/**
 * The streaming CSV reader: the spreadsheet shapes, every chunk boundary, a
 * fuzzed round trip, and a large file read with bounded memory.
 */
import { describe, expect, it } from "vitest";

import {
  CsvTokenizer,
  CsvTooLargeError,
  MAX_COLUMNS,
  MAX_FIELD_CHARS,
  detectDelimiter,
  readCsvRecords,
  textToStream,
  type CsvRecord,
} from "../csv-stream";

function all(text: string, delimiter: "auto" | "," | ";" | "\t" = "auto") {
  const t = new CsvTokenizer(delimiter);
  return [...t.push(text), ...t.end()];
}

/** Feed the text split at every position, one boundary at a time. */
function everySplit(text: string): CsvRecord[][] {
  const out: CsvRecord[][] = [];
  for (let i = 0; i <= text.length; i++) {
    const t = new CsvTokenizer();
    out.push([
      ...t.push(text.slice(0, i)),
      ...t.push(text.slice(i)),
      ...t.end(),
    ]);
  }
  return out;
}

const fields = (records: CsvRecord[]) => records.map((r) => r.fields);

describe("detectDelimiter", () => {
  it.each([
    ["a,b,c", ","],
    ["a;b;c", ";"],
    ["a\tb\tc", "\t"],
    ['"x;y",b,c', ","],
    ["single", ","],
  ] as const)("%j → %j", (line, expected) => {
    expect(detectDelimiter(line)).toBe(expected);
  });
});

describe("CsvTokenizer", () => {
  it("drops a byte-order mark and reads a semicolon file with decimal commas", () => {
    expect(fields(all("﻿Analyt;Wert;Einheit\nHbA1c;5,4;%\n"))).toEqual([
      ["Analyt", "Wert", "Einheit"],
      ["HbA1c", "5,4", "%"],
    ]);
  });

  it("keeps separators, quotes and line breaks inside quoted fields", () => {
    const text = 'a,b\n"x, y","say ""hi""\nthere"\n';
    expect(fields(all(text))).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
  });

  it("reads LF, CRLF and lone CR line ends and skips blank lines", () => {
    expect(fields(all("a,b\r\n1,2\r3,4\n\n\r\n5,6"))).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ]);
  });

  it("reports the physical line each record starts on", () => {
    const records = all('h\n"multi\nline"\n\nlast\n');
    expect(records.map((r) => r.line)).toEqual([1, 2, 5]);
  });

  it("keeps empty fields and a trailing empty field", () => {
    expect(fields(all("a,,c,\n"))).toEqual([["a", "", "c", ""]]);
  });

  it("gives the same records whatever the chunk boundaries", () => {
    const text =
      '﻿name;dose;"note"\r\n"Ram;ipril";"5 mg";"two\r\nlines ""q"""\r\nX;1;\r';
    const expected = fields(all(text));
    for (const records of everySplit(text)) {
      expect(fields(records)).toEqual(expected);
    }
  });

  it("marks a runaway field instead of growing without end", () => {
    const records = all(`a\n"${"x".repeat(MAX_FIELD_CHARS + 50)}\n`);
    expect(records[1].oversized).toBe(true);
    expect(records[1].fields[0].length).toBe(MAX_FIELD_CHARS);
  });

  it("marks a record wider than the column cap", () => {
    const wide = Array.from({ length: MAX_COLUMNS + 5 }, (_, i) =>
      String(i),
    ).join(",");
    const [record] = all(`${wide}\n`);
    expect(record.oversized).toBe(true);
    expect(record.fields).toHaveLength(MAX_COLUMNS);
  });
});

/** Deterministic pseudo-random so a failure reproduces. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function quoteField(value: string) {
  return /[",;\t\r\n]/.test(value) || value === ""
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

describe("fuzzed round trip", () => {
  it("reads back exactly what was written, for random tables and chunkings", () => {
    const alphabet = [
      "a",
      "Z",
      "1",
      ",",
      ";",
      '"',
      "\n",
      "\r\n",
      " ",
      "ä",
      "漢",
      "\t",
      ".",
    ];
    const rand = rng(1215);
    for (let round = 0; round < 300; round++) {
      const delimiter = ([",", ";", "\t"] as const)[Math.floor(rand() * 3)];
      const cols = 1 + Math.floor(rand() * 5);
      const rows = 1 + Math.floor(rand() * 6);
      const table: string[][] = [];
      for (let r = 0; r < rows; r++) {
        const row: string[] = [];
        for (let c = 0; c < cols; c++) {
          let v = "";
          const len = Math.floor(rand() * 6);
          for (let k = 0; k < len; k++)
            v += alphabet[Math.floor(rand() * alphabet.length)];
          // A field that is all whitespace-free and quotable stays as written.
          row.push(r === 0 ? `h${c}` : v);
        }
        // A record of only empty fields is skipped by design; keep one cell.
        if (!row.some((f) => f.length > 0)) row[0] = "x";
        table.push(row);
      }
      const text =
        table
          .map((row) => row.map((f) => quoteField(f)).join(delimiter))
          .join(rand() < 0.5 ? "\n" : "\r\n") + (rand() < 0.5 ? "\n" : "");
      const t = new CsvTokenizer(delimiter);
      const out: CsvRecord[] = [];
      let i = 0;
      while (i < text.length) {
        const step = 1 + Math.floor(rand() * 7);
        out.push(...t.push(text.slice(i, i + step)));
        i += step;
      }
      out.push(...t.end());
      // Quoted line breaks come back as "\n": the reader normalises them.
      const expected = table.map((row) =>
        row.map((f) => f.replace(/\r\n/g, "\n")),
      );
      expect(fields(out), `round ${round}: ${JSON.stringify(text)}`).toEqual(
        expected,
      );
    }
  });
});

describe("readCsvRecords", () => {
  it("streams a large file record by record", async () => {
    const rows = 200_000;
    const lines = ["analyte;value;unit;date"];
    for (let i = 0; i < rows; i++)
      lines.push(`Marker ${i % 50};${i % 9},${i % 10};mg/dL;01.02.2024`);
    const text = lines.join("\n");
    let count = 0;
    let maxFieldLength = 0;
    for await (const record of readCsvRecords(textToStream(text, 8192), {
      maxBytes: 64 * 1024 * 1024,
    })) {
      count += 1;
      for (const f of record.fields)
        maxFieldLength = Math.max(maxFieldLength, f.length);
    }
    expect(count).toBe(rows + 1);
    expect(maxFieldLength).toBeLessThan(20);
  });

  it("stops past the byte cap", async () => {
    const text = "a,b\n" + "1,2\n".repeat(1000);
    const consume = async () => {
      for await (const _ of readCsvRecords(textToStream(text, 100), {
        maxBytes: 500,
      })) {
        void _;
      }
    };
    await expect(consume()).rejects.toBeInstanceOf(CsvTooLargeError);
  });

  it("decodes a multi-byte character split across chunks", async () => {
    const text = "name\nÄrztin 漢字\n";
    const out: string[] = [];
    for await (const r of readCsvRecords(textToStream(text, 1), {
      maxBytes: 1000,
    }))
      out.push(r.fields[0]);
    expect(out).toEqual(["name", "Ärztin 漢字"]);
  });
});
