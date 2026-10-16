/**
 * v1.43 — Dawarich is a movement context, never a location store. The schema
 * holds daily values only: no column of `DawarichDay`, and no Dawarich column
 * on `User`, may hold a coordinate, a place name, an address or a visit.
 *
 * The check reads the column names and their doc comments in
 * `prisma/schema.prisma`. A new column whose name or description says
 * latitude, longitude, coordinates, geometry, address, label, a place name or
 * a visit list fails here and has to argue its case in review.
 *
 * Mutation check: add `placeName String?` to `DawarichDay` and the first case
 * names it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  join(process.cwd(), "prisma", "schema.prisma"),
  "utf8",
);

const FORBIDDEN =
  /\b(lat|lon|lng|latitude|longitude|coord\w*|geo\w*|geometry|address|label|street|city|placeName|place_name|visits?Json|track|path|point)\b/i;

/** Column lines of a model with the `///` doc comment above each. */
function columns(model: string): Array<{ name: string; text: string }> {
  const start = schema.indexOf(`model ${model} {`);
  expect(start, `model ${model} not found`).toBeGreaterThan(-1);
  const body = schema.slice(start, schema.indexOf("\n}", start));
  const out: Array<{ name: string; text: string }> = [];
  let doc = "";
  for (const raw of body.split("\n").slice(1)) {
    const line = raw.trim();
    if (line.startsWith("///")) {
      doc += ` ${line.slice(3)}`;
      continue;
    }
    const m = /^([a-zA-Z_]\w*)\s+\w/.exec(line);
    if (m && !line.startsWith("@@"))
      out.push({ name: m[1], text: `${m[1]} ${doc}` });
    doc = "";
  }
  return out;
}

describe("Dawarich stores no location", () => {
  it("DawarichDay holds daily values only", () => {
    const cols = columns("DawarichDay");
    expect(cols.map((c) => c.name)).toContain("awayFromHomeMinutes");
    const offending = cols
      .filter((c) => c.name !== "user")
      .filter((c) => FORBIDDEN.test(c.name) || FORBIDDEN.test(c.text))
      .map((c) => c.name);
    expect(offending).toEqual([]);
  });

  it("the User row holds the connection, never a place", () => {
    const cols = columns("User").filter((c) => /^dawarich/.test(c.name));
    expect(cols.map((c) => c.name).sort()).toEqual([
      "dawarichAllowPrivateHost",
      "dawarichApiKeyEncrypted",
      "dawarichDays",
      "dawarichPrefsEncrypted",
      "dawarichUrlEncrypted",
    ]);
    const offending = cols
      .filter((c) => FORBIDDEN.test(c.name))
      .map((c) => c.name);
    expect(offending).toEqual([]);
  });
});
