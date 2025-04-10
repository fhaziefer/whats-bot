const WebSocket = require("ws");

function setupWebSocket(wss, client) {
  wss.on("connection", (ws) => {
    console.log("A socket client connected");

    if (client.pupBrowser) {
      ws.send(JSON.stringify({ type: "status", ready: true }));
    }

    ws.on("close", () => {
      console.log("A socket client disconnected");
    });
  });

  // Tambahkan fungsi broadcast ke instance wss
  wss.broadcast = function broadcast(message) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  };
}

module.exports = { setupWebSocket };