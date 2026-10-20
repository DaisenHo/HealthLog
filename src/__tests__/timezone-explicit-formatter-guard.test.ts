import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A formatter that renders an instant must say which calendar it renders in.
 *
 * `new Intl.DateTimeFormat(locale, {…})` and `date.toLocaleDateString(…)` fall
 * back to the BROWSER's timezone when none is given. That is a different
 * question from the one this app answers: a reading belongs to the day it was
 * where the person lives, not where their laptop happens to be. A reporter hit
 * exactly this (#490), and the sweep behind it found four separate surfaces
 * that had drifted apart — one of them printed a shared report a day off from
 * the page it was downloaded from.
 *
 * The check is a source-shape check, and it is deliberately coarse in one
 * direction: it cannot tell a Date built from calendar arithmetic (a month
 * label, a weekday header — no instant involved, no timezone question) from a
 * Date parsed out of stored data. So those legitimately-bare sites live on the
 * allowlist with a reason, and the guard's real job is the ratchet: a NEW bare
 * formatter has to be argued for in writing before it can ship.
 *
 * `.toLocaleString(` is deliberately NOT matched. It is overwhelmingly a
 * number formatter in this tree, and flagging thousands separators would bury
 * the four real hits in noise until someone silenced the whole guard.
 */

const REPO_ROOT = resolve(__dirname, "../..");

/**
 * Bare formatter sites that are correct as they stand. Keep this short: it is
 * an inventory of exceptions, not a parking space. Every entry says why.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: "src/components/ui/calendar.tsx",
    why: "A `data-day` attribute on a calendar cell, derived from the grid's own arithmetic. It identifies a cell, it does not render a recorded moment.",
  },
  {
    file: "src/components/cycle/cycle-calendar.tsx",
    why: "Weekday headers walked from a fixed local date, and a month label built from a month anchor. Both are calendar arithmetic with no instant behind them.",
  },
  {
    file: "src/lib/intl/formatter-cache.ts",
    why: "The shared cache itself. Its options come from the caller, so the timezone is the caller's to supply and the guard should be asking them, not this.",
  },
];

const FORMATTER_PATTERNS = [
  /new Intl\.DateTimeFormat\s*\(/g,
  /\.toLocale(?:Date|Time)String\s*\(/g,
  // The shared cache's own entry point: it forwards its options straight to
  // `Intl.DateTimeFormat`, so a call that omits the zone is a bare formatter
  // exactly like the constructor form (the workout surfaces did this until
  // v1.43.6).
  /\bgetDateTimeFormat\s*\(/g,
];

/** The argument list starting at the `(` at or after `from`. */
function argumentList(source: string, from: number): string {
  const open = source.indexOf("(", from);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

/** Number of top-level, comma-separated arguments in `(…)`. */
function topLevelArgCount(args: string): number {
  let depth = 0;
  let count = 0;
  let sawContent = false;
  for (const ch of args.slice(1, -1)) {
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (ch === "," && depth === 0) {
      count += 1;
      sawContent = false;
      continue;
    }
    if (!/\s/.test(ch)) sawContent = true;
  }
  return sawContent ? count + 1 : count;
}

function bareFormatterSites(): Array<{ file: string; line: number }> {
  const listed = execFileSync(
    "grep",
    [
      "-rlE",
      "new Intl\\.DateTimeFormat|\\.toLocale(Date|Time)String\\(|getDateTimeFormat\\(",
      "src",
      "--include=*.ts",
      "--include=*.tsx",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    // Tests pin instants on purpose and are not user-facing surfaces.
    .filter((f) => !f.includes("__tests__"));

  const hits: Array<{ file: string; line: number }> = [];
  for (const file of listed) {
    const source = readFileSync(resolve(REPO_ROOT, file), "utf8");
    for (const pattern of FORMATTER_PATTERNS) {
      pattern.lastIndex = 0;
      for (let m = pattern.exec(source); m !== null; m = pattern.exec(source)) {
        const args = argumentList(source, m.index + m[0].length - 1);
        // The property, not the substring, and both ways of writing it.
        //
        // `timeZoneName: "short"` is a DISPLAY option — it appends "GMT+1" to
        // the output and leaves the zone as the browser's. A plain substring
        // check waves it through, and the result then looks MORE
        // timezone-aware than a bare formatter while being exactly as wrong.
        //
        // The shorthand `{ timeZone }` is the common form in this tree (nine
        // correct call sites use it), so a colon-only check would report all
        // of them and the honest response would be to allowlist them — which
        // is how a guard stops guarding.
        if (/\btimeZone\s*(?::|,|\}|$)/m.test(args)) continue;
        // `getDateTimeFormat(locale, tz, options)` takes the zone as its own
        // argument; only the two-argument `(locale, options)` form can leave
        // it out.
        if (m[0].startsWith("getDateTimeFormat") && topLevelArgCount(args) >= 3)
          continue;
        // A mention in a comment renders nothing.
        const lineStart = source.lastIndexOf("\n", m.index) + 1;
        if (/^\s*(?:\/\/|\*|\/\*)/.test(source.slice(lineStart, m.index)))
          continue;
        hits.push({
          file,
          line: source.slice(0, m.index).split("\n").length,
        });
      }
    }
  }
  return hits;
}

describe("date formatters name the calendar they render in", () => {
  const hits = bareFormatterSites();

  it("finds formatter sites at all (the guard must not pass vacuously)", () => {
    // If this drops to zero the grep has stopped matching and every assertion
    // below became free.
    const all = execFileSync(
      "grep",
      [
        "-rlE",
        "new Intl\\.DateTimeFormat|\\.toLocale(Date|Time)String\\(|getDateTimeFormat\\(",
        "src",
        "--include=*.ts",
        "--include=*.tsx",
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(all.length).toBeGreaterThan(5);
  });

  it("has no unexplained formatter without an explicit timeZone", () => {
    const unexplained = hits.filter(
      (h) => !ALLOWLIST.some((a) => a.file === h.file),
    );
    if (unexplained.length > 0) {
      throw new Error(
        `${unexplained.length} formatter call(s) render a date without naming a timezone:\n\n` +
          unexplained.map((h) => `  ${h.file}:${h.line}`).join("\n") +
          "\n\nWithout `timeZone` these follow the browser, not the profile. Pass the " +
          "profile timezone (`readStoredTimezone() || DEFAULT_TIMEZONE` on the client, " +
          "`resolveUserTimezone(userId)` on the server), or use the shared helpers in " +
          "@/lib/format. If the value is calendar arithmetic rather than a recorded " +
          "instant, add the file to ALLOWLIST in this test with the reason.",
      );
    }
  });

  it("does not accept timeZoneName as a substitute for timeZone", () => {
    // `timeZoneName: "short"` appends "GMT+1" to the output and leaves the
    // zone as the browser's. The first version of this guard tested for the
    // substring "timeZone", which that satisfies — so a formatter that LOOKS
    // more timezone-aware than a bare one sailed through while being exactly
    // as wrong. An independent read found it; this pins it.
    const property = /\btimeZone\s*(?::|,|\}|$)/m;
    expect(property.test('{ hour: "2-digit", timeZoneName: "short" }')).toBe(
      false,
    );
    expect(property.test('{ hour: "2-digit", timeZone: tz }')).toBe(true);
    expect(property.test("{ timeZone : tz }")).toBe(true);
    // The shorthand forms, which are what most of this tree actually writes.
    expect(property.test("{ timeZone, year: 'numeric' }")).toBe(true);
    expect(property.test("{ ...options, timeZone }")).toBe(true);
  });

  it("carries no allowlist entry that no longer has a bare formatter", () => {
    // A stale exception is worse than none: it documents a decision about code
    // that has moved on, and it quietly covers whatever lands in that file next.
    for (const entry of ALLOWLIST) {
      expect(
        hits.some((h) => h.file === entry.file),
        `stale allowlist entry — ${entry.file} no longer has a bare formatter`,
      ).toBe(true);
    }
  });
});

/**
 * A component renders dates through `useFormatters()`, never through the
 * shared cache directly.
 *
 * The two-argument `getDateTimeFormat(locale, options)` from
 * `@/lib/intl/formatter-cache` can name a zone and still be wrong: it takes
 * the locale and the hour cycle from wherever the caller found them and
 * knows nothing of the reader's date-order preference. The workout surfaces
 * rebuilt their own formatters this way and showed "Dec 16" to a reader who
 * had chosen YYYY-MM-DD. The three-argument `(locale, timeZone, options)`
 * form from `@/lib/tz/intl-cache` builds day keys and clock parts, not
 * display text, and stays allowed.
 */
describe("components format dates through useFormatters", () => {
  const CALL = /\bgetDateTimeFormat\s*\(/g;

  function scan() {
    const files = execFileSync(
      "grep",
      [
        "-rlE",
        "getDateTimeFormat\\s*\\(",
        "src/components",
        "--include=*.ts",
        "--include=*.tsx",
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.includes("__tests__"));
    const offenders: string[] = [];
    let calls = 0;
    for (const file of files) {
      const source = readFileSync(resolve(REPO_ROOT, file), "utf8");
      CALL.lastIndex = 0;
      for (let m = CALL.exec(source); m; m = CALL.exec(source)) {
        const lineStart = source.lastIndexOf("\n", m.index) + 1;
        if (/^\s*(?:\/\/|\*|\/\*)/.test(source.slice(lineStart, m.index)))
          continue;
        calls += 1;
        const args = argumentList(source, m.index + m[0].length - 1);
        if (topLevelArgCount(args) < 3) {
          offenders.push(
            `${file}:${source.slice(0, m.index).split("\n").length}`,
          );
        }
      }
    }
    return { offenders, calls };
  }

  it("still sees the cache's calls in components (the matcher matches)", () => {
    expect(scan().calls).toBeGreaterThanOrEqual(1);
  });

  it("has no two-argument getDateTimeFormat in src/components", () => {
    expect(scan().offenders).toEqual([]);
  });

  it("the matcher flags the two-argument form across lines", () => {
    const source =
      'getDateTimeFormat(\n  locale,\n  { timeZone, month: "short" },\n)';
    CALL.lastIndex = 0;
    const m = CALL.exec(source)!;
    expect(
      topLevelArgCount(argumentList(source, m.index + m[0].length - 1)),
    ).toBe(2);
  });
});

/**
 * A stated calendar date must not go through a zone-aware short formatter.
 *
 * A day key is anchored at noon UTC (`${key}T12:00:00Z`) so that it is the
 * same calendar date everywhere, and then `dateShortSmart` read it in the
 * profile zone and showed the NEXT day in UTC+12..+14. The calendar sibling,
 * `dateShortSmartCalendar`, reads the key in UTC. This fails on any
 * `dateShortSmart(`/`dateShort(`/`date(` call whose argument builds a noon
 * anchor, and on the old local-noon form (`T12:00:00` with no zone), which a
 * browser reads in its own zone.
 *
 * A file whose `fmt` comes from `makeBucketLabelFormatters` is skipped: that
 * formatter set is pinned to UTC, so a noon anchor is already its calendar
 * date there.
 */
describe("a stated date is formatted on its calendar date", () => {
  const ZONED_CALL = /\bfmt\.(?:dateShortSmart|dateShort|date)\s*\(/g;
  const CALENDAR_CALL = /\bfmt\.dateShortSmartCalendar\s*\(/g;
  const NOON_ANCHOR = /T12:00:00/;

  function scan() {
    const files = execFileSync(
      "grep",
      ["-rlE", "fmt\\.date", "src", "--include=*.ts", "--include=*.tsx"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.includes("__tests__"));
    const offenders: string[] = [];
    let calendarCalls = 0;
    for (const file of files) {
      const source = readFileSync(resolve(REPO_ROOT, file), "utf8");
      calendarCalls += (source.match(CALENDAR_CALL) ?? []).length;
      if (/const fmt = makeBucketLabelFormatters\(/.test(source)) continue;
      ZONED_CALL.lastIndex = 0;
      for (let m = ZONED_CALL.exec(source); m; m = ZONED_CALL.exec(source)) {
        const args = argumentList(source, m.index + m[0].length - 1);
        if (NOON_ANCHOR.test(args)) {
          offenders.push(
            `${file}:${source.slice(0, m.index).split("\n").length}`,
          );
        }
      }
    }
    return { offenders, calendarCalls };
  }

  it("finds the calendar formatter in use (the matcher still matches)", () => {
    expect(scan().calendarCalls).toBeGreaterThanOrEqual(6);
  });

  it("never hands a noon anchor to a zone-aware formatter", () => {
    expect(scan().offenders).toEqual([]);
  });

  it("the matcher flags the shape it exists for", () => {
    const source = "fmt.dateShortSmart(`${d}T12:00:00Z`)";
    ZONED_CALL.lastIndex = 0;
    const m = ZONED_CALL.exec(source);
    expect(m).not.toBeNull();
    expect(
      NOON_ANCHOR.test(argumentList(source, m!.index + m![0].length - 1)),
    ).toBe(true);
  });
});
