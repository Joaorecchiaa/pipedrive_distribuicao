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
/**
 * Chave de ordenação da fila (menor = mais cedo). Cada closer tem
 * `vezesNaFila` (coluna VEZES_NA_FILA; vazio = 1). Quem tem 2 passa 2x por
 * ciclo, ANTES dos demais. Exemplo com Maia/Fabro/Francisco = 2, resto = 1:
 *   Maia, Fabro, Francisco, Maia, Fabro, Francisco, X, X, X (e repete).
 *
 * Chave = [ciclo, grupo, passo, ordemFila]
 *  - ciclo: floor(recebidas / vezes) — em que "rodada" a próxima reunião dele cai
 *  - grupo: 0 = quem tem vezes > 1 (vai primeiro na rodada), 1 = demais
 *  - passo: recebidas % vezes — repete o bloco prioritário (1ª, depois 2ª vez)
 *  - ordemFila: posição na planilha, desempate final
 * Com todos em vezes = 1 isso vira exatamente a regra antiga (menos
 * recebidas primeiro, empate pela ordem da planilha).
 */
function chaveDeFila(c) {
  const vezes = Math.max(1, parseInt(c.vezesNaFila, 10) || 1);
  const recebidas = c.reunioesHoje;
  return [Math.floor(recebidas / vezes), vezes > 1 ? 0 : 1, recebidas % vezes, c.ordemFila];
}

function compararChaves(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function escolherCloser(closers) {
  if (!closers || closers.length === 0) {
    throw new Error("Nenhum closer elegível disponível.");
  }

  const abaixoDoTeto = closers.filter((c) => c.reunioesHoje < c.limite);

  if (abaixoDoTeto.length > 0) {
    return abaixoDoTeto.reduce((melhor, atual) =>
      compararChaves(chaveDeFila(atual), chaveDeFila(melhor)) < 0 ? atual : melhor
    );
  }

  // Fase 2 — sorteio puro
  const indiceSorteado = Math.floor(Math.random() * closers.length);
  return closers[indiceSorteado];
}

module.exports = { escolherCloser };
