/**
 * A streaming CSV reader for the record imports (#1215).
 *
 * The measurement importer reads its whole body into one string and splits
 * it. That is fine for its 16 MB cap, but a lab or medication history kept
 * over years in a spreadsheet arrives as one upload, and the import must hold
 * a bounded amount of it at a time. This reader consumes the body chunk by
 * chunk and hands out one record at a time; at any moment it holds the bytes
 * of the record it is building and nothing before it.
 *
 * RFC 4180 plus what spreadsheets actually write:
 *  - a UTF-8 byte-order mark at the start is dropped;
 *  - the separator is `,`, `;` or a tab, detected from the header line
 *    outside quotes unless the caller names one (a German export writes `;`
 *    because `,` is its decimal mark);
 *  - fields may be quoted with `"`, a doubled `""` inside is one quote, and
 *    a quoted field may hold the separator and line breaks;
 *  - lines end in `\n`, `\r\n` or a lone `\r`;
 *  - a record of only empty fields (a trailing blank line) is skipped.
 *
 * Bounds: the body is counted while it is read and refused past `maxBytes`;
 * a field longer than `MAX_FIELD_CHARS` or a record wider than
 * `MAX_COLUMNS` marks that record `oversized` instead of growing without end
 * (one runaway quote would otherwise swallow the rest of the file).
 */

export type CsvDelimiter = "," | ";" | "\t";

export const MAX_FIELD_CHARS = 4000;
export const MAX_COLUMNS = 100;

export interface CsvRecord {
  /** 1-based physical line the record starts on. */
  line: number;
  fields: string[];
  /** A field or the record ran past the bounds; its fields are cut short. */
  oversized: boolean;
}

/** Count separators outside quotes in a header line; the most frequent wins. */
export function detectDelimiter(headerLine: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of headerLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "," || ch === ";" || ch === "\t")) {
      counts[ch] += 1;
    }
  }
  // Ties go to the comma, then the semicolon: a one-column file is a comma file.
  let best: CsvDelimiter = ",";
  for (const d of [";", "\t"] as const) {
    if (counts[d] > counts[best]) best = d;
  }
  return best;
}

/**
 * The incremental tokenizer. `push` takes the next piece of text and returns
 * the records it completed; `end` flushes the last one. Pure and synchronous,
 * so it is fuzzed without streams.
 */
export class CsvTokenizer {
  private delimiter: CsvDelimiter | null;
  private field = "";
  private fields: string[] = [];
  private quoted = false;
  /** The previous character closed a quote, or was a quote inside quotes. */
  private quotePending = false;
  private afterCr = false;
  private line = 1;
  private recordLine = 1;
  private oversized = false;
  private started = false;
  /** Text held back until the header line shows the separator. */
  private pending = "";

  constructor(delimiter: CsvDelimiter | "auto" = "auto") {
    this.delimiter = delimiter === "auto" ? null : delimiter;
  }

  get detectedDelimiter(): CsvDelimiter | null {
    return this.delimiter;
  }

  push(text: string): CsvRecord[] {
    if (!this.started && text.length > 0) {
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    if (this.delimiter === null) {
      this.pending += text;
      const end = firstLineEnd(this.pending);
      if (end === -1) {
        // Bound the hold-back too: a header that never ends is a broken file.
        if (this.pending.length <= MAX_FIELD_CHARS * MAX_COLUMNS) return [];
        this.delimiter = detectDelimiter(this.pending);
      } else {
        this.delimiter = detectDelimiter(this.pending.slice(0, end));
      }
      text = this.pending;
      this.pending = "";
    }
    const out: CsvRecord[] = [];
    for (let i = 0; i < text.length; i++) {
      this.consume(text[i], out);
    }
    return out;
  }

  end(): CsvRecord[] {
    const out: CsvRecord[] = [];
    if (this.delimiter === null) {
      const held = this.pending;
      this.pending = "";
      this.delimiter = detectDelimiter(held);
      for (const ch of held) this.consume(ch, out);
    }
    if (this.quotePending) {
      // A closing quote right at the end of the input.
      this.quoted = false;
      this.quotePending = false;
    }
    if (this.field !== "" || this.fields.length > 0) this.finishRecord(out);
    return out;
  }

  private append(ch: string) {
    if (this.field.length < MAX_FIELD_CHARS) this.field += ch;
    else this.oversized = true;
  }

  private finishField() {
    if (this.fields.length < MAX_COLUMNS) this.fields.push(this.field);
    else this.oversized = true;
    this.field = "";
  }

  private finishRecord(out: CsvRecord[]) {
    this.finishField();
    const blank = this.fields.every((f) => f === "");
    if (!blank) {
      out.push({
        line: this.recordLine,
        fields: this.fields,
        oversized: this.oversized,
      });
    }
    this.fields = [];
    this.oversized = false;
  }

  private consume(ch: string, out: CsvRecord[]) {
    // A `\n` straight after a `\r` belongs to the same line end.
    if (this.afterCr) {
      this.afterCr = false;
      if (ch === "\n") return;
    }
    if (this.quoted) {
      if (this.quotePending) {
        this.quotePending = false;
        if (ch === '"') {
          this.append('"');
          return;
        }
        // The quote closed the field; fall through to unquoted handling.
        this.quoted = false;
      } else if (ch === '"') {
        this.quotePending = true;
        return;
      } else {
        if (ch === "\n" || ch === "\r") {
          this.line += 1;
          if (ch === "\r") this.afterCr = true;
          this.append("\n");
          return;
        }
        this.append(ch);
        return;
      }
    }
    if (ch === this.delimiter) {
      this.finishField();
      return;
    }
    if (ch === "\n" || ch === "\r") {
      this.finishRecord(out);
      this.line += 1;
      this.recordLine = this.line;
      if (ch === "\r") this.afterCr = true;
      return;
    }
    if (ch === '"' && this.field === "") {
      this.quoted = true;
      return;
    }
    this.append(ch);
  }
}

function firstLineEnd(text: string): number {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) return i;
  }
  return -1;
}

export class CsvTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`CSV exceeds ${maxBytes} bytes`);
    this.name = "CsvTooLargeError";
  }
}

/**
 * Read a byte stream as CSV records, one at a time. The bytes are counted as
 * they arrive and the read stops with `CsvTooLargeError` past `maxBytes`, so
 * a body without a Content-Length cannot run past the cap either.
 */
export async function* readCsvRecords(
  stream: ReadableStream<Uint8Array>,
  opts: { maxBytes: number; delimiter?: CsvDelimiter | "auto" },
): AsyncGenerator<CsvRecord, void, undefined> {
  const tokenizer = new CsvTokenizer(opts.delimiter ?? "auto");
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > opts.maxBytes) throw new CsvTooLargeError(opts.maxBytes);
      for (const record of tokenizer.push(
        decoder.decode(value, { stream: true }),
      )) {
        yield record;
      }
    }
    for (const record of tokenizer.push(decoder.decode())) yield record;
    for (const record of tokenizer.end()) yield record;
  } finally {
    reader.releaseLock();
  }
}

/** A string as a one-chunk-at-a-time stream; for tests and the client preview. */
export function textToStream(
  text: string,
  chunkSize = 64 * 1024,
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}
