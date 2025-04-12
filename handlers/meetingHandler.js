const { createWorker } = require("tesseract.js");
const fs = require("fs");
const path = require("path");
const os = require("os");
const moment = require("moment");
const momentHijri = require("moment-hijri");
const chrono = require("chrono-node");
const Jimp = require("jimp");
const winston = require("winston");

// Konfigurasi logging terstruktur
const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/meeting-handler.log" }),
  ],
});

// Promisify file operations
const writeFile = fs.promises.writeFile;
const unlink = fs.promises.unlink;
const mkdir = fs.promises.mkdir;

// Template balasan dalam berbagai bahasa
const replyTemplates = {
  id: {
    greeting: "Wa'alaikumussalam Wr. Wb.",
    thanks: "Matur nuwun sanget kagem undangan",
    confirmation: "Njeh, InsyaAllah kulo usahaaken hadir.",
    defaultLocation: "Kantor Muktamar P2L",
  },
  en: {
    greeting: "Dear Sir/Madam,",
    thanks: "Thank you for the invitation to",
    confirmation: "I will do my best to attend.",
    defaultLocation: "P2L Muktamar Office",
  },
};

// Pra-pemrosesan gambar untuk meningkatkan akurasi OCR
async function preprocessImage(imagePath) {
  try {
    // Tambahkan validasi file terlebih dahulu
    await fs.promises.access(imagePath, fs.constants.R_OK | fs.constants.W_OK);

    const image = await Jimp.read(imagePath).catch((err) => {
      logger.error("Jimp read error", { error: err.message });
      throw new Error("Failed to read image with Jimp");
    });

    // Lakukan preprocessing bertahap dengan error handling
    await image.greyscale().contrast(0.5).normalize().quality(90);

    // Tulis ke file temporary yang berbeda
    const processedPath = imagePath + ".processed.jpg";
    await image.writeAsync(processedPath);

    logger.debug("Image preprocessing completed", {
      original: imagePath,
      processed: processedPath,
    });

    return processedPath; // Kembalikan path file yang sudah diproses
  } catch (error) {
    logger.error("Image preprocessing failed", {
      error: error.message,
      stack: error.stack,
      imagePath,
    });
    throw new Error("Failed to preprocess image: " + error.message);
  }
}

// Ekstraksi teks dari gambar dengan Tesseract.js
async function extractTextFromImage(imagePath) {
  logger.info(`Starting OCR processing for image: ${imagePath}`);
  let worker;
  let processedImagePath = imagePath;

  try {
    // Coba preprocessing, jika gagal lanjut dengan gambar asli
    try {
      processedImagePath = await preprocessImage(imagePath);
    } catch (preprocessError) {
      logger.warn("Using original image due to preprocessing failure", {
        error: preprocessError.message,
        imagePath,
      });
      processedImagePath = imagePath;
    }

    worker = await createWorker({
      langPath: "https://tessdata.projectnaptha.com/4.0.0_best",
      cachePath: path.join(os.tmpdir(), "tesseract-cache"),
      cacheMethod: "readwrite",
      logger: (m) => logger.debug(m.status),
    });

    await worker.loadLanguage("eng+ind");
    await worker.initialize("eng+ind");

    const {
      data: { text },
    } = await worker.recognize(processedImagePath);

    // Hapus file processed jika berhasil dibuat
    if (processedImagePath !== imagePath) {
      await unlink(processedImagePath).catch((e) =>
        logger.warn("Failed to delete processed image", { error: e })
      );
    }

    return text;
  } catch (error) {
    logger.error("OCR Processing Error", {
      error: error.message,
      stack: error.stack,
      imagePath: processedImagePath,
    });
    throw error;
  } finally {
    // Cleanup
    if (worker)
      await worker
        .terminate()
        .catch((e) => logger.error("Worker termination error", e));
    if (processedImagePath !== imagePath) {
      await unlink(processedImagePath).catch((e) =>
        logger.warn("Failed to delete processed image in finally", { error: e })
      );
    }
  }
}

// Ekstrak detail rapat dari teks
function extractMeetingDetails(text, language = "id") {
  if (!text || typeof text !== "string" || text.length < 10) {
    throw new Error("Invalid text input for meeting details extraction");
  }

  // Pembersihan teks
  const cleanedText = cleanText(text);
  logger.debug("Text after cleaning", {
    cleanedText: cleanedText.substring(0, 100) + "...",
  });

  // 1. Ekstraksi tanggal menggunakan chrono-node
  const dateDetails = extractDateDetails(cleanedText);

  // 2. Ekstraksi jenis rapat
  const meetingType = extractMeetingType(cleanedText, language);

  // 3. Ekstraksi waktu
  const time = extractTime(cleanedText);

  // 4. Ekstraksi lokasi
  const location = extractLocation(cleanedText, language);

  return {
    meetingType,
    day: dateDetails.day,
    date: dateDetails.gregorianDate,
    time,
    location,
    rawText: cleanedText.substring(0, 200) + "...", // Untuk debugging
  };
}

// Fungsi bantu untuk membersihkan teks
function cleanText(text) {
  return text
    .replace(/[‘’'`~©+£•®]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

// Fungsi bantu untuk ekstraksi tanggal
function extractDateDetails(text) {
  const dates = chrono.parse(text);
  let gregorianDate = "tanggal belum ditentukan";
  let dayOfWeek = "Jum'at"; // Default

  if (dates.length > 0) {
    const parsedDate = dates[0].start.date();
    gregorianDate = moment(parsedDate).format("DD MMMM YYYY");
    dayOfWeek = moment(parsedDate).locale("id").format("dddd");

    logger.debug("Date parsed successfully", {
      input: text.substring(0, 50),
      parsedDate,
      gregorianDate,
      dayOfWeek,
    });
  }

  return { gregorianDate, day: dayOfWeek };
}

// Fungsi bantu untuk ekstraksi jenis rapat
function extractMeetingType(text, language) {
  const patterns = {
    id: /dalam\s+rangka\s+(.*?)(?=\s*(?:yang\s+insya\s+Allah|pada\s*:|$))/i,
    en: /(meeting|invitation)\s+for\s+(.*?)(?=\s*(?:will be held|on\s*:|$))/i,
  };

  const match = text.match(patterns[language] || patterns.id);
  const defaultType = language === "id" ? "Rapat" : "Meeting";

  if (!match) return defaultType;

  return match[1]
    .replace(/\s+/g, " ")
    .replace(/[^\w\s.,-]/g, "")
    .trim();
}

// Fungsi bantu untuk ekstraksi waktu
function extractTime(text) {
  const timeMatch =
    text.match(
      /Waktu\s*[^:\d]*(\d{1,2})[.:\s]*(\d{2})?\s*(WIB|WITA|WIT)?\s*\(?\s*(Pagi|Siang|Sore|Malam)?\s*\)?/i
    ) || text.match(/(\d{1,2})[.:](\d{2})\s*(AM|PM)?/i);

  if (!timeMatch) return "00:00";

  let hours = parseInt(timeMatch[1]) || 0;
  const minutes = parseInt(timeMatch[2]) || 0;
  const period = timeMatch[4] || timeMatch[3];

  // Konversi ke format 24 jam
  if (period) {
    const periodLower = period.toLowerCase();
    if (
      (periodLower === "pm" ||
        periodLower === "malam" ||
        periodLower === "sore") &&
      hours < 12
    ) {
      hours += 12;
    }
    if ((periodLower === "am" || periodLower === "pagi") && hours === 12) {
      hours = 0;
    }
  }

  // Pastikan jam valid
  hours = Math.min(23, Math.max(0, hours));
  const normMins = Math.min(59, Math.max(0, minutes));

  return `${hours.toString().padStart(2, "0")}:${normMins
    .toString()
    .padStart(2, "0")}`;
}

// Fungsi bantu untuk ekstraksi lokasi
function extractLocation(text, language) {
  const patterns = {
    id: /Tempat\s*:\s*([^\n.,;]+)/i,
    en: /Location\s*:\s*([^\n.,;]+)/i,
  };

  const match = text.match(patterns[language] || patterns.id);
  const defaultLocation = replyTemplates[language].defaultLocation;

  if (!match) return defaultLocation;

  let location = match[1]
    .split(/[.,;]/)[0]
    .replace(/Demikian.*$/i, "")
    .trim();

  // Normalisasi lokasi khusus
  if (location.includes("P2L") || location.includes("Muktamar")) {
    return defaultLocation;
  }

  return location;
}

// Membuat balasan singkat
function createShortReply(details, language = "id") {
  if (!details || typeof details !== "object") {
    return `${replyTemplates[language].greeting}\n\n${replyTemplates[language].thanks}ipun, insyaAllah kulo usahaaken hadir.`;
  }

  const template = replyTemplates[language];

  return [
    template.greeting,
    `${template.thanks} ${details.meetingType}.`,
    details.day && `Hari: ${details.day}`,
    `Tanggal: ${details.date}`,
    `Waktu: ${details.time}`,
    `Tempat: ${details.location}`,
    "",
    template.confirmation,
  ]
    .filter((line) => line)
    .join("\n");
}

// Fungsi utama untuk menangani pesan meeting
async function handleMeeting(message, botInfo) {
  // Skip jika dari bot sendiri atau grup
  if (
    !message ||
    !botInfo ||
    message.from === `${botInfo?.botNumber}@c.us` ||
    message.from.includes("@g.us")
  ) {
    logger.debug("Message skipped (from bot or group)");
    return false;
  }

  let text = message.body || "";
  let isImage = false;
  const startTime = Date.now();

  try {
    // Proses gambar jika ada
    if (message.hasMedia) {
      try {
        const media = await message.downloadMedia();
        if (media && media.mimetype.startsWith("image/")) {
          const tempDir = os.tmpdir();
          const fileExt = media.mimetype.split("/")[1] || "jpg";
          const filePath = path.join(
            tempDir,
            `invite_${Date.now()}.${fileExt}`
          );

          await writeFile(filePath, media.data, "base64");
          text = await extractTextFromImage(filePath);
          await unlink(filePath).catch((e) =>
            logger.warn("Failed to delete temp file", { error: e })
          );
          isImage = true;

          if (!text || text.trim().length < 20) {
            logger.warn("No valid text extracted from image");
            return false;
          }
        }
      } catch (error) {
        logger.error("Image processing error", { error });
        throw error;
      }
    }

    // Periksa apakah ini undangan
    if (
      !/(undangan|rapat|wekdalipun|panggenanipun|invitation|meeting)/i.test(
        text
      )
    ) {
      logger.debug("Not a meeting invitation", {
        text: text.substring(0, 50) + "...",
      });
      return false;
    }

    // Deteksi bahasa
    const language =
      /[a-zA-Z]/.test(text) && !/[a-zA-Z][a-zA-Z]/.test(text) ? "id" : "en";

    // Ekstrak detail rapat
    const details = extractMeetingDetails(text, language);
    logger.info("Meeting details extracted", { details });

    // Kirim balasan dengan delay eksponensial
    await delayedReply(message, createShortReply(details, language));

    logger.info("Meeting invitation processed successfully", {
      processingTime: `${Date.now() - startTime}ms`,
      isImage,
      language,
    });

    return true;
  } catch (error) {
    logger.error("Error processing meeting invitation", {
      error: error.message,
      stack: error.stack,
      text: text.substring(0, 100) + "...",
    });

    // Balasan fallback
    try {
      await delayedReply(
        message,
        `${replyTemplates["id"].greeting}\n\n` +
          `${replyTemplates["id"].thanks}ipun.\n\n` +
          `Wassalamu'alaikum Wr. Wb.`
      );
    } catch (replyError) {
      logger.error("Failed to send fallback reply", { error: replyError });
    }

    return false;
  }
}

// Fungsi untuk mengirim balasan dengan delay eksponensial
async function delayedReply(message, text, attempt = 1) {
  const delay = Math.min(15000 * Math.pow(2, attempt - 1), 120000);
  logger.debug(`Delaying reply for ${delay}ms`, { attempt });

  await new Promise((resolve) => setTimeout(resolve, delay));
  await message.reply(text);
}

module.exports = { handleMeeting };
