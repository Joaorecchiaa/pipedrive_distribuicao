const { norm } = require("../lib/normalizar");
const {
  getDoc,
  getAba,
  montarMapaCabecalho,
  getCampo,
  hojeISOSaoPaulo,
  ehHoje,
  ALIASES_DISTRIBUICAO,
} = require("../lib/sheets");
const { buscarDonoAtualDoDeal } = require("../lib/pipedrive");
const {
  ABA_DISTRIBUICAO,
  ABA_LOG,
  COLUNA_NOME_DISTRIBUICAO,
  COLUNA_CARGO_DISTRIBUICAO,
  COLUNA_CREDITO_ATUAL,
  COLUNA_LOG_DATA_HORA,
  COLUNA_LOG_DEAL_ID,
  COLUNA_LOG_COLABORADOR,
  COLUNA_LOG_ALTERADO,
  COLUNA_LOG_AGENDADA_OUTRO_DIA,
  COLUNA_LOG_REUNIAO_DATA,
  COLUNA_LOG_RESPONSAVEL_ATUAL,
  COLUNA_LOG_CREDITADA_EM,
} = require("../lib/config");

// Recalcula REUNIOES_ATUAIS_HOJE de cada closer a partir da verdade:
//   deals distintos com reunião HOJE (log) cujo DONO ATUAL no Pipedrive é o closer.
// Corrige: mesmo deal contado várias vezes, remanejamento que o webhook perdeu, etc.
// Não mexe em RECEBIDAS_HOJE.
// Uso: /api/reconciliar?secret=XXXX&dry=1  (dry=1 só mostra a diferença, não grava)
//      /api/reconciliar?secret=XXXX         (grava)

function dataISO(valor) {
  const s = String(valor || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}

async function emLotes(itens, tamanho, fn) {
  const out = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    out.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fn))));
  }
  return out;
}

module.exports = async (req, res) => {
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  if (WEBHOOK_SECRET && req.query?.secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Não autorizado." });
  }
  const dry = ["1", "true", "sim"].includes(String(req.query?.dry || "").toLowerCase());

  try {
    const hoje = hojeISOSaoPaulo();
    const doc = await getDoc();

    const sheetLog = await getAba(doc, ABA_LOG);
    const mapaLog = await montarMapaCabecalho(sheetLog, [
      { chave: "data_hora", palavras: ["data"] },
      { chave: "deal_id", palavras: ["deal"] },
      { chave: "colaborador", palavras: ["colaborador"] },
      { chave: "alterado", palavras: ["alterado"] },
      { chave: "novo_proprietario", palavras: ["novo", "proprietario"] },
      { chave: "agendada_outro_dia", palavras: ["agendada", "outro"] },
      { chave: "creditada_em", palavras: ["creditada"] },
    ]);
    const rowsLog = await sheetLog.getRows();

    const ultimoPorDeal = new Map();
    for (const row of rowsLog) {
      const id = String(getCampo(row, mapaLog, COLUNA_LOG_DEAL_ID) || "").trim();
      if (id) ultimoPorDeal.set(id, row);
    }

    // Deals com reunião HOJE (pela última linha de cada um no log).
    const candidatos = [];
    for (const [dealId, row] of ultimoPorDeal) {
      if (norm(getCampo(row, mapaLog, COLUNA_LOG_ALTERADO)) === "sim") continue; // voltou
      const dReuniao = dataISO(getCampo(row, mapaLog, COLUNA_LOG_REUNIAO_DATA));
      const dOutroDia = dataISO(getCampo(row, mapaLog, COLUNA_LOG_AGENDADA_OUTRO_DIA));
      let eHoje;
      if (dReuniao) eHoje = dReuniao === hoje;
      else if (dOutroDia) eHoje = dOutroDia === hoje;
      else eHoje = ehHoje(getCampo(row, mapaLog, COLUNA_LOG_DATA_HORA));
      if (!eHoje) continue;
      const donoLog = getCampo(row, mapaLog, COLUNA_LOG_RESPONSAVEL_ATUAL) || getCampo(row, mapaLog, COLUNA_LOG_COLABORADOR);
      candidatos.push({ dealId, row, donoLog });
    }

    // Dono atual no Pipedrive (se falhar, vale o log).
    const resolvidos = await emLotes(candidatos, 8, async (c) => {
      try {
        const { ownerNome } = await buscarDonoAtualDoDeal(c.dealId);
        return { ...c, dono: ownerNome || c.donoLog, fonte: "pipedrive" };
      } catch (e) {
        return { ...c, dono: c.donoLog, fonte: "log" };
      }
    });

    const sheetDist = await getAba(doc, ABA_DISTRIBUICAO);
    const mapaDist = await montarMapaCabecalho(sheetDist, ALIASES_DISTRIBUICAO);
    const headerCredito = mapaDist[norm(COLUNA_CREDITO_ATUAL)];
    if (!headerCredito) throw new Error(`Coluna '${COLUNA_CREDITO_ATUAL}' não encontrada.`);
    const rowsDist = await sheetDist.getRows();

    const contagem = {};
    const deals = {};
    for (const r of resolvidos) {
      if (!r.dono) continue;
      const k = norm(r.dono);
      contagem[k] = (contagem[k] || 0) + 1;
      (deals[k] = deals[k] || []).push(r.dealId);
    }

    const diferencas = [];
    for (const row of rowsDist) {
      if (!norm(getCampo(row, mapaDist, COLUNA_CARGO_DISTRIBUICAO)).includes("closer")) continue;
      const nome = getCampo(row, mapaDist, COLUNA_NOME_DISTRIBUICAO);
      if (!nome) continue;
      const novo = contagem[norm(nome)] || 0;
      const atual = parseFloat(row.get(headerCredito) || "0") || 0;
      if (novo !== atual) {
        diferencas.push({ closer: nome, antes: atual, depois: novo, deals: deals[norm(nome)] || [] });
        if (!dry) {
          row.set(headerCredito, novo);
          await row.save();
        }
      }
    }

    // Marca as reuniões de hoje como já somadas (evita o "semear" somar de novo).
    const headerCreditada = mapaLog[norm(COLUNA_LOG_CREDITADA_EM)];
    if (!dry && headerCreditada) {
      for (const c of resolvidos) {
        if (dataISO(getCampo(c.row, mapaLog, COLUNA_LOG_CREDITADA_EM)) !== hoje) {
          c.row.set(headerCreditada, hoje);
          await c.row.save();
        }
      }
    }

    return res.status(200).json({
      ok: true,
      dry,
      deals_de_hoje: resolvidos.length,
      conferidos_no_pipedrive: resolvidos.filter((r) => r.fonte === "pipedrive").length,
      sem_conferir_valeu_o_log: resolvidos.filter((r) => r.fonte === "log").map((r) => r.dealId),
      alteracoes: diferencas,
    });
  } catch (err) {
    console.error("Erro ao reconciliar:", err);
    return res.status(500).json({ error: err.message });
  }
};
