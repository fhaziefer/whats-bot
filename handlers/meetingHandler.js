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
  const worker = await createWorker();
  try {
    await worker.loadLanguage("eng");
    await worker.initialize("eng");
    const {
      data: { text },
    } = await worker.recognize(imagePath);
    return text;
  } finally {
    await worker.terminate();
  }
}

function extractMeetingDetails(text) {
  if (!text || typeof text !== "string" || text.length < 10) {
    throw new Error("Invalid text input");
  }

  // Enhanced text cleaning
  text = text
    .replace(/[‘’'`~©+£]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\n/g, " ")
    .trim();

  // 1. Extract date
  const dateMatch = text.match(
    /Tanggal\s*:\s*(\d+\s+\w+\s+\d+\s*H\.?\/\s*(\d+\s+\w+\s+\d+)\s*M)/i
  );
  let gregorianDate = "tanggal belum ditentukan";
  let dayOfWeek = "Jum'at"; // Default to Jum'at

  if (dateMatch && dateMatch[2]) {
    gregorianDate = dateMatch[2]
      .trim()
      .replace(/\bMM?aret\b/g, "Maret")
      .replace(/[^\w\s\d]/g, "");
  }

  // 2. Extract meeting type with better stopping condition
  // 2. Extract meeting type with better stopping condition
  const meetingTypeMatch = text.match(
    /dalam\s+rangka\s+(.*?)(?=\s*(?:yang\s+insya\s+Allah|pada\s*:|$))/i
  );
  const meetingType = meetingTypeMatch
    ? meetingTypeMatch[1]
        .replace(/\s+/g, " ")
        .replace(/[^\w\s.,-]/g, "")
        .trim()
    : "Rapat";

  // 3. Extract time
  const timeMatch = text.match(
    /Waktu\s*[^:\d]*(\d{1,2})[.:\s]*(\d{2})?\s*Wis?\s*\(?\s*Malam\s*\)?/i
  );
  let time = "00:00";
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]) || 0;
    const minutes = parseInt(timeMatch[2]) || 0;
    if (text.toLowerCase().includes("malam") && hours < 12) {
      hours += 12;
    }
    time = `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}`;
  }

  // 4. Improved location extraction - stops at line end or punctuation
  const locationMatch = text.match(/Tempat\s*:\s*([^\n.,;]+)/i);
  let location = "Kantor Muktamar P2L"; // Default value
  if (locationMatch) {
    location = locationMatch[1]
      .split(/[.,;]/)[0] // Split at punctuation
      .replace(/Demikian.*$/i, "") // Remove any "Demikian" text
      .trim();

    // Special case for P2L
    if (location.includes("P2L")) {
      location = "Kantor Muktamar P2L";
    }
  }

  return {
    meetingType: meetingType,
    day: dayOfWeek,
    date: gregorianDate,
    time: time,
    location: location,
  };
}

function convertToGregorianDate(rawDate) {
  if (!rawDate) return "";

  try {
    // Try to extract Gregorian part from "Hijri/Gregorian" format
    const gregMatch = rawDate.match(/\/(\d+\s+\w+\s+\d+\s*M)/i);
    if (gregMatch && gregMatch[1]) {
      return gregMatch[1].replace(/\s*M/i, "").trim();
    }

    // If no slash format, try to parse directly
    const cleaned = rawDate
      .replace(/[^\w\s\d-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Try common date formats
    const formats = ["DD MMMM YYYY", "D MMMM YYYY", "DD-MM-YYYY", "YYYY-MM-DD"];
    for (const fmt of formats) {
      const mDate = moment(cleaned, fmt);
      if (mDate.isValid()) {
        return mDate.format("DD MMMM YYYY");
      }
    }

    return cleaned;
  } catch (error) {
    console.error("Date conversion error:", error);
    return rawDate;
  }
}

function normalizeTime(timeStr) {
  if (!timeStr) return "00:00";

  // Clean the time string
  timeStr = timeStr
    .toLowerCase()
    .replace(/[^\d\w\s:.]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Extract time parts
  const timeMatch = timeStr.match(
    /(\d{1,2})[.:]?(\d{2})?\s*(pagi|siang|sore|malam)?/i
  );
  if (!timeMatch) return "00:00";

  let hours = parseInt(timeMatch[1]) || 0;
  const minutes = parseInt(timeMatch[2]) || 0;
  const period = timeMatch[3];

  // Convert to 24-hour format
  if (period === "malam" && hours < 12) hours += 12;
  if (period === "siang" && hours < 12) hours += 12;
  if (period === "sore" && hours < 12) hours += 12;

  // Ensure valid time
  hours = Math.min(23, Math.max(0, hours));
  const normMins = Math.min(59, Math.max(0, minutes));

  return `${hours.toString().padStart(2, "0")}:${normMins
    .toString()
    .padStart(2, "0")}`;
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
