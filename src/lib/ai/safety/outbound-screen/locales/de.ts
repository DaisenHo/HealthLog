/** Outbound-screen banks for German, composed by `../../outbound-screen.ts`. */
import {
  DOSE_UNIT,
  UNIT_END,
  objectSlot,
  TARGET,
  LETTER,
  ENGINE,
  medicationExtras,
  unlessDeferred,
  WORD_START,
  WORD_END,
  type LocaleBank,
} from "../shared";

const DE_STOP =
  "nicht|nie|niemals|kein\\w*|und|oder|aber|wenn|ob|natrium|salz|koffein|zucker|wasser|eiweiß|protein|ballaststoff\\w*|kalorien";

const DE_SLOT = objectSlot(DE_STOP);

const DE_SHORT = objectSlot(
  `${DE_STOP}|als|zu|mit|für|gegen|statt|ohne|über`,
  2,
);

const DE_MED_NOUN =
  "\\S*(?:dosis|tablette\\w*|medikament\\w*|medikation|spritze\\w*|insulin|pille\\w*|kapsel\\w*)";

/**
 * The object a German change verb may carry before its target ("erhöhe
 * deine Dosis auf 2,4 mg"). English allows "your dose" in the same slot;
 * without it the German imperative with an object slipped through.
 */
const DE_DOSE_OBJECT =
  "(?:\\s+(?:(?:deine|die|ihre|eure|seine)\\s+)?(?:dosis|dosierung|medikation|wochendosis|tagesdosis))?";

/** A German count in front of a medication noun ("eine Tablette mehr"). */
const DE_COUNT = "ein(?:e|en)?|zwei|drei|vier|halbe|\\d+(?:[.,]\\d+)?";

const SPELLED_DE =
  "(?:null|eins?|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|dreizehn|vierzehn|fünfzehn|sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|dreißig|vierzig|fünfzig|sechzig|siebzig|achtzig|neunzig)";

const PCT_WORD_DE = `${SPELLED_DE}\\s+prozent`;

const QUAL_NUM_DE = `(?:\\d{1,3}\\s*%|${PCT_WORD_DE})`;

const RISK_NOUN_DE = "(?:risiko|wahrscheinlichkeit|chance)";

const HORIZON_DE = "(?:10[- ]jahres|zehn[- ]jahres|lebenszeit)[- ]?risiko";

const RESULT_VERB_DE =
  "(?:ordnet\\s+(?:dich|sie)\\s+ein|stuft\\s+(?:dich|sie)\\s+ein|f[äa]llst\\s+in|einordnen|liegst\\s+im)";

const RISK_BAND_DE =
  "(?:hoh|niedrig|mittler|erhöht|moderat|gering)\\w*[- ]?risiko(?:bereich|kategorie|gruppe|band)";

const RISK_LEVEL_DE =
  "(?:erhöht|hoch|höher|mittel|mäßig|grenzwertig|besorgniserregend|deutlich)";

const RISK_VERDICT_DE = `(?:ist|liegt|erscheint|wirkt|bleibt|zeigt|deutet\\s+auf|weist\\s+auf)\\s+(?:\\w+\\s+){0,2}${RISK_LEVEL_DE}`;

const DE_MED_CLASS =
  "\\S*(?:blutverdünner\\w*|gerinnungshemmer\\w*|antikoagul\\w*|statin\\w*|betablocker\\w*|diuretik\\w*|wassertablette\\w*|blutdrucksenker\\w*|antidepressiv\\w*|schlaftablette\\w*)";

/** Signals that the number-free change shapes stand down for (`unlessDeferred`). */
const DE_DEFERRAL = `\\?|${WORD_START}(?:nicht|kein\\w*|nie|niemals|nur\\s*,?\\s*(?:wenn|falls|nach)|erst\\s*,?\\s*(?:wenn|nach)|ohne|frag\\w*|besprich\\w*|sprich\\s+mit|rücksprache|ärzt\\w*|arzt\\w*|apothek\\w*|hausärzt\\w*|diabetolog\\w*|fachperson\\w*|praxis)${WORD_END}`;

export const bank: LocaleBank = {
  vocabulary: (names) =>
    `(?:${DE_MED_NOUN}|${medicationExtras(DE_MED_CLASS, names)})`,
  doseChangeClass: (med) => [
    new RegExp(
      `\\b(?:erhöh(?:e|en)?|steiger(?:e|n)?|reduzier(?:e|en)?|senk(?:e|en)?|verringer(?:e|n)?|halbier(?:e|en)?|verdopp(?:e?le|eln)|stell(?:e|en)?|geh(?:e)?|setz(?:e|en)?|bring(?:e|en)?)(?:\\s+sie)?\\s+${DE_SLOT}(?:(?:hoch|rauf|runter|herunter)\\s+)?(?:auf|um)\\s+${TARGET}`,
      "i",
    ),
    new RegExp(
      `\\b(?:nimm|nehmen\\s+sie|spritz|spritzen\\s+sie|injizier(?:e)?|injizieren\\s+sie|beginn(?:e)?\\s+mit|beginnen\\s+sie\\s+mit|starte\\s+mit)\\s+${DE_SLOT}${TARGET}`,
      "i",
    ),
    new RegExp(
      `(?<![${LETTER}])(?:halbier(?:e|en)?|verdopp(?:e?le|eln)|pausier(?:e|en)?|überspring(?:e|en)?|stopp(?:e|en)?)(?:\\s+sie)?\\s+${DE_SLOT}${med}`,
      "i",
    ),
    new RegExp(
      `\\b(?:setz(?:e|en)?)(?:\\s+sie)?(?:\\s+(?!(?:nicht|nie|niemals|kein\\w*)(?=\\s))[^\\s.?!,;:]+){1,4}?\\s+ab(?=\\s*(?:[.?!,;:]|$|und\\s|oder\\s))`,
      "i",
    ),
    new RegExp(
      `\\b(?:lass|lassen\\s+sie)\\s+${DE_SLOT}${med}(?:(?!\\b(?:nicht|nie|niemals)\\b)[^.?!]){0,20}?\\b(?:aus|weg)\\b`,
      "i",
    ),
    new RegExp(
      `\\bh(?:ör(?:e)?|ören\\s+sie)\\s+(?:mit\\s+\\S+\\s+)?auf\\b[^.?!]{0,40}?\\b(?:zu\\s+nehmen|einzunehmen|zu\\s+spritzen)`,
      "i",
    ),
    new RegExp(
      `\\b(?:solltest|sollten\\s+sie|empfehle|rate\\s+(?:dir|ihnen)|würde\\s+ich)\\b(?:(?!\\b(?:nicht|nie|niemals|kein\\w*)\\b)[^.?!]){0,40}?\\b(?:absetzen|abzusetzen|halbieren|zu\\s+halbieren|verdoppeln|zu\\s+verdoppeln|auslassen|auszulassen|weglassen|wegzulassen|pausieren|zu\\s+pausieren)\\b`,
      "i",
    ),
    // "eine Tablette mehr", "noch eine Tablette", "eine zusätzliche
    // Tablette", "mehr Insulin". A negation ("keine") cannot enter the slot.
    new RegExp(
      `\\b(?:nimm|nehmen\\s+sie|spritz|spritzen\\s+sie|injizier(?:e)?|injizieren\\s+sie)\\s+${DE_SHORT}(?:(?:noch\\s+)?(?:${DE_COUNT})\\s+${DE_SHORT}${med}\\s+mehr\\b|noch\\s+(?:${DE_COUNT})\\s+${DE_SHORT}${med}|(?:(?:${DE_COUNT})\\s+)?(?:zusätzlich\\w*|extra|weitere\\w*|mehr)[-\\s]+${DE_SHORT}${med})`,
      "i",
    ),
    new RegExp(
      `\\bh(?:ör(?:e)?|ören\\s+sie)\\s+mit\\s+${DE_SHORT}${med}\\s+auf\\b`,
      "i",
    ),
    new RegExp(
      `\\bverzichte(?:n\\s+sie)?\\s+${DE_SHORT}auf\\s+${DE_SHORT}${med}`,
      "i",
    ),
    // Halving or a fraction with no number: "reduzieren Sie die Dosis um die
    // Hälfte", "nehmen Sie nur die halbe Dosis", "teilen Sie die Tablette in
    // zwei Hälften". "Teilen" alone also means "share", so the split needs
    // its "in Hälften".
    unlessDeferred(
      DE_DEFERRAL,
      new RegExp(
        `\\b(?:reduzier(?:e|en)?|verringer(?:e|n)?|senk(?:e|en)?|kürz(?:e|en)?)(?:\\s+sie)?\\s+${DE_SLOT}${med}\\s+um\\s+(?:die\\s+)?hälfte`,
        "i",
      ),
    ),
    unlessDeferred(
      DE_DEFERRAL,
      new RegExp(
        `\\b(?:nimm|nehmen\\s+sie|spritz|spritzen\\s+sie|injizier(?:e)?|injizieren\\s+sie)\\s+(?:nur\\s+)?(?:die\\s+|eine\\s+)?(?:halbe|hälfte\\s+(?:der|deiner|ihrer))\\s+${DE_SHORT}${med}`,
        "i",
      ),
    ),
    unlessDeferred(
      DE_DEFERRAL,
      new RegExp(
        `\\bteil(?:e|en)?(?:\\s+sie)?\\s+${DE_SLOT}${med}\\s+(?:in\\s+(?:zwei\\s+)?hälften|in\\s+der\\s+mitte|durch\\s+zwei)`,
        "i",
      ),
    ),
    // A bare change imperative on a medication, no target: "reduzieren Sie
    // die Dosis.", "erhöhe dein Insulin etwas". The noun closes the clause or
    // meets a time or degree word; "reduziere die Dosis nicht" does neither.
    unlessDeferred(
      DE_DEFERRAL,
      new RegExp(
        `\\b(?:erhöh(?:e|en)?|steiger(?:e|n)?|reduzier(?:e|en)?|senk(?:e|en)?|verringer(?:e|n)?)(?:\\s+sie)?\\s+${DE_SHORT}${med}(?=\\s*(?:[.!?;:)]|$)|\\s+(?:jetzt|heute|morgen|etwas|leicht|langsam|schrittweise|ab\\s+sofort|für|bis)\\b)`,
        "i",
      ),
    ),
  ],
  dose: [
    new RegExp(
      `\\b(?:erhöh\\w*|steiger\\w*|setz\\w*\\s+(?:hoch|rauf)|geh\\w*\\s+(?:hoch|rauf))${DE_DOSE_OBJECT}\\s+(?:auf|um)\\s+[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    new RegExp(
      `\\b(?:reduzier\\w*|senk\\w*|verringer\\w*|nimm\\s+(?:weniger|runter))${DE_DOSE_OBJECT}\\s+(?:auf|um)\\s+[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    new RegExp(
      `\\bn[äa]chste\\s+(?:stufe|dosis)\\b[^.?!]{0,30}\\b[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    // German puts the verb last in a subordinate clause ("auf 7,5 mg zu
    // erhöhen"), so the verb-first patterns above miss the most natural
    // phrasing of the instruction. Match the inverted order too.
    new RegExp(
      `\\b(?:auf|um)\\s+[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}[^.?!]{0,30}\\b(?:erhöh\\S*|steiger\\S*|reduzier\\S*|senk\\S*|verringer\\S*|hochsetz\\S*)`,
      "i",
    ),
    new RegExp(
      `\\b(?:erwäg\\w*|probier\\w*|du\\s+solltest|ich\\s+empfehle|ich\\s+schlage\\s+vor)\\b[^.?!]{0,40}\\b[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    /\b(?:halbier\w*|verdoppel\w*|lass\w*\s+aus|setz\w*\s+ab|pausier\w*)\b[^.?!]{0,25}\b(?:dosis|tablette\w*|medikament\w*|spritze\w*|insulin)\b[^.?!]{0,40}\b(?:für\s+\w+\s+(?:tag|tage|woche|wochen|monat\w*)|um\s+zu\s+(?:sehen|testen)|zum\s+(?:test|ausprobieren))\b/i,
  ],
  risk: [
    new RegExp(
      `\\brisiko\\s+(?:von|bei|liegt\\s+bei)\\s+(?:etwa\\s+|ungefähr\\s+|~)?\\d{1,3}\\s*%`,
      "i",
    ),
    new RegExp(`\\b\\d{1,3}\\s*%\\s+${RISK_NOUN_DE}\\b`, "i"),
    // spelled-out percent as a risk figure, either order
    new RegExp(`\\b${RISK_NOUN_DE}\\b[^.?!]{0,40}\\b${PCT_WORD_DE}\\b`, "i"),
    new RegExp(`\\b${PCT_WORD_DE}\\b[^.?!]{0,40}\\b${RISK_NOUN_DE}\\b`, "i"),
    // 10-year horizon + a qualifying number, either order
    new RegExp(`\\b${HORIZON_DE}\\b[^.?!]{0,40}${QUAL_NUM_DE}`, "i"),
    new RegExp(`${QUAL_NUM_DE}[^.?!]{0,40}\\b${HORIZON_DE}\\b`, "i"),
    // named engine (same literals) + qualifying number or categorical result
    new RegExp(`\\b${ENGINE}\\b[^.?!]{0,50}${QUAL_NUM_DE}`, "i"),
    new RegExp(`${QUAL_NUM_DE}[^.?!]{0,50}\\b${ENGINE}\\b`, "i"),
    new RegExp(
      `\\b(?:${ENGINE}|${HORIZON_DE})\\b[^.?!]{0,60}${RESULT_VERB_DE}`,
      "i",
    ),
    new RegExp(
      `\\b(?:${ENGINE}|${HORIZON_DE})\\b[^.?!]{0,60}${RISK_BAND_DE}`,
      "i",
    ),
    new RegExp(
      `\\b(?:${ENGINE}|${HORIZON_DE})\\b[^.?!]{0,40}${RISK_VERDICT_DE}`,
      "i",
    ),
  ],
  causal: [
    /\bweil\b/i,
    /\bwegen\b/i,
    /\bverursach\w*/i,
    /\baufgrund\b/i,
    /\bführt[e]?\s+zu\b/i,
    /\bdurch\s+\w+\s+(?:verursacht|ausgelöst)\b/i,
    /\bschuld\b/i,
    /\bauslöser\b/i,
    /\bverantwortlich\s+für\b/i,
  ],
  continuation:
    /\b(?:weiterhin|weiter\s+(?:einnehmen|nehmen)|nimm\s+weiter|beibehalten|behalte\s+bei|wie\s+(?:verordnet|verschrieben|besprochen|gewohnt|bisher)|bleib(?:e|st)?\s+bei)\b/i,
  changeStem:
    /\b(?:erhöh|steiger|reduzier|senk|verringer|halbier|verdoppel|absetz|auslass|hochsetz|runtersetz|titrier)\w*/i,
};
