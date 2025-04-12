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
    // console.log(text);
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

function convertToHijriDate(rawDate) {
  try {
    if (!rawDate || typeof rawDate !== "string") {
      return "tanggal belum ditentukan";
    }

    // Jika sudah dalam format Hijriah/Masehi
    const hijriMatch = rawDate.match(
      /(\d+\s\w+\s\d+\sH)\s*\/\s*(\d+\s\w+\s\d+\sM)/i
    );
    if (hijriMatch) {
      return `${hijriMatch[1]}/${hijriMatch[2]}`;
    }

    // Clean the date string
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

    const hijriDate = momentHijri(mDate).format("iD iMMMM iYYYY");
    const gregorianFormatted = mDate.format("dddd, DD MMMM YYYY");

    return `${gregorianFormatted} (${hijriDate} H)`;
  } catch (error) {
    console.error("Date conversion error:", error);
    return rawDate;
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
      /tanggal\s*:\s*(.*?)\s*\/\s*(.*?)(?:\n|$)/i,
      /tanggal\s*:\s*(.*?)(?:\n|$)/i,
      /dilaksanakan\s*pada\s*(.*?)(?=\s*(?:waktu|tempat))/i,
    ],
    ""
  );

  const rawTime = getMatch(
    [
      /waktu\s*:\s*(\d{1,2}\.\d{2}\s*Wis\.\s*Malam)(?:\n|$)/i,
      /waktu\s*:\s*(\d{1,2}:\d{2}\s*Wis\.\s*Malam)(?:\n|$)/i,
      /waktu\s*:\s*(.*?)(?:\n|$)/i,
    ],
    "00:00"
  );

  return {
    meetingType: getMatch(
      [
        /undangan\s*(rapat\s*harian\s*\d+.*?)(?=\s*(?:hari|tanggal|waktu|dilaksanakan))/i,
        /acara\s*(.*?)(?=\s*(?:hari|tanggal|dilaksanakan))/i,
        /rapat\s*(.*?)(?=\s*(?:hari|tanggal|dilaksanakan))/i,
      ],
      "Rapat Harian"
    )
      .replace(/\s+/g, " ")
      .trim(),
    date: rawDate ? convertToHijriDate(rawDate) : "akan ditentukan",
    time: rawTime.replace(/\./g, ":"),
    location: getMatch(
      [/tempat\s*:\s*(.*?)(?:\n|$)/i, /lokasi\s*:\s*(.*?)(?:\n|$)/i],
      "akan ditentukan"
    ),
  };
}

function createShortReply(details) {
  if (!details || typeof details !== "object") {
    return `Wa'alaikumussalam Wr. Wb.\n\nMatur nuwun sanget kagem undanganipun, insyaAllah kulo usahaaken hadir.`;
  }

  return (
    `Wa'alaikumussalam Wr. Wb.\n` +
    `Matur nuwun sanget kagem undangan ${details.meetingType}.\n` +
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
