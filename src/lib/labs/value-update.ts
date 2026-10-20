/**
 * The numeric value of a lab reading in the edit sheet.
 *
 * A converted reading is stored at full precision (5.6 mmol/L of glucose is
 * 100.90191999999999 mg/dL), and the sheet must not open with that tail. The
 * field starts from the value at the precision every lab surface shows it:
 * whole numbers bare, two decimals. Two decimals carry too little of a small
 * value, though (a TSH of 0.004 would open as "0"), so below 1 the field keeps
 * three significant figures instead. Written with a dot, which the sheet's
 * parser reads, rather than in the reader's locale, which an input cannot
 * round-trip, and never in exponent notation.
 */
export function valueEditSeed(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.min(
    MAX_SEED_DECIMALS,
    Math.max(DISPLAY_DECIMALS, SEED_SIGNIFICANT_FIGURES - 1 - magnitude),
  );
  // eslint-disable-next-line healthlog/no-unlocalised-decimal -- seeds an input whose parser reads the full stop back
  return value
    .toFixed(decimals)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

const DISPLAY_DECIMALS = 2;
const SEED_SIGNIFICANT_FIGURES = 3;
/** `toFixed` accepts up to 100; no lab value needs more than this. */
const MAX_SEED_DECIMALS = 20;

/**
 * What the edit PUT sends for the value. A field the person did not touch is
 * omitted (`undefined`), so the stored full-precision number stays as it is and
 * a converted reading keeps its "converted from" record: sending the rounded
 * start value back would both lose precision and read to the server as a new
 * number. A changed field sends the parsed number.
 */
export function resolveValueForUpdate(args: {
  seed: string;
  editorValue: string;
  parsed: number;
}): number | undefined {
  return args.editorValue.trim() === args.seed.trim() ? undefined : args.parsed;
}
