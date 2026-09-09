const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const { norm } = require("../lib/normalizar");
const { montarMapaCabecalho, getCampo } = require("../lib/sheets");
const { ABA_COLABORADORES, SUBAREAS_ELEGIVEIS, LIMITE_DIARIO_POR_NIVEL, COLUNA_CONTADOR } = require("../lib/config");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

module.exports = async (req, res) => {
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  if (WEBHOOK_SECRET && req.query?.secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  try {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const jwt = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const doc = new GoogleSpreadsheet(SHEET_ID, jwt);
    await doc.loadInfo();

    const sheet = doc.sheetsByTitle[ABA_COLABORADORES];
    if (!sheet) {
      return res.status(404).json({ error: `Aba '${ABA_COLABORADORES}' não encontrada.` });
    }

    const mapaCabecalho = montarMapaCabecalho(sheet);
    const rows = await sheet.getRows();
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();

    const diagnostico = [];
    let elegiveisCount = 0;

    for (const row of rows) {
      const cargo = String(getCampo(row, mapaCabecalho, "Cargo") || "");
      const cargoNorm = norm(cargo);
      const subareaVal = getCampo(row, mapaCabecalho, "Subarea");
      const subareaNorm = norm(subareaVal);
      const statusVal = getCampo(row, mapaCabecalho, "Status (Equipe Comercial)");
      const statusNorm = norm(statusVal);
      const mesRefVal = getCampo(row, mapaCabecalho, "Mês Referência");
      const anoRefVal = getCampo(row, mapaCabecalho, "Ano Referência");
      const mesRef = parseInt(mesRefVal, 10);
      const anoRef = parseInt(anoRefVal, 10);
      const nome = getCampo(row, mapaCabecalho, "Nome");

      if (!cargoNorm.includes("closer")) continue;

      const motivos = [];
      if (!SUBAREAS_ELEGIVEIS.includes(subareaNorm)) {
        motivos.push(`Subarea '${subareaVal}' (normalizado: '${subareaNorm}') não está em [${SUBAREAS_ELEGIVEIS.join(", ")}]`);
      }
      if (statusNorm !== "ativo") {
        motivos.push(`Status '${statusVal}' (normalizado: '${statusNorm}') != 'ativo'`);
      }
      if (mesRef !== mesAtual || anoRef !== anoAtual) {
        motivos.push(`Mês/Ano Referência = ${mesRefVal}/${anoRefVal}, esperado ${mesAtual}/${anoAtual}`);
      }
      const nivelMatch = cargo.match(/(\d+)/);
      if (!nivelMatch) {
        motivos.push(`Cargo '${cargo}' não tem número extraível`);
      } else if (!LIMITE_DIARIO_POR_NIVEL[parseInt(nivelMatch[1], 10)]) {
        motivos.push(`Nível ${nivelMatch[1]} não está no mapa de LIMITE_DIARIO_POR_NIVEL`);
      }

      if (motivos.length === 0) elegiveisCount++;

      diagnostico.push({
        nome,
        cargo,
        subarea: subareaVal,
        status: statusVal,
        mesRef: mesRefVal,
        anoRef: anoRefVal,
        reunioesHoje: getCampo(row, mapaCabecalho, COLUNA_CONTADOR),
        elegivel: motivos.length === 0,
        motivos_exclusao: motivos,
      });
    }

    return res.status(200).json({
      cabecalhosReaisDaPlanilha: sheet.headerValues,
      mesAtualEsperado: mesAtual,
      anoAtualEsperado: anoAtual,
      totalClosersNaPlanilha: diagnostico.length,
      totalElegiveis: elegiveisCount,
      detalhes: diagnostico,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};


