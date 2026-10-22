/** Population-norm framing, pl. */
export const patterns: readonly RegExp[] = [
  /\b(?:normalny|prawidłowy)\s+(?:zakres|przedział)\b/i,
  /\bzdrow(?:i|ych)\s+doros(?:li|łych)\b/i,
  /\b(?:większość|średnia)\s+(?:doros(?:łych|li)|ludzi|osób)\b/i,
  /\b(?:wytyczne|lekarze|eksperci)\s+(?:mówią|zalecają|radzą|sugerują)\b/i,
  /\bdoros(?:li|łych)\s+(?:zazwyczaj|zwykle|na\s+ogół)\s+(?:potrzebują|wymagają)\b/i,
  /\b(?:zakres|przedział)\s+(?:referencyjny|normy|prawidłowy|zalecany)\b/i,
  /\b(?:wynosi|mieści\s+się)\s+(?:zazwyczaj|zwykle|na\s+ogół)\s+(?:od|między|około)\b/i,
];
