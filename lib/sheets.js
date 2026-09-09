const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const { norm } = require("./normalizar");
const { ABA_COLABORADORES, SUBAREAS_ELEGIVEIS, LIMITE_DIARIO_POR_NIVEL, COLUNA_CONTADOR } = require("./config");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function getServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não configurada.");
  }
  return JSON.parse(raw);
}

async function getSheetColaboradores() {
  const creds = getServiceAccountCredentials();
  const jwt = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(SHEET_ID, jwt);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[ABA_COLABORADORES];
  if (!sheet) {
    throw new Error(`Aba '${ABA_COLABORADORES}' não encontrada na planilha.`);
  }
  return sheet;
}

/**
 * Monta um mapa "nome de coluna normalizado" -> "nome de coluna real" a partir
 * do cabeçalho de verdade da planilha (sheet.headerValues). Isso protege contra
 * cabeçalhos com espaço duplo, quebra de linha dentro da célula, ou espaço
 * "non-breaking" (comum quando a coluna foi colada de outro lugar) — casos em
 * que row.get("nome exato") retorna undefined mesmo o texto "parecendo" igual.
 */
function montarMapaCabecalho(sheet) {
  const mapa = {};
  for (const headerReal of sheet.headerValues) {
    mapa[norm(headerReal)] = headerReal;
  }
  return mapa;
}

/** Busca o valor de uma coluna pelo nome, usando o mapa normalizado. */
function getCampo(row, mapaCabecalho, nomeEsperado) {
  const headerReal = mapaCabecalho[norm(nomeEsperado)];
  if (!headerReal) return undefined;
  return row.get(headerReal);
}

async function getClosersElegiveis() {
  const sheet = await getSheetColaboradores();
  const rows = await sheet.getRows();
  const mapaCabecalho = montarMapaCabecalho(sheet);

  const hoje = new Date();
  const mesAtual = hoje.getMonth() + 1;
  const anoAtual = hoje.getFullYear();

  const closers = [];

  for (const row of rows) {
    const cargo = String(getCampo(row, mapaCabecalho, "Cargo") || "");
    const subareaNorm = norm(getCampo(row, mapaCabecalho, "Subarea"));
    const statusNorm = norm(getCampo(row, mapaCabecalho, "Status (Equipe Comercial)"));
    const mesRef = parseInt(getCampo(row, mapaCabecalho, "Mês Referência"), 10);
    const anoRef = parseInt(getCampo(row, mapaCabecalho, "Ano Referência"), 10);

    if (!norm(cargo).includes("closer")) continue;
    if (!SUBAREAS_ELEGIVEIS.includes(subareaNorm)) continue;
    if (statusNorm !== "ativo") continue;
    if (mesRef !== mesAtual || anoRef !== anoAtual) continue;

    const nivelMatch = cargo.match(/(\d+)/);
    if (!nivelMatch) continue;
    const nivel = parseInt(nivelMatch[1], 10);

    const limite = LIMITE_DIARIO_POR_NIVEL[nivel];
    if (!limite) continue;

    const reunioesHoje = parseFloat(getCampo(row, mapaCabecalho, COLUNA_CONTADOR) || "0") || 0;

    closers.push({
      nome: getCampo(row, mapaCabecalho, "Nome"),
      subareaNorm,
      nivel,
      limite,
      reunioesHoje,
      _row: row,
      _mapaCabecalho: mapaCabecalho,
    });
  }

  return closers;
}

/** Incrementa em +1 o contador do dia do closer escolhido. */
async function incrementarContador(closer) {
  const headerReal = closer._mapaCabecalho[norm(COLUNA_CONTADOR)];
  if (!headerReal) {
    throw new Error(`Coluna '${COLUNA_CONTADOR}' não encontrada no cabeçalho da planilha.`);
  }
  const atual = parseFloat(closer._row.get(headerReal) || "0") || 0;
  closer._row.set(headerReal, atual + 1);
  await closer._row.save();
}

/** Zera o contador do dia de todos os colaboradores da aba (roda 1x/dia via cron). */
async function resetarContadorDiario() {
  const sheet = await getSheetColaboradores();
  const rows = await sheet.getRows();
  const mapaCabecalho = montarMapaCabecalho(sheet);
  const headerReal = mapaCabecalho[norm(COLUNA_CONTADOR)];
  if (!headerReal) {
    throw new Error(`Coluna '${COLUNA_CONTADOR}' não encontrada no cabeçalho da planilha.`);
  }

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

module.exports = { getClosersElegiveis, incrementarContador, resetarContadorDiario, montarMapaCabecalho, getCampo };
