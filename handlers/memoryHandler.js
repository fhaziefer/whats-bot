const pidusage = require("pidusage");

function startMemoryMonitoring(client, wss) {
  setInterval(async () => {
    try {
      const memoryUsage = await getTotalMemoryUsage(client);
      wss.broadcast({
        type: "memoryUsage",
        memoryUsage,
      });
    } catch (error) {
      console.error("Gagal mendapatkan penggunaan memori:", error);
    }
  }, 2000); // Perbarui setiap 2 detik
}

async function getTotalMemoryUsage(client) {
  const nodeMemory = process.memoryUsage();

  if (!client.pupBrowser) {
    console.error("Puppeteer browser instance is not available.");
    return {
      rss: (nodeMemory.rss / 1024 / 1024).toFixed(2),
      heapTotal: (nodeMemory.heapTotal / 1024 / 1024).toFixed(2),
      heapUsed: (nodeMemory.heapUsed / 1024 / 1024).toFixed(2),
      external: (nodeMemory.external / 1024 / 1024).toFixed(2),
      chromiumMemory: "0.00",
      totalMemory: (nodeMemory.rss / 1024 / 1024).toFixed(2),
    };
  }

  const chromiumPID = client.pupBrowser.process().pid;
  const { memory: chromiumMemory } = await pidusage(chromiumPID);

  return {
    rss: (nodeMemory.rss / 1024 / 1024).toFixed(2),
    heapTotal: (nodeMemory.heapTotal / 1024 / 1024).toFixed(2),
    heapUsed: (nodeMemory.heapUsed / 1024 / 1024).toFixed(2),
    external: (nodeMemory.external / 1024 / 1024).toFixed(2),
    chromiumMemory: (chromiumMemory / 1024 / 1024).toFixed(2),
    totalMemory: ((nodeMemory.rss + chromiumMemory) / 1024 / 1024).toFixed(2),
  };
}

module.exports = { startMemoryMonitoring };