const { getClosersElegiveis, incrementarContador, registrarLog } = require("../lib/sheets");
const { escolherCloser } = require("../lib/distribuicao");
const { buscarOwnerIdPorNome, moverEAtribuirDeal } = require("../lib/pipedrive");
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

    const closers = await getClosersElegiveis();
    if (closers.length === 0) {
      return res.status(422).json({
        error: "Nenhum closer elegível encontrado na planilha (Elite/MGM, ativo, mês/ano atual).",
      });
    }

    const escolhido = escolherCloser(closers);
    const destino = DESTINO_POR_SUBAREA[escolhido.subareaNorm];
    if (!destino) {
      return res.status(500).json({ error: `Sem destino configurado para subarea '${escolhido.subareaNorm}'.` });
    }

    const ownerId = await buscarOwnerIdPorNome(escolhido.nome);
    await moverEAtribuirDeal(dealId, ownerId, destino.pipeline_id, destino.stage_id);

    // Teste sem a coluna do contador ainda criada na planilha: não deixa
    // o fluxo quebrar, só avisa no log. Antes de ir pra produção, crie a coluna
    // pra o teto diário funcionar de verdade.
    let reunioesAposDistribuicao = escolhido.reunioesHoje + 1;
    try {
      await incrementarContador(escolhido);
    } catch (errContador) {
      reunioesAposDistribuicao = null; // não sabemos o valor real se não incrementou
      console.warn(
        `Aviso: não foi possível incrementar o contador. Deal foi distribuído normalmente. Erro: ${errContador.message}`
      );
    }

    // Log em log_distribuicao — não deixa o fluxo quebrar se a aba ainda não existir.
    try {
      await registrarLog(escolhido, dealId, reunioesAposDistribuicao);
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
    });
  } catch (err) {
    console.error("Erro ao processar distribuição:", err);
    return res.status(500).json({ error: err.message });
  }
};
