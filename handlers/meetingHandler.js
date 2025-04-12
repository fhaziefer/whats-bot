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
  console.log(`Processing image: ${imagePath}`);
  let worker;

  try {
    worker = await createWorker();

    await worker.load();

    const {
      data: { text },
    } = await worker.recognize(imagePath);
    return text;
  } catch (error) {
    console.error("OCR Processing Error:", error);
    return "";
  } finally {
    if (worker) {
      await worker
        .terminate()
        .catch((e) => console.error("Termination error:", e));
    }
  }
}

function cleanOcrText(text) {
  return text
    .replace(/[~©®™+•”"“|]/g, ":") // ganti simbol kacau dengan titik dua
    .replace(/[^\x00-\x7F]/g, "") // buang karakter non-ASCII (opsional)
    .replace(/[\s]+/g, " ") // normalisasi spasi
    .replace(/\n/g, " \n ") // buang line-break
    .trim();
}

function extractMeetingDetails(text) {
  if (!text || typeof text !== "string" || text.length < 10) {
    throw new Error("Invalid text input");
  }

  // Enhanced text cleaning
  text = cleanOcrText(text);
  function extractMeetingDetails(text) {
    if (!text || typeof text !== "string" || text.length < 10) {
      throw new Error("Invalid text input");
    }
  
    // Enhanced text cleaning
    text = text
      .replace(/[~©®™+•”"“|]/g, ":")
      .replace(/::+/g, ":")
      .replace(/:\s*:/g, ":")
      .replace(/\s+/g, " ")
      .trim();
  
    console.log("Cleaned text:", text);
  
    // 1. Extract meeting type - more precise pattern
    const meetingTypeMatch = text.match(
      /(?:acara|rapat)\s*(.*?)\s*(?:yang akan dilaksanakan|pada|$)/i
    );
    const meetingType = meetingTypeMatch 
      ? `Rapat ${meetingTypeMatch[1].trim().replace(/\.$/, '')}`
      : "Rapat Harian";
  
    // 2. Extract day - exact pattern
    const dayMatch = text.match(/Hari\s*:\s*([^\n]+?)(?=\s*Tanggal|$)/i);
    const dayOfWeek = dayMatch ? dayMatch[1].trim() : "";
  
    // 3. Extract date - keep both Hijri and Gregorian
    const dateMatch = text.match(/Tanggal\s*:\s*([^\n]+?)(?=\s*Waktu|$)/i);
    const fullDate = dateMatch ? dateMatch[1].trim() : "";
  
    // 4. Extract time - keep original format
    const timeMatch = text.match(/Waktu\s*:\s*([^\n]+?)(?=\s*Tempat|$)/i);
    const time = timeMatch ? timeMatch[1].trim() : "";
  
    // 5. Extract location - stop at punctuation
    const locationMatch = text.match(/Tempat\s*:\s*([^\n.,;]+)/i);
    const location = locationMatch ? locationMatch[1].trim() : "Kantor";
  
    return {
      acara: meetingType,
      hari: dayOfWeek,
      tanggal: fullDate,
      waktu: time,
      tempat: location
    };
  }
  
  function createShortReply(details) {
    if (!details || typeof details !== "object") {
      return `Wa'alaikumussalam Wr. Wb.\n\nMatur nuwun sanget kagem undanganipun, insyaAllah kulo usahaaken hadir.`;
    }
  
    return (
      `Wa'alaikumussalam Wr. Wb.\n\n` +
      `Detail Undangan:\n` +
      `Acara: ${details.acara}\n` +
      `Hari: ${details.hari}\n` +
      `Tanggal: ${details.tanggal}\n` +
      `Waktu: ${details.waktu}\n` +
      `Tempat: ${details.tempat}\n\n` +
      `Matur nuwun sanget, insyaAllah kulo usahaaken hadir.`
    );
  }
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
  let isImage = false;

  // Process image if exists
  if (message.hasMedia) {
    try {
      const media = await message.downloadMedia();
      if (media && media.mimetype.startsWith("image/")) {
        const tempDir = "./temp";
        try {
          await mkdir(tempDir, { recursive: true });
        } catch (mkdirError) {
          if (mkdirError.code !== "EEXIST") throw mkdirError;
        }

        const fileExt = media.mimetype.split("/")[1] || "jpg";
        const filePath = path.join(tempDir, `invite_${Date.now()}.${fileExt}`);

        await writeFile(filePath, media.data, "base64");
        text = await extractTextFromImage(filePath);
        await unlink(filePath);
        isImage = true;

        if (!text || text.trim().length < 20) {
          console.log("No valid text extracted from image");
          return false;
        }
      }
    } catch (error) {
      console.error("Image processing error:", error);
      return false;
    }
  }

  // Check if it's an invitation
  if (!/(undangan|rapat|wekdalipun|panggenanipun)/i.test(text)) {
    return false;
  }

  try {
    const details = extractMeetingDetails(text);
    console.log("Extracted details:", JSON.stringify(details, null, 2));

    await new Promise((resolve) => setTimeout(resolve, 15000)); // 15s delay
    await message.reply(createShortReply(details));
    return true;
  } catch (error) {
    console.error("Error processing invitation:", error);
    // Fallback reply
    await new Promise((resolve) => setTimeout(resolve, 15000));
    await message.reply(
      `Wa'alaikumussalam Wr. Wb.\n\n` +
        `Matur nuwun sanget kagem undanganipun.\n\n` +
        `Wassalamu'alaikum Wr. Wb.`
    );
    return false;
  }
}

module.exports = { handleMeeting };
