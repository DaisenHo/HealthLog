/**
 * Population-norm framing, ko.
 *
 * No `\b` next to Hangul (it is an ASCII \w boundary), and the object sits
 * between subject and verb in Korean, so each entry allows a gap where the
 * Latin banks put \s+.
 */
export const patterns: readonly RegExp[] = [
  /정상\s*범위(?:는|가|를|로|의)/,
  /(?:참고|기준|권장)\s*(?:범위|치|값)/,
  /(?:건강한|대부분의)\s*(?:성인|사람들?|인구)/,
  /일반\s*인구(?:는|에서|의)/,
  /(?:지침|가이드라인|의사들?|전문가들?)(?:은|이|에서|에서는|에 따르면)?[^.?!]{0,25}(?:권(?:장|해)|권고|제안|조언)/,
  /(?:성인|사람들?|대부분의?\s*사람들?)(?:은|이|의)?\s*(?:보통|일반적으로|대개|평균적으로)\s*[^.?!]{0,20}(?:필요|권장|적당)/,
  /(?:보통|일반적으로|대개)\s*[^.?!]{0,15}(?:사이|정도|범위)(?:예요|에요|입니다|이에요)/,
];
