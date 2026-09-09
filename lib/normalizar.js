// Normalização de texto — mesmo padrão usado no painel Board Academy (norm()):
// minúsculas + remove acentos (NFD) + colapsa qualquer sequência de espaço/quebra
// de linha/espaço não separável (\s cobre tudo isso em JS) num espaço só + trim.
// O colapso de espaços é essencial pra casar cabeçalhos de planilha que podem ter
// espaço duplo, quebra de linha dentro da célula, ou espaço "non-breaking" colado
// de outro lugar — sem isso, row.get("Status (Equipe Comercial)") retorna
// undefined mesmo quando o cabeçalho "parece" idêntico visualmente.

function norm(texto) {
  if (texto === null || texto === undefined) return "";
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove marcas de acentuação
    .replace(/\s+/g, " ") // colapsa qualquer whitespace (espaço duplo, \n, nbsp) num espaço só
    .trim()
    .toLowerCase();
}

module.exports = { norm };
