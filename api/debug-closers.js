const { norm } = require("../lib/normalizar");
const {
  getDoc,
  getAba,
  montarMapaCabecalho,
  getCampo,
  ALIASES_COLABORADORES,
  ALIASES_DISTRIBUICAO,
} = require("../lib/sheets");
const {
  ABA_COLABORADORES,
  ABA_DISTRIBUICAO,
  SUBAREAS_ELEGIVEIS,
  COLUNA_NOME_DISTRIBUICAO,
  COLUNA_CARGO_DISTRIBUICAO,
  COLUNA_META,
  COLUNA_RECEBIDAS,
} = require("../lib/config");

module.exports = async (req, res) => {
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  if (WEBHOOK_SECRET && req.query?.secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  try {
    const doc = await getDoc();

    const sheetColab = await getAba(doc, ABA_COLABORADORES);
    const mapaColab = await montarMapaCabecalho(sheetColab, ALIASES_COLABORADORES);
    const rowsColab = await sheetColab.getRows();

    const sheetDist = await getAba(doc, ABA_DISTRIBUICAO);
    const mapaDist = await montarMapaCabecalho(sheetDist, ALIASES_DISTRIBUICAO);
    const rowsDist = await sheetDist.getRows();

    const indiceDist = {};
    let ordemFilaAtual = 0;
    for (const row of rowsDist) {
      const cargoDist = norm(getCampo(row, mapaDist, COLUNA_CARGO_DISTRIBUICAO));
      if (!cargoDist.includes("closer")) continue;
      const nome = getCampo(row, mapaDist, COLUNA_NOME_DISTRIBUICAO);
      if (!nome) continue;
      indiceDist[norm(nome)] = { row, ordemFila: ordemFilaAtual };
      ordemFilaAtual++;
    }

    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();

    const diagnostico = [];
    let elegiveisCount = 0;

    for (const row of rowsColab) {
      const cargo = String(getCampo(row, mapaColab, "Cargo") || "");
      const cargoNorm = norm(cargo);
      const subareaVal = getCampo(row, mapaColab, "Subarea");
      const subareaNorm = norm(subareaVal);
      const statusVal = getCampo(row, mapaColab, "Status (Equipe Comercial)");
      const statusNorm = norm(statusVal);
      const mesRefVal = getCampo(row, mapaColab, "Mês Referência");
      const anoRefVal = getCampo(row, mapaColab, "Ano Referência");
      const mesRef = parseInt(mesRefVal, 10);
      const anoRef = parseInt(anoRefVal, 10);
      const nome = getCampo(row, mapaColab, "Nome");

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

      const entradaDist = indiceDist[norm(nome)];
      let meta = null;
      let recebidas = null;
      let ordemFila = null;
      if (!entradaDist) {
        motivos.push(`Nome '${nome}' não encontrado na aba '${ABA_DISTRIBUICAO}' com Cargo contendo "closer" (normalizado: '${norm(nome)}')`);
      } else {
        ordemFila = entradaDist.ordemFila;
        const metaRaw = getCampo(entradaDist.row, mapaDist, COLUNA_META);
        meta = parseInt(metaRaw, 10);
        if (!meta || meta <= 0) {
          motivos.push(`Meta '${metaRaw}' na coluna ${COLUNA_META} ausente ou inválida`);
        }
        recebidas = parseFloat(getCampo(entradaDist.row, mapaDist, COLUNA_RECEBIDAS) || "0") || 0;
      }

      if (motivos.length === 0) elegiveisCount++;

      diagnostico.push({
        nome,
        cargo,
        subarea: subareaVal,
        status: statusVal,
        mesRef: mesRefVal,
        anoRef: anoRefVal,
        encontradoNaDistribuicao: !!entradaDist,
        ordemFila,
        meta,
        recebidasHoje: recebidas,
        elegivel: motivos.length === 0,
        motivos_exclusao: motivos,
      });
    }

    return res.status(200).json({
      cabecalhosColaboradores: sheetColab.headerValues,
      cabecalhosDistribuicao: sheetDist.headerValues,
      totalLinhasDistribuicao: rowsDist.length,
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
