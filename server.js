const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { Client, LocalAuth } = require("whatsapp-web.js");
const clientHandler = require("./handlers/clientHandler");
const websocketHandler = require("./handlers/websocketHandler");
const memoryHandler = require("./handlers/memoryHandler");
const routes = require("./routes");
const { PORT } = require("./config/constants");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: false,
  clientTracking: true
});

// Ping clients setiap 25 detik
const interval = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      if (!client.isAlive) {
        client.terminate();
        return;
      }
      client.isAlive = false;
      client.ping(() => {});
    }
  });
}, 25000);

wss.on('close', () => {
  clearInterval(interval);
});

wss.on('connection', (ws, request) => {
  console.log('New WebSocket connection');
  
  ws.isAlive = true;
  
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Catat waktu mulai server
const startTime = Date.now();

// Fungsi untuk menghitung uptime
function getUptime() {
  const uptimeMs = Date.now() - startTime;
  const uptimeSeconds = Math.floor(uptimeMs / 1000);
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;
  return { hours, minutes, seconds };
}

// Inisialisasi WhatsApp client dengan LocalAuth
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "localAuthSession"
  }),
  puppeteer: {
    // headless: true,
    headless: false,
    executablePath: '/usr/bin/chromium-browser',
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process", // <- tambahkan ini untuk environment dengan resource terbatas
      "--disable-gpu",
      "--window-size=1920x1080"
    ],
    ignoreHTTPSErrors: true,
    userDataDir: './chromeCache' // tambahkan direktori cache khusus
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
}, 5000); // Kirim setiap 5 detik

// server.on('upgrade', (request, socket, head) => {
//   wss.handleUpgrade(request, socket, head, (ws) => {
//     wss.emit('connection', ws, request);
//   });
// });

wss.on('error', (error) => {
    console.error('WebSocket Server Error:', error);
});

// Tambahkan error handling untuk HTTP server
server.on('error', (error) => {
    console.error('HTTP Server Error:', error);
});

// Tambahkan handler untuk uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Jangan exit process kecuali benar-benar diperlukan
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
// Start server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT} | 3100`);
});