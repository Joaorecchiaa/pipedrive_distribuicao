const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const { norm } = require("./normalizar");
const { ABA_COLABORADORES, SUBAREAS_ELEGIVEIS, LIMITE_DIARIO_POR_NIVEL, COLUNA_CONTADOR } = require("./config");

const SHEET_ID = process.env.GOOGLE_SHEET_ID; // mesmo ID usado pelo pipedrive_escala (config_dashs)

function getServiceAccountCredentials() {
  // Mesmo padrão do pipedrive_escala: JSON da Service Account em env var
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
 * Lê a aba colaboradores e retorna a lista de closers elegíveis (Elite/MGM, ativos,
 * mês/ano de referência atual), com nível, limite diário e reuniões recebidas hoje.
 */
async function getClosersElegiveis() {
  const sheet = await getSheetColaboradores();
  const rows = await sheet.getRows();

  const hoje = new Date();
  const mesAtual = hoje.getMonth() + 1;
  const anoAtual = hoje.getFullYear();

  const closers = [];

  for (const row of rows) {
    const cargo = String(row.get("Cargo") || "");
    const subareaNorm = norm(row.get("Subarea"));
    const statusNorm = norm(row.get("Status (Equipe Comercial)"));
    const mesRef = parseInt(row.get("Mês Referência"), 10);
    const anoRef = parseInt(row.get("Ano Referência"), 10);

    if (!norm(cargo).includes("closer")) continue;
    if (!SUBAREAS_ELEGIVEIS.includes(subareaNorm)) continue;
    if (statusNorm !== "ativo") continue;
    if (mesRef !== mesAtual || anoRef !== anoAtual) continue;

    const nivelMatch = cargo.match(/(\d+)/);
    if (!nivelMatch) continue; // cargo sem número (ex: "Closer Legendário") fica de fora
    const nivel = parseInt(nivelMatch[1], 10);

    const limite = LIMITE_DIARIO_POR_NIVEL[nivel];
    if (!limite) continue; // nível fora do mapa de teste

    const reunioesHoje = parseFloat(row.get(COLUNA_CONTADOR) || "0") || 0;

    closers.push({
      nome: row.get("Nome"),
      subareaNorm,
      nivel,
      limite,
      reunioesHoje,
      _row: row, // referência direta pra incrementar depois sem precisar buscar de novo
    });
  }

  return closers;
}

/** Incrementa em +1 o contador do dia do closer escolhido. */
async function incrementarContador(closer) {
  const atual = parseFloat(closer._row.get(COLUNA_CONTADOR) || "0") || 0;
  closer._row.set(COLUNA_CONTADOR, atual + 1);
  await closer._row.save();
}

/** Zera o contador do dia de todos os colaboradores da aba (roda 1x/dia via cron). */
async function resetarContadorDiario() {
  const sheet = await getSheetColaboradores();
  const rows = await sheet.getRows();
  let atualizados = 0;
  for (const row of rows) {
    const atual = row.get(COLUNA_CONTADOR);
    if (atual !== undefined && atual !== "" && Number(atual) !== 0) {
      row.set(COLUNA_CONTADOR, 0);
      await row.save();
      atualizados++;
    }
  }
  return atualizados;
}

module.exports = { getClosersElegiveis, incrementarContador, resetarContadorDiario };
