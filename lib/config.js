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
  COLUNA_RECEBIDAS: "RECEBIDAS_HOJE", // histórico do dia — só sobe (nunca desconta), reseta à meia-noite; NÃO decide a fila
  COLUNA_CREDITO_ATUAL: "REUNIOES_ATUAIS_HOJE", // o que o closer tem pra fazer hoje — a fila e a meta usam esta; sobe/desce conforme devolução/remanejamento, reseta à meia-noite
  COLUNA_VEZES_NA_FILA: "VEZES_NA_FILA", // opcional: quantas vezes o closer passa na fila por ciclo, antes dos demais (vazio = 1)
  COLUNA_AJUSTE_FILA: "AJUSTE_FILA", // gerida pelo sistema (não preencher): posição de quem chegou tarde na fila; zera à meia-noite

  // Colunas da aba log_distribuicao
  COLUNA_LOG_DATA_HORA: "DATA_HORA",
  COLUNA_LOG_DEAL_ID: "DEAL_ID",
  COLUNA_LOG_COLABORADOR: "COLABORADOR",
  COLUNA_LOG_FUNIL: "FUNIL",
  COLUNA_LOG_REUNIOES_DO_DIA: "REUNIOES_DO_DIA",
  COLUNA_LOG_ALTERADO: "ALTERADO", // marca "Sim" quando já corrigimos o contador por reatribuição manual
  COLUNA_LOG_NOVO_PROPRIETARIO: "NOVO_PROPRIETARIO", // pra quem o deal foi reatribuído manualmente
  COLUNA_LOG_AGENDADA_OUTRO_DIA: "AGENDADA_OUTRO_DIA", // data (AAAA-MM-DD) se a reunião não é pra hoje — nesse caso não contou no contador

  // Colunas NOVAS do log (crie na aba log_distribuicao): servem pra saber que
  // horário cada closer já tem ocupado e evitar duas reuniões ao mesmo tempo.
  COLUNA_LOG_REUNIAO_DATA: "REUNIAO_DATA", // dia da reunião (AAAA-MM-DD, horário de Brasília) — preenchida pelo sistema
  COLUNA_LOG_REUNIAO_HORA: "REUNIAO_HORA", // horário da reunião (HH:MM, Brasília) — preenchida pelo sistema
  COLUNA_LOG_REUNIAO_DURACAO: "REUNIAO_DURACAO_MIN", // duração em minutos — preenchida pelo sistema
  // Closer que está com o deal quando o head remaneja entre closers (ALTERADO fica
  // em branco: não é "voltou"). Usa a mesma coluna NOVO_PROPRIETARIO do fluxo de volta.
  COLUNA_LOG_RESPONSAVEL_ATUAL: "NOVO_PROPRIETARIO",

  // Duração assumida quando a atividade do Pipedrive não tem duração preenchida
  // (usada na checagem de choque de horário entre reuniões do mesmo closer).
  DURACAO_PADRAO_REUNIAO_MIN: 60,

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
