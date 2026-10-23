/** Population-norm framing, pl. */
export const patterns: readonly RegExp[] = [
  /\b(?:normalny|prawidłowy)\s+(?:zakres|przedział)(?![\w\u00C0-\u024F])/i,
  /\bzdrow(?:i|ych)\s+doro(?:[sś]li|słych)\b/i,
  /(?<![\w\u00C0-\u024F])(?:większość|średnia)\s+(?:doro(?:słych|[sś]li)|ludzi|osób)\b/i,
  /\b(?:wytyczne|lekarze|eksperci)\s+(?:mówią|zalecają|radzą|sugerują)(?![\w\u00C0-\u024F])/i,
  /\bdoro(?:[sś]li|słych)\s+(?:zazwyczaj|zwykle|na\s+ogół)\s+(?:potrzebują|wymagają)(?![\w\u00C0-\u024F])/i,
  /\b(?:zakres|przedział)\s+(?:referencyjny|normy|prawidłowy|zalecany)\b/i,
  /\b(?:wynosi|mieści\s+się)\s+(?:zazwyczaj|zwykle|na\s+ogół)\s+(?:od|między|około)\b/i,
];
