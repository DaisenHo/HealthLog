/**
 * The one rounding a provider value gets on its way in.
 *
 * Provider payloads arrive as binary floats that carry noise from the
 * provider's own arithmetic and from ours (Withings sends `value * 10^unit`,
 * seconds become minutes, metres become kilometres): `72.30000000000001`
 * stored as is shows up in a chart tooltip, an export and a delta. Every
 * provider client used to keep its own `parseFloat(n.toFixed(2))`, which
 * also mis-rounds on halves (`(1.005).toFixed(2)` is `"1.00"`, because the
 * double below 1.005 is what gets rounded).
 *
 * Two decimals by default, rounded half away from zero on the decimal the
 * value prints as, so the result is the double nearest to a short decimal
 * and prints cleanly. Two places is the precision every provider client
 * already stored; this keeps it. A source whose values need another
 * precision (a nutrient in grams to the milligram) passes `places` rather
 * than rounding privately. `src/__tests__/provider-rounding-guard.test.ts`
 * keeps `toFixed` and hand-rolled `Math.round(x * 10^n) / 10^n` out of the
 * provider and import directories.
 */
export function importValue(n: number, places = 2): number {
  if (!Number.isFinite(n)) return n;
  if (!Number.isInteger(places) || places < 0 || places > 6) {
    throw new RangeError(`importValue: places must be 0..6, got ${places}`);
  }
  const magnitude = Math.abs(n);
  const text = String(magnitude);
  const scale = 10 ** places;
  // A value printed in exponent form is below a millionth or beyond 1e21;
  // shifting its text would not parse, and plain arithmetic is exact enough.
  const units = text.includes("e")
    ? Math.round(magnitude * scale)
    : Math.round(Number(`${text}e${places}`));
  return (Math.sign(n) * units) / scale || 0;
}
