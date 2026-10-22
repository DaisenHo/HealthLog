/**
 * The English source wording of every validated questionnaire, and the one
 * function every surface resolves item text through.
 *
 * An app language outside an instrument's `validatedItemLocales` must show the
 * instrument as published in English: the items, the answer options, the
 * recall stems, and for the PHQ-9 its unscored follow-up question. Changing a
 * word in a validated questionnaire changes what it measures, so a freely made
 * translation is never an acceptable stand-in, even with a note beside it.
 *
 * The text is held here rather than looked up in `messages/en.json` because
 * the client does not hold the English bundle when it renders another
 * language (`load-locale.ts` fetches it only on a key miss), and the items
 * must not flash as raw keys or wait on a network round trip. A guard pins
 * this map to `messages/en.json` key for key, and pins every bundle of a
 * language outside an instrument's validated set to carry none of these keys:
 * `instrument-wording.test.ts` and the locale-parity check in
 * `i18n-locale-integrity.test.ts`.
 */
import {
  INSTRUMENTS,
  INSTRUMENT_ORDER,
  hasValidatedItems,
  optionLabelKey,
  stemKey,
  type InstrumentId,
} from "./instruments";

/** English source text, keyed by the i18n key a validated bundle uses. */
export const SOURCE_WORDING: Readonly<Record<string, string>> = {
  "mentalHealth.items.phq9.1": "Little interest or pleasure in doing things",
  "mentalHealth.items.phq9.2": "Feeling down, depressed, or hopeless",
  "mentalHealth.items.phq9.3":
    "Trouble falling or staying asleep, or sleeping too much",
  "mentalHealth.items.phq9.4": "Feeling tired or having little energy",
  "mentalHealth.items.phq9.5": "Poor appetite or overeating",
  "mentalHealth.items.phq9.6":
    "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
  "mentalHealth.items.phq9.7":
    "Trouble concentrating on things, such as reading the newspaper or watching television",
  "mentalHealth.items.phq9.8":
    "Moving or speaking so slowly that other people could have noticed. Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual",
  "mentalHealth.items.phq9.9":
    "Thoughts that you would be better off dead, or of hurting yourself in some way",
  "mentalHealth.items.gad7.1": "Feeling nervous, anxious, or on edge",
  "mentalHealth.items.gad7.2": "Not being able to stop or control worrying",
  "mentalHealth.items.gad7.3": "Worrying too much about different things",
  "mentalHealth.items.gad7.4": "Trouble relaxing",
  "mentalHealth.items.gad7.5": "Being so restless that it is hard to sit still",
  "mentalHealth.items.gad7.6": "Becoming easily annoyed or irritable",
  "mentalHealth.items.gad7.7":
    "Feeling afraid as if something awful might happen",
  "mentalHealth.items.who5.1": "I have felt cheerful and in good spirits",
  "mentalHealth.items.who5.2": "I have felt calm and relaxed",
  "mentalHealth.items.who5.3": "I have felt active and vigorous",
  "mentalHealth.items.who5.4": "I woke up feeling fresh and rested",
  "mentalHealth.items.who5.5":
    "My daily life has been filled with things that interest me",
  "mentalHealth.items.sci.1": "… how long does it take you to fall asleep?",
  "mentalHealth.items.sci.2":
    "… if you then wake up during the night … how long are you awake for in total? (add all the wakenings up)",
  "mentalHealth.items.sci.3":
    "… how many nights a week do you have a problem with your sleep?",
  "mentalHealth.items.sci.4": "… how would you rate your sleep quality?",
  "mentalHealth.items.sci.5": "… affected your mood, energy, or relationships?",
  "mentalHealth.items.sci.6":
    "… affected your concentration, productivity, or ability to stay awake?",
  "mentalHealth.items.sci.7": "… troubled you in general?",
  "mentalHealth.items.sci.8":
    "… how long have you had a problem with your sleep?",
  "mentalHealth.options.0": "Not at all",
  "mentalHealth.options.1": "Several days",
  "mentalHealth.options.2": "More than half the days",
  "mentalHealth.options.3": "Nearly every day",
  "mentalHealth.gad7Options.0": "Not at all",
  "mentalHealth.gad7Options.1": "Several days",
  "mentalHealth.gad7Options.2": "More than half the days",
  "mentalHealth.gad7Options.3": "Nearly every day",
  "mentalHealth.functionalTitle":
    "If you checked off any problems, how difficult have these problems made it for you to do your work, take care of things at home, or get along with other people?",
  "mentalHealth.functional.0": "Not difficult at all",
  "mentalHealth.functional.1": "Somewhat difficult",
  "mentalHealth.functional.2": "Very difficult",
  "mentalHealth.functional.3": "Extremely difficult",
  "mentalHealth.who5Options.0": "At no time",
  "mentalHealth.who5Options.1": "Some of the time",
  "mentalHealth.who5Options.2": "Less than half of the time",
  "mentalHealth.who5Options.3": "More than half of the time",
  "mentalHealth.who5Options.4": "Most of the time",
  "mentalHealth.who5Options.5": "All of the time",
  "mentalHealth.sciOptions.duration.0": "≥ 61 min",
  "mentalHealth.sciOptions.duration.1": "46–60 min",
  "mentalHealth.sciOptions.duration.2": "31–45 min",
  "mentalHealth.sciOptions.duration.3": "16–30 min",
  "mentalHealth.sciOptions.duration.4": "0–15 min",
  "mentalHealth.sciOptions.nights.0": "5–7",
  "mentalHealth.sciOptions.nights.1": "4",
  "mentalHealth.sciOptions.nights.2": "3",
  "mentalHealth.sciOptions.nights.3": "2",
  "mentalHealth.sciOptions.nights.4": "0–1",
  "mentalHealth.sciOptions.quality.0": "Very poor",
  "mentalHealth.sciOptions.quality.1": "Poor",
  "mentalHealth.sciOptions.quality.2": "Average",
  "mentalHealth.sciOptions.quality.3": "Good",
  "mentalHealth.sciOptions.quality.4": "Very good",
  "mentalHealth.sciOptions.impact.0": "Very much",
  "mentalHealth.sciOptions.impact.1": "Much",
  "mentalHealth.sciOptions.impact.2": "Somewhat",
  "mentalHealth.sciOptions.impact.3": "A little",
  "mentalHealth.sciOptions.impact.4": "Not at all",
  "mentalHealth.sciOptions.problemDuration.0": "> 1 year",
  "mentalHealth.sciOptions.problemDuration.1": "7–12 months",
  "mentalHealth.sciOptions.problemDuration.2": "3–6 months",
  "mentalHealth.sciOptions.problemDuration.3": "1–2 months",
  "mentalHealth.sciOptions.problemDuration.4":
    "I don't have a problem / < 1 month",
  "mentalHealth.stems.phq9.period":
    "Over the last 2 weeks, how often have you been bothered by any of the following problems?",
  "mentalHealth.stems.gad7.period":
    "Over the last 2 weeks, how often have you been bothered by the following problems?",
  "mentalHealth.stems.who5.period": "Over the last two weeks …",
  "mentalHealth.stems.sci.night":
    "Thinking about a typical night in the last month …",
  "mentalHealth.stems.sci.impact":
    "Thinking about the past month, to what extent has poor sleep …",
  "mentalHealth.stems.sci.finally": "Finally …",
};

/** The PHQ-9's unscored follow-up question and its four answers. */
export const FUNCTIONAL_TITLE_KEY = "mentalHealth.functionalTitle";
export function functionalOptionKey(value: number): string {
  return `mentalHealth.functional.${value}`;
}
const FUNCTIONAL_VALUES = [0, 1, 2, 3] as const;

/** Instruments whose form carries the unscored functional follow-up. */
export function hasFunctionalItem(id: InstrumentId): boolean {
  return id === "PHQ9";
}

export function itemKey(id: InstrumentId, itemIndex: number): string {
  return `mentalHealth.items.${INSTRUMENTS[id].i18nKey}.${itemIndex + 1}`;
}

/**
 * Every i18n key that carries this instrument's own wording: items, answer
 * options, recall stems and the functional follow-up.
 */
export function instrumentWordingKeys(id: InstrumentId): string[] {
  const def = INSTRUMENTS[id];
  const keys = new Set<string>();
  for (let i = 0; i < def.itemCount; i++) {
    keys.add(itemKey(id, i));
    for (const value of def.optionOrder) {
      keys.add(optionLabelKey(id, i, value));
    }
    const stem = stemKey(id, i);
    if (stem) keys.add(`mentalHealth.stems.${stem}`);
  }
  if (hasFunctionalItem(id)) {
    keys.add(FUNCTIONAL_TITLE_KEY);
    for (const value of FUNCTIONAL_VALUES) keys.add(functionalOptionKey(value));
  }
  return [...keys];
}

/**
 * The keys a bundle for `locale` must NOT carry: wording of an instrument
 * whose validated set excludes the language. A key shared by several
 * instruments (the PHQ-9 / GAD-7 answer options) is English-only only when
 * every instrument using it excludes the language.
 */
export function englishOnlyWordingKeys(locale: string): string[] {
  const allowed = new Set<string>();
  const all = new Set<string>();
  for (const id of INSTRUMENT_ORDER) {
    for (const key of instrumentWordingKeys(id)) {
      all.add(key);
      if (hasValidatedItems(id, locale)) allowed.add(key);
    }
  }
  return [...all].filter((key) => !allowed.has(key)).sort();
}

/**
 * Resolve one piece of instrument wording for the reader's language: the
 * bundle's validated translation where one exists, the English source
 * otherwise. Every surface that shows an item, an answer label or a stem goes
 * through here, never through a bare `t()`.
 */
export function instrumentText(
  id: InstrumentId,
  key: string,
  locale: string,
  t: (key: string) => string,
): string {
  if (hasValidatedItems(id, locale)) return t(key);
  return SOURCE_WORDING[key] ?? key;
}
