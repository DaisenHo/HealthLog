/**
 * How many digits a number somebody recorded is printed with.
 *
 * A lab value, a dose or a reference bound is a figure a person typed or a
 * report printed, and its digits are the precision it was measured at. A
 * PSA of 0.034 ng/mL is not "0.03", and a dose of 0.125 mg is not "0.13".
 * Every surface that prints such a figure used to pick its own fixed number
 * of decimals (one on the PDF, two on the share page, "two above 1, three
 * significant below" on the labs page), so the same reading read differently
 * in each place and some of them dropped digits that carried meaning.
 *
 * The rule here keeps every digit the number holds:
 *
 * - A stored value is printed exactly as stored. Nothing records how many
 *   trailing zeros were typed, so "4.20" prints as "4.2"; every digit that is
 *   there survives. The value is first read back at
 *   {@link STORED_SIGNIFICANT_DIGITS} significant digits, which removes
 *   binary floating-point noise ("0.30000000000000004") and nothing a person
 *   could have entered.
 * - A value converted from another unit carries no precision of its own, its
 *   digits are the product of a conversion factor. When the figure the report
 *   printed is known (`printed`), the converted value keeps as many
 *   significant digits as that figure had, never fewer than
 *   {@link CONVERTED_MIN_SIGNIFICANT_DIGITS} and never fewer than its own
 *   integer digits, so 5.2 mmol/L reads as 201 mg/dL rather than 201.0844.
 *
 * The caller formats the result in its own locale with exactly
 * `fractionDigits` decimals, so the separator follows the reader.
 */

/** Significant digits a stored value is read back at. */
const STORED_SIGNIFICANT_DIGITS = 12;

/** Floor for a converted value's significant digits. */
const CONVERTED_MIN_SIGNIFICANT_DIGITS = 3;

/** `Intl.NumberFormat` accepts at most this many fraction digits everywhere. */
const MAX_FRACTION_DIGITS = 20;

/** A locale number formatter that prints exactly `fractionDigits` decimals. */
export type FractionDigitsFormat = (
  value: number,
  fractionDigits: number,
) => string;

/** Significant digits and decimal exponent of a finite, nonzero number. */
function shape(n: number): { digits: number; exponent: number } {
  // Without an argument `toExponential` prints as many digits as it takes to
  // identify the number uniquely: the shortest round-trip spelling.
  const [mantissa, exponent] = Math.abs(n).toExponential().split("e");
  return {
    digits: mantissa.replace(".", "").length,
    exponent: Number(exponent),
  };
}

/**
 * The value to print and how many decimals it carries. `printed` is the
 * figure the source printed when `value` was converted from it, else absent.
 */
export function recordedPrecision(
  value: number,
  printed?: number | null,
): { value: number; fractionDigits: number } {
  if (!Number.isFinite(value) || value === 0) {
    return { value, fractionDigits: 0 };
  }
  let significant = STORED_SIGNIFICANT_DIGITS;
  if (
    printed !== null &&
    printed !== undefined &&
    Number.isFinite(printed) &&
    printed !== 0
  ) {
    const integerDigits = Math.max(1, shape(value).exponent + 1);
    significant = Math.max(
      shape(printed).digits,
      CONVERTED_MIN_SIGNIFICANT_DIGITS,
      integerDigits,
    );
  }
  const rounded = Number(value.toPrecision(Math.min(significant, 100)));
  const { digits, exponent } = shape(rounded);
  return {
    value: rounded,
    fractionDigits: Math.min(
      MAX_FRACTION_DIGITS,
      Math.max(0, digits - 1 - exponent),
    ),
  };
}

/** A recorded number in the caller's locale, with every digit it holds. */
export function formatRecordedNumber(
  value: number,
  formatNumber: FractionDigitsFormat,
  printed?: number | null,
): string {
  const { value: rounded, fractionDigits } = recordedPrecision(value, printed);
  return formatNumber(rounded, fractionDigits);
}
