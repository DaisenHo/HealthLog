/** Population-norm framing, it. */
export const patterns: readonly RegExp[] = [
  /\b(?:l'|il\s+|la\s+)?intervallo\s+normale\b/i,
  /\b(?:gli\s+)?adulti\s+sani\b/i,
  /\b(?:la\s+maggior\s+parte\s+(?:degli|delle)|la\s+media\s+(?:degli|delle))\s+(?:adulti|persone)\b/i,
  /\b(?:le\s+)?(?:linee\s+guida|medici|esperti)\s+(?:dicono|raccomandano|consigliano|suggeriscono)\b/i,
  /\b(?:gli\s+)?adulti\s+(?:generalmente|di\s+solito|normalmente)\s+(?:hanno\s+bisogno|necessitano)\b/i,
  /\bintervallo\s+(?:di\s+riferimento|normale|raccomandato)\b/i,
  /\bsi\s+(?:colloca|attesta)\s+(?:generalmente|normalmente|di\s+solito)\s+(?:tra|intorno)\b/i,
];
