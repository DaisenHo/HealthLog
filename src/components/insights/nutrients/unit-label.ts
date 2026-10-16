/**
 * How a nutrient unit code from the server reads on screen. The wire spells
 * microgram `ug` (ASCII on purpose) and the international unit `IU`, which
 * German labels print as IE, French, Spanish and Italian ones as UI and
 * Polish ones as j.m.; every other code is already its symbol.
 */
export function nutrientUnitLabel(
  unit: string,
  t: (key: string) => string,
): string {
  if (unit === "ug") return "µg";
  if (unit === "IU") return t("nutrients.units.IU");
  return unit;
}
