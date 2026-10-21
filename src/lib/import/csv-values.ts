/**
 * Reading numbers and dates out of spreadsheet cells (#1215).
 *
 * Conservative by rule: a cell that could mean two things is refused with
 * its own reason rather than read one way. The person sees the line and the
 * reason and fixes the file or the setting; a wrong number stored quietly is
 * the one outcome an import must never have.
 */
import { zonedWallClockToUtc } from "@/lib/tz/wall-clock";
import { isCalendarDateKey } from "@/lib/tz/date-only";

export type DecimalMark = "dot" | "comma";
export type DateOrder = "iso" | "dmy" | "mdy";

export type NumberResult =
  | { ok: true; value: number }
  | { ok: false; reason: "invalid_number" | "ambiguous_number" };

/**
 * A number written with the file's decimal mark. Grouping separators are
 * accepted only in the unmistakable form (`1.234,5` with a comma mark,
 * `1,234.5` with a dot mark). A lone grouping-shaped number in the other
 * convention (`1,234` in a dot file, `1.234` in a comma file) is ambiguous:
 * it is a thousand and something in one country and one point something in
 * the next, and lab values live exactly in that range.
 */
export function parseLocaleNumber(
  raw: string,
  mark: DecimalMark,
): NumberResult {
  let s = raw.trim().replace(/[   ]/g, "");
  let sign = 1;
  if (s.startsWith("-") || s.startsWith("−")) {
    sign = -1;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return { ok: false, reason: "invalid_number" };
  const dec = mark === "comma" ? "," : ".";
  const grp = mark === "comma" ? "." : ",";
  const e = (c: string) => `\\${c}`;
  const read = (digits: string) => {
    const value = sign * Number(digits);
    return Number.isFinite(value)
      ? ({ ok: true, value } as const)
      : ({ ok: false, reason: "invalid_number" } as const);
  };

  // Only the file's own decimal mark, at most once.
  if (new RegExp(`^(\\d+(${e(dec)}\\d+)?|${e(dec)}\\d+)$`).test(s)) {
    return read(s.replace(dec, "."));
  }
  // Grouped in the file's own convention: 1,234,567 / 1,234.5 (dot file).
  if (new RegExp(`^\\d{1,3}(${e(grp)}\\d{3})+(${e(dec)}\\d+)?$`).test(s)) {
    const groups = s.split(grp).length - 1;
    // One group and no decimal part reads as the other convention's decimal
    // too (1,234 = one point two three four in a comma country).
    if (groups === 1 && !s.includes(dec)) {
      return { ok: false, reason: "ambiguous_number" };
    }
    return read(s.split(grp).join("").replace(dec, "."));
  }
  // One mark of the other convention with not exactly three digits after it
  // can only be a decimal mark (5,4 in a dot file, 5.4 in a comma file).
  const other = new RegExp(`^\\d+${e(grp)}(\\d+)$`).exec(s);
  if (other) {
    if (other[1].length === 3) return { ok: false, reason: "ambiguous_number" };
    return read(s.replace(grp, "."));
  }
  return { ok: false, reason: "invalid_number" };
}

export type DateResult =
  | {
      ok: true;
      /** The instant to store. */
      instant: Date;
      /** The calendar date the cell states. */
      dateKey: string;
      /** The cell gave a date without a time of day. */
      dateOnly: boolean;
    }
  | {
      ok: false;
      reason: "invalid_date" | "invalid_time" | "ambiguous_date";
    };

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A date cell (and an optional separate time cell) in the stated order.
 *
 *  - `iso`: `YYYY-MM-DD`, optionally with `T`/space and `HH:mm[:ss]` and an
 *    offset (`Z`, `+02:00`), the shape every export tool can write;
 *  - `dmy`: `DD.MM.YYYY`, `DD/MM/YYYY` or `DD-MM-YYYY`;
 *  - `mdy`: `MM/DD/YYYY`.
 *
 * A time without an offset is a wall-clock time in `timezone` (the account's
 * zone unless the import names another). A date without a time is stored as
 * the date-only anchor the scanned and document readings use (noon UTC), so
 * it is the same calendar date for everyone who opens the record.
 *
 * A two-digit year is refused as ambiguous. So is a `dmy`/`mdy` cell whose
 * first number cannot be what the order says (13/02/2026 under `mdy`):
 * that file is in the other order, and guessing it per row would mix both.
 */
export function parseCsvDate(
  rawDate: string,
  rawTime: string | undefined,
  opts: { order: DateOrder; timezone: string },
): DateResult {
  const cell = rawDate.trim();
  if (cell === "") return { ok: false, reason: "invalid_date" };
  let y: number;
  let m: number;
  let d: number;
  let timePart: string | undefined;
  let offset: string | undefined;

  if (opts.order === "iso") {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(
        cell,
      );
    if (!match) {
      return /^\d{2}-\d{2}-\d{2}$/.test(cell)
        ? { ok: false, reason: "ambiguous_date" }
        : { ok: false, reason: "invalid_date" };
    }
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
    timePart = match[4];
    offset = match[5];
  } else {
    const match =
      /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:[ T](\d{1,2}:\d{2}(?::\d{2})?))?$/.exec(
        cell,
      );
    if (!match) return { ok: false, reason: "invalid_date" };
    if (match[3].length === 2) return { ok: false, reason: "ambiguous_date" };
    const first = Number(match[1]);
    const second = Number(match[2]);
    y = Number(match[3]);
    [d, m] = opts.order === "dmy" ? [first, second] : [second, first];
    if (m > 12 && d <= 12) return { ok: false, reason: "ambiguous_date" };
    timePart = match[4];
  }

  const dateKey = `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
  if (!isCalendarDateKey(dateKey)) return { ok: false, reason: "invalid_date" };

  const time = (rawTime ?? "").trim() || timePart;
  if (!time) {
    return {
      ok: true,
      instant: new Date(`${dateKey}T12:00:00.000Z`),
      dateKey,
      dateOnly: true,
    };
  }
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(time);
  if (!tm) return { ok: false, reason: "invalid_time" };
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  const second = Number(tm[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) {
    return { ok: false, reason: "invalid_time" };
  }
  if (offset) {
    const norm =
      offset.toUpperCase() === "Z"
        ? "Z"
        : offset.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
    const instant = new Date(
      `${dateKey}T${pad(hour)}:${pad(minute)}:${pad(second)}${norm}`,
    );
    if (Number.isNaN(instant.getTime()))
      return { ok: false, reason: "invalid_time" };
    return { ok: true, instant, dateKey, dateOnly: false };
  }
  const instant = zonedWallClockToUtc(
    { year: y, month: m, day: d, hour, minute, second },
    opts.timezone,
  );
  return { ok: true, instant, dateKey, dateOnly: false };
}

/** A yes/no cell in the languages HealthLog speaks; anything else is null. */
export function parseYesNo(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === "") return null;
  if (
    [
      "1",
      "yes",
      "y",
      "true",
      "x",
      "ja",
      "j",
      "sí",
      "si",
      "oui",
      "tak",
      "예",
      "wahr",
    ].includes(v)
  ) {
    return true;
  }
  if (
    [
      "0",
      "no",
      "n",
      "false",
      "nein",
      "non",
      "nie",
      "nee",
      "아니오",
      "falsch",
    ].includes(v)
  ) {
    return false;
  }
  return null;
}
