/**
 * Escolhe o próximo closer a receber o deal.
 *
 * Fase 1 (fila): enquanto pelo menos um closer estiver ABAIXO da própria meta
 *         (QTD_REUNIOES), escolhe quem tiver MENOS reuniões recebidas hoje
 *         (RECEBIDAS_HOJE). Em caso de empate, vence quem está mais cedo na
 *         ordem de fila (posição da linha na aba distribuicao_reuniao) — o
 *         primeiro da planilha recebe primeiro, depois o segundo, e assim
 *         por diante. Quem bate a meta "fecha" e sai da disputa pelo resto
 *         do dia.
 *
 * Fase 2 (sorteio): quando TODOS já bateram a própria meta, o sorteio passa a
 *         ser aleatório entre todos os closers elegíveis, pelo resto do dia.
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
