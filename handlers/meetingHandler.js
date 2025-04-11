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
      logger: (m) => console.log(m.status),
      // Simplified configuration - let the package handle its own paths
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
    });

    await worker.loadLanguage("eng");
    await worker.initialize("eng");

    const {
      data: { text },
    } = await worker.recognize(imagePath);
    console.log(`Extracted ${text.length} characters`);
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
    `Wa'alaikumussalam Wr. Wb.\n` +
    `Matur nuwun sanget kagem undanganipun.\n` +
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
