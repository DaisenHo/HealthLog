/**
 * What every locale's outbound-screen bank is built from: the dose units, the
 * target-dose shape, the object slot, the generic-name stems, and the shape of
 * a bank. The screen itself is `../outbound-screen.ts`; each language's bank
 * is one module in `./locales/`.
 */

export /**
 * Count units — a dose expressed as a number of dosage forms ("2 tablets",
 * "zwei Hübe" written as "2 Hübe", "1 comprimé"). The same forms the
 * medication wizard offers (`src/lib/medications/dose-units.ts`), in every
 * locale the banks cover. Without them "take 3 tablets a day" carried no unit
 * the screen recognised and passed every pattern.
 */
const COUNT_UNIT =
  "(?:tablets?|pills?|capsules?|drops?|puffs?|sprays?|tabletten?|kapseln?|tropfen|hübe|hub|sprühstöße|comprimés?|gélules?|gouttes?|bouffées?|comprimidos?|pastillas?|c[áa]psulas?|gotas?|compress[ae]|pastigli[ae]|gocce|goccia|tabletk[aęiy]|tabletek|kapsułk[aęiy]|kapsułek|krople|kropli|druppels?|pillen|pufjes?|pastilhas?|dr[áa]geas?|jatos?|borrifadas?)";

export /**
 * Dose units for a target dose a model must never name. Mass and insulin
 * units plus the count forms; `ml` is left out on purpose because
 * "increase your water intake to 2000 ml" is ordinary hydration advice.
 */
const DRUG_UNIT = `(?:mg|mcg|µg|iu|ui|i\\.u\\.|units?|unidades?|unità|unités?|jednostek|jednostki|eenheden|eenheid|ie|i\\.e\\.|einheiten|${COUNT_UNIT})`;

export /**
 * Dose units, shared across every locale. The GLP-1 + general oral-dose
 * vocabulary; `ie` / `i.e.` / `einheiten` / `unità` / `jednostk` cover the
 * insulin-unit spellings the locales use (`eenheden` is the Dutch one, `ui`
 * the Portuguese abbreviation of "unidades internacionais").
 */
const DOSE_UNIT = `(?:ml|${DRUG_UNIT})`;

export /**
 * What may follow a dose unit. A concentration is a lab value, not a dose:
 * "keep your glucose under 140 mg/dL" and "eGFR above 60 ml/min" name no
 * medication, and a bare `\b` let both trip the "try … N mg" pattern. A
 * per-day or per-kilogram rate ("2000 mg/day", "10 mg/kg") IS a dose and still
 * matches. The lookahead also ends a unit that closes on a non-word letter
 * ("unità", "i.e.") where `\b` cannot.
 */
const UNIT_END = "(?!\\w|\\s*\\/\\s*(?:dl|l|min|mmol)\\b)";

export /**
 * One to four words of object between a change verb and its target — "your
 * metformin", "the evening insulin dose", "votre metformine". The original
 * English pattern accepted only "it" or "your dose" in that slot, so naming the
 * drug ("increase your metformin to 2000 mg") walked past the screen.
 *
 * A word may not be a digit run, a sentence break, a negation (a negated
 * imperative is a warning, not an instruction), a clause joiner, or a
 * dietary noun: "lower your sodium to 1500 mg" and "cut caffeine to 200 mg"
 * are nutrition guidance, not a dose change.
 */
function objectSlot(stopWords: string, maxWords = 4): string {
  return `(?:(?!(?:${stopWords})(?=\\s))[^\\s\\d.?!,;:]+\\s+){0,${maxWords}}?`;
}

export /**
 * A count written as a word: "take two tablets", "nimm zwei Tabletten",
 * "prenez deux comprimés", "weź dwie tabletki". The union of every covered
 * locale, because a provider mixes languages. Articles ("a", "un", "eine")
 * are left out on purpose: "take a tablet with food" is an article, not a
 * count, and the "eine Tablette mehr" shape is its own pattern below.
 */
const SPELLED_COUNT =
  "(?:one|two|three|four|five|six|half\\s+an?|zwei|drei|vier|fünf|sechs|eine?n?\\s+halbe|halbe|deux|trois|quatre|cinq|demi|dos|tres|cuatro|cinco|media|due|tre|quattro|cinque|mezza|dwie|dwa|trzy|cztery|pięć|jedn[ąa]|pół|één|twee|drie|vier|vijf|zes|halve|dois|duas|três|quatro|meia|meio)";

export /** A target dose: a number, a drug unit, and an honest unit end. */
const TARGET = `(?:[\\d.,]+\\s*${DRUG_UNIT}${UNIT_END}|(?<![\\w])${SPELLED_COUNT}\\s+${COUNT_UNIT}${UNIT_END})`;

export /** The letters a drug name is spelled with in the Latin-script locales. */
const LETTER = "a-zà-ÿąćęłńóśźż";

export /**
 * Common generic-name stems (INN): ramipril, losartan, bisoprolol,
 * atorvastatin, amlodipine, metformin, semaglutide, apixaban, omeprazole,
 * furosemide. A surface that passes no schedule (a nudge, the document chat)
 * still recognises "skip the amlodipine". Two letters must precede the stem,
 * so "April" is not a drug; the stems are chosen so no everyday word ends in
 * one ("comparing" is why heparin is spelled out rather than stemmed).
 */
const INN_STEM = `(?<![${LETTER}])[${LETTER}]{2,}(?:pril|sartan|olol|statin|dipin|dypin|formin|glutid|gliflozin|gliptin|xaban|ksaban|prazol|semid)[${LETTER}]{0,4}(?![${LETTER}])|(?<![${LETTER}])(?:enoxa|dalte)?heparin[${LETTER}]{0,4}`;

export const ENGINE = "(?:framingham|ascvd|score2|qrisk)";

/*
 * Each bank also builds a tighter slot for the shapes that carry no number: an
 * extra / one more / stop imperative. At most two words, and a preposition ends
 * it, so "take an extra minute to log your medication" and "stop worrying about
 * your medication" never reach the medication noun.
 */

/**
 * An elided article ("l'amlodipine", "dell'insulina") may sit in front of a
 * French or Italian medication noun.
 */
export const ELIDED = "(?:[a-z]{1,4}['’])?";

/**
 * What a locale's medication noun accepts beside its dosage-form words: its
 * drug-class words, the generic-name stems (not for Korean, whose script the
 * stems are not written in), and the person's own medication names when the
 * caller passes them.
 */
export function medicationExtras(
  medClass: string,
  names: string | null,
  withStems = true,
): string {
  return [medClass, withStems ? INN_STEM : null, names]
    .filter((part): part is string => part !== null)
    .join("|");
}

/** One language's banks, composed by the screen. */
export interface LocaleBank {
  /**
   * The medication-noun alternation the dose-change class uses: the
   * dosage-form and treatment words, the generic drug-class words ("Stop your
   * blood thinner" names no dosage form and no drug, and it is the most
   * dangerous stop of all), the generic-name stems, and the person's own
   * medication names when the caller passes them.
   */
  vocabulary(names: string | null): string;
  /** The dose-change class over that medication noun. */
  doseChangeClass(med: string): readonly RegExp[];
  /** Target-dose prescriptions. */
  dose: readonly RegExp[];
  /** Risk-score fabrication. */
  risk: readonly RegExp[];
  /** Asserted causation (GROUND RULE 12). */
  causal: readonly RegExp[];
  /** A maintenance anchor that may exempt a dose sentence. */
  continuation: RegExp;
  /** A change stem that cancels that exemption. */
  changeStem: RegExp;
}
