const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { Client, RemoteAuth, LocalAuth } = require("whatsapp-web.js");
const { MongoStore } = require("wwebjs-mongo");
const mongoose = require("mongoose");
const clientHandler = require("./handlers/clientHandler");
const websocketHandler = require("./handlers/websocketHandler");
const memoryHandler = require("./handlers/memoryHandler");
const routes = require("./routes");
const { PORT, MONGODB_URI } = require("./config/constants");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Catat waktu mulai server
const startTime = Date.now();

// Fungsi untuk menghitung uptime
function getUptime() {
  const uptimeMs = Date.now() - startTime; // Hitung selisih waktu dalam milidetik
  const uptimeSeconds = Math.floor(uptimeMs / 1000); // Konversi ke detik
  const hours = Math.floor(uptimeSeconds / 3600); // Hitung jam
  const minutes = Math.floor((uptimeSeconds % 3600) / 60); // Hitung menit
  const seconds = uptimeSeconds % 60; // Hitung detik
  return { hours, minutes, seconds };
}

// Connect to MongoDB
mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log("Connected to MongoDB");

    // Create a new MongoStore
    const store = new MongoStore({ mongoose: mongoose });

    // Inisialisasi WhatsApp client dengan RemoteAuth
    // const client = new Client({
    //   authStrategy: new RemoteAuth({
    //     store: store,
    //     backupSyncIntervalMs: 300000, // Sync session setiap 5 menit
    //   }),
    //   puppeteer: {
    //     headless: true,
    //     args: [
    //       "--no-sandbox",
    //       "--disable-setuid-sandbox",
    //       "--disable-dev-shm-usage",
    //       "--disable-accelerated-2d-canvas",
    //       "--disable-gpu",
    //       "--window-size=1920x1080",
    //     ],
    //   },
    // });

    // Inisialisasi WhatsApp client dengan LocalAuth
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: "localAuthSession"
    }),
    puppeteer: {
        headless: true,
        executablePath: '/usr/bin/chromium-browser',
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--disable-gpu",
            "--window-size=1920x1080"
        ]
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    }
});

    // Setup routes
    app.use("/", routes);

    // Setup WebSocket
    websocketHandler.setupWebSocket(wss, client);

    // Setup WhatsApp client handlers
    clientHandler.setupClientHandlers(client, startTime, wss);

    // Setup memory monitoring
    memoryHandler.startMemoryMonitoring(client, wss);

    // Kirim uptime ke frontend secara berkala
    setInterval(() => {
      const uptime = getUptime();
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(
            JSON.stringify({
              type: "uptime",
              uptime,
            })
          );
        }
      });
    }, 1000); // Kirim setiap 1 detik

    // Start server
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Server is running on port ${PORT} | 3100`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err);
  });