/**
 * Escolhe o próximo closer a receber o deal.
 *
 * Fase 1 (fila): enquanto pelo menos um closer estiver ABAIXO do próprio teto
 *         diário, escolhe quem tiver MENOS reuniões recebidas hoje. Em caso de
 *         empate, vence quem está mais cedo na ordem de fila (posição da
 *         linha na aba distribuicao_reuniao). Quando alguém bate o teto, ele
 *         "fecha" — sai da disputa da Fase 1 pelo resto do dia.
 *
 * Fase 2 (sorteio): quando TODOS já bateram o próprio teto, vira sorteio
 *         aleatório puro entre todos os closers elegíveis, pelo resto do dia.
 *         O contador continua incrementando por registro, mas não influencia
 *         mais a escolha.
 */
function escolherCloser(closers) {
  if (!closers || closers.length === 0) {
    throw new Error("Nenhum closer elegível disponível.");
  }

  const abaixoDoTeto = closers.filter((c) => c.reunioesHoje < c.limite);

  if (abaixoDoTeto.length > 0) {
    return abaixoDoTeto.reduce((melhor, atual) => {
      if (atual.reunioesHoje !== melhor.reunioesHoje) {
        return atual.reunioesHoje < melhor.reunioesHoje ? atual : melhor;
      }
      // empate na contagem -> desempata pela ordem de fila (menor = mais cedo)
      return atual.ordemFila < melhor.ordemFila ? atual : melhor;
    });
  }

  // Fase 2 — sorteio puro
  const indiceSorteado = Math.floor(Math.random() * closers.length);
  return closers[indiceSorteado];
}

module.exports = { escolherCloser };
