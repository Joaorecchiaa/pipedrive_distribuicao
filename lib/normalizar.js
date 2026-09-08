// Normalização de texto — mesmo padrão usado no painel Board Academy (norm()):
// minúsculas + remove acentos (NFD) + trim. Evita falso-negativo tipo "Sócio" vs "socio".

function norm(texto) {
  if (texto === null || texto === undefined) return "";
  return String(texto)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove marcas de acentuação
    .trim();
}

module.exports = { norm };
