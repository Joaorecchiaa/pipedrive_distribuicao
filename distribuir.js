const { getClosersElegiveis, incrementarContador } = require("../lib/sheets");
const { escolherCloser } = require("../lib/distribuicao");
const { buscarOwnerIdPorNome, moverEAtribuirDeal } = require("../lib/pipedrive");
const { DESTINO_POR_SUBAREA } = require("../lib/config");

// Extrai o ID do deal do payload do webhook do Pipedrive.
// Cobre os formatos mais comuns (v1 legado e v2).
function extrairDealId(body) {
  return (
    body?.data?.id ??
    body?.current?.id ??
    body?.object?.id ??
    body?.meta?.id ??
    null
  );
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
    await incrementarContador(escolhido);

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
