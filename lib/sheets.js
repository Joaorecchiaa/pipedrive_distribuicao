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
  COLUNA_CREDITO_ATUAL,
  COLUNA_VEZES_NA_FILA,
  COLUNA_AJUSTE_FILA,
  COLUNA_LOG_DATA_HORA,
  COLUNA_LOG_DEAL_ID,
  COLUNA_LOG_COLABORADOR,
  COLUNA_LOG_ALTERADO,
  COLUNA_LOG_NOVO_PROPRIETARIO,
  COLUNA_LOG_AGENDADA_OUTRO_DIA,
  COLUNA_LOG_REUNIAO_DATA,
  COLUNA_LOG_REUNIAO_HORA,
  COLUNA_LOG_REUNIAO_DURACAO,
  COLUNA_LOG_RESPONSAVEL_ATUAL,
  COLUNA_LOG_CREDITADA_EM,
  DURACAO_PADRAO_REUNIAO_MIN,
  ABA_ESCALA,
  COLUNA_ESCALA_NOME,
  COLUNA_ESCALA_CARGO,
  COLUNA_ESCALA_ENTRADA,
  COLUNA_ESCALA_SAIDA,
  COLUNA_ESCALA_DIAS_SEMANA,
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
  { chave: "recebidas_hoje", palavras: ["recebid"] }, // histórico do dia (só sobe); fila/meta usam REUNIOES_ATUAIS_HOJE
  { chave: "reunioes_atuais_hoje", palavras: ["atuais"] }, // crédito real, sobe/desce
  { chave: "vezes_na_fila", palavras: ["vezes"] }, // opcional: peso na fila (2 = passa 2x antes dos demais)
  { chave: "ajuste_fila", palavras: ["ajuste"] }, // gerida pelo sistema: entrada tardia na fila
];

const ALIASES_LOG = [
  { chave: "data_hora", palavras: ["data"] },
  { chave: "deal_id", palavras: ["deal"] },
  { chave: "colaborador", palavras: ["colaborador"] },
  { chave: "funil", palavras: ["funil"] },
  { chave: "reunioes_do_dia", palavras: ["reunioes", "dia"] },
  { chave: "alterado", palavras: ["alterado"] },
  { chave: "novo_proprietario", palavras: ["novo", "proprietario"] },
  { chave: "agendada_outro_dia", palavras: ["agendada", "outro"] },
  { chave: "creditada_em", palavras: ["creditada"] },
];

const ALIASES_ESCALA = [
  { chave: "nome", palavras: ["nome"] },
  { chave: "cargo", palavras: ["cargo"] },
  { chave: "entrada", palavras: ["entrada"] },
  { chave: "saida", palavras: ["saida"] },
  { chave: "dias_semana", palavras: ["dias"] },
];

const DIAS_SEMANA_ABREV = { sun: "dom", mon: "seg", tue: "ter", wed: "qua", thu: "qui", fri: "sex", sat: "sab" };

/** Dia da semana (abreviado, pt-BR) de uma data "AAAA-MM-DD", sem depender de timezone. */
function diaSemanaAbrevDeData(dataStr) {
  const [y, m, d] = dataStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const diaIngles = dt.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  return DIAS_SEMANA_ABREV[diaIngles];
}

/** Normaliza "HH:MM" ou "HH:MM:SS" pros primeiros 5 caracteres, pra comparação por minuto. */
function hhmm(str) {
  return String(str).slice(0, 5);
}

/**
 * Lê a aba escala_comercial e retorna o conjunto (nomes normalizados) dos
 * Closers que estão DENTRO do horário de turno no momento de referência.
 * dias_semana vazio = todos os dias. Uma pessoa pode ter várias linhas
 * (turnos diferentes) — basta UMA bater pra considerar "na escala".
 *
 * `momentoReuniao` (opcional): { data: "AAAA-MM-DD", hora: "HH:MM" }. Quando
 * informado, verifica a escala NAQUELE dia/horário (ex: reunião marcada pra
 * amanhã às 9h só pode ir pra quem estiver de plantão amanhã às 9h — não pra
 * quem está de plantão agora). Sem `hora` (reunião sem due_time definido),
 * checa só o dia, sem exigir horário. Sem `momentoReuniao` (compatibilidade),
 * usa o dia/hora atuais (America/Sao_Paulo) — comportamento de antes.
 */
async function buscarClosersEmEscalaAgora(momentoReuniao = null) {
  const doc = await getDoc();
  const sheet = await getAba(doc, ABA_ESCALA);
  const mapa = await montarMapaCabecalho(sheet, ALIASES_ESCALA);
  const rows = await sheet.getRows();

  let diaHoje, horaReferencia, exigirHorario;
  if (momentoReuniao && momentoReuniao.data) {
    diaHoje = diaSemanaAbrevDeData(momentoReuniao.data);
    horaReferencia = momentoReuniao.hora ? hhmm(momentoReuniao.hora) : null;
    exigirHorario = !!horaReferencia;
  } else {
    const diaIngles = new Date()
      .toLocaleString("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" })
      .toLowerCase(); // "mon", "tue", ...
    diaHoje = DIAS_SEMANA_ABREV[diaIngles];
    horaReferencia = hhmm(new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour12: false }));
    exigirHorario = true;
  }

  const emEscala = new Set();

  for (const row of rows) {
    const cargo = norm(getCampo(row, mapa, COLUNA_ESCALA_CARGO));
    if (!cargo.includes("closer")) continue;

    const nome = getCampo(row, mapa, COLUNA_ESCALA_NOME);
    if (!nome) continue;

    const diasSemanaRaw = getCampo(row, mapa, COLUNA_ESCALA_DIAS_SEMANA);
    const diasArray = diasSemanaRaw
      ? String(diasSemanaRaw)
          .split(",")
          .map((d) => norm(d.trim()).slice(0, 3))
      : [];
    const diaOk = diasArray.length === 0 || diasArray.includes(diaHoje);
    if (!diaOk) continue;

    if (exigirHorario) {
      const entrada = getCampo(row, mapa, COLUNA_ESCALA_ENTRADA);
      const saida = getCampo(row, mapa, COLUNA_ESCALA_SAIDA);
      if (!entrada || !saida) continue;

      const dentroDoHorario = horaReferencia >= hhmm(entrada) && horaReferencia <= hhmm(saida);
      if (!dentroDoHorario) continue;
    }

    emEscala.add(norm(nome));
  }

  return emEscala;
}

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
async function getClosersElegiveis(momentoReuniao = null) {
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

    // A fila e a meta olham o que o closer TEM pra fazer hoje (REUNIOES_ATUAIS_HOJE):
    // reunião que entrou e já saiu (devolvida ou remanejada) não conta. Sem essa
    // coluna na planilha, cai pra RECEBIDAS_HOJE.
    const colunaContagem = mapaDist[norm(COLUNA_CREDITO_ATUAL)] ? COLUNA_CREDITO_ATUAL : COLUNA_RECEBIDAS;
    const reunioesHoje = parseFloat(getCampo(entradaDist.row, mapaDist, colunaContagem) || "0") || 0;
    const recebidasHoje = parseFloat(getCampo(entradaDist.row, mapaDist, COLUNA_RECEBIDAS) || "0") || 0; // histórico (só sobe)
    const vezesNaFila = Math.max(1, parseInt(getCampo(entradaDist.row, mapaDist, COLUNA_VEZES_NA_FILA), 10) || 1);
    const temColunaAjuste = !!mapaDist[norm(COLUNA_AJUSTE_FILA)];
    const ajusteFila = Math.max(0, parseInt(getCampo(entradaDist.row, mapaDist, COLUNA_AJUSTE_FILA), 10) || 0);

    closers.push({
      nome,
      subareaNorm,
      limite,
      reunioesHoje,
      recebidasHoje,
      vezesNaFila,
      ajusteFila,
      ajusteIndisponivel: !temColunaAjuste,
      ordemFila: entradaDist.ordemFila,
      _rowDist: entradaDist.row,
      _mapaDist: mapaDist,
      _doc: doc,
    });
  }

  // Filtro de escala: só quem está dentro do horário de turno NO MOMENTO DA
  // REUNIÃO (não necessariamente "agora" — uma reunião pra amanhã só pode
  // ir pra quem estiver de plantão amanhã, no horário dela).
  // Fallback: se NINGUÉM estiver na escala nesse momento, todos os closers
  // ativos entram na disputa mesmo assim (mesma lógica do pipedrive_escala).
  // `.todos` = todos os closers elegíveis ANTES do filtro de escala: a fila
  // precisa saber quem foi o último a receber hoje, mesmo que já tenha saído
  // do turno (ver calcularEntradasTardias em distribuicao.js).
  const emEscala = await buscarClosersEmEscalaAgora(momentoReuniao);
  const elegiveis = emEscala.size > 0 ? closers.filter((c) => emEscala.has(norm(c.nome))) : closers;
  elegiveis.todos = closers;

  if (closers.length > 0 && closers.every((c) => c.ajusteIndisponivel)) {
    console.warn(
      `Aviso: coluna '${COLUNA_AJUSTE_FILA}' não existe na aba ${ABA_DISTRIBUICAO}. Sem ela, quem chega tarde recupera o atraso (recebe várias seguidas). Crie a coluna pra ativar a regra de fila sem privilégio.`
    );
  }

  return elegiveis;
}

/** Aceita "AAAA-MM-DD" ou "DD/MM/AAAA" (como a planilha pode devolver) e normaliza pra "AAAA-MM-DD". */
function dataParaISO(valor) {
  const s = String(valor || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

/**
 * Quantas reuniões já foram distribuídas pra cada closer com data de reunião
 * = `dataISO` ("AAAA-MM-DD"), lendo o log_distribuicao (coluna
 * AGENDADA_OUTRO_DIA). Retorna { nomeNormalizado: quantidade }. Vale só a
 * ÚLTIMA linha de cada deal (se foi redistribuído ou remarcado, a anterior não
 * conta) e ignora as já reatribuídas manualmente (ALTERADO = Sim).
 */
async function contarReunioesAgendadasPorDia(dataISO) {
  const doc = await getDoc();
  const sheet = await getAba(doc, ABA_LOG);
  const mapa = await montarMapaCabecalho(sheet, ALIASES_LOG);
  const rows = await sheet.getRows();

  const ultimoPorDeal = new Map();
  for (const row of rows) {
    const dealId = String(getCampo(row, mapa, COLUNA_LOG_DEAL_ID) || "").trim();
    if (!dealId) continue;
    ultimoPorDeal.set(dealId, {
      agendada: dataParaISO(getCampo(row, mapa, COLUNA_LOG_AGENDADA_OUTRO_DIA)),
      alterado: norm(getCampo(row, mapa, COLUNA_LOG_ALTERADO)) === "sim",
      nome: norm(getCampo(row, mapa, COLUNA_LOG_COLABORADOR)),
    });
  }

  const contagem = {};
  for (const { agendada, alterado, nome } of ultimoPorDeal.values()) {
    if (agendada !== dataISO || alterado || !nome) continue;
    contagem[nome] = (contagem[nome] || 0) + 1;
  }
  return contagem;
}

/** Hoje em "AAAA-MM-DD" (America/Sao_Paulo). */
function hojeISOSaoPaulo() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * Soma em REUNIOES_ATUAIS_HOJE as reuniões que foram distribuídas em DIAS
 * ANTERIORES mas são pra HOJE (log: AGENDADA_OUTRO_DIA = hoje). Elas entram na
 * conta da meta e da fila junto com as de hoje. NÃO mexe em RECEBIDAS_HOJE
 * (só distribuições feitas hoje).
 *
 * - Vale só a última linha de cada deal; ignora as que voltaram (ALTERADO = Sim).
 * - Dono = NOVO_PROPRIETARIO (se o head remanejou) ou COLABORADOR.
 * - Cada deal é somado UMA vez: o log recebe CREDITADA_EM = hoje (idempotente;
 *   pode rodar várias vezes no dia, por cron e por distribuição/reatribuição).
 * - Sem a coluna CREDITADA_EM no log não dá pra garantir isso: não faz nada.
 */
async function semearReunioesDeHoje() {
  const hojeISO = hojeISOSaoPaulo();
  const doc = await getDoc();
  const sheetLog = await getAba(doc, ABA_LOG);
  const mapaLog = await montarMapaCabecalho(sheetLog, ALIASES_LOG);
  if (!mapaLog[norm(COLUNA_LOG_CREDITADA_EM)]) {
    console.warn(
      `Aviso: coluna '${COLUNA_LOG_CREDITADA_EM}' não existe no ${ABA_LOG}. Reuniões marcadas em dias anteriores pra hoje NÃO estão sendo somadas. Crie a coluna.`
    );
    return { semeadas: 0, semColuna: true, porCloser: {} };
  }
  const headerCreditada = mapaLog[norm(COLUNA_LOG_CREDITADA_EM)];
  const rowsLog = await sheetLog.getRows();

  const ultimoPorDeal = new Map();
  for (const row of rowsLog) {
    const dealId = String(getCampo(row, mapaLog, COLUNA_LOG_DEAL_ID) || "").trim();
    if (dealId) ultimoPorDeal.set(dealId, row);
  }

  const pendentes = [];
  for (const row of ultimoPorDeal.values()) {
    if (dataParaISO(getCampo(row, mapaLog, COLUNA_LOG_AGENDADA_OUTRO_DIA)) !== hojeISO) continue;
    if (norm(getCampo(row, mapaLog, COLUNA_LOG_ALTERADO)) === "sim") continue;
    if (dataParaISO(getCampo(row, mapaLog, COLUNA_LOG_CREDITADA_EM)) === hojeISO) continue;
    const dono = norm(getCampo(row, mapaLog, COLUNA_LOG_RESPONSAVEL_ATUAL) || getCampo(row, mapaLog, COLUNA_LOG_COLABORADOR));
    if (dono) pendentes.push({ row, dono });
  }
  if (pendentes.length === 0) return { semeadas: 0, porCloser: {} };

  // Marca primeiro (se algo falhar no meio, falta crédito em vez de sobrar).
  for (const { row } of pendentes) {
    row.set(headerCreditada, hojeISO);
    await row.save();
  }

  const porCloser = {};
  for (const { dono } of pendentes) porCloser[dono] = (porCloser[dono] || 0) + 1;

  const sheetDist = await getAba(doc, ABA_DISTRIBUICAO);
  const mapaDist = await montarMapaCabecalho(sheetDist, ALIASES_DISTRIBUICAO);
  const headerCredito = mapaDist[norm(COLUNA_CREDITO_ATUAL)];
  if (!headerCredito) throw new Error(`Coluna '${COLUNA_CREDITO_ATUAL}' não encontrada no cabeçalho de ${ABA_DISTRIBUICAO}.`);
  const rowsDist = await sheetDist.getRows();
  for (const row of rowsDist) {
    const nome = norm(getCampo(row, mapaDist, COLUNA_NOME_DISTRIBUICAO));
    if (!porCloser[nome]) continue;
    if (!norm(getCampo(row, mapaDist, COLUNA_CARGO_DISTRIBUICAO)).includes("closer")) continue;
    const atual = parseFloat(row.get(headerCredito) || "0") || 0;
    row.set(headerCredito, atual + porCloser[nome]);
    await row.save();
  }

  console.log(`Reuniões de dias anteriores pra hoje somadas em ${COLUNA_CREDITO_ATUAL}: ${JSON.stringify(porCloser)}`);
  return { semeadas: pendentes.length, porCloser };
}

/** Grava o ajuste de fila (entrada tardia) do closer na planilha. */
async function salvarAjusteFila(closer, valor) {
  const header = closer._mapaDist[norm(COLUNA_AJUSTE_FILA)];
  if (!header) {
    throw new Error(`Coluna '${COLUNA_AJUSTE_FILA}' não encontrada no cabeçalho de ${ABA_DISTRIBUICAO}.`);
  }
  closer._rowDist.set(header, valor);
  await closer._rowDist.save();
}

/**
 * Incrementa em +1 as duas colunas na distribuição normal:
 * RECEBIDAS_HOJE (histórico do dia, nunca desconta) e
 * REUNIOES_ATUAIS_HOJE (crédito real: é o que a fila e a meta usam; sobe/desce com devolução e remanejamento).
 */
async function incrementarContador(closer, { semCredito = false } = {}) {
  const headerRecebidas = closer._mapaDist[norm(COLUNA_RECEBIDAS)];
  const headerCredito = closer._mapaDist[norm(COLUNA_CREDITO_ATUAL)];
  if (!headerRecebidas) {
    throw new Error(`Coluna '${COLUNA_RECEBIDAS}' não encontrada no cabeçalho de ${ABA_DISTRIBUICAO}.`);
  }
  if (!headerCredito) {
    throw new Error(`Coluna '${COLUNA_CREDITO_ATUAL}' não encontrada no cabeçalho de ${ABA_DISTRIBUICAO}.`);
  }

  const atualRecebidas = parseFloat(closer._rowDist.get(headerRecebidas) || "0") || 0;
  const atualCredito = parseFloat(closer._rowDist.get(headerCredito) || "0") || 0;
  closer._rowDist.set(headerRecebidas, atualRecebidas + 1);
  // semCredito: o mesmo deal voltou pro MESMO closer — o histórico sobe, o crédito (que já contava esse deal) não.
  if (!semCredito) closer._rowDist.set(headerCredito, atualCredito + 1);
  await closer._rowDist.save();

  return semCredito ? atualCredito : atualCredito + 1;
}

/**
 * Transfere o crédito real (REUNIOES_ATUAIS_HOJE) do closer original pro novo
 * dono do deal — usado quando alguém reatribui manualmente. NUNCA mexe em
 * RECEBIDAS_HOJE (histórico, intocado).
 *
 * - Sempre desconta 1 do closer original (se encontrado na planilha).
 * - Só credita o novo dono se ele também for um Closer (Cargo contém "closer")
 *   E estiver cadastrado na distribuicao_reuniao. Se for SDR, Head, Team
 *   Leader ou qualquer um fora da planilha, ninguém ganha o crédito — só o
 *   nome dele fica registrado no log (feito em outro lugar).
 * - Nunca deixa o contador ficar negativo.
 */
async function transferirCredito(nomeAntigo, nomeNovo) {
  const doc = await getDoc();
  const sheet = await getAba(doc, ABA_DISTRIBUICAO);
  const mapa = await montarMapaCabecalho(sheet, ALIASES_DISTRIBUICAO);
  const rows = await sheet.getRows();

  const headerCredito = mapa[norm(COLUNA_CREDITO_ATUAL)];
  if (!headerCredito) {
    throw new Error(`Coluna '${COLUNA_CREDITO_ATUAL}' não encontrada no cabeçalho de ${ABA_DISTRIBUICAO}.`);
  }

  const nomeAntigoNorm = norm(nomeAntigo);
  const rowAntigo = rows.find((r) => norm(getCampo(r, mapa, COLUNA_NOME_DISTRIBUICAO)) === nomeAntigoNorm);
  let creditoAntigoNovoValor = null;
  if (rowAntigo) {
    const atual = parseFloat(rowAntigo.get(headerCredito) || "0") || 0;
    creditoAntigoNovoValor = Math.max(0, atual - 1);
    rowAntigo.set(headerCredito, creditoAntigoNovoValor);
    await rowAntigo.save();
  }

  const nomeNovoNorm = norm(nomeNovo);
  const rowNovo = rows.find((r) => norm(getCampo(r, mapa, COLUNA_NOME_DISTRIBUICAO)) === nomeNovoNorm);
  const novoEhCloser = !!(
    rowNovo && norm(getCampo(rowNovo, mapa, COLUNA_CARGO_DISTRIBUICAO)).includes("closer")
  );

  let creditoNovoNovoValor = null;
  if (novoEhCloser) {
    const atualNovo = parseFloat(rowNovo.get(headerCredito) || "0") || 0;
    creditoNovoNovoValor = atualNovo + 1;
    rowNovo.set(headerCredito, creditoNovoNovoValor);
    await rowNovo.save();
  }

  return {
    closerOriginalEncontrado: !!rowAntigo,
    creditoAntigoNovoValor,
    novoEhCloser,
    creditoNovoNovoValor,
  };
}

/**
 * Quem está contando HOJE esse deal em REUNIOES_ATUAIS_HOJE, segundo o log
 * (última linha do deal, ainda não marcada como voltou). Retorna o nome do
 * closer ou null. Usado quando o deal é distribuído DE NOVO (head devolveu pra
 * DISTRIBUIÇÃO pra redistribuir): o closer que estava com ele precisa perder o crédito.
 */
async function buscarCreditoAtivoDoDeal(dealId) {
  const doc = await getDoc();
  const sheet = await getAba(doc, ABA_LOG);
  const mapa = await montarMapaCabecalho(sheet, ALIASES_LOG);
  const rows = await sheet.getRows();
  const hoje = hojeISOSaoPaulo();

  let ultima = null;
  for (const row of rows) {
    if (String(getCampo(row, mapa, COLUNA_LOG_DEAL_ID) || "").trim() === String(dealId)) ultima = row;
  }
  if (!ultima) return null;
  if (norm(getCampo(ultima, mapa, COLUNA_LOG_ALTERADO)) === "sim") return null; // já descontado

  const outroDia = dataParaISO(getCampo(ultima, mapa, COLUNA_LOG_AGENDADA_OUTRO_DIA));
  const contouHoje =
    (ehHoje(getCampo(ultima, mapa, COLUNA_LOG_DATA_HORA)) && !outroDia) ||
    (outroDia === hoje && dataParaISO(getCampo(ultima, mapa, COLUNA_LOG_CREDITADA_EM)) === hoje);
  if (!contouHoje) return null;

  return getCampo(ultima, mapa, COLUNA_LOG_RESPONSAVEL_ATUAL) || getCampo(ultima, mapa, COLUNA_LOG_COLABORADOR) || null;
}

/** Tira 1 de REUNIOES_ATUAIS_HOJE do closer (nunca abaixo de 0). Retorna o novo valor (ou null se não achou). */
async function descontarCredito(nome) {
  const doc = await getDoc();
  const sheet = await getAba(doc, ABA_DISTRIBUICAO);
  const mapa = await montarMapaCabecalho(sheet, ALIASES_DISTRIBUICAO);
  const header = mapa[norm(COLUNA_CREDITO_ATUAL)];
  if (!header) throw new Error(`Coluna '${COLUNA_CREDITO_ATUAL}' não encontrada no cabeçalho de ${ABA_DISTRIBUICAO}.`);
  const rows = await sheet.getRows();
  const row = rows.find((r) => norm(getCampo(r, mapa, COLUNA_NOME_DISTRIBUICAO)) === norm(nome));
  if (!row) return null;
  const novo = Math.max(0, (parseFloat(row.get(header) || "0") || 0) - 1);
  row.set(header, novo);
  await row.save();
  return novo;
}

/** Zera RECEBIDAS_HOJE e REUNIOES_ATUAIS_HOJE de todos (roda 1x/dia via cron). NÃO mexe na meta (QTD_REUNIOES). */
async function resetarContadorDiario() {
  const doc = await getDoc();
  const sheet = await getAba(doc, ABA_DISTRIBUICAO);
  const mapa = await montarMapaCabecalho(sheet, ALIASES_DISTRIBUICAO);
  const headerRecebidas = mapa[norm(COLUNA_RECEBIDAS)];
  const headerCredito = mapa[norm(COLUNA_CREDITO_ATUAL)];
  if (!headerRecebidas) {
    throw new Error(`Coluna '${COLUNA_RECEBIDAS}' não encontrada no cabeçalho de ${ABA_DISTRIBUICAO}.`);
  }
  if (!headerCredito) {
    throw new Error(`Coluna '${COLUNA_CREDITO_ATUAL}' não encontrada no cabeçalho de ${ABA_DISTRIBUICAO}.`);
  }

  const headerAjuste = mapa[norm(COLUNA_AJUSTE_FILA)]; // opcional: zera junto, se existir

  const rows = await sheet.getRows();
  let atualizados = 0;
  for (const row of rows) {
    const atualRecebidas = row.get(headerRecebidas);
    const atualCredito = row.get(headerCredito);
    const atualAjuste = headerAjuste ? row.get(headerAjuste) : undefined;
    const precisaZerar =
      (atualRecebidas !== undefined && atualRecebidas !== "" && Number(atualRecebidas) !== 0) ||
      (atualCredito !== undefined && atualCredito !== "" && Number(atualCredito) !== 0) ||
      (atualAjuste !== undefined && atualAjuste !== "" && Number(atualAjuste) !== 0);
    if (precisaZerar) {
      row.set(headerRecebidas, 0);
      row.set(headerCredito, 0);
      if (headerAjuste) row.set(headerAjuste, 0);
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
async function registrarLog(closer, dealId, reunioesAposDistribuicao, dataAgendadaOutroDia, reuniao = null) {
  const sheetLog = await getAba(closer._doc, ABA_LOG);
  await sheetLog.loadHeaderRow();

  const dataHora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const destino = NOME_DESTINO_POR_SUBAREA[closer.subareaNorm] || closer.subareaNorm;

  const linha = {
    "DATA_HORA": dataHora,
    "DEAL_ID": dealId,
    "COLABORADOR": closer.nome,
    "FUNIL": destino,
    "REUNIOES_DO_DIA": reunioesAposDistribuicao,
    "AGENDADA_OUTRO_DIA": dataAgendadaOutroDia || "",
  };

  // Horário da reunião: alimenta a checagem de choque de horário (ver
  // carregarAgendaDoDia). Só grava se as colunas novas existirem no log.
  if (reuniao && reuniao.due_date && reuniao.due_time) {
    const headers = sheetLog.headerValues.map((h) => norm(h));
    const grava = (nomeColuna, valor) => {
      if (headers.includes(norm(nomeColuna))) linha[nomeColuna] = valor;
    };
    grava(COLUNA_LOG_REUNIAO_DATA, reuniao.due_date);
    grava(COLUNA_LOG_REUNIAO_HORA, String(reuniao.due_time).slice(0, 5));
    grava(COLUNA_LOG_REUNIAO_DURACAO, reuniao.duracao_min || DURACAO_PADRAO_REUNIAO_MIN);
  }

  await sheetLog.addRow(linha);
}

/** "HH:MM" ou "HH:MM:SS" -> minutos desde 00:00 (null se inválido). */
function horaParaMinutos(str) {
  const m = String(str || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/**
 * Agenda de reuniões JÁ DISTRIBUÍDAS pra um dia, por closer: lê o
 * log_distribuicao (colunas REUNIAO_DATA / REUNIAO_HORA / REUNIAO_DURACAO_MIN).
 * Retorna { nomeNormalizado: [{ dealId, inicio, fim }] } (minutos desde 00:00).
 *
 * - Vale só a ÚLTIMA linha de cada deal (redistribuição/tentativa anterior não conta).
 * - Ignora deals que voltaram (ALTERADO = Sim): a reunião não está mais com ele.
 * - Dono da reunião = RESPONSAVEL_ATUAL (quando o head remanejou entre closers)
 *   ou, se vazio, o COLABORADOR original.
 * - Linhas antigas, sem horário gravado, não entram (não há como comparar).
 */
async function carregarAgendaDoDia(dataISO) {
  const doc = await getDoc();
  const sheet = await getAba(doc, ABA_LOG);
  const mapa = await montarMapaCabecalho(sheet, ALIASES_LOG);
  const rows = await sheet.getRows();

  const ultimoPorDeal = new Map();
  for (const row of rows) {
    const dealId = String(getCampo(row, mapa, COLUNA_LOG_DEAL_ID) || "").trim();
    if (!dealId) continue;
    ultimoPorDeal.set(dealId, row);
  }

  const agenda = {};
  for (const [dealId, row] of ultimoPorDeal) {
    if (dataParaISO(getCampo(row, mapa, COLUNA_LOG_REUNIAO_DATA)) !== dataISO) continue;
    if (norm(getCampo(row, mapa, COLUNA_LOG_ALTERADO)) === "sim") continue;

    const inicio = horaParaMinutos(getCampo(row, mapa, COLUNA_LOG_REUNIAO_HORA));
    if (inicio === null) continue;
    const duracao = parseInt(getCampo(row, mapa, COLUNA_LOG_REUNIAO_DURACAO), 10) || DURACAO_PADRAO_REUNIAO_MIN;

    const dono = norm(
      getCampo(row, mapa, COLUNA_LOG_RESPONSAVEL_ATUAL) || getCampo(row, mapa, COLUNA_LOG_COLABORADOR)
    );
    if (!dono) continue;

    (agenda[dono] = agenda[dono] || []).push({ dealId, inicio, fim: inicio + duracao });
  }
  return agenda;
}

/** Duas reuniões se chocam quando os intervalos [início, fim) se sobrepõem. */
function reunioesSeChocam(a, b) {
  return a.inicio < b.fim && b.inicio < a.fim;
}

/** O nome é de um Closer cadastrado na aba distribuicao_reuniao? */
async function ehCloserCadastrado(nome) {
  const doc = await getDoc();
  const sheet = await getAba(doc, ABA_DISTRIBUICAO);
  const mapa = await montarMapaCabecalho(sheet, ALIASES_DISTRIBUICAO);
  const rows = await sheet.getRows();
  const alvo = norm(nome);
  return rows.some(
    (r) =>
      norm(getCampo(r, mapa, COLUNA_NOME_DISTRIBUICAO)) === alvo &&
      norm(getCampo(r, mapa, COLUNA_CARGO_DISTRIBUICAO)).includes("closer")
  );
}

/**
 * Grava em RESPONSAVEL_ATUAL (log) quem está com o deal depois que o head
 * remanejou entre closers. NÃO marca ALTERADO (não é uma reunião que voltou).
 * Retorna false se a coluna não existir no log.
 */
async function registrarResponsavelAtual(logEntry, nome) {
  const header = logEntry.mapa[norm(COLUNA_LOG_RESPONSAVEL_ATUAL)];
  if (!header) return false;
  logEntry.row.set(header, nome);
  await logEntry.row.save();
  return true;
}

/**
 * Retorna o conjunto das últimas N datas ÚTEIS (formato "DD/MM/AAAA", pulando
 * sábado e domingo), contando hoje como a primeira. Usado pra limitar o
 * range de busca no log — não faz sentido comparar com distribuições de
 * semanas atrás.
 */
function ultimosDiasUteis(n) {
  const hojeStr = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const [dHoje, mHoje, yHoje] = hojeStr.split("/").map(Number);
  const cursor = new Date(yHoje, mHoje - 1, dHoje);

  const validos = new Set();
  while (validos.size < n) {
    const diaSemana = cursor.getDay(); // 0 = domingo, 6 = sábado
    if (diaSemana !== 0 && diaSemana !== 6) {
      const d = String(cursor.getDate()).padStart(2, "0");
      const m = String(cursor.getMonth() + 1).padStart(2, "0");
      const y = cursor.getFullYear();
      validos.add(`${d}/${m}/${y}`);
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return validos;
}

/**
 * Busca a linha mais recente do log_distribuicao pra um deal_id específico,
 * mas só dentro dos últimos 2 dias ÚTEIS (pula fim de semana). Fora desse
 * range, considera que não há nada relevante a corrigir — retorna null,
 * igual a "deal nunca distribuído".
 */
async function buscarUltimoLogPorDeal(dealId) {
  const doc = await getDoc();
  const sheet = await getAba(doc, ABA_LOG);
  const mapa = await montarMapaCabecalho(sheet, ALIASES_LOG);
  const rows = await sheet.getRows();

  const diasValidos = ultimosDiasUteis(2);
  const dealIdStr = String(dealId);
  let ultimaEncontrada = null;
  for (const row of rows) {
    const valor = getCampo(row, mapa, COLUNA_LOG_DEAL_ID);
    if (String(valor) !== dealIdStr) continue;

    const dataHora = getCampo(row, mapa, COLUNA_LOG_DATA_HORA);
    const dataParte = String(dataHora || "").split(",")[0].trim();
    // Reunião marcada há mais de 2 dias úteis mas que é PRA HOJE (já somada nos contadores de hoje) também vale.
    const ehPraHoje = dataParaISO(getCampo(row, mapa, COLUNA_LOG_AGENDADA_OUTRO_DIA)) === hojeISOSaoPaulo();
    if (!diasValidos.has(dataParte) && !ehPraHoje) continue; // fora do range — ignora essa linha

    ultimaEncontrada = row;
  }
  if (!ultimaEncontrada) return null;

  return {
    row: ultimaEncontrada,
    mapa,
    colaborador: getCampo(ultimaEncontrada, mapa, COLUNA_LOG_COLABORADOR),
    dataHora: getCampo(ultimaEncontrada, mapa, COLUNA_LOG_DATA_HORA),
    alterado: getCampo(ultimaEncontrada, mapa, COLUNA_LOG_ALTERADO),
    responsavelAtual: getCampo(ultimaEncontrada, mapa, COLUNA_LOG_RESPONSAVEL_ATUAL) || "",
    agendadaOutroDia: dataParaISO(getCampo(ultimaEncontrada, mapa, COLUNA_LOG_AGENDADA_OUTRO_DIA)),
    creditadaEm: dataParaISO(getCampo(ultimaEncontrada, mapa, COLUNA_LOG_CREDITADA_EM)),
  };
}

/** Marca ALTERADO = "Sim" e grava quem é o novo proprietário — evita descontar o contador duas vezes pro mesmo deal. */
async function marcarLogAlterado(logEntry, novoProprietario) {
  const headerAlterado = logEntry.mapa[norm(COLUNA_LOG_ALTERADO)];
  if (!headerAlterado) {
    throw new Error(`Coluna '${COLUNA_LOG_ALTERADO}' não encontrada no cabeçalho de ${ABA_LOG}.`);
  }
  logEntry.row.set(headerAlterado, "Sim");

  const headerNovoProprietario = logEntry.mapa[norm(COLUNA_LOG_NOVO_PROPRIETARIO)];
  if (headerNovoProprietario && novoProprietario) {
    logEntry.row.set(headerNovoProprietario, novoProprietario);
  }

  await logEntry.row.save();
}

/**
 * Confere se uma data/hora (no formato salvo por toLocaleString('pt-BR', ...))
 * cai no mesmo dia de hoje (America/Sao_Paulo). Usado pra não descontar o
 * contador de um registro de dias anteriores (o contador já resetou).
 */
function ehHoje(dataHoraStr) {
  if (!dataHoraStr) return false;
  const dataParte = String(dataHoraStr).split(",")[0].trim(); // "10/09/2026, 16:55:08" -> "10/09/2026"
  const hojeParte = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return dataParte === hojeParte;
}

module.exports = {
  getClosersElegiveis,
  incrementarContador,
  buscarCreditoAtivoDoDeal,
  descontarCredito,
  salvarAjusteFila,
  contarReunioesAgendadasPorDia,
  semearReunioesDeHoje,
  hojeISOSaoPaulo,
  carregarAgendaDoDia,
  reunioesSeChocam,
  ehCloserCadastrado,
  registrarResponsavelAtual,
  transferirCredito,
  resetarContadorDiario,
  registrarLog,
  buscarUltimoLogPorDeal,
  marcarLogAlterado,
  buscarClosersEmEscalaAgora,
  ehHoje,
  getDoc,
  getAba,
  montarMapaCabecalho,
  getCampo,
  ALIASES_COLABORADORES,
  ALIASES_DISTRIBUICAO,
  ALIASES_ESCALA,
};
