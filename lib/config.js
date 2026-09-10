// Configuração central da automação de distribuição SDR → Closer
// Ajuste aqui quando a regra "real" de limite substituir a de teste.

module.exports = {
  ABA_COLABORADORES: "colaboradores",
  ABA_DISTRIBUICAO: "distribuicao_reuniao",
  ABA_LOG: "log_distribuicao",

  // Gatilho: funil/estágio de origem (Sniper) — apenas referência/documentação,
  // o gatilho de verdade fica configurado na automação nativa do Pipedrive.
  ORIGEM: { pipeline_id: 88, stage_id: 815 }, // SNIPER / AGENDADOS

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
  COLUNA_RECEBIDAS: "RECEBIDAS_HOJE", // contador — começa em 0, sobe a cada distribuição, reseta à meia-noite
};
