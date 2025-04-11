const WebSocket = require("ws");
const { handleGreeting } = require("./greetingHandler");
const { handlePing } = require("./pingHandler");
const { handleCall } = require("./callHandler");
const { handleMeeting } = require("./meetingHandler");

// Fungsi untuk mengirim log ke frontend
function sendLog(wss, message) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "log", message }));
    }
  });
}

// Override console.log untuk mengirim log ke frontend
function setupLogger(wss) {
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    originalConsoleLog(...args); // Tetap tampilkan log di terminal backend
    sendLog(wss, args.join(" ")); // Kirim log ke frontend
  };
}

function setupClientHandlers(client, startTime, wss) {
  // Setup logger untuk mengirim log ke frontend
  setupLogger(wss);

  // Inisialisasi penamaan Bot sesuai dengan nomor yang men-scan
  let botInfo;

  // Listen for remote session saved event
  client.on("remote_session_saved", () => {
    console.log("Session saved to MongoDB");
  });

  client.on("ready", () => {
    console.log("QR already scanned!");
    console.log("WhatsApp Bot is ready!");
    wss.broadcast({ type: "status", ready: true });
    botInfo = {
      botName: client.info.pushname,
      botNumber: client.info.me.user,
    };
  });

  client.on("qr", (qr) => {
    console.log("QR Ready to scan!");
    wss.broadcast({ type: "qr", qr });
  });

  client.on("message_create", (message) => {
    const senderName = message._data.notifyName || message.from;
    const senderNumber = message.from;
    const isGroup = senderNumber.includes("@g.us");
    const messageBody = message.body;

    if (
      senderNumber !== `${botInfo?.botNumber}@c.us` &&
      senderNumber !== "status@broadcast" &&
      isGroup !== true
    ) {
      console.log(
        `Menerima pesan dari \nPengirim Pesan: ${senderName} (${senderNumber}): \nPesan: \n${messageBody}`
      );
    }

    // Panggil handler untuk pesan "!ping"
    const isPing = handlePing(message, startTime, botInfo);

    // Jika bukan ping, coba handle sebagai greeting
    if (!isPing) {
      const isGreeting = handleGreeting(message, botInfo);

      // Jika bukan greeting, coba handle sebagai meeting
      if (!isGreeting) {
        handleMeeting(message, botInfo);
      }
    }
  });

  // Panggil handler untuk panggilan masuk
  client.on("call", async (call) => {
    await handleCall(call, client); // Gunakan callHandler
  });

  client.on("auth_failure", (msg) => {
    console.error("Authentication failed:", msg);
  });

  client.on("disconnected", (reason) => {
    console.log("Client disconnected:", reason);
    console.log("Restarting...");
    console.log("Generating new QR");
    wss.broadcast({ type: "status", ready: false });
    client.destroy();
    client.initialize();
  });

  client.initialize();
}

module.exports = { setupClientHandlers };
