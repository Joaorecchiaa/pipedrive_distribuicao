const { semearReunioesDeHoje } = require("../lib/sheets");

// Soma em REUNIOES_ATUAIS_HOJE as reuniões marcadas em dias anteriores pra hoje.
// Agende no cron da Vercel DEPOIS do reset diário (ex.: 10 min depois). Também roda
// sozinho na 1ª distribuição/reatribuição do dia — este endpoint só evita a corrida.
// Uso: GET/POST /api/semear?secret=XXXX
module.exports = async (req, res) => {
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  if (WEBHOOK_SECRET && req.query?.secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Não autorizado." });
  }
  try {
    const r = await semearReunioesDeHoje();
    return res.status(200).json({ ok: true, ...r });
  } catch (err) {
    console.error("Erro ao somar reuniões de dias anteriores:", err);
    return res.status(500).json({ error: err.message });
  }
};
