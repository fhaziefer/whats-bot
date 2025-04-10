async function handleCall(call, client) {
  console.log("Panggilan Masuk dari: ", call.from);

  if (call) {
    try {
      call.reject();
      await client.sendMessage(
        call.from,
        "Mohon maaf, saat ini kami belum dapat menerima telepon.\nSilakan sampaikan pesan Anda melalui chat. Ada yang bisa kami bantu?"
      );
      console.log("Panggilan ditolak dan balasan dikirim.");
    } catch (error) {
      console.error("Gagal menolak panggilan atau mengirim balasan:", error);
    }
  }
}

module.exports = { handleCall };
