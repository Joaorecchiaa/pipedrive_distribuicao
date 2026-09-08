const { norm } = require("./normalizar");

const PIPEDRIVE_DOMAIN = process.env.PIPEDRIVE_DOMAIN; // ex: seudominio.pipedrive.com
const PIPEDRIVE_API_TOKEN = process.env.PIPEDRIVE_API_TOKEN;

if (!PIPEDRIVE_DOMAIN || !PIPEDRIVE_API_TOKEN) {
  console.warn(
    "[pipedrive.js] PIPEDRIVE_DOMAIN ou PIPEDRIVE_API_TOKEN não configurados nas env vars."
  );
}

// Cache simples em memória (dura enquanto a function ficar "quente" no Vercel).
let _usuariosCache = null;
let _usuariosCacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

async function getUsuariosPipedrive() {
  const agora = Date.now();
  if (_usuariosCache && agora - _usuariosCacheTimestamp < CACHE_TTL_MS) {
    return _usuariosCache;
  }

  const url = `https://${PIPEDRIVE_DOMAIN}/api/v1/users?api_token=${PIPEDRIVE_API_TOKEN}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Falha ao buscar usuários do Pipedrive: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  _usuariosCache = data.data || [];
  _usuariosCacheTimestamp = agora;
  return _usuariosCache;
}

async function buscarOwnerIdPorNome(nomePlanilha) {
  const nomeNorm = norm(nomePlanilha);
  const usuarios = await getUsuariosPipedrive();
  const encontrado = usuarios.find((u) => norm(u.name) === nomeNorm);
  if (!encontrado) {
    throw new Error(
      `Usuário '${nomePlanilha}' (normalizado: '${nomeNorm}') não encontrado entre os usuários do Pipedrive.`
    );
  }
  return encontrado.id;
}

async function moverEAtribuirDeal(dealId, ownerId, pipelineId, stageId) {
  const url = `https://${PIPEDRIVE_DOMAIN}/api/v2/deals/${dealId}`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": PIPEDRIVE_API_TOKEN,
    },
    body: JSON.stringify({
      owner_id: ownerId,
      pipeline_id: pipelineId,
      stage_id: stageId,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Falha ao atualizar deal ${dealId}: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

module.exports = { getUsuariosPipedrive, buscarOwnerIdPorNome, moverEAtribuirDeal };
