/** Population-norm framing, es. */
export const patterns: readonly RegExp[] = [
  /\b(?:el|la)\s+(?:rango|intervalo)\s+normal\b/i,
  /\b(?:los\s+)?adultos\s+sanos\b/i,
  /\b(?:la\s+mayoría\s+de|el\s+promedio\s+de)\s+(?:los\s+)?(?:adultos|personas|gente)\b/i,
  /\b(?:las\s+)?(?:guías|directrices|médicos|expertos)\s+(?:dicen|recomiendan|aconsejan|sugieren)\b/i,
  /\b(?:los\s+)?adultos\s+(?:generalmente|normalmente|suelen)\s+(?:necesitan|requieren)\b/i,
  /\b(?:rango|intervalo)\s+(?:de\s+referencia|normal|recomendado)\b/i,
  /\bse\s+sitúa\s+(?:generalmente|normalmente|habitualmente)\s+(?:entre|alrededor)\b/i,
];
