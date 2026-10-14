import { formatLabValue } from "./format-value";

/**
 * The numeric value of a lab reading in the edit sheet.
 *
 * A converted reading is stored at full precision (5.6 mmol/L of glucose is
 * 100.90191999999999 mg/dL), and the sheet must not open with that tail. The
 * field starts from the value as every lab surface shows it: whole numbers
 * bare, at most two decimals. Written with a dot, which the sheet's parser
 * reads, rather than in the reader's locale, which an input cannot round-trip.
 */
export function valueEditSeed(value: number): string {
  return formatLabValue(value, String);
}

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
