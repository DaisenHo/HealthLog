/** Outbound-screen banks for Dutch, composed by `../../outbound-screen.ts`. */
import {
  DRUG_UNIT,
  DOSE_UNIT,
  UNIT_END,
  objectSlot,
  TARGET,
  LETTER,
  ENGINE,
  medicationExtras,
  type LocaleBank,
} from "../shared";

const NL_STOP =
  "niet|nooit|geen|en|of|maar|als|wanneer|natrium|zout|cafeïne|suiker\\S*|water|vocht|eiwit\\S*|vezels?|koffie|alcohol|stappen|calorieën";

const NL_SLOT = objectSlot(NL_STOP);

const NL_SHORT = objectSlot(
  `${NL_STOP}|om|voor|met|bij|in|op|van|naar|tot|na|zonder|tijdens|over|dan|te`,
  2,
);

const NL_MED_NOUN = `(?:[${LETTER}]*(?:dosis|doses|dosering|tablet(?:ten|je|jes)?|medicijn(?:en)?|medicatie|medicament(?:en)?|geneesmiddel(?:en)?|insuline|injecties?|capsules?)|pil(?:len|letje|letjes)?|prik(?:ken)?|spuitjes?|inhalator)(?![${LETTER}])`;

const SPELLED_NL =
  "(?:nul|een|één|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf|dertien|veertien|vijftien|zestien|zeventien|achttien|negentien|twintig|dertig|veertig|vijftig|zestig)";

const PCT_WORD_NL = `${SPELLED_NL}\\s+procent`;

const QUAL_NUM_NL = `(?:\\d{1,3}\\s*%|${PCT_WORD_NL})`;

const RISK_NOUN_NL = "(?:risico\\w*|kans|waarschijnlijkheid)";

const HORIZON_NL =
  "(?:(?:10|tien)[- ]?jaars?[- ]?risico\\w*|levenslang\\s+risico\\w*|risico\\w*(?:\\s+\\S+){0,3}\\s+(?:binnen|in)\\s+(?:de\\s+komende\\s+)?(?:10|tien)\\s+jaar)";

const RESULT_VERB_NL =
  "(?:plaatst\\s+(?:je|u)|deelt\\s+(?:je|u)\\s+in|zet\\s+(?:je|u)\\s+in|(?:je|u)\\s+valt\\s+in|valt\\s+(?:je|u)\\s+in|brengt\\s+(?:je|u)\\s+in)";

const RISK_BAND_NL =
  "(?:hoog|hoger|laag|lager|middel|matig|verhoogd)\\w*[- ]?risico(?:categorie|groep|klasse|zone)";

const RISK_LEVEL_NL =
  "(?:verhoogd|hoog|hoger|matig|gemiddeld|zorgwekkend|aanzienlijk)";

const RISK_VERDICT_NL = `(?:is|ligt|lijkt|blijft|wijst\\s+op|komt\\s+uit\\s+op)\\s+(?:\\w+\\s+){0,2}${RISK_LEVEL_NL}`;

const NL_MED_CLASS =
  "\\S*(?:bloedverdunner\\w*|antistolling\\w*|anticoagul\\w*|plaatjesremmer\\w*|statine\\w*|b[eè]tablokker\\w*|plastablet\\w*|diuretic\\w*|diuretica|antidepressiv\\w*|antidepressiva|slaappil\\w*|slaapmiddel\\w*|bloeddrukverlager\\w*|ace-remmer\\w*)";

export const bank: LocaleBank = {
  vocabulary: (names) =>
    `(?:${NL_MED_NOUN}|${medicationExtras(NL_MED_CLASS, names)})`,
  doseChangeClass: (med) => [
    new RegExp(
      `(?<!\\b(?:niet|nooit)\\s)\\b(?:verhoog|verhogen|verlaag|verlagen|verminder|verminderen|halveer|halveren|verdubbel|verdubbelen)\\s+${NL_SLOT}(?:van\\s+${TARGET}\\s+)?(?:naar|tot|met)\\s+${TARGET}`,
      "i",
    ),
    new RegExp(
      `(?<!\\b(?:niet|nooit)\\s)\\b(?:ga|gaan|breng|brengen|bouw|bouwen|zet|zetten)\\s+${NL_SLOT}(?:van\\s+${TARGET}\\s+)?(?:omhoog\\s+|omlaag\\s+|terug\\s+|af\\s+|op\\s+)?(?:naar|tot)\\s+${TARGET}`,
      "i",
    ),
    new RegExp(
      `(?<!\\b(?:niet|nooit)\\s)\\bzet\\s+${NL_SLOT}op\\s+${TARGET}`,
      "i",
    ),
    // The infinitive closes a Dutch clause: "om je metformine naar 2000 mg te
    // verhogen". A past participle ("verhoogd") is a log restatement and
    // does not match.
    new RegExp(
      `\\b(?:naar|tot|met)\\s+${TARGET}[^.?!]{0,30}?\\b(?:verhogen|verlagen|verminderen|ophogen|opbouwen|afbouwen|terugbrengen|halveren|verdubbelen)\\b`,
      "i",
    ),
    new RegExp(
      `(?<!\\b(?:niet|nooit)\\s)\\b(?:neem|slik|spuit|injecteer|begin\\s+met|start\\s+met)\\s+${NL_SLOT}${TARGET}`,
      "i",
    ),
    new RegExp(
      `(?<!\\b(?:niet|nooit)\\s)\\b(?:halveer|verdubbel|pauzeer|deel|onderbreek)\\s+${NL_SLOT}${med}`,
      "i",
    ),
    // "Overslaan" is separable: "sla je avonddosis over". A negation between
    // the object and the particle ("sla je dosis niet over") is a warning.
    new RegExp(
      `\\bsla\\s+${NL_SLOT}${med}(?:(?!\\b(?:niet|nooit)\\b)[^.?!]){0,25}?\\bover\\b`,
      "i",
    ),
    new RegExp(
      `\\bstop\\s+met\\s+(?:het\\s+)?(?:innemen|slikken|gebruiken|spuiten|nemen)\\b`,
      "i",
    ),
    // Stop, halt or leave out a named medication or a drug class: "stop je
    // bloedverdunner", "laat de Eliquis morgen weg".
    new RegExp(`\\b(?:stop|staak)\\s+(?:met\\s+)?${NL_SHORT}${med}`, "i"),
    new RegExp(
      `\\blaat\\s+${NL_SLOT}${med}(?:(?!\\b(?:niet|nooit)\\b)[^.?!]){0,25}?\\bweg\\b`,
      "i",
    ),
    // The same behind a recommending cue, with the verb last. A referral
    // ("vraag", "overleg", "voordat", "of") or a negation ends it.
    new RegExp(
      `\\b(?:je\\s+zou|u\\s+zou|je\\s+kunt|u\\s+kunt|ik\\s+raad|ik\\s+adviseer|overweeg|probeer|het\\s+is\\s+(?:beter|verstandig))\\b(?:(?!\\b(?:niet|nooit|geen|vraag|overleg|voordat|of|eerst)\\b)[^.?!]){0,40}?${med}(?:(?!\\b(?:niet|nooit)\\b)[^.?!]){0,30}?\\b(?:overslaan|over\\s+te\\s+slaan|stoppen|te\\s+stoppen|staken|te\\s+staken|halveren|te\\s+halveren|verdubbelen|te\\s+verdubbelen|pauzeren|te\\s+pauzeren|weglaten|weg\\s+te\\s+laten)\\b`,
      "i",
    ),
    // An extra, another or one more of a medication: "neem een extra
    // ramipril", "neem nog een tablet", "neem vanavond een tablet meer".
    // A negation ("geen") cannot enter the short slot.
    new RegExp(
      `(?<!\\b(?:niet|nooit)\\s)\\b(?:neem|slik|spuit|injecteer|voeg)\\s+${NL_SHORT}(?:(?:(?:een|één|twee|\\d+)\\s+)?(?:extra|aanvullende?|tweede)[-\\s]+${NL_SHORT}${med}|nog\\s+(?:een|één|twee|\\d+)\\s+${NL_SHORT}${med}|(?:een|één|twee|drie|\\d+)\\s+${NL_SHORT}${med}\\s+(?:meer|extra)\\b)`,
      "i",
    ),
  ],
  dose: [
    // verhoog / ga omhoog / bouw op naar|tot|met N unit
    new RegExp(
      `\\b(?:verhoog|verhogen|ophogen|ga\\s+omhoog|bouw\\s+op|opbouwen)(?:\\s+(?:je|jouw|de|uw)\\s+(?:dosis|dosering))?\\s+(?:naar|tot|met)\\s+[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    // verlaag / verminder / bouw af naar|tot|met N unit
    new RegExp(
      `\\b(?:verlaag|verlagen|verminder|verminderen|ga\\s+omlaag|bouw\\s+af|afbouwen)(?:\\s+(?:je|jouw|de|uw)\\s+(?:dosis|dosering))?\\s+(?:naar|tot|met)\\s+[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    // A recommending cue in front of a drug amount. `ml` is left out: "probeer
    // 2000 ml water per dag" is hydration advice.
    new RegExp(
      `\\b(?:overweeg|probeer|je\\s+zou|u\\s+zou|ik\\s+raad|ik\\s+adviseer|ik\\s+stel\\s+voor)\\b[^.?!]{0,40}\\b[\\d.,]+\\s*${DRUG_UNIT}${UNIT_END}`,
      "i",
    ),
    new RegExp(
      `\\b(?:volgende|nieuwe)\\s+(?:dosis|stap)\\b[^.?!]{0,30}\\b[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    /\b(?:halveer|halveren|verdubbel|verdubbelen|sla\s+\S+\s+over|overslaan|stop\s+met)\b[^.?!]{0,25}(?:dosis|tablet\w*|medicijn\w*|medicatie|insuline|injectie\w*)[^.?!]{0,40}\b(?:(?:een|twee|drie|vier|\d+)\s+(?:dag|dagen|week|weken|maand|maanden)|om\s+te\s+(?:zien|testen|kijken|proberen))\b/i,
  ],
  risk: [
    new RegExp(
      `\\brisico\\w*\\s+(?:van|is|ligt\\s+op|bedraagt|op)\\s+(?:ongeveer\\s+|zo['’]?n\\s+|circa\\s+|rond\\s+|~)?\\d{1,3}\\s*%`,
      "i",
    ),
    new RegExp(`\\b\\d{1,3}\\s*%\\s+${RISK_NOUN_NL}\\b`, "i"),
    new RegExp(`\\b${RISK_NOUN_NL}\\b[^.?!]{0,40}\\b${PCT_WORD_NL}\\b`, "i"),
    new RegExp(`\\b${PCT_WORD_NL}\\b[^.?!]{0,40}\\b${RISK_NOUN_NL}\\b`, "i"),
    new RegExp(`\\b${HORIZON_NL}\\b[^.?!]{0,40}${QUAL_NUM_NL}`, "i"),
    new RegExp(`${QUAL_NUM_NL}[^.?!]{0,40}\\b${HORIZON_NL}\\b`, "i"),
    new RegExp(`\\b${ENGINE}\\b[^.?!]{0,50}${QUAL_NUM_NL}`, "i"),
    new RegExp(`${QUAL_NUM_NL}[^.?!]{0,50}\\b${ENGINE}\\b`, "i"),
    new RegExp(
      `\\b(?:${ENGINE}|${HORIZON_NL})\\b[^.?!]{0,60}${RESULT_VERB_NL}`,
      "i",
    ),
    new RegExp(
      `\\b(?:${ENGINE}|${HORIZON_NL})\\b[^.?!]{0,60}${RISK_BAND_NL}`,
      "i",
    ),
    new RegExp(
      `\\b(?:${ENGINE}|${HORIZON_NL})\\b[^.?!]{0,40}${RISK_VERDICT_NL}`,
      "i",
    ),
  ],
  causal: [
    /\bomdat\b/i,
    /\bdoordat\b/i,
    /\bvanwege\b/i,
    /\bveroorza\w*/i,
    /\b(?:ten|als)\s+gevolg\s+van\b/i,
    /\bleid(?:t|de|den)\s+tot\b/i,
    /\bkomt\s+door\b/i,
    /\bdankzij\b/i,
    /\bde\s+schuld\s+van\b/i,
    /\boorzaak\b/i,
    /\bverantwoordelijk\s+voor\b/i,
  ],
  continuation:
    /\b(?:blijf|ga\s+door\s+met|neem\s+\S+\s+(?:gewoon\s+)?verder|zoals\s+(?:voorgeschreven|afgesproken|gebruikelijk|gewoonlijk|altijd|eerder|je\s+gewend\s+bent)|volgens\s+(?:voorschrift|afspraak))\b/i,
  changeStem:
    /\b(?:verho|verla|vermind|halve|verdubbel|ophog|afbouw|bouw\s+af|overslaan|sla\s+\S+\s+over|stop)\w*/i,
};
