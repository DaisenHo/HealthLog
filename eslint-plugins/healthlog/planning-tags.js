/**
 * @fileoverview Recognises a planning tag at the head of a comment line.
 *
 * Comments used to open with the identifier of the work item that produced
 * them: `v1.4.34 IW-B — …`, `v1.4.25 W4 — …`, `v1.4.40 W-PRIVACY (SB-3) — …`,
 * `RECON1 (D5-5) — …`, `Phase 4 — …`. Those identifiers point into planning
 * notes that never ship with the repository, so to a reader they are noise
 * that looks like a reference. A release version that dates the behaviour may
 * stay, and so may an issue reference (`#1234`, `iOS #12`); the tag goes.
 *
 * One matcher serves two callers: the `healthlog/no-planning-tags` rule, which
 * reports a tag in a new comment, and `scripts/strip-planning-tags.mjs`, which
 * removed the existing ones. Sharing it keeps "what the rule flags" and "what
 * the sweep removed" the same set by construction.
 *
 * Shape recognised (on one comment line, after the comment marker):
 *
 *   [VERSION [/ VERSION …]] HEAD SEP REST
 *
 *   VERSION  `v1.4.34`, `v1.39`
 *   HEAD     tokens, every one of them a tag, a planning word, an issue
 *            reference, a separator, or a parenthesised group of those; a
 *            parenthesised group of anything else (`(org-audit rec #2)`) is
 *            kept verbatim. At least one tag or planning word must be present.
 *   SEP      an em dash; with a leading VERSION also a colon.
 *
 * A line without a version is held to more: the head must carry a tag or a
 * strong planning word, no tag may be on the domain list below (`B12`,
 * `PM2.5`, `UTF-8`, …), and no tag may also occur in the file's code — a
 * test that names its cases `T1`, `T2` keeps its comment labels.
 *
 * WHAT THIS DOES NOT CATCH
 *
 * A tag in the middle of a sentence (`see W4`), a tag inside a string (test
 * titles), and an all-capitals code without a digit (`FDREXTEND`). It reads
 * the head of a line, where the convention put them.
 */

"use strict";

const VERSION_RE = /^v\d+(?:\.\d+){1,3}$/;
const VERSION_PREFIX_RE =
  /^(v\d+(?:\.\d+){1,3}(?:\s*[/,+&]\s*v\d+(?:\.\d+){1,3})*)\s+/;

// A work-item code: letters then digits (B3, MB6, W9b, RECON1, D5-5,
// W9-CHART-GATE, Code-H9), a word-dash-number code (HIGH-9, SB-SCHED-9,
// MOD-12), or the two letter-only families the convention used (IW-B,
// IW-F-Perf, W-PRIVACY).
const TAG_RES = [
  /^(?:[A-Z][A-Za-z]*-)*[A-Z]{1,8}\d+[a-z]{0,2}(?:-[A-Za-z0-9]+)*$/,
  /^[A-Z][A-Za-z]*(?:-[A-Z][A-Za-z]*)*-\d+[a-z]?$/,
  /^IW(?:-[A-Za-z0-9]+)*$/,
  /^W-[A-Z][A-Za-z0-9-]*$/,
];

// Codes that are domain or protocol vocabulary, not work items. Only
// consulted for a line without a version, where such a word can open an
// ordinary comment (`// B12 — cobalamin`, `// UTF-8 — the wire encoding`).
const DOMAIN_RE =
  /^(?:B\d{1,2}|D[23]|K[12]|E[1-4]|T[34]|O[23]|NO2|CO2|SO2|PM\d+(?:\.\d+)?|R2|S3|H[1-6]|A[0-9]|P\d{2,3}|Q[1-4]|V8|ES\d+|SHA-?\d+|MD5|UTF-?\d+|HS\d+|RS\d+|ISO-?\d+|AES-?\d+|RFC-?\d+|COVID-\d+|SARS-CoV-\d+|HTTP-?\d+|X\d+|IPV\d|CSS\d|HTML\d|ECMA-?\d+|WCAG-?\d+|HbA1c|A1C|LDL\d*|HDL\d*|EKG\d*|ECG\d*|PHQ-\d+|GAD-\d+|WHO-\d+|AUDIT-C|ICD-\d+|FHIR-R\d|R4|R5|APP\d+)$/;

const PLAN_WORDS = new Set([
  "phase",
  "wave",
  "welle",
  "workstream",
  "epic",
  "reconcile",
  "hotfix",
  "follow-up",
  "qa",
  "qol",
  "audit",
  "ux",
  "ia",
  "a11y",
  "perf",
  "fix",
  "item",
]);
// Words that mark a planning tag on their own, without a code beside them.
const STRONG_PLAN_WORDS = new Set([
  "phase",
  "wave",
  "welle",
  "workstream",
  "epic",
  "reconcile",
]);
const PLAN_WORD_SHAPES = [
  /^phase-[A-Z]?\d*[a-z]?$/i,
  /^fix-[A-Z0-9]+$/i,
  /^maintainer-item-\d+$/,
];

const TICKET_WORDS = new Set(["ios", "issue", "issues"]);

function isTag(token) {
  return TAG_RES.some((re) => re.test(token));
}

function isPlanWord(token) {
  return (
    PLAN_WORDS.has(token.toLowerCase()) ||
    PLAN_WORD_SHAPES.some((re) => re.test(token))
  );
}

function isTicket(token) {
  return (
    /^#\d+$/.test(token) ||
    /^(?:ios|iOS)#\d+$/.test(token) ||
    TICKET_WORDS.has(token.toLowerCase())
  );
}

const SEPARATORS = new Set(["/", ",", "+", "&"]);

/**
 * Split a head into tokens with their offsets. Parentheses and the
 * separators are their own tokens.
 */
function tokenize(head) {
  const out = [];
  const re = /[()]|[/,+&]|[^\s()/,+&]+/g;
  let m;
  while ((m = re.exec(head)) !== null) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Classify the tokens of one head (or one parenthesised group). Returns
 * null when a token is foreign; otherwise the per-token verdicts.
 */
function classify(tokens) {
  const kinds = tokens.map((t) => {
    if (SEPARATORS.has(t.text)) return "sep";
    if (VERSION_RE.test(t.text)) return "version";
    if (isTicket(t.text)) return "ticket";
    if (/^\d+$/.test(t.text) && t.text.length <= 3) return "digits";
    if (isTag(t.text)) return "tag";
    if (isPlanWord(t.text)) return "plan";
    if (/^\d{4}-\d{2}-\d{2}$/.test(t.text)) return "date";
    if (/^[A-Za-z]$/.test(t.text)) return "letter";
    return null;
  });
  if (kinds.includes(null)) return null;
  const hasTag = kinds.includes("tag");
  const hasPlan = kinds.includes("plan");
  // Bare digits, single letters and dates only belong to a planning head
  // (`Phase 4`, `Welle J`, `W9b/c`, `2026-07-17 audit M5`).
  if (!hasTag && !hasPlan) {
    if (kinds.some((k) => k === "digits" || k === "letter" || k === "date")) {
      return null;
    }
  }
  // `item 3` after an issue reference is part of it (`iOS #12 item 3`).
  for (let i = 1; i < kinds.length; i++) {
    const isItem = tokens[i].text.toLowerCase() === "item";
    if (kinds[i - 1] === "ticket" && (isItem || kinds[i] === "digits")) {
      kinds[i] = "ticket";
    }
  }
  return kinds;
}

function tidy(s) {
  let prev;
  let out = s;
  do {
    prev = out;
    out = out
      .replace(/\(\s*[/,+&]?\s*\)/g, "")
      .replace(/\(\s*[/,+&]\s*/g, "(")
      .replace(/\s*[/,+&]\s*\)/g, ")")
      .replace(/([/,+&])(\s*[/,+&])+/g, "$1")
      .replace(/^\s*[/,+&]\s*/, "")
      .replace(/\s*[/,+&]\s*$/, "")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .replace(/\s{2,}/g, " ")
      .trim();
  } while (out !== prev);
  return out;
}

function capitaliseFirstWord(rest) {
  const m = rest.match(/^([a-z]+)(?=[\s,.;:-]|$)/);
  if (!m) return rest;
  return m[1][0].toUpperCase() + rest.slice(1);
}

/**
 * Inspect the text of one comment line (marker already removed).
 *
 * @param {string} text the line after `//`, `/*`, or ` * `.
 * @param {(tag: string) => boolean} [usedInCode] whether a tag also occurs
 *   in the file's code; only consulted for a line without a version.
 * @returns {null | { tags: string[], replacement: string }}
 */
function matchPlanningTag(text, usedInCode = () => false) {
  const verMatch = text.match(VERSION_PREFIX_RE);
  const version = verMatch ? verMatch[1] : "";
  const afterVersion = verMatch ? text.slice(verMatch[0].length) : text;

  const sepRe = version
    ? /^([^—:`"']{1,60}?)\s*(—|:)(\s|$)/
    : /^([^—:`"']{1,60}?)\s*(—)(\s|$)/;
  const sm = afterVersion.match(sepRe);
  if (!sm) return null;
  const head = sm[1];
  const sep = sm[2];
  const rest = afterVersion.slice(sm[0].length);

  const tokens = tokenize(head);
  if (tokens.length === 0) return null;

  // Split into bare tokens and parenthesised groups (one level).
  const removable = new Array(tokens.length).fill(false);
  const tags = [];
  let sawTagOrPlan = false;
  let sawStrong = false;
  const bare = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text === "(") {
      let j = i + 1;
      while (j < tokens.length && tokens[j].text !== ")") j++;
      if (j >= tokens.length) return null;
      const inner = tokens.slice(i + 1, j);
      const kinds = classify(inner);
      if (kinds) {
        kinds.forEach((k, n) => {
          if (k === "tag" || k === "plan" || k === "date" || k === "letter") {
            removable[i + 1 + n] = true;
          }
          if (k === "digits" && kinds.includes("plan")) {
            removable[i + 1 + n] = true;
          }
          if (k === "tag") tags.push(inner[n].text);
          if (k === "tag" || k === "plan") sawTagOrPlan = true;
          if (
            k === "plan" &&
            STRONG_PLAN_WORDS.has(inner[n].text.toLowerCase())
          )
            sawStrong = true;
        });
      }
      i = j;
      continue;
    }
    if (tokens[i].text === ")") return null;
    bare.push(i);
  }
  const bareKinds = classify(bare.map((i) => tokens[i]));
  if (bare.length > 0 && !bareKinds) return null;
  if (bareKinds) {
    bareKinds.forEach((k, n) => {
      const i = bare[n];
      if (k === "tag" || k === "plan" || k === "date" || k === "letter") {
        removable[i] = true;
      }
      if (k === "digits" && bareKinds.includes("plan")) removable[i] = true;
      if (k === "tag") tags.push(tokens[i].text);
      if (k === "tag" || k === "plan") sawTagOrPlan = true;
      if (k === "plan" && STRONG_PLAN_WORDS.has(tokens[i].text.toLowerCase()))
        sawStrong = true;
    });
  }
  if (!sawTagOrPlan) return null;

  if (!version) {
    if (tags.length === 0 && !sawStrong) return null;
    if (tags.some((t) => DOMAIN_RE.test(t))) return null;
    if (tags.some((t) => usedInCode(t))) return null;
    if (rest.trim() === "") return null;
  }

  let kept = "";
  let cursor = 0;
  tokens.forEach((t, i) => {
    kept += head.slice(cursor, t.start);
    if (!removable[i]) kept += t.text;
    cursor = t.end;
  });
  kept += head.slice(cursor);
  kept = tidy(kept);

  const lead = [version, kept].filter(Boolean).join(" ");
  const replacement = lead
    ? `${lead}${sep === ":" ? "" : " "}${sep}${rest ? " " + rest : ""}`
    : capitaliseFirstWord(rest);
  if (replacement === text) return null;
  return { tags, replacement };
}

/**
 * Split one comment's source text into lines with the marker separated, so
 * a caller can run `matchPlanningTag` on each line and splice the result
 * back. `raw` is the full comment including its `//` or `/* … *\/`.
 */
function commentLines(raw) {
  const lines = raw.split("\n");
  let offset = 0;
  return lines.map((line, index) => {
    const m = line.match(/^(\s*(?:\{?\/\/+|\{?\/\*+|\*+(?!\/))?[ \t]*)(.*)$/);
    const entry = {
      index,
      offset,
      prefix: m[1],
      text: m[2],
    };
    offset += line.length + 1;
    return entry;
  });
}

module.exports = { matchPlanningTag, commentLines };
