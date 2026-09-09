const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const { norm } = require("../lib/normalizar");
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

    const rows = await sheet.getRows();
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();

    const diagnostico = [];
    let elegiveisCount = 0;

    for (const row of rows) {
      const cargo = String(row.get("Cargo") || "");
      const cargoNorm = norm(cargo);
      const subareaNorm = norm(row.get("Subarea"));
      const statusNorm = norm(row.get("Status (Equipe Comercial)"));
      const mesRef = parseInt(row.get("Mês Referência"), 10);
      const anoRef = parseInt(row.get("Ano Referência"), 10);
      const nome = row.get("Nome");

      if (!cargoNorm.includes("closer")) continue; // ignora quem nem é closer, pra não poluir

      const motivos = [];
      if (!SUBAREAS_ELEGIVEIS.includes(subareaNorm)) {
        motivos.push(`Subarea '${row.get("Subarea")}' (normalizado: '${subareaNorm}') não está em [${SUBAREAS_ELEGIVEIS.join(", ")}]`);
      }
      if (statusNorm !== "ativo") {
        motivos.push(`Status '${row.get("Status (Equipe Comercial)")}' (normalizado: '${statusNorm}') != 'ativo'`);
      }
      if (mesRef !== mesAtual || anoRef !== anoAtual) {
        motivos.push(`Mês/Ano Referência = ${row.get("Mês Referência")}/${row.get("Ano Referência")}, esperado ${mesAtual}/${anoAtual}`);
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
        subarea: row.get("Subarea"),
        status: row.get("Status (Equipe Comercial)"),
        mesRef: row.get("Mês Referência"),
        anoRef: row.get("Ano Referência"),
        reunioesHoje: row.get(COLUNA_CONTADOR),
        elegivel: motivos.length === 0,
        motivos_exclusao: motivos,
      });
    }

    return res.status(200).json({
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
