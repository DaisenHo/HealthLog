/** Outbound-screen banks for Italian, composed by `../../outbound-screen.ts`. */
import {
  DOSE_UNIT,
  UNIT_END,
  objectSlot,
  TARGET,
  ENGINE,
  WORD_END,
  ELIDED,
  medicationExtras,
  type LocaleBank,
} from "../shared";

const IT_STOP =
  "non|mai|e|o|ma|se|sodio|sale|caffeina|zucchero|acqua|proteine|fibre";

const IT_SLOT = objectSlot(IT_STOP);

const IT_SHORT = objectSlot(`${IT_STOP}|per|con|prima|dopo|senza|a|al`, 2);

const IT_MED_NOUN =
  "(?:dos[ei]|compress[ae]|pastigli[ae]|farmac[oi]|medicinal[ei]|insulina|iniezion[ei]|capsul[ae]|terapia)";

const SPELLED_IT =
  "(?:zero|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|venti|trenta|quaranta|cinquanta|sessanta)";

const PCT_WORD_IT = `${SPELLED_IT}\\s+per\\s+cento`;

const QUAL_NUM_IT = `(?:\\d{1,3}\\s*%|${PCT_WORD_IT})`;

const RISK_NOUN_IT = "(?:rischio|probabilità)";

const RESULT_VERB_IT =
  "(?:la\\s+(?:colloca|mette|classifica|pone)|rientra\\s+(?:in|nella)|si\\s+trova\\s+(?:in|nella)|ricade\\s+in)";

const IT_MED_CLASS =
  "(?:anticoagulant[ei]|antiaggregant[ei]|statin[ae]|betabloccant[ei]|diuretic[oi]|antidepressiv[oi])";

export const bank: LocaleBank = {
  vocabulary: (names) =>
    `${ELIDED}(?:${IT_MED_NOUN}|${medicationExtras(IT_MED_CLASS, names)})`,
  doseChangeClass: (med) => [
    new RegExp(
      `(?<!\\b(?:non|mai)\\s)\\b(?:aumenti|aumentare|incrementi|incrementare|porti|portare|passi|passare|salga|salire|riduca|ridurre|abbassi|abbassare|diminuisca|diminuire|dimezzi|dimezzare|raddoppi|raddoppiare)\\s+${IT_SLOT}(?:da\\s+${TARGET}\\s+)?(?:a|di|fino\\s+a)\\s+${TARGET}`,
      "i",
    ),
    new RegExp(
      `(?<!\\b(?:non|mai)\\s)\\b(?:prenda|assuma|inietti|si\\s+inietti|inizi\\s+con|cominci\\s+con)\\s+${IT_SLOT}${TARGET}`,
      "i",
    ),
    new RegExp(
      `(?<!\\b(?:non|mai)\\s)\\b(?:salti|sospenda|interrompa|dimezzi|raddoppi|divida|ometta|tralasci|smetta)\\s+${IT_SLOT}${med}`,
      "i",
    ),
    new RegExp(
      `(?<!\\b(?:non|mai)\\s)\\bsmett(?:a|i|ere)\\s+di\\s+(?:prendere|assumere|usare)\\b`,
      "i",
    ),
    // "una compressa in più", "un'altra compressa", "una dose extra".
    new RegExp(
      `(?<!\\b(?:non|mai)\\s)\\b(?:prenda|assuma|inietti|aggiunga)\\s+${IT_SHORT}(?:(?:un|una|uno|due|tre|\\d+)\\s+${IT_SHORT}${med}[^.?!]{0,30}?(?:\\bin\\s+più|\\bextra\\b|\\baggiuntiv[aoei]\\b|\\bin\\s+aggiunta\\b)|(?:un['’]altra|un\\s+altro|altr[eio])\\s*${IT_SHORT}${med})`,
      "i",
    ),
  ],
  dose: [
    // aumenti / salga / passi a|di N unit
    new RegExp(
      `\\b(?:aument\\w*|sal\\w*|pass\\w*|increment\\w*)\\s+(?:la\\s+sua\\s+dose\\s+)?(?:a|di|fino\\s+a)\\s+[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    // riduca / abbassi / diminuisca a|di N unit
    new RegExp(
      `\\b(?:riduc\\w*|ridur\\w*|abbass\\w*|diminu\\w*|cal\\w*)\\s+(?:la\\s+sua\\s+dose\\s+)?(?:a|di|fino\\s+a)\\s+[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    new RegExp(
      `\\b(?:consideri|provi|dovrebbe|raccomando|suggerisco)\\b[^.?!]{0,40}\\b[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    new RegExp(
      `\\b(?:prossima|nuova)\\s+dose\\b[^.?!]{0,30}\\b[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
  ],
  risk: [
    /\brischio\s+(?:del?|dell'|[èe]\s+del?|di\s+circa)\s+(?:circa\s+|~)?\d{1,3}\s*%/i,
    /\b\d{1,3}\s*%\s+(?:di\s+)?(?:rischio|probabilit[àa])/i,
    /\brischio\s+(?:cardiovascolare|cardiaco|di\s+ictus|di\s+mortalit[àa])\s+a\s+(?:10|dieci)\s+anni\b/i,
    new RegExp(`\\b${RISK_NOUN_IT}${WORD_END}[^.?!]{0,40}\\d{1,3}\\s*%`, "i"),
    new RegExp(`\\d{1,3}\\s*%[^.?!]{0,40}\\b${RISK_NOUN_IT}${WORD_END}`, "i"),
    new RegExp(
      `\\b${RISK_NOUN_IT}${WORD_END}[^.?!]{0,40}\\b${PCT_WORD_IT}\\b`,
      "i",
    ),
    new RegExp(
      `\\b${PCT_WORD_IT}\\b[^.?!]{0,40}\\b${RISK_NOUN_IT}${WORD_END}`,
      "i",
    ),
    new RegExp(`\\b${ENGINE}\\b[^.?!]{0,50}${QUAL_NUM_IT}`, "i"),
    new RegExp(`${QUAL_NUM_IT}[^.?!]{0,50}\\b${ENGINE}\\b`, "i"),
    new RegExp(`\\b${ENGINE}\\b[^.?!]{0,60}${RESULT_VERB_IT}`, "i"),
  ],
  causal: [
    /\bperch[ée]/i,
    /\ba\s+causa\s+di\b/i,
    /\bcaus(?:a|ano|ato|ata)\b/i,
    /\bprovoc\w*/i,
    /\bha\s+portato\s+a\b/i,
    /\bdovuto\s+a\b/i,
    /\bresponsabile\s+di\b/i,
    /\bgrazie\s+a\b/i,
    /\bguid\w*\s+da\b/i,
  ],
  continuation: /\b(?:continui\s+(?:a|con|il)|mantenga|come\s+prescritto)\b/i,
  changeStem: /\b(?:aument|riduc|ridur|abbass|diminu|raddoppi|salt|dimezz)\w*/i,
};
