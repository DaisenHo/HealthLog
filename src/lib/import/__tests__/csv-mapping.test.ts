import { describe, expect, it } from "vitest";

import {
  labsCsvQuerySchema,
  medicationsCsvQuerySchema,
} from "@/lib/validations/record-import";

import {
  RECORD_IMPORT_TEMPLATES,
  guessFormat,
  guessMapping,
  readHead,
} from "../csv-mapping";
import { normaliseLabRow } from "../labs-csv";
import { normaliseMedicationRow } from "../medications-csv";

describe("guessMapping", () => {
  it("reads English and German headers, required fields first", () => {
    expect(
      guessMapping(
        ["Analyte", "Result", "Unit", "Date", "Reference range"],
        "labs",
      ),
    ).toEqual({
      analyte: 0,
      value: 1,
      unit: 2,
      date: 3,
      referenceRange: 4,
    });
    expect(
      guessMapping(
        ["Datum", "Laborwert", "Wert", "Einheit", "Referenzbereich"],
        "labs",
      ),
    ).toMatchObject({
      date: 0,
      analyte: 1,
      value: 2,
      unit: 3,
      referenceRange: 4,
    });
    expect(
      guessMapping(
        ["Medikament", "Dosis", "Uhrzeiten", "Bei Bedarf", "Beginn", "Ende"],
        "medications",
      ),
    ).toEqual({
      name: 0,
      dose: 1,
      times: 2,
      asNeeded: 3,
      startsOn: 4,
      endsOn: 5,
    });
  });

  it("offers a column to one field only and leaves unknown headers alone", () => {
    const m = guessMapping(["name", "foo", "bar"], "labs");
    expect(m).toEqual({ analyte: 0 });
  });
});

describe("guessFormat", () => {
  it("sees a German file", () => {
    const head = readHead("Analyt;Wert;Datum\nHbA1c;5,4;01.03.2025\n");
    expect(head.delimiter).toBe(";");
    expect(guessFormat(head, 2)).toEqual({
      decimal: "comma",
      dateOrder: "dmy",
    });
  });
  it("sees a US file by a day above twelve", () => {
    const head = readHead("a,b,date\nx,5.4,03/15/2025\n");
    expect(guessFormat(head, 2)).toEqual({ decimal: "dot", dateOrder: "mdy" });
  });
  it("sees ISO", () => {
    expect(guessFormat(readHead("a,date\nx,2025-03-01\n"), 1).dateOrder).toBe(
      "iso",
    );
  });
});

describe("the templates", () => {
  it("import cleanly with the mapping the screen suggests", () => {
    const labs = readHead(RECORD_IMPORT_TEMPLATES.labs, 10);
    const labMap = guessMapping(labs.rows[0], "labs");
    const labQuery = labsCsvQuerySchema.parse(
      Object.fromEntries(
        Object.entries(labMap).map(([k, v]) => [k, String(v)]),
      ),
    );
    for (const [i, fields] of labs.rows.slice(1).entries()) {
      expect(normaliseLabRow({ line: i + 2, fields }, labQuery, "UTC").ok).toBe(
        true,
      );
    }
    const meds = readHead(RECORD_IMPORT_TEMPLATES.medications, 10);
    const medMap = guessMapping(meds.rows[0], "medications");
    const medQuery = medicationsCsvQuerySchema.parse(
      Object.fromEntries(
        Object.entries(medMap).map(([k, v]) => [k, String(v)]),
      ),
    );
    for (const [i, fields] of meds.rows.slice(1).entries()) {
      expect(
        normaliseMedicationRow({ line: i + 2, fields }, medQuery, "UTC").ok,
      ).toBe(true);
    }
  });
});
