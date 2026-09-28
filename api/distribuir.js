const { getClosersElegiveis, incrementarContador, registrarLog } = require("../lib/sheets");
const { escolherCloser } = require("../lib/distribuicao");
const { buscarOwnerIdPorNome, moverEAtribuirDeal, buscarReuniaoRelevante } = require("../lib/pipedrive");
const { DESTINO_POR_SUBAREA } = require("../lib/config");

// Extrai o ID do deal do payload do webhook do Pipedrive.
// Cobre os formatos mais comuns (v1 legado e v2).
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

  // Proteção simples do endpoint via query param — configure o mesmo valor
  // na URL do webhook cadastrada na automação do Pipedrive: ?secret=XXXX
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  if (WEBHOOK_SECRET && req.query?.secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  try {
    const dealId = extrairDealId(req.body);
    if (!dealId) {
      return res.status(400).json({ error: "Não foi possível identificar o deal_id no payload." });
    }

    // Busca a reunião (due_date + due_time) ANTES de escolher o closer: quem
    // pode receber depende do horário da própria reunião (se for pra
    // amanhã, só quem estiver de plantão amanhã naquele horário), não do
    // horário em que a distribuição está sendo processada agora.
    let reuniao = null;
    try {
      reuniao = await buscarReuniaoRelevante(dealId);
    } catch (errReuniao) {
      console.warn(
        `Aviso: não foi possível buscar a reunião do deal ${dealId}. Usando a escala de agora como fallback. Erro: ${errReuniao.message}`
      );
    }

    const closers = await getClosersElegiveis(
      reuniao ? { data: reuniao.due_date, hora: reuniao.due_time } : null
    );
    if (closers.length === 0) {
      return res.status(422).json({
        error:
          "Nenhum closer elegível encontrado na planilha (Elite/MGM, ativo, mês/ano atual, dentro da escala pro horário da reunião).",
      });
    }

    const escolhido = escolherCloser(closers);
    const destino = DESTINO_POR_SUBAREA[escolhido.subareaNorm];
    if (!destino) {
      return res.status(500).json({ error: `Sem destino configurado para subarea '${escolhido.subareaNorm}'.` });
    }

    const ownerId = await buscarOwnerIdPorNome(escolhido.nome);
    await moverEAtribuirDeal(dealId, ownerId, destino.pipeline_id, destino.stage_id);

    // Só conta pra hoje se a reunião estiver de fato agendada pra hoje
    // (due_date da atividade). Se for pra outro dia, não incrementa nada —
    // não conta em dia nenhum, só não pode contar hoje (e por isso o closer
    // não perde a vez: o contador dele não sobe).
    let contaHoje = true;
    const dueDateEncontrada = reuniao ? reuniao.due_date : null;
    if (dueDateEncontrada) {
      const hojeStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); // "AAAA-MM-DD"
      contaHoje = dueDateEncontrada === hojeStr;
    }

    let reunioesAposDistribuicao = escolhido.reunioesHoje;
    if (contaHoje) {
      reunioesAposDistribuicao = escolhido.reunioesHoje + 1;
      try {
        reunioesAposDistribuicao = await incrementarContador(escolhido);
      } catch (errContador) {
        console.warn(
          `Aviso: não foi possível incrementar o contador. Deal foi distribuído normalmente. Erro: ${errContador.message}`
        );
      }
    } else {
      console.log(`Deal ${dealId}: reunião agendada pra outro dia, não incrementado o contador de hoje.`);
    }

    // Log em log_distribuicao — não deixa o fluxo quebrar se a aba ainda não existir.
    try {
      await registrarLog(escolhido, dealId, reunioesAposDistribuicao, contaHoje ? null : dueDateEncontrada);
    } catch (errLog) {
      console.warn(`Aviso: não foi possível registrar no log_distribuicao. Erro: ${errLog.message}`);
    }

    console.log(`Deal ${dealId} atribuído a ${escolhido.nome} (${escolhido.subareaNorm})`);

    return res.status(200).json({
      ok: true,
      deal_id: dealId,
      closer: escolhido.nome,
      subarea: escolhido.subareaNorm,
      destino,
      contou_para_hoje: contaHoje,
    });
  } catch (err) {
    console.error("Erro ao processar distribuição:", err);
    return res.status(500).json({ error: err.message });
  }
};
