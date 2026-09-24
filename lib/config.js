// Configuração central da automação de distribuição SDR → Closer
// Ajuste aqui quando a regra "real" de limite substituir a de teste.

module.exports = {
  ABA_COLABORADORES: "colaboradores",
  ABA_DISTRIBUICAO: "distribuicao_reuniao",
  ABA_LOG: "log_distribuicao",

  // Gatilho: funil/estágio de origem (Sniper) — apenas referência/documentação,
  // o gatilho de verdade fica configurado na automação nativa do Pipedrive.
  ORIGEM: { pipeline_id: 88, stage_id: 913 }, // SNIPER / DISTRIBUIÇÃO

  // Destino conforme a subarea do closer sorteado (chave já normalizada: minúsculo, sem acento)
  DESTINO_POR_SUBAREA: {
    elite: { pipeline_id: 87, stage_id: 803 }, // ELITE / AGENDADOS
    mgm: { pipeline_id: 46, stage_id: 354 },   // OLYMPUS (label "MGM" na planilha) / AGENDADOS
  },

  SUBAREAS_ELEGIVEIS: ["elite", "mgm"],

  // Colunas da aba distribuicao_reuniao (nomes esperados; ver aliases de
  // tolerância em lib/sheets.js para pequenas variações de digitação)
  COLUNA_NOME_DISTRIBUICAO: "Nome",
  COLUNA_EMAIL_DISTRIBUICAO: "Email",
  COLUNA_CARGO_DISTRIBUICAO: "Cargo",
  COLUNA_META: "QTD_REUNIOES",       // meta fixa do closer pro dia (definida manualmente na planilha)
  COLUNA_RECEBIDAS: "RECEBIDAS_HOJE", // controla sorteio/meta — só sobe (nunca desconta), reseta à meia-noite
  COLUNA_CREDITO_ATUAL: "REUNIOES_ATUAIS_HOJE", // crédito real — sobe/desce conforme reatribuição, reseta à meia-noite

  // Colunas da aba log_distribuicao
  COLUNA_LOG_DATA_HORA: "DATA_HORA",
  COLUNA_LOG_DEAL_ID: "DEAL_ID",
  COLUNA_LOG_COLABORADOR: "COLABORADOR",
  COLUNA_LOG_FUNIL: "FUNIL",
  COLUNA_LOG_REUNIOES_DO_DIA: "REUNIOES_DO_DIA",
  COLUNA_LOG_ALTERADO: "ALTERADO", // marca "Sim" quando já corrigimos o contador por reatribuição manual
  COLUNA_LOG_NOVO_PROPRIETARIO: "NOVO_PROPRIETARIO", // pra quem o deal foi reatribuído manualmente
  COLUNA_LOG_AGENDADA_OUTRO_DIA: "AGENDADA_OUTRO_DIA", // data (AAAA-MM-DD) se a reunião não é pra hoje — nesse caso não contou no contador

  // Aba escala_comercial (mesma usada pelo pipedrive_escala) — filtra quem
  // está dentro do horário de turno agora. Fallback: se ninguém estiver na
  // escala no momento, todos os closers ativos entram na disputa mesmo assim.
  ABA_ESCALA: "escala_comercial",
  COLUNA_ESCALA_NOME: "Nome",
  COLUNA_ESCALA_CARGO: "Cargo",
  COLUNA_ESCALA_ENTRADA: "Entrada",
  COLUNA_ESCALA_SAIDA: "Saida",
  COLUNA_ESCALA_DIAS_SEMANA: "dias_semana", // vazio = todos os dias
};
