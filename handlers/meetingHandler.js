// handlers/meetingHandler.js
function handleMeeting(message, botInfo) {
  const messageBody = message.body;
  const senderName = message._data.notifyName || "Bapak/Ibu";
  const senderNumber = message.from;
  const isGroup = senderNumber.includes("@g.us");

  if (
    senderNumber === `${botInfo?.botNumber}@c.us` &&
    senderNumber === "status@broadcast" &&
    isGroup === true
  )
    return false;

  // Check if message contains meeting keywords
  const isMeetingMessage =
    /undangan\s*\*.*\*|rapat\s*\*.*\*|wekdalipun|panggenanipun|dilaksanakan|dinten|hari\s*:/i.test(
      messageBody
    );

  if (!isMeetingMessage) return false;

  try {
    // Extract meeting information
    const meetingType =
      messageBody.match(/(?:undangan|rapat)\s*\*(.*?)\*/i)?.[1]?.trim() ||
      "rapat penting";

    const dateMatch =
      messageBody.match(/hari\s*:\s*(.*?)\n/i)?.[1] ||
      messageBody.match(/dinten\s*(.*?)\s*(?=wekdalipun|$)/i)?.[1] ||
      "hari yang akan ditentukan";

    const timeMatch = (
      messageBody.match(/wekdalipun\s*:\s*([^\n(]+)/i)?.[1] ||
      messageBody.match(/jam\s*([^\s(]+)/i)?.[1] ||
      "00.00"
    ).replace(/\./g, ":");

    const location =
      messageBody.match(/panggenanipun\s*:\s*(.*?)(?:\n|$)/i)?.[1]?.trim() ||
      messageBody.match(/tempat\s*:\s*(.*?)(?:\n|$)/i)?.[1]?.trim() ||
      "tempat yang akan ditentukan";

    // Create reply message in Javanese formal style
    const replyMessage =
      `Wa'alaikumussalam Wr. Wb.\n\n` +
      `Matur nuwun sanget kagem undanganipun.\n` +
      `Njeh, insyaAllah dalem usahaaken saget hadir dateng acara ${meetingType}\n\n` +
      `Wassalamu'alaikum Wr. Wb.`;

    // Send reply
    message.reply(replyMessage);
    console.log(
      `\n\n\n===UNDANGAN===\n\nAcara: ${meetingType}\nHari: ${dateMatch}\nWaktu: ${timeMatch}\nLokasi Acara: ${location}\n\n\n`
    );
    return true;
  } catch (error) {
    // Fallback reply if parsing fails
    message.reply(
      `Wa'alaikumussalam Wr. Wb.\n\n` +
        `Matur nuwun sanget kagem undanganipun.\n` +
        `Njeh, insyaAllah dalem usahaaken saget hadir dateng acaraipun.\n\n` +
        `Wassalamu'alaikum Wr. Wb.`
    );
    return false;
  }
}

module.exports = { handleMeeting };
