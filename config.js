// Configuração central da automação de distribuição SDR → Closer
// Ajuste aqui quando a regra "real" de limite substituir a de teste.

module.exports = {
  ABA_COLABORADORES: "colaboradores",

  // Gatilho: funil/estágio de origem (Sniper) — apenas referência/documentação,
  // o gatilho de verdade fica configurado na automação nativa do Pipedrive.
  ORIGEM: { pipeline_id: 88, stage_id: 815 }, // SNIPER / AGENDADOS

  // Destino conforme a subarea do closer sorteado (chave já normalizada: minúsculo, sem acento)
  DESTINO_POR_SUBAREA: {
    elite: { pipeline_id: 87, stage_id: 803 }, // ELITE / AGENDADOS
    mgm: { pipeline_id: 46, stage_id: 354 },   // OLYMPUS (label "MGM" na planilha) / AGENDADOS
  },

  SUBAREAS_ELEGIVEIS: ["elite", "mgm"],

  // TESTE — limite diário por nível de closer (número extraído do Cargo, ex: "Closer 4" -> 4)
  // Será substituído pela regra final depois dos testes.
  LIMITE_DIARIO_POR_NIVEL: {
    1: 3,
    2: 4,
    3: 5,
    4: 6,
    5: 7,
  },

  COLUNA_CONTADOR: "Reuniões no Dia",
};
