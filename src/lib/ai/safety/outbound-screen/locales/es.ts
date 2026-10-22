/** Outbound-screen banks for Spanish, composed by `../../outbound-screen.ts`. */
import {
  DOSE_UNIT,
  UNIT_END,
  objectSlot,
  TARGET,
  LETTER,
  ENGINE,
  medicationExtras,
  type LocaleBank,
} from "../shared";

const ES_STOP =
  "no|nunca|y|o|pero|si|sodio|sal|cafeína|azúcar|agua|proteínas?|fibra";

const ES_SLOT = objectSlot(ES_STOP);

const ES_SHORT = objectSlot(`${ES_STOP}|para|con|antes|después|sin|a|al`, 2);

const ES_MED_NOUN =
  "(?:dosis|pastillas?|comprimidos?|medicamentos?|medicaci[óo]n|insulina|inyecci[óo]n|inyecciones|c[áa]psulas?|tratamiento)";

const SPELLED_ES =
  "(?:cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciséis|diecisiete|dieciocho|diecinueve|veinte|treinta|cuarenta|cincuenta|sesenta)";

const PCT_WORD_ES = `${SPELLED_ES}\\s+por\\s+ciento`;

const QUAL_NUM_ES = `(?:\\d{1,3}\\s*%|${PCT_WORD_ES})`;

const RISK_NOUN_ES = "(?:riesgo|probabilidad)";

const RESULT_VERB_ES =
  "(?:lo\\s+(?:coloca|sitúa|clasifica|pone)|le\\s+(?:coloca|sitúa|clasifica)|se\\s+encuentra\\s+en|está\\s+en\\s+(?:la\\s+)?categor|cae\\s+en)";

const ES_MED_CLASS =
  "(?:anticoagulantes?|antiagregantes?|estatinas?|betabloqueantes?|diuréticos?|antidepresivos?)";

export const bank: LocaleBank = {
  vocabulary: (names) =>
    `(?:${ES_MED_NOUN}|${medicationExtras(ES_MED_CLASS, names)})`,
  doseChangeClass: (med) => [
    new RegExp(
      `(?<!\\b(?:no|nunca)\\s)\\b(?:aumente|aumenta|aumentar|suba|sube|subir|pase|pasar|incremente|incrementar|reduzca|reduce|reducir|baje|bajar|disminuya|disminuir|duplique|duplicar|lleve|llevar|ajuste|ajustar)\\s+${ES_SLOT}(?:de\\s+${TARGET}\\s+)?(?:a|en|hasta)\\s+${TARGET}`,
      "i",
    ),
    new RegExp(
      `(?<!\\b(?:no|nunca)\\s)\\b(?:tome|tómese|inyecte|inyéctese|administre|empiece\\s+con|comience\\s+con)\\s+${ES_SLOT}${TARGET}`,
      "i",
    ),
    new RegExp(
      `(?<!\\b(?:no|nunca)\\s)\\b(?:omita|sáltese|salte|suspenda|interrumpa|duplique|divida|parta)\\s+${ES_SLOT}${med}`,
      "i",
    ),
    new RegExp(
      `(?<!\\b(?:no|nunca)\\s)\\b(?:deje|deja|dejar)\\s+de\\s+(?:tomar|usar|inyectarse)\\b`,
      "i",
    ),
    // "una pastilla de más", "otra pastilla", "una dosis extra".
    new RegExp(
      `(?<!\\b(?:no|nunca)\\s)\\b(?:tome|tómese|inyecte|inyéctese|añada|agregue)\\s+${ES_SHORT}(?:(?:un|una|dos|tres|\\d+)\\s+${ES_SHORT}${med}[^.?!]{0,20}?(?:\\bm[áa]s(?![${LETTER}])|\\bextra\\b|\\badicional(?:es)?\\b)|otr[oa]s?\\s+${ES_SHORT}${med})`,
      "i",
    ),
    // Stop a named medication or a drug class: "deje el anticoagulante".
    new RegExp(
      `(?<!\\b(?:no|nunca)\\s)\\b(?:deje|pare|abandone)\\s+${ES_SHORT}${med}`,
      "i",
    ),
  ],
  dose: [
    // aumente / suba / pase a|en N unit
    new RegExp(
      `\\b(?:aument\\w*|sub\\w*|pas\\w*|increment\\w*)\\s+(?:su\\s+dosis\\s+)?(?:a|en|hasta)\\s+[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    // reduzca / baje / disminuya a|en N unit
    new RegExp(
      `\\b(?:reduzc\\w*|reduc\\w*|baj\\w*|disminu\\w*)\\s+(?:su\\s+dosis\\s+)?(?:a|en|hasta)\\s+[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    new RegExp(
      `\\b(?:considere|pruebe|deber[íi]a|recomiendo|sugiero)\\b[^.?!]{0,40}\\b[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    new RegExp(
      `\\b(?:pr[óo]xima|siguiente|nueva)\\s+dosis\\b[^.?!]{0,30}\\b[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
  ],
  risk: [
    /\briesgo\s+(?:del?|es\s+del?|de\s+aproximadamente)\s+(?:aproximadamente\s+|~)?\d{1,3}\s*%/i,
    /\b\d{1,3}\s*%\s+(?:de\s+)?(?:riesgo|probabilidad)/i,
    /\briesgo\s+(?:cardiovascular|card[íi]aco|de\s+ictus|de\s+mortalidad)\s+a\s+(?:10|diez)\s+a[ñn]os\b/i,
    new RegExp(`\\b${RISK_NOUN_ES}\\b[^.?!]{0,40}\\d{1,3}\\s*%`, "i"),
    new RegExp(`\\d{1,3}\\s*%[^.?!]{0,40}\\b${RISK_NOUN_ES}\\b`, "i"),
    new RegExp(`\\b${RISK_NOUN_ES}\\b[^.?!]{0,40}\\b${PCT_WORD_ES}\\b`, "i"),
    new RegExp(`\\b${PCT_WORD_ES}\\b[^.?!]{0,40}\\b${RISK_NOUN_ES}\\b`, "i"),
    new RegExp(`\\b${ENGINE}\\b[^.?!]{0,50}${QUAL_NUM_ES}`, "i"),
    new RegExp(`${QUAL_NUM_ES}[^.?!]{0,50}\\b${ENGINE}\\b`, "i"),
    new RegExp(`\\b${ENGINE}\\b[^.?!]{0,60}${RESULT_VERB_ES}`, "i"),
  ],
  causal: [
    /\bporque\b/i,
    /\bdebido\s+a\b/i,
    /\ba\s+causa\s+de\b/i,
    /\bcaus(?:a|an|ó|ado)/i,
    /\bprovoc\w*/i,
    /\bllev[óo]\s+a\b/i,
    /\bresponsable\s+de\b/i,
    /\bgracias\s+a\b/i,
    /\bimpuls\w*\s+(?:por|el|la)\b/i,
  ],
  continuation:
    /\b(?:siga\s+(?:tomando|con)|continúe|mantenga|según\s+lo\s+prescrito)\b/i,
  changeStem: /\b(?:aument|reduzc|reduc|baj|disminu|dobl|omit|salt)\w*/i,
};
