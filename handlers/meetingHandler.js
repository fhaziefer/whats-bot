const { createWorker } = require("tesseract.js");
const fs = require("fs");
const path = require("path");
const moment = require("moment-hijri");
moment.locale("id");

// Fungsi untuk ekstrak teks dari gambar
async function extractTextFromImage(imagePath) {
  console.log("Memulai OCR untuk:", imagePath);
  const worker = await createWorker({
    logger: (progress) => console.log(progress),
    cachePath: "./tesseract-cache",
    gzip: false,
  });

  try {
    await worker.load();
    await worker.initialize("ind+eng");

    console.log("Memproses gambar...");
    const {
      data: { text },
    } = await worker.recognize(imagePath);
    console.log("Teks berhasil diekstrak");

    return text;
  } catch (error) {
    console.error("Gagal OCR:", error);
    throw error;
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
  console.log(message);
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
      if (!media) {
        console.log("Media tidak valid");
        return false;
      }

      const tempDir = "./temp";
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
      }

      const filePath = path.join(
        tempDir,
        `undangan_${Date.now()}.${media.mimetype.split("/")[1]}`
      );
      fs.writeFileSync(filePath, media.data, "base64");

      console.log("Memulai ekstraksi teks...");
      const text = await extractTextFromImage(filePath);
      fs.unlinkSync(filePath);

      if (!text) {
        console.log("Tidak ada teks yang terdeteksi");
        return false;
      }
    } catch (error) {
      console.error("Error processing image:", error);
      return false;
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
