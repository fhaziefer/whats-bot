const { createWorker } = require("tesseract.js");
const fs = require("fs");
const path = require("path");
const moment = require("moment");
const momentHijri = require("moment-hijri");
moment.locale("id");
momentHijri.locale("id");

// Promisified file operations
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

async function extractTextFromImage(imagePath) {
  console.log(`Processing image: ${path.basename(imagePath)}`);
  
  const worker = await createWorker({
    cacheMethod: 'none',
    workerPath: require.resolve('tesseract.js/dist/worker.min.js'),
    lang: 'ind+eng'
  });

  try {
    const { data: { text } } = await worker.recognize(imagePath);
    console.log(`Extracted ${text.length} characters`);
    return text;
  } finally {
    await worker.terminate();
  }
}

function convertToHijriDate(gregorianDate) {
  try {
    if (!gregorianDate) return "tanggal belum ditentukan";
    
    // Clean date string
    const cleanedDate = gregorianDate
      .replace(/[^\w\s\d-]/g, '')
      .replace(/\b(\d{1,2})\b/g, '0$1');
    
    // Try multiple date formats
    const formats = [
      "DD MMMM YYYY",
      "DD-MM-YYYY", 
      "DD/MM/YYYY",
      "D MMMM YYYY"
    ];
    
    let mDate;
    for (const format of formats) {
      mDate = moment(cleanedDate, format);
      if (mDate.isValid()) break;
    }
    
    if (!mDate.isValid()) {
      console.warn(`Invalid date format: ${gregorianDate}`);
      return gregorianDate; // Return original if can't parse
    }
    
    const hijriDate = momentHijri(mDate).format("iD iMMMM iYYYY");
    const gregorianFormatted = mDate.format("dddd, DD MMMM YYYY");
    
    return `${gregorianFormatted} (${hijriDate} H)`;
  } catch (error) {
    console.error("Date conversion error:", error);
    return gregorianDate; // Fallback to original date
  }
}

function extractMeetingDetails(text) {
  const getMatch = (patterns, defaultValue = '') => {
    if (!text) return defaultValue;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) return match[1].trim();
    }
    return defaultValue;
  };

  const rawDate = getMatch([
    /hari\s*:\s*(.*?)(?:\n|$)/i,
    /tanggal\s*:\s*(.*?)(?:\n|$)/i,
    /dilaksanakan\s*pada\s*(.*?)(?=\s*(?:wekdalipun|waktu|tempat))/i
  ], "");

  return {
    meetingType: getMatch([
      /undangan\s*(.*?)(?=\s*(?:hari|tanggal|wekdalipun|dilaksanakan))/i,
      /acara\s*(.*?)(?=\s*(?:hari|tanggal|dilaksanakan))/i,
      /rapat\s*(.*?)(?=\s*(?:hari|tanggal|dilaksanakan))/i
    ], "acara penting"),
    date: rawDate ? convertToHijriDate(rawDate) : "akan ditentukan",
    time: getMatch([
      /wekdalipun\s*:\s*(.*?)(?:\n|$)/i,
      /waktu\s*:\s*(.*?)(?:\n|$)/i,
      /jam\s*([0-9.:]+)\s*(?=\s*(?:wi?s?|malam|pagi|siang|selesai))/i
    ], "00.00").replace(/\./g, ":"),
    location: getMatch([
      /panggenanipun\s*:\s*(.*?)(?:\n|$)/i,
      /tempat\s*:\s*(.*?)(?:\n|$)/i,
      /lokasi\s*:\s*(.*?)(?:\n|$)/i
    ], "akan ditentukan")
  };
}

function createShortReply(details) {
  if (!details || typeof details !== 'object') {
    return `Wa'alaikumussalam Wr. Wb.\n\nMatur nuwun sanget kagem undanganipun.\n\nWassalamu'alaikum Wr. Wb.`;
  }

  return `Wa'alaikumussalam Wr. Wb.\n\n` +
    `Matur nuwun sanget kagem undanganipun.\n` +
    (details.meetingType ? `Njeh, insyaAllah dalem usahaaken saget hadir dateng acara ${details.meetingType}\n\n` : '\n') +
    `Wassalamu'alaikum Wr. Wb.`;
}

async function handleMeeting(message, botInfo) {
  // Skip if from bot itself or group
  if (message.from === `${botInfo?.botNumber}@c.us` || message.from.includes("@g.us")) {
    return false;
  }

  let text = message.body || "";
  let isImage = false;

  // Process image if exists
  if (message.hasMedia) {
    try {
      const media = await message.downloadMedia();
      if (media && media.mimetype.startsWith('image/')) {
        const tempDir = "./temp";
        if (!fs.existsSync(tempDir)) {
          await mkdir(tempDir, { recursive: true });
        }

        const fileExt = media.mimetype.split('/')[1] || 'jpg';
        const filePath = path.join(tempDir, `invite_${Date.now()}.${fileExt}`);
        
        await writeFile(filePath, media.data, "base64");
        text = await extractTextFromImage(filePath);
        await unlink(filePath);
        isImage = true;

        if (!text || text.length < 20) {
          console.log('No valid text extracted from image');
          return false;
        }
      }
    } catch (error) {
      console.error('Image processing error:', error);
      return false;
    }
  }

  // Check if it's an invitation
  if (!/(undangan|rapat|wekdalipun|panggenanipun)/i.test(text)) {
    return false;
  }

  try {
    const details = extractMeetingDetails(text);
    console.log('Extracted details:', details);
    
    await new Promise(resolve => setTimeout(resolve, 15000)); // 15s delay
    await message.reply(createShortReply(details));
    return true;
  } catch (error) {
    console.error('Error processing invitation:', error);
    // Fallback reply
    await new Promise(resolve => setTimeout(resolve, 15000));
    await message.reply(
      `Wa'alaikumussalam Wr. Wb.\n\n` +
      `Matur nuwun sanget kagem undanganipun.\n\n` +
      `Wassalamu'alaikum Wr. Wb.`
    );
    return false;
  }
}

module.exports = { handleMeeting };