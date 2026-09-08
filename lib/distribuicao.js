/**
 * Escolhe o próximo closer a receber o deal.
 *
 * Fase 1: enquanto pelo menos um closer estiver ABAIXO do próprio teto diário,
 *         escolhe quem tiver a menor razão (reunioesHoje / limite) — quem está
 *         "mais devendo" recebe primeiro.
 *
 * Fase 2: quando TODOS já bateram o próprio teto, vira sorteio aleatório puro
 *         entre todos os closers elegíveis, sem pesar nada.
 */
function escolherCloser(closers) {
  if (!closers || closers.length === 0) {
    throw new Error("Nenhum closer elegível disponível.");
  }

  const abaixoDoTeto = closers.filter((c) => c.reunioesHoje < c.limite);

  if (abaixoDoTeto.length > 0) {
    return abaixoDoTeto.reduce((melhor, atual) => {
      const razaoAtual = atual.reunioesHoje / atual.limite;
      const razaoMelhor = melhor.reunioesHoje / melhor.limite;
      return razaoAtual < razaoMelhor ? atual : melhor;
    });
  }

  // Fase 2 — sorteio puro
  const indiceSorteado = Math.floor(Math.random() * closers.length);
  return closers[indiceSorteado];
}

module.exports = { escolherCloser };
