/**
 * Fila de distribuição de reuniões entre closers.
 *
 * Fase 1 (fila): enquanto pelo menos um closer estiver ABAIXO da própria meta
 *         (QTD_REUNIOES), segue a ordem da fila (ver chaveDeFila). Quem bate a
 *         meta "fecha" e sai da disputa pelo resto do dia.
 *
 * Fase 2 (sorteio): quando TODOS já bateram a própria meta, o sorteio passa a
 *         ser aleatório entre todos os closers elegíveis, pelo resto do dia.
 *
 * Closer que chega mais tarde NÃO tem privilégio: ao entrar, ele é colocado na
 * posição atual da fila (ver calcularEntradasTardias) e só recebe quando a
 * rotação chegar na vez dele.
 */

/**
 * Posição do closer na fila = reuniões recebidas hoje + ajuste de entrada
 * tardia (coluna AJUSTE_FILA, gerida pelo sistema). A meta usa SÓ as reuniões
 * recebidas de verdade; o ajuste só mexe na ordem.
 */
function posicaoFila(c) {
  return (c.reunioesHoje || 0) + Math.max(0, parseInt(c.ajusteFila, 10) || 0);
}

/**
 * Chave de ordenação da fila (menor = mais cedo). Cada closer tem
 * `vezesNaFila` (coluna VEZES_NA_FILA; vazio = 1). Quem tem 2 passa 2x por
 * ciclo, ANTES dos demais. Exemplo com Maia/Fabro/Francisco = 2, resto = 1:
 *   Maia, Fabro, Francisco, Maia, Fabro, Francisco, X, X, X (e repete).
 *
 * Chave = [ciclo, grupo, passo, ordemFila]
 *  - ciclo: floor(posição / vezes) — em que "rodada" a próxima reunião dele cai
 *  - grupo: 0 = quem tem vezes > 1 (vai primeiro na rodada), 1 = demais
 *  - passo: posição % vezes — repete o bloco prioritário (1ª, depois 2ª vez)
 *  - ordemFila: posição na planilha, desempate final
 * Com todos em vezes = 1 isso vira a regra simples (menos recebidas primeiro,
 * empate pela ordem da planilha).
 */
function chaveDeFila(c, pos = posicaoFila(c)) {
  const vezes = Math.max(1, parseInt(c.vezesNaFila, 10) || 1);
  return [Math.floor(pos / vezes), vezes > 1 ? 0 : 1, pos % vezes, c.ordemFila];
}

function compararChaves(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Entrada tardia SEM privilégio. Descobre quem foi o último da fila a receber
 * hoje (a maior "chave da última reunião recebida" entre TODOS os closers, estejam
 * ou não de plantão agora) e empurra pra frente, até logo depois dessa posição,
 * qualquer closer do pool que ficou pra trás (chegou tarde, ou foi pulado). Assim
 * ele não "recupera o atraso": espera a rotação chegar na vez dele.
 *
 * Retorna a lista [{ closer, novoAjuste }] dos que precisam mudar — quem chama
 * aplica em memória e grava na planilha (coluna AJUSTE_FILA), porque o ajuste
 * precisa persistir entre uma distribuição e a próxima.
 *
 * `todos` = todos os closers elegíveis ANTES do filtro de escala (default: pool).
 */
function calcularEntradasTardias(pool, todos) {
  const referencia = todos && todos.length ? todos : pool || [];

  let ultima = null; // chave da última reunião recebida na fila hoje
  for (const c of referencia) {
    if (!(c.reunioesHoje > 0)) continue; // só quem realmente recebeu
    const chave = chaveDeFila(c, posicaoFila(c) - 1);
    if (ultima === null || compararChaves(chave, ultima) > 0) ultima = chave;
  }
  if (ultima === null) return []; // ninguém recebeu ainda hoje: nada a ajustar

  const mudancas = [];
  for (const c of pool || []) {
    if (c.ajusteIndisponivel) continue; // sem coluna AJUSTE_FILA na planilha: não dá pra persistir
    const pos = posicaoFila(c);
    if (compararChaves(chaveDeFila(c, pos), ultima) > 0) continue; // já está à frente da última recebida

    let novaPos = pos;
    for (let i = 0; i < 1000 && compararChaves(chaveDeFila(c, novaPos), ultima) <= 0; i++) novaPos++;
    mudancas.push({ closer: c, novoAjuste: Math.max(0, parseInt(c.ajusteFila, 10) || 0) + (novaPos - pos) });
  }
  return mudancas;
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

/**
 * Fila das reuniões marcadas pra OUTRO DIA. Não pode usar os contadores de
 * hoje (eles não mudam com reunião de amanhã, e daria sempre o mesmo closer):
 * usa quantas reuniões já foram distribuídas pra AQUELA data
 * (`closer.agendadasNoDia`, vindo do log_distribuicao). A meta diária
 * (QTD_REUNIOES) e o peso (VEZES_NA_FILA) valem igual, e o desempate é a
 * ordem da planilha. Quando todos já bateram a meta daquele dia, sorteio.
 */
function escolherCloserOutroDia(closers) {
  if (!closers || closers.length === 0) {
    throw new Error("Nenhum closer elegível disponível.");
  }

  const adaptados = closers.map((c) => ({
    original: c,
    reunioesHoje: c.agendadasNoDia || 0, // "recebidas" no dia alvo
    limite: c.limite,
    vezesNaFila: c.vezesNaFila,
    ordemFila: c.ordemFila,
    ajusteFila: 0,
  }));

  const abaixoDoTeto = adaptados.filter((a) => a.reunioesHoje < a.limite);
  if (abaixoDoTeto.length > 0) {
    const melhor = abaixoDoTeto.reduce((m, a) => (compararChaves(chaveDeFila(a), chaveDeFila(m)) < 0 ? a : m));
    return melhor.original;
  }

  return closers[Math.floor(Math.random() * closers.length)];
}

module.exports = { escolherCloser, escolherCloserOutroDia, calcularEntradasTardias };
