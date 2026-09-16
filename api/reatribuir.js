const { norm } = require("../lib/normalizar");
const { buscarDonoAtualDoDeal } = require("../lib/pipedrive");
const {
  buscarUltimoLogPorDeal,
  marcarLogAlterado,
  descontarContadorPorNome,
  ehHoje,
} = require("../lib/sheets");

function extrairDealId(body) {
  const bruto =
    body?.deal_id ??
    body?.data?.id ??
    body?.current?.id ??
    body?.object?.id ??
    body?.meta?.id ??
    null;

  if (bruto === null || bruto === undefined || bruto === "") return null;
  const numero = Number(bruto);
  return Number.isNaN(numero) ? null : numero;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido, use POST." });
  }

  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  if (WEBHOOK_SECRET && req.query?.secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  try {
    const dealId = extrairDealId(req.body);
    if (!dealId) {
      return res.status(400).json({ error: "Não foi possível identificar o deal_id no payload." });
    }

    const logEntry = await buscarUltimoLogPorDeal(dealId);
    if (!logEntry) {
      // Deal nunca passou pela distribuição automática — nada a corrigir.
      return res.status(200).json({ ok: true, acao: "ignorado", motivo: "deal não distribuído automaticamente" });
    }

    if (norm(logEntry.alterado) === "sim") {
      // Já corrigimos essa distribuição antes — não desconta de novo mesmo
      // que o deal continue trocando de mão.
      return res.status(200).json({ ok: true, acao: "ignorado", motivo: "já corrigido anteriormente" });
    }

    const { ownerNome: donoAtual } = await buscarDonoAtualDoDeal(dealId);

    if (norm(donoAtual) === norm(logEntry.colaborador)) {
      // Dono atual é o mesmo que a automação atribuiu — provavelmente é o
      // próprio webhook disparado pela nossa mudança de dono. Nada a fazer.
      return res.status(200).json({ ok: true, acao: "ignorado", motivo: "dono não mudou de fato" });
    }

    if (!ehHoje(logEntry.dataHora)) {
      // Distribuição foi em outro dia — o contador já resetou, nada a
      // descontar na planilha (mas registra que já vimos essa divergência).
      await marcarLogAlterado(logEntry);
      return res.status(200).json({ ok: true, acao: "ignorado", motivo: "registro de dia anterior" });
    }

    const novoValor = await descontarContadorPorNome(logEntry.colaborador);
    await marcarLogAlterado(logEntry);

    console.log(
      `Deal ${dealId} reatribuído de ${logEntry.colaborador} para ${donoAtual}. Contador de ${logEntry.colaborador} corrigido para ${novoValor}.`
    );

    return res.status(200).json({
      ok: true,
      acao: "corrigido",
      deal_id: dealId,
      closer_original: logEntry.colaborador,
      novo_dono: donoAtual,
      contador_corrigido_para: novoValor,
    });
  } catch (err) {
    console.error("Erro ao processar reatribuição:", err);
    return res.status(500).json({ error: err.message });
  }
};
