function handlePing(message, startTime, botInfo) {
  // Fungsi untuk menghitung uptime
  function getUptime() {
    const uptimeMs = Date.now() - startTime; // Hitung selisih waktu dalam milidetik
    const uptimeSeconds = Math.floor(uptimeMs / 1000); // Konversi ke detik
    const hours = Math.floor(uptimeSeconds / 3600); // Hitung jam
    const minutes = Math.floor((uptimeSeconds % 3600) / 60); // Hitung menit
    const seconds = uptimeSeconds % 60; // Hitung detik
    return { hours, minutes, seconds };
  }

  const messageBody = message.body;

  if (messageBody === "!info") {
    // Mendapatkan tanggal dan waktu saat ini
    const now = new Date();

    // Format tanggal dan waktu
    const options = {
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    };

    // Format tanggal dan waktu sesuai kebutuhan
    const formattedDate = now.toLocaleString("en-US", options);

    // Menentukan salam berdasarkan waktu
    const hour = now.getHours(); // Mendapatkan jam (0-23)
    let greeting = "";

    if (hour >= 5 && hour < 12) {
      greeting = "Good Morning, My Bos! 🌤️";
    } else if (hour >= 12 && hour < 18) {
      greeting = "Good Afternoon, My Bos! ✨";
    } else if (hour >= 18 && hour < 22) {
      greeting = "Good Evening, My Bos! 🌙";
    } else {
      greeting = "Good Night, My Bos! 🌙";
    }

    const uptime = getUptime()

    // Format uptime
    const uptimeInfo = `${uptime.hours} hours, ${uptime.minutes} minutes, ${uptime.seconds} seconds`;

    // Balasan pesan dengan tambahan salam, tanggal, dan waktu
    message.reply(
      `_${greeting}_\n\n` +
        `For your information, this WhatsApp Bot is *active*\n\n` +
        `_Bot Info:_\n` +
        `  *Name:* ${botInfo.botName}\n` +
        `  *Number:* ${botInfo.botNumber}\n` +
        `  *Server Uptime:* ${uptimeInfo}\n\n` +
        `Reported on ${formattedDate}`
    );
  }
}

module.exports = { handlePing };
