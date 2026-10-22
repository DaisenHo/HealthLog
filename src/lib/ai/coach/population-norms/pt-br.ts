/**
 * Population-norm framing, pt-BR.
 *
 * Every entry needs a population subject or a reference noun: a reading of
 * the reader's own ("Sua pressão de 158/97 geralmente fica…", "Seu médico
 * recomenda…") is a claim about their data, and an exempted sentence is one
 * whose numbers are never checked.
 */
export const patterns: readonly RegExp[] = [
  /\bfaixa\s+(?:de\s+refer[eê]ncia|normal)\b/i,
  /\bvalor(?:es)?\s+de\s+refer[eê]ncia\b/i,
  /\b(?:adultos?|pessoas?)\s+saud[áa]ve(?:l|is)\b/i,
  /\bmaioria\s+(?:dos\s+)?(?:adultos?|das\s+pessoas)\b/i,
  /\b(?:as\s+|os\s+)?(?:diretrizes|m[eé]dicos|especialistas)\s+(?:geralmente\s+|em\s+geral\s+)?(?:dizem|recomendam|aconselham|sugerem|indicam|consideram)\b/i,
  /\b(?:os\s+)?(?:adultos|as\s+pessoas)\s+(?:geralmente\s+|normalmente\s+|em\s+geral\s+)?(?:precisam|necessitam)\s+de\b/i,
  /\b(?:a|o)\s+(?:frequ[êe]ncia\s+card[íi]aca|pulso|press[ãa]o(?:\s+arterial)?|glicemia|glicose)(?:\s+de\s+repouso)?\s+(?:normal|saud[áa]vel|t[íi]pica|t[íi]pico)\b/i,
];
