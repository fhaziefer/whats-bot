const { createWorker } = require("tesseract.js");
const fs = require("fs");
const path = require("path");
const moment = require("moment-hijri");
moment.locale("id");

// Fungsi untuk ekstrak teks dari gambar
async function extractTextFromImage(imagePath) {
  const worker = await createWorker();
  try {
    await worker.loadLanguage("ind+eng");
    await worker.initialize("ind+eng");
    const {
      data: { text },
    } = await worker.recognize(imagePath);
    return text;
  } finally {
    await worker.terminate();
  }
}

// Fungsi untuk mengekstrak detail undangan
function extractMeetingDetails(text) {
  const meetingType =
    text.match(
      /undangan\s*(.*?)(?=\s*(?:hari|wekdalipun|tanggal|dilaksanakan))/i
    )?.[1] ||
    text.match(/acara\s*(.*?)(?=\s*(?:hari|tanggal|dilaksanakan))/i)?.[1] ||
    "rapat penting";

  const dateMatch =
    text.match(/Hari\s*:\s*(.*?)(?:\n|$)/i)?.[1] ||
    text.match(/Tanggal\s*:\s*(.*?)(?:\n|$)/i)?.[1] ||
    "hari yang akan ditentukan";

  const timeMatch = (
    text.match(/Wekdalipun\s*:\s*(.*?)(?:\n|$)/i)?.[1] ||
    text.match(/Waktu\s*:\s*(.*?)(?:\n|$)/i)?.[1] ||
    "00.00"
  ).replace(/\./g, ":");

  const location =
    text.match(/Panggenanipun\s*:\s*(.*?)(?:\n|$)/i)?.[1] ||
    text.match(/Tempat\s*:\s*(.*?)(?:\n|$)/i)?.[1] ||
    "tempat yang akan ditentukan";

  return {
    meetingType: meetingType.trim(),
    date: dateMatch.trim(),
    time: timeMatch.trim(),
    location: location.trim(),
  };
}

// Fungsi untuk membuat balasan singkat
function createShortReply(details) {
  return (
    `Wa'alaikumussalam Wr. Wb.\n\n` +
    `Matur nuwun sanget kagem undanganipun.\n` +
    `Njeh, insyaAllah dalem usahaaken saget hadir dateng acara ${details.meetingType}\n\n` +
    `Wassalamu'alaikum Wr. Wb.`
  );
}

// Fungsi utama untuk menangani undangan
async function handleMeeting(message, botInfo) {
  // Jangan balas jika pesan dari bot sendiri atau group

  // Tambahkan di awal fungsi handleMeeting
  const tempDir = "./temp";
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
    console.log("Folder temp created");
  }

  if (
    message.from === `${botInfo?.botNumber}@c.us` ||
    message.from.includes("@g.us")
  ) {
    return false;
  }

  let text = message.body || "";

  // Jika pesan mengandung gambar
  if (message.hasMedia) {
    try {
      const media = await message.downloadMedia();
      if (media && ["image/jpeg", "image/png"].includes(media.mimetype)) {
        const tempDir = "./temp";
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

        const filename = `undangan_${Date.now()}.${
          media.mimetype.split("/")[1]
        }`;
        const filePath = path.join(tempDir, filename);

        fs.writeFileSync(filePath, media.data, "base64");
        text = await extractTextFromImage(filePath);
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error("Error processing image:", error);
    }
  }

  // Cek apakah ini undangan
  if (!/(undangan|rapat|wekdalipun|panggenanipun)/i.test(text)) {
    return false;
  }

  try {
    // Ekstrak detail undangan
    const details = extractMeetingDetails(text);

    // Tambah delay 15 detik sebelum membalas
    await new Promise((resolve) => setTimeout(resolve, 15000));

    // Kirim balasan singkat
    await message.reply(createShortReply(details));

    return true;
  } catch (error) {
    console.error("Error processing invitation:", error);
    return false;
  }
}

module.exports = { handleMeeting };
