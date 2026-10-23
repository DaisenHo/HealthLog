/** Population-norm framing, en. */
export const patterns: readonly RegExp[] = [
  /\bthe\s+normal\s+range\s+(?:is|for)\b/i,
  /\b(?:healthy|most|the\s+average)\s+(?:adults?|people|population)\b/i,
  /\bthe\s+general\s+population\b/i,
  /\b(?:guidelines?|doctors?|experts?)\s+(?:say|recommend|suggest|consider|advise)\b/i,
  /\b(?:adults?|people|most\s+people)\s+(?:generally|typically|usually|normally)\s+(?:need|require|get|aim)\b/i,
  /\b(?:general|reference|normal|typical|healthy)\s+(?:reference\s+)?range\b/i,
  /\b(?:recommended|typical|normal|healthy)\s+(?:amount|level|range|target)\s+(?:is|for|of)\b/i,
];
