function handleGreeting(message, botInfo) {
  const senderName = message._data.notifyName || message.from;
  const senderNumber = message.from;
  const messageBody = message.body;

  if (
    (messageBody.toLowerCase().includes("hai") ||
      messageBody.toLowerCase().includes("hallo") ||
      messageBody.toLowerCase().includes("helo") ||
      messageBody.toLowerCase().includes("hello") ||
      messageBody.toLowerCase().includes("hi") ||
      messageBody.toLowerCase().includes("halo")) &&
    senderNumber !== `${botInfo.botNumber}@c.us`
  ) {
    message.reply(
      `Hai ${senderName}, Anda telah menghubungi ${botInfo.botName}!`
    );
  }
}

module.exports = { handleGreeting };
