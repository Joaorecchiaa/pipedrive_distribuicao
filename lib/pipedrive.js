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

/** Busca o nome do usuário do Pipedrive a partir do ID (usa o mesmo cache). */
async function buscarNomePorOwnerId(ownerId) {
  const usuarios = await getUsuariosPipedrive();
  const encontrado = usuarios.find((u) => u.id === Number(ownerId));
  return encontrado ? encontrado.name : null;
}

/** Busca o deal atual no Pipedrive e retorna o owner_id/nome do dono atual. */
async function buscarDonoAtualDoDeal(dealId) {
  const url = `https://${PIPEDRIVE_DOMAIN}/api/v2/deals/${dealId}`;
  const resp = await fetch(url, {
    headers: { "x-api-token": PIPEDRIVE_API_TOKEN },
  });
  if (!resp.ok) {
    throw new Error(`Falha ao buscar deal ${dealId}: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  const deal = data.data;
  const ownerId = typeof deal.owner_id === "object" ? deal.owner_id.id : deal.owner_id;
  const ownerNome =
    (typeof deal.owner_id === "object" && deal.owner_id.name) || (await buscarNomePorOwnerId(ownerId));
  return { ownerId, ownerNome };
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

/**
 * Busca a data agendada (due_date, "AAAA-MM-DD") da reunião mais próxima
 * ainda não realizada desse deal. Prioriza atividades type=meeting com
 * done=false; se não achar nenhuma, cai pra qualquer atividade meeting com
 * due_date. Retorna null se não achar nada (deal sem atividade de reunião).
 */
async function buscarDueDateReuniao(dealId) {
  const url = `https://${PIPEDRIVE_DOMAIN}/api/v2/activities?deal_id=${dealId}&type=meeting&limit=100`;
  const resp = await fetch(url, {
    headers: { "x-api-token": PIPEDRIVE_API_TOKEN },
  });
  if (!resp.ok) {
    throw new Error(`Falha ao buscar atividades do deal ${dealId}: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  const atividades = data.data || [];
  if (atividades.length === 0) return null;

  const naoFeitas = atividades.filter((a) => !a.done && a.due_date);
  const candidatas = naoFeitas.length > 0 ? naoFeitas : atividades.filter((a) => a.due_date);
  if (candidatas.length === 0) return null;

  candidatas.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
  return candidatas[0].due_date; // "AAAA-MM-DD"
}

module.exports = {
  getUsuariosPipedrive,
  buscarOwnerIdPorNome,
  buscarNomePorOwnerId,
  buscarDonoAtualDoDeal,
  moverEAtribuirDeal,
  buscarDueDateReuniao,
};
