const { createWorker } = require("tesseract.js");
const fs = require("fs");
const path = require("path");
const moment = require("moment-hijri");
moment.locale("id");

// Logger yang lebih aman
function createSafeLogger() {
  return {
    logger: (m) => {
      try {
        if (['initializing', 'recognizing text', 'done'].includes(m.status)) {
          console.log(`[OCR] ${m.status}: ${Math.round(m.progress * 100)}%`);
        }
      } catch (err) {
        console.error('Logger error:', err.message);
      }
    }
  };
}

// Fungsi ekstrak teks dari gambar yang diperbaiki
async function extractTextFromImage(imagePath) {
  console.log('Memulai proses OCR untuk:', path.basename(imagePath));
  
  const worker = await createWorker({
    ...createSafeLogger(),
    cacheMethod: 'none',
    workerPath: require.resolve('tesseract.js/dist/worker.min.js'), // Path yang lebih kompatibel
    errorHandler: (err) => console.error('Worker error:', err)
  });

  try {
    // Gunakan try-catch terpisah untuk initialize dan recognize
    let text = '';
    try {
      await worker.initialize('ind+eng');
      const result = await worker.recognize(imagePath);
      text = result.data.text;
    } catch (ocrError) {
      console.error('Error selama OCR:', ocrError);
      throw ocrError;
    }

    console.log('Berhasil ekstrak teks. Panjang:', text.length);
    if (text.length < 20) {
      console.warn('Peringatan: Teks yang diekstrak sangat pendek');
    }

    return text;
  } finally {
    try {
      await worker.terminate();
    } catch (terminateError) {
      console.error('Error saat terminate worker:', terminateError);
    }
  }
}

// Fungsi ekstrak detail dengan validasi lebih ketat
function extractMeetingDetails(text) {
  if (!text || typeof text !== 'string' || text.length < 10) {
    throw new Error('Teks tidak valid untuk diproses');
  }

  const cleanText = text.replace(/\s+/g, ' ').replace(/[^\w\s:.,-]/g, '');

  const patterns = {
    meetingType: [
      /undangan\s*(.*?)(?=\s*(?:hari|tanggal|wekdalipun|dilaksanakan|acara))/i,
      /acara\s*(.*?)(?=\s*(?:hari|tanggal|dilaksanakan))/i,
      /rapat\s*(.*?)(?=\s*(?:hari|tanggal|dilaksanakan))/i
    ],
    date: [
      /hari\s*:\s*(.*?)(?:\n|$)/i,
      /tanggal\s*:\s*(.*?)(?:\n|$)/i,
      /dilaksanakan\s*pada\s*(.*?)(?=\s*(?:wekdalipun|waktu|tempat))/i
    ],
    time: [
      /wekdalipun\s*:\s*(.*?)(?:\n|$)/i,
      /waktu\s*:\s*(.*?)(?:\n|$)/i,
      /jam\s*([0-9.:]+)\s*(?=\s*(?:wi?s?|malam|pagi|siang|selesai))/i
    ],
    location: [
      /panggenanipun\s*:\s*(.*?)(?:\n|$)/i,
      /tempat\s*:\s*(.*?)(?:\n|$)/i,
      /lokasi\s*:\s*(.*?)(?:\n|$)/i
    ]
  };

  const extractField = (field) => {
    for (const pattern of patterns[field]) {
      const match = cleanText.match(pattern);
      if (match && match[1]) return match[1].trim();
    }
    return field === 'time' ? '00.00' : 'akan ditentukan';
  };

  return {
    meetingType: extractField('meetingType'),
    date: extractField('date'),
    time: extractField('time').replace(/\./g, ":"),
    location: extractField('location')
  };
}

// Fungsi balasan singkat yang lebih fleksibel
function createShortReply(details) {
  if (!details || typeof details !== 'object') {
    return `Wa'alaikumussalam Wr. Wb.\n\nMatur nuwun sanget kagem undanganipun.\n\nWassalamu'alaikum Wr. Wb.`;
  }

  return `Wa'alaikumussalam Wr. Wb.\n\n` +
    `Matur nuwun sanget kagem undanganipun.\n` +
    (details.meetingType ? `Njeh, insyaAllah dalem usahaaken saget hadir dateng acara ${details.meetingType}\n\n` : '\n') +
    `Wassalamu'alaikum Wr. Wb.`;
}

// Fungsi utama yang sudah dioptimasi
async function handleMeeting(message, botInfo) {
  // Validasi awal
  if (!message || !botInfo) return false;
  if (message.from === `${botInfo?.botNumber}@c.us` || message.from.includes("@g.us")) {
    return false;
  }

  // Setup folder temp
  const tempDir = "./temp";
  try {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  } catch (dirError) {
    console.error('Gagal membuat folder temp:', dirError);
    return false;
  }

  let text = message.body || "";
  let isFromImage = false;

  // Proses gambar jika ada
  if (message.hasMedia) {
    try {
      const media = await message.downloadMedia();
      if (!media || !media.mimetype.startsWith('image/')) {
        console.log('Media bukan gambar atau tidak valid');
        return false;
      }

      const fileExt = media.mimetype.split('/')[1] || 'jpg';
      const filePath = path.join(tempDir, `undangan_${Date.now()}.${fileExt}`);
      
      await fs.promises.writeFile(filePath, media.data, "base64");
      console.log('Gambar disimpan di:', filePath);

      text = await extractTextFromImage(filePath);
      await fs.promises.unlink(filePath);
      isFromImage = true;

      if (!text || text.trim().length < 10) {
        console.log('Teks tidak terdeteksi dalam gambar');
        return false;
      }
    } catch (mediaError) {
      console.error('Error memproses media:', mediaError);
      return false;
    }
  }

  // Proses teks undangan
  try {
    if (!/(undangan|rapat|wekdalipun|panggenanipun)/i.test(text)) {
      return false;
    }

    const details = extractMeetingDetails(text);
    console.log('Detail undangan:', JSON.stringify(details, null, 2));

    // Delay 15 detik
    await new Promise(resolve => setTimeout(resolve, 15000));

    const reply = createShortReply(details);
    await message.reply(reply);
    console.log('Balasan terkirim:', reply.substring(0, 50) + '...');

    return true;
  } catch (error) {
    console.error('Error memproses undangan:', error);
    
    // Kirim balasan default jika error
    await new Promise(resolve => setTimeout(resolve, 15000));
    await message.reply(createShortReply(null));
    
    return false;
  }
}

module.exports = { handleMeeting };