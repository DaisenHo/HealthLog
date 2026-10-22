/** Population-norm framing, fr. */
export const patterns: readonly RegExp[] = [
  /\bla\s+(?:plage|fourchette)\s+normale\b/i,
  /\b(?:les\s+)?(?:adultes|personnes)\s+en\s+bonne\s+santé(?![\w\u00C0-\u024F])/i,
  /\b(?:la\s+plupart\s+des|la\s+moyenne\s+des)\s+(?:adultes|gens|personnes)\b/i,
  /\b(?:les\s+)?(?:recommandations|médecins|experts?)\s+(?:disent|recommandent|conseillent|suggèrent)\b/i,
  /\b(?:les\s+)?adultes\s+(?:ont\s+généralement|ont\s+besoin|nécessitent)\b/i,
  /\bplage\s+(?:de\s+référence|normale|recommandée)\b/i,
  /\bse\s+situe\s+(?:généralement|normalement|habituellement)\s+(?:entre|autour)\b/i,
];
