module.exports = async (req, res) => {
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  if (WEBHOOK_SECRET && req.query?.secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const dealId = req.query?.deal_id;
  if (!dealId) {
    return res.status(400).json({ error: "Passe ?deal_id=XXX na URL." });
  }

  const PIPEDRIVE_DOMAIN = process.env.PIPEDRIVE_DOMAIN;
  const PIPEDRIVE_API_TOKEN = process.env.PIPEDRIVE_API_TOKEN;

  try {
    const url = `https://${PIPEDRIVE_DOMAIN}/api/v2/activities?deal_id=${dealId}&limit=200`;
    const resp = await fetch(url, {
      headers: { "x-api-token": PIPEDRIVE_API_TOKEN },
    });
    const data = await resp.json();

    const atividades = (data.data || []).map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      due_date: a.due_date,
      due_time: a.due_time,
      done: a.done,
    }));

    return res.status(200).json({
      deal_id: dealId,
      total_atividades: atividades.length,
      atividades,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
