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
    worker = await createWorker({
      // logger: (m) => console.log(m.status),
      // Simplified configuration - let the package handle its own paths
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
    });

    await worker.loadLanguage("eng");
    await worker.initialize("eng");

    const {
      data: { text },
    } = await worker.recognize(imagePath);
    // console.log(`Extracted ${text.length} characters`);
    console.log(text);
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

function convertToGregorianDate(rawDate) {
  try {
    if (!rawDate || typeof rawDate !== "string") {
      return "tanggal belum ditentukan";
    }

    // Extract Gregorian date from "Hijri/Gregorian" format
    const gregorianMatch = rawDate.match(
      /\d+\s\w+\s\d+\sH\.?\/\s*(\d+\s\w+\s\d+\sM)/i
    );
    if (gregorianMatch && gregorianMatch[1]) {
      return gregorianMatch[1].replace(/M\.?/i, "").trim();
    }

    // If no Hijri/Gregorian format, try to parse as Gregorian directly
    const cleanedDate = rawDate
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
      console.warn(`Invalid date format: ${rawDate}`);
      return rawDate;
    }

    return mDate.format("DD MMMM YYYY");
  } catch (error) {
    console.error("Date conversion error:", error);
    return rawDate;
  }
}

function normalizeTime(timeStr) {
  if (!timeStr) return "00:00";

  // Clean the time string
  timeStr = timeStr
    .replace(/[^\d\w\s:.]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Extract time parts
  const timeMatch = timeStr.match(
    /(\d{1,2})[.:]?(\d{2})?\s*(Pagi|Siang|Sore|Malam|pagi|siang|sore|malam)?/i
  );
  if (!timeMatch) return "00:00";

  let hours = parseInt(timeMatch[1]) || 0;
  const minutes = parseInt(timeMatch[2]) || 0;
  const period = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

  // Convert to 24-hour format
  if (period === "malam" && hours < 12) hours += 12;
  if (period === "siang" && hours < 12) hours += 12;
  if (period === "sore" && hours < 12) hours += 12;

  // Ensure valid time
  hours = Math.min(23, Math.max(0, hours));
  const normalizedMinutes = Math.min(59, Math.max(0, minutes));

  return `${hours.toString().padStart(2, "0")}:${normalizedMinutes
    .toString()
    .padStart(2, "0")}`;
}

function extractMeetingDetails(text) {
  if (!text || typeof text !== "string" || text.length < 10) {
    throw new Error("Invalid text input");
  }

  // Clean the text more aggressively
  text = text
    .replace(/[~©‘’]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\n/g, " ")
    .trim();

  const getMatch = (patterns, defaultValue = "") => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1]
          .trim()
          .replace(/\s{2,}/g, " ")
          .replace(/[^a-zA-Z0-9\s\/\-:.,()]/g, "");
      }
    }
    return defaultValue;
  };

  // Extract meeting type
  const meetingType = getMatch(
    [
      /Perihal\s*:\s*UNDANGAN\s*(.*?)(?=\s*(?:hari|tanggal|waktu|tempat|dilaksanakan|assalam|wassalam))/i,
      /rapat\s*(Evaluasi.*?)(?=\s*(?:hari|tanggal|waktu|tempat|dilaksanakan))/i,
      /undangan\s*(rapat.*?)(?=\s*(?:hari|tanggal|waktu|tempat|dilaksanakan))/i,
    ],
    "Rapat"
  );

  // Extract day
  const day = getMatch(
    [
      /Hari\s*:\s*(.*?)(?=\s*(?:tanggal|waktu|tempat|dilaksanakan|assalam|wassalam))/i,
    ],
    ""
  ).replace(/’/g, "'"); // Fix apostrophe

  // Extract date
  const rawDate = getMatch(
    [
      /Tanggal\s*:\s*(.*?)(?=\s*(?:waktu|tempat|dilaksanakan|assalam|wassalam))/i,
      /dilaksanakan\s*pada\s*(.*?)(?=\s*(?:waktu|tempat))/i,
    ],
    ""
  );

  // Extract time
  const rawTime = getMatch(
    [
      /Waktu\s*:\s*(.*?)(?=\s*(?:tempat|dilaksanakan|assalam|wassalam))/i,
      /waktu\s*(\d+[.:]\d+\s*Wis.*?)(?=\s*(?:tempat|dilaksanakan))/i,
    ],
    "00:00"
  );

  // Extract location
  const location = getMatch(
    [
      /Tempat\s*:\s*(.*?)(?=\s*(?:demikian|wassalam|assalam|pengurus|sekretariat))/i,
    ],
    "Kantor"
  )
    .split(/[,.]/)[0]
    .trim();

  return {
    meetingType: meetingType,
    day: day,
    date: convertToGregorianDate(rawDate),
    time: normalizeTime(rawTime),
    location: location,
  };
}

function createShortReply(details) {
  if (!details || typeof details !== "object") {
    return `Wa'alaikumussalam Wr. Wb.\n\nMatur nuwun sanget kagem undanganipun, insyaAllah kulo usahaaken hadir.`;
  }

  return (
    `Wa'alaikumussalam Wr. Wb.\n` +
    `Matur nuwun sanget kagem undangan ${details.meetingType}.\n` +
    (details.day ? `Hari: ${details.day}\n` : "") +
    `Tanggal: ${details.date}\n` +
    `Waktu: ${details.time}\n` +
    `Tempat: ${details.location}\n\n` +
    `Njeh, InsyaAllah kulo usahaaken hadir.`
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
