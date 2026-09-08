const { resetarContadorDiario } = require("../lib/sheets");

module.exports = async (req, res) => {
  // Vercel Cron chama via GET e envia o header Authorization: Bearer $CRON_SECRET automaticamente
  // quando CRON_SECRET está configurado nas env vars do projeto.
  const CRON_SECRET = process.env.CRON_SECRET;
  if (CRON_SECRET) {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: "Não autorizado." });
    }
  }

  try {
    const atualizados = await resetarContadorDiario();
    console.log(`Reset diário concluído — ${atualizados} linha(s) zerada(s).`);
    return res.status(200).json({ ok: true, atualizados });
  } catch (err) {
    console.error("Erro no reset diário:", err);
    return res.status(500).json({ error: err.message });
  }
};
