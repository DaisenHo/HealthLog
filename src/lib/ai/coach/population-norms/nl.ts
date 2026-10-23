/** Population-norm framing, nl. */
export const patterns: readonly RegExp[] = [
  /\bhet\s+normale\s+(?:bereik|niveau)\b/i,
  /\b(?:normale?|gezonde)\s+(?:rust)?(?:hartslag|pols|waarde|waarden|bereik)\b/i,
  /\b(?:gezonde|de\s+meeste|de\s+gemiddelde)\s+(?:volwassenen|mensen|volwassene)\b/i,
  /\bde\s+algemene\s+bevolking\b/i,
  /\b(?:richtlijnen|artsen|experts?|deskundigen)\s+(?:zeggen|adviseren|raden|bevelen)\b/i,
  /\b(?:volwassenen|mensen)\s+(?:hebben\s+)?(?:meestal|doorgaans|gewoonlijk|normaal\s+gesproken|over\s+het\s+algemeen)\s+(?:nodig|hebben)\b/i,
  /\b(?:referentie|normaal|aanbevolen)\w*\s*(?:bereik|waarden?)\b/i,
  /\bligt\s+(?:normaal\s+gesproken|meestal|doorgaans|gewoonlijk)\s+(?:tussen|rond|op)\b/i,
];
