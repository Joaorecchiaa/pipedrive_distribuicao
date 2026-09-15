/**
 * Escolhe o próximo closer a receber o deal.
 *
 * Fase 1: enquanto pelo menos um closer estiver ABAIXO da própria meta diária
 *         (QTD_REUNIOES), o sorteio é aleatório entre esses. Quem bate a
 *         meta "fecha" — sai da disputa pelo resto do dia.
 *
 * Fase 2: quando TODOS já bateram a própria meta, o sorteio passa a ser
 *         aleatório entre todos os closers elegíveis, pelo resto do dia.
 *         O contador continua incrementando por registro, mas não influencia
 *         mais a escolha em nenhuma das duas fases.
 */
function escolherCloser(closers) {
  if (!closers || closers.length === 0) {
    throw new Error("Nenhum closer elegível disponível.");
  }

  const abaixoDoTeto = closers.filter((c) => c.reunioesHoje < c.limite);
  const pool = abaixoDoTeto.length > 0 ? abaixoDoTeto : closers;

  const indiceSorteado = Math.floor(Math.random() * pool.length);
  return pool[indiceSorteado];
}

module.exports = { escolherCloser };
