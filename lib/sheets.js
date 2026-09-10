const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const { norm } = require("./normalizar");
const {
  ABA_COLABORADORES,
  ABA_DISTRIBUICAO,
  ABA_LOG,
  SUBAREAS_ELEGIVEIS,
  COLUNA_NOME_DISTRIBUICAO,
  COLUNA_CARGO_DISTRIBUICAO,
  COLUNA_META,
  COLUNA_RECEBIDAS,
} = require("./config");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function getServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não configurada.");
  }
  return JSON.parse(raw);
}

async function getDoc() {
  const creds = getServiceAccountCredentials();
  const jwt = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const doc = new GoogleSpreadsheet(SHEET_ID, jwt);
  await doc.loadInfo();
  return doc;
}

async function getAba(doc, nomeAba) {
  const sheet = doc.sheetsByTitle[nomeAba];
  if (!sheet) {
    throw new Error(`Aba '${nomeAba}' não encontrada na planilha.`);
  }
  return sheet;
}

/**
 * Monta um mapa "nome de coluna normalizado" -> "nome de coluna real" a partir
 * do cabeçalho de verdade da aba (sheet.headerValues). Isso protege contra
 * cabeçalhos com espaço duplo, quebra de linha dentro da célula, ou pequeno
 * erro de digitação — casos em que row.get("nome exato") retorna undefined
 * mesmo o texto "parecendo" igual.
 *
 * Precisa ser async: sheet.headerValues é um getter que lança erro se acessado
 * antes do load — por isso sempre chamamos loadHeaderRow() incondicionalmente.
 */
async function montarMapaCabecalho(sheet, aliases = []) {
  await sheet.loadHeaderRow();
  const mapa = {};
  for (const headerReal of sheet.headerValues) {
    mapa[norm(headerReal)] = headerReal;
  }
  for (const { chave, palavras } of aliases) {
    if (mapa[chave]) continue; // já bateu exato, não precisa de alias
    const headerEncontrado = sheet.headerValues.find((h) => {
      const hNorm = norm(h);
      return palavras.every((p) => hNorm.includes(p));
    });
    if (headerEncontrado) {
      mapa[chave] = headerEncontrado;
    }
  }
  return mapa;
}

const ALIASES_COLABORADORES = [
  { chave: "status (equipe comercial)", palavras: ["status"] },
  { chave: "mes referencia", palavras: ["mes", "referencia"] },
  { chave: "ano referencia", palavras: ["ano", "referencia"] },
];

const ALIASES_DISTRIBUICAO = [
  { chave: "nome", palavras: ["nome"] },
  { chave: "email", palavras: ["email"] },
  { chave: "cargo", palavras: ["cargo"] },
  { chave: "qtd_reunioes", palavras: ["qtd"] }, // meta — evita bater com RECEBIDAS_HOJE
  { chave: "recebidas_hoje", palavras: ["recebid"] }, // contador
];

/** Busca o valor de uma coluna pelo nome, usando o mapa normalizado. */
function getCampo(row, mapaCabecalho, nomeEsperado) {
  const headerReal = mapaCabecalho[norm(nomeEsperado)];
  if (!headerReal) return undefined;
  return row.get(headerReal);
}

/**
 * Lê a aba colaboradores (elegibilidade: Cargo, Subarea, Status, Mês/Ano) e
 * cruza por Nome normalizado com a aba distribuicao_reuniao (meta +
 * contador do dia). Closers elegíveis pela colaboradores mas SEM linha
 * correspondente (ou sem meta válida) na distribuicao_reuniao ficam de fora.
 */
async function getClosersElegiveis() {
  const doc = await getDoc();

  const sheetColab = await getAba(doc, ABA_COLABORADORES);
  const mapaColab = await montarMapaCabecalho(sheetColab, ALIASES_COLABORADORES);
  const rowsColab = await sheetColab.getRows();

  const sheetDist = await getAba(doc, ABA_DISTRIBUICAO);
  const mapaDist = await montarMapaCabecalho(sheetDist, ALIASES_DISTRIBUICAO);
  const rowsDist = await sheetDist.getRows();

  // Índice por nome normalizado -> { row, ordemFila }. Filtra só linhas de
  // Closer: a aba vai ganhar linhas de SDR no futuro (pra outra automação),
  // e não devem entrar aqui. ordemFila = posição da linha na aba
  // distribuicao_reuniao (de cima pra baixo), usada como ordem de fila.
  const indiceDist = {};
  let ordemFila = 0;
  for (const row of rowsDist) {
    const cargoDist = norm(getCampo(row, mapaDist, COLUNA_CARGO_DISTRIBUICAO));
    if (!cargoDist.includes("closer")) continue;
    const nome = getCampo(row, mapaDist, COLUNA_NOME_DISTRIBUICAO);
    if (!nome) continue;
    indiceDist[norm(nome)] = { row, ordemFila };
    ordemFila++;
  }

  const hoje = new Date();
  const mesAtual = hoje.getMonth() + 1;
  const anoAtual = hoje.getFullYear();

  const closers = [];

  for (const row of rowsColab) {
    const cargo = String(getCampo(row, mapaColab, "Cargo") || "");
    const subareaNorm = norm(getCampo(row, mapaColab, "Subarea"));
    const statusNorm = norm(getCampo(row, mapaColab, "Status (Equipe Comercial)"));
    const mesRef = parseInt(getCampo(row, mapaColab, "Mês Referência"), 10);
    const anoRef = parseInt(getCampo(row, mapaColab, "Ano Referência"), 10);
    const nome = getCampo(row, mapaColab, "Nome");

    if (!norm(cargo).includes("closer")) continue;
    if (!SUBAREAS_ELEGIVEIS.includes(subareaNorm)) continue;
    if (statusNorm !== "ativo") continue;
    if (mesRef !== mesAtual || anoRef !== anoAtual) continue;

    const entradaDist = indiceDist[norm(nome)];
    if (!entradaDist) continue; // sem linha na distribuicao_reuniao -> fora, por enquanto

    const limite = parseInt(getCampo(entradaDist.row, mapaDist, COLUNA_META), 10);
    if (!limite || limite <= 0) continue; // meta ausente/inválida -> fora

    const reunioesHoje = parseFloat(getCampo(entradaDist.row, mapaDist, COLUNA_RECEBIDAS) || "0") || 0;

    closers.push({
      nome,
      subareaNorm,
      limite,
      reunioesHoje,
      ordemFila: entradaDist.ordemFila,
      _rowDist: entradaDist.row,
      _mapaDist: mapaDist,
      _doc: doc,
    });
  }

  return closers;
}

/** Incrementa em +1 o contador do dia (RECEBIDAS_HOJE) do closer escolhido. */
async function incrementarContador(closer) {
  const headerReal = closer._mapaDist[norm(COLUNA_RECEBIDAS)];
  if (!headerReal) {
    throw new Error(`Coluna '${COLUNA_RECEBIDAS}' não encontrada no cabeçalho de ${ABA_DISTRIBUICAO}.`);
  }
  const atual = parseFloat(closer._rowDist.get(headerReal) || "0") || 0;
  closer._rowDist.set(headerReal, atual + 1);
  await closer._rowDist.save();
}

/** Zera RECEBIDAS_HOJE de todos na aba distribuicao_reuniao (roda 1x/dia via cron). NÃO mexe na meta (QTD_REUNIOES). */
async function resetarContadorDiario() {
  const doc = await getDoc();
  const sheet = await getAba(doc, ABA_DISTRIBUICAO);
  const mapa = await montarMapaCabecalho(sheet, ALIASES_DISTRIBUICAO);
  const headerReal = mapa[norm(COLUNA_RECEBIDAS)];
  if (!headerReal) {
    throw new Error(`Coluna '${COLUNA_RECEBIDAS}' não encontrada no cabeçalho de ${ABA_DISTRIBUICAO}.`);
  }

  const rows = await sheet.getRows();
  let atualizados = 0;
  for (const row of rows) {
    const atual = row.get(headerReal);
    if (atual !== undefined && atual !== "" && Number(atual) !== 0) {
      row.set(headerReal, 0);
      await row.save();
      atualizados++;
    }
  }
  return atualizados;
}

const NOME_DESTINO_POR_SUBAREA = {
  elite: "Elite",
  mgm: "Olympus",
};

/**
 * Adiciona uma linha na aba log_distribuicao registrando a distribuição —
 * histórico completo, nunca sobrescreve, serve pra auditoria e pra "quantas
 * foram pra cada um hoje" mesmo depois do contador resetar à meia-noite.
 */
async function registrarLog(closer, dealId, reunioesAposDistribuicao) {
  const sheetLog = await getAba(closer._doc, ABA_LOG);
  await sheetLog.loadHeaderRow();

  const dataHora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const destino = NOME_DESTINO_POR_SUBAREA[closer.subareaNorm] || closer.subareaNorm;

  await sheetLog.addRow({
    "DATA_HORA": dataHora,
    "DEAL_ID": dealId,
    "COLABORADOR": closer.nome,
    "FUNIL": destino,
    "REUNIOES_DO_DIA": reunioesAposDistribuicao,
  });
}

module.exports = {
  getClosersElegiveis,
  incrementarContador,
  resetarContadorDiario,
  registrarLog,
  getDoc,
  getAba,
  montarMapaCabecalho,
  getCampo,
  ALIASES_COLABORADORES,
  ALIASES_DISTRIBUICAO,
};
