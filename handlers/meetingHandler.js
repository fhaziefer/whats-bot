const { createWorker } = require("tesseract.js");
const fs = require("fs");
const path = require("path");
const moment = require("moment");
const momentHijri = require("moment-hijri");
moment.locale("id");
momentHijri.locale("id");

// Promisify file operations
const writeFile = fs.promises.writeFile;
const unlink = fs.promises.unlink;
const mkdir = fs.promises.mkdir;

async function extractTextFromImage(imagePath) {
  console.log(`Processing image: ${path.basename(imagePath)}`);
  
  const worker = await createWorker('ind+eng'); // Langsung specify bahasa
  
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
    if (!gregorianDate || typeof gregorianDate !== "string") {
      return "tanggal belum ditentukan";
    }

    // Clean the date string
    const cleanedDate = gregorianDate
      .replace(/[^\w\s\d-]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // Try multiple date formats
    const formats = [
      "DD MMMM YYYY",
      "DD-MM-YYYY",
      "D MMMM YYYY",
      "DD/MM/YYYY",
      "YYYY-MM-DD",
    ];

    let mDate;
    for (const format of formats) {
      mDate = moment(cleanedDate, format);
      if (mDate.isValid()) break;
    }

    if (!mDate.isValid()) {
      console.warn(`Invalid date format: ${gregorianDate}`);
      return gregorianDate;
    }

    const hijriDate = momentHijri(mDate).format("iD iMMMM iYYYY");
    const gregorianFormatted = mDate.format("dddd, DD MMMM YYYY");

    return `${gregorianFormatted} (${hijriDate} H)`;
  } catch (error) {
    console.error("Date conversion error:", error);
    return gregorianDate;
  }
}

function extractMeetingDetails(text) {
  if (!text || typeof text !== "string" || text.length < 10) {
    throw new Error("Invalid text input");
  }

  const getMatch = (patterns, defaultValue = "") => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) return match[1].trim();
    }
    return defaultValue;
  };

  const rawDate = getMatch(
    [
      /hari\s*:\s*(.*?)(?:\n|$)/i,
      /tanggal\s*:\s*(.*?)(?:\n|$)/i,
      /dilaksanakan\s*pada\s*(.*?)(?=\s*(?:wekdalipun|waktu|tempat))/i,
    ],
    ""
  );

  return {
    meetingType: getMatch(
      [
        /undangan\s*(.*?)(?=\s*(?:hari|tanggal|wekdalipun|dilaksanakan))/i,
        /acara\s*(.*?)(?=\s*(?:hari|tanggal|dilaksanakan))/i,
        /rapat\s*(.*?)(?=\s*(?:hari|tanggal|dilaksanakan))/i,
      ],
      "acara penting"
    ),
    date: rawDate ? convertToHijriDate(rawDate) : "akan ditentukan",
    time: getMatch(
      [
        /wekdalipun\s*:\s*(.*?)(?:\n|$)/i,
        /waktu\s*:\s*(.*?)(?:\n|$)/i,
        /jam\s*([0-9.:]+)\s*(?=\s*(?:wi?s?|malam|pagi|siang|selesai))/i,
      ],
      "00.00"
    ).replace(/\./g, ":"),
    location: getMatch(
      [
        /panggenanipun\s*:\s*(.*?)(?:\n|$)/i,
        /tempat\s*:\s*(.*?)(?:\n|$)/i,
        /lokasi\s*:\s*(.*?)(?:\n|$)/i,
      ],
      "akan ditentukan"
    ),
  };
}

function createShortReply(details) {
  if (!details || typeof details !== "object") {
    return `Wa'alaikumussalam Wr. Wb.\n\nMatur nuwun sanget kagem undanganipun.\n\nWassalamu'alaikum Wr. Wb.`;
  }

  return (
    `Wa'alaikumussalam Wr. Wb.\n\n` +
    `Matur nuwun sanget kagem undanganipun.\n` +
    (details.meetingType
      ? `Njeh, insyaAllah dalem usahaaken saget hadir dateng acara ${details.meetingType}\n\n`
      : "\n") +
    `Wassalamu'alaikum Wr. Wb.`
  );
}

async function handleMeeting(message, botInfo) {
  // Skip if from bot itself or group
  if (
    !message ||
    !botInfo ||
    message.from === `${botInfo?.botNumber}@c.us` ||
    message.from.includes("@g.us")
  ) {
    return false;
  }

  let text = message.body || "";

  // Proses gambar jika ada
  if (message.hasMedia) {
    try {
      const media = await message.downloadMedia();
      if (!media || !media.mimetype.startsWith("image/")) {
        console.log("Bukan gambar yang valid");
        return false;
      }

      // Buat folder temp jika belum ada (dengan callback)
      const tempDir = "./temp";
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const fileExt = media.mimetype.split("/")[1] || "jpg";
      const filePath = path.join(tempDir, `undangan_${Date.now()}.${fileExt}`);

      // Gunakan writeFileSync untuk menghindari promise issues
      fs.writeFileSync(filePath, media.data, "base64");
      console.log("Gambar disimpan di:", filePath);

      text = await extractTextFromImage(filePath);
      fs.unlinkSync(filePath); // Hapus file setelah diproses

      if (!text || text.length < 20) {
        console.log("Teks tidak terdeteksi dalam gambar");
        return false;
      }
    } catch (error) {
      console.error("Error memproses gambar:", error);
      return false;
    }
  }

  // Cek apakah ini undangan
  if (!/(undangan|rapat|wekdalipun|panggenanipun)/i.test(text)) {
    return false;
  }

  try {
    const details = {
      meetingType:
        text.match(
          /undangan\s*(.*?)(?=\s*(?:hari|tanggal|wekdalipun|dilaksanakan))/i
        )?.[1] || "rapat penting",
      date: text.match(/hari\s*:\s*(.*?)(?:\n|$)/i)?.[1] || "akan ditentukan",
      time: (
        text.match(/wekdalipun\s*:\s*(.*?)(?:\n|$)/i)?.[1] || "00.00"
      ).replace(/\./g, ":"),
      location:
        text.match(/panggenanipun\s*:\s*(.*?)(?:\n|$)/i)?.[1] ||
        "akan ditentukan",
    };

    // Delay 15 detik
    await new Promise((resolve) => setTimeout(resolve, 15000));

    // Kirim balasan
    await message.reply(
      `Wa'alaikumussalam Wr. Wb.\n\n` +
        `Matur nuwun sanget kagem undanganipun.\n` +
        `Njeh, insyaAllah dalem usahaaken saget hadir dateng acara ${details.meetingType}\n\n` +
        `Wassalamu'alaikum Wr. Wb.`
    );

    return true;
  } catch (error) {
    console.error("Error memproses undangan:", error);
    return false;
  }
}

module.exports = { handleMeeting };
