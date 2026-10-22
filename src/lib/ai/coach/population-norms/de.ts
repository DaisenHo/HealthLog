/** Population-norm framing, de. */
export const patterns: readonly RegExp[] = [
  /\bder\s+normal(?:e|bereich)\b/i,
  /\bdie\s+normale\b/i,
  /\bnormal(?:er|e)?\s+(?:ruhe)?(?:herzfrequenz|puls|bereich|wert)\b/i,
  /\b(?:gesunde|die\s+meisten|der\s+durchschnittliche?)\s+(?:erwachsene|menschen|bevölkerung)\b/i,
  /\b(?:leitlinien|ärzte|expert\w*)\s+(?:sagen|empfehlen|raten|betrachten)\b/i,
  /\b(?:erwachsene|menschen)\s+(?:brauchen|benötigen)\s+(?:in\s+der\s+regel|generell|typischerweise|normalerweise)\b/i,
  /\b(?:allgemeine|normale|typische)\s+(?:referenz)?(?:bereich|spanne|werte)\b/i,
  /\bliegt\s+(?:normalerweise|üblicherweise|in\s+der\s+regel)\s+(?:bei|zwischen)\b/i,
];
