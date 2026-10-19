const { norm } = require("../lib/normalizar");
const { buscarDonoAtualDoDeal } = require("../lib/pipedrive");
const {
  buscarUltimoLogPorDeal,
  marcarLogAlterado,
  transferirCredito,
  ehHoje,
  ehCloserCadastrado,
  registrarResponsavelAtual,
  semearReunioesDeHoje,
  hojeISOSaoPaulo,
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

    // Garante que as reuniões de dias anteriores pra hoje já estão somadas antes de qualquer desconto.
    try {
      await semearReunioesDeHoje();
    } catch (errSemear) {
      console.warn(`Aviso: não foi possível somar as reuniões de dias anteriores. Erro: ${errSemear.message}`);
    }

    const logEntry = await buscarUltimoLogPorDeal(dealId);
    if (!logEntry) {
      // Deal nunca passou pela distribuição automática — nada a corrigir.
      console.log(`Reatribuir deal ${dealId}: ignorado — deal não distribuído automaticamente (sem linha no log dos últimos dias úteis).`);
      return res.status(200).json({ ok: true, acao: "ignorado", motivo: "deal não distribuído automaticamente" });
    }

    if (norm(logEntry.alterado) === "sim") {
      // Já corrigimos essa distribuição antes — não desconta de novo mesmo
      // que o deal continue trocando de mão.
      console.log(`Reatribuir deal ${dealId}: ignorado — a última distribuição já está marcada ALTERADO = Sim (já descontada antes).`);
      return res.status(200).json({ ok: true, acao: "ignorado", motivo: "já corrigido anteriormente" });
    }

    const { ownerNome: donoAtual } = await buscarDonoAtualDoDeal(dealId);

    // Quem está com o deal segundo o log: o closer que a automação escolheu ou,
    // se o head já remanejou entre closers antes, o último responsável gravado.
    const responsavelAnterior = logEntry.responsavelAtual || logEntry.colaborador;
    if (norm(donoAtual) === norm(responsavelAnterior)) {
      // Dono atual é o mesmo que a automação atribuiu — provavelmente é o
      // próprio webhook disparado pela nossa mudança de dono. Nada a fazer.
      console.log(`Reatribuir deal ${dealId}: ignorado — dono atual (${donoAtual}) é o mesmo que o log registra (${responsavelAnterior}).`);
      return res.status(200).json({ ok: true, acao: "ignorado", motivo: "dono não mudou de fato" });
    }

    // A distribuição só mexeu nos contadores de hoje se foi feita hoje E a
    // reunião era pra hoje (reunião de outro dia não conta em dia nenhum).
    // Também conta a reunião distribuída em dia anterior pra HOJE, já somada (CREDITADA_EM = hoje).
    const contouHoje =
      (ehHoje(logEntry.dataHora) && !logEntry.agendadaOutroDia) ||
      (logEntry.agendadaOutroDia === hojeISOSaoPaulo() && logEntry.creditadaEm === hojeISOSaoPaulo());

    // Head remanejou o deal pra OUTRO CLOSER (mesmo funil ou outro): NÃO é uma
    // reunião que voltou (o log não é marcado ALTERADO, então não entra em
    // "voltaram"). A reunião válida sai de quem estava com ela e entra pro novo
    // closer (REUNIOES_ATUAIS_HOJE). RECEBIDAS_HOJE (histórico) não muda.
    // NOVO_PROPRIETARIO guarda quem está com o deal agora (pra próximas trocas
    // e pra checagem de choque de horário).
    if (await ehCloserCadastrado(donoAtual)) {
      const gravou = await registrarResponsavelAtual(logEntry, donoAtual);
      if (gravou) {
        let transf = null;
        if (contouHoje) transf = await transferirCredito(responsavelAnterior, donoAtual);
        console.log(
          `Deal ${dealId} remanejado de ${responsavelAnterior} para ${donoAtual} (closer → closer). ` +
            (transf
              ? `Reuniões válidas: ${responsavelAnterior} → ${transf.creditoAntigoNovoValor}, ${donoAtual} → ${transf.creditoNovoNovoValor}.`
              : `Reunião não contava em hoje: contadores mantidos.`)
        );
        return res.status(200).json({
          ok: true,
          acao: "remanejado_entre_closers",
          deal_id: dealId,
          de: responsavelAnterior,
          para: donoAtual,
          credito_de: transf ? transf.creditoAntigoNovoValor : null,
          credito_para: transf ? transf.creditoNovoNovoValor : null,
        });
      }
      // Sem a coluna RESPONSAVEL_ATUAL no log não dá pra rastrear a troca nem
      // evitar contar duas vezes: segue o fluxo antigo (marca ALTERADO).
      console.warn("Coluna RESPONSAVEL_ATUAL não existe no log_distribuicao — usando o fluxo antigo (ALTERADO = Sim).");
    }

    if (!contouHoje) {
      // Distribuição foi em outro dia, ou a reunião era de outro dia: nada a
      // descontar na planilha (mas registra que já vimos essa divergência).
      await marcarLogAlterado(logEntry, donoAtual);
      console.log(`Reatribuir deal ${dealId}: de ${responsavelAnterior} para ${donoAtual} — NÃO descontou: distribuição de dia anterior ou reunião de outro dia (log: ${logEntry.dataHora}, outro dia: ${logEntry.agendadaOutroDia || "não"}).`);
      return res.status(200).json({ ok: true, acao: "ignorado", motivo: "registro de dia anterior ou reunião de outro dia" });
    }

    // Voltou pra alguém que não é closer (SDR, head...): desconta de quem estava
    // com a reunião e marca como voltou.
    const novoValor = await transferirCredito(responsavelAnterior, donoAtual);
    await marcarLogAlterado(logEntry, donoAtual);

    console.log(
      `Deal ${dealId} reatribuído de ${responsavelAnterior} para ${donoAtual}. ` +
        `Crédito de ${responsavelAnterior} corrigido para ${novoValor.creditoAntigoNovoValor}. ` +
        (novoValor.novoEhCloser
          ? `${donoAtual} agora tem crédito ${novoValor.creditoNovoNovoValor}.`
          : `${donoAtual} não é Closer cadastrado — ninguém foi creditado.`)
    );

    return res.status(200).json({
      ok: true,
      acao: "corrigido",
      deal_id: dealId,
      closer_original: responsavelAnterior,
      credito_original_corrigido_para: novoValor.creditoAntigoNovoValor,
      novo_dono: donoAtual,
      novo_dono_e_closer: novoValor.novoEhCloser,
      credito_novo_dono: novoValor.creditoNovoNovoValor,
    });
  } catch (err) {
    console.error("Erro ao processar reatribuição:", err);
    return res.status(500).json({ error: err.message });
  }
};
