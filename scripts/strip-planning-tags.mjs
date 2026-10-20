#!/usr/bin/env node
/**
 * Remove planning-note identifiers from the head of comment lines.
 *
 *   node scripts/strip-planning-tags.mjs           # report only, exit 1 on hits
 *   node scripts/strip-planning-tags.mjs --write   # rewrite the files
 *   node scripts/strip-planning-tags.mjs --write src/lib/foo.ts …
 *
 * What counts as a tag is defined once, in
 * `eslint-plugins/healthlog/planning-tags.js`; the `healthlog/no-planning-tags`
 * rule uses the same matcher, so a tree this script leaves clean is a tree
 * the rule accepts.
 *
 * Only comment text changes. Comments are located with the TypeScript parser
 * rather than a regex, so string and template contents are never touched, and
 * every rewritten file is re-parsed and printed with comments removed: if
 * that printout differs from the original's in any way, the file is left
 * alone and the run fails.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const {
  matchPlanningTag,
  commentLines,
} = require("../eslint-plugins/healthlog/planning-tags.js");

const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const EXCLUDED_PREFIXES = [
  "src/generated/",
  "eslint-plugins/",
  "node_modules/",
];

const args = process.argv.slice(2);
const write = args.includes("--write");
const explicit = args.filter((a) => !a.startsWith("--"));

const files = (
  explicit.length > 0
    ? explicit
    : execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n")
).filter(
  (f) =>
    f &&
    EXTENSIONS.has(extname(f)) &&
    !EXCLUDED_PREFIXES.some((p) => f.startsWith(p)),
);

function scriptKind(file) {
  switch (extname(file)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function parse(file, text) {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
}

/** Every comment range in the file, in source order, without duplicates. */
function commentRanges(sf) {
  const text = sf.getFullText();
  const seen = new Map();
  const literalSpans = [];
  const add = (ranges) => {
    for (const r of ranges ?? []) seen.set(r.pos, r);
  };
  const visit = (node) => {
    add(ts.getLeadingCommentRanges(text, node.pos));
    add(ts.getTrailingCommentRanges(text, node.end));
    if (
      node.kind === ts.SyntaxKind.JsxText ||
      ts.isStringLiteralLike(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail ||
      node.kind === ts.SyntaxKind.RegularExpressionLiteral
    ) {
      literalSpans.push([node.getStart(sf), node.end]);
      return;
    }
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  add(ts.getLeadingCommentRanges(text, sf.endOfFileToken.pos));
  return [...seen.values()]
    .filter((r) => !literalSpans.some(([s, e]) => r.pos >= s && r.pos < e))
    .sort((a, b) => a.pos - b.pos);
}

function printWithoutComments(sf) {
  return ts.createPrinter({ removeComments: true }).printFile(sf);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let filesChanged = 0;
let linesChanged = 0;
let tagsRemoved = 0;
let failures = 0;

for (const file of files) {
  const original = readFileSync(file, "utf8");
  const sf = parse(file, original);
  const ranges = commentRanges(sf);
  if (ranges.length === 0) continue;

  let codeOnly = "";
  let cursor = 0;
  for (const r of ranges) {
    codeOnly += original.slice(cursor, r.pos) + " ".repeat(r.end - r.pos);
    cursor = r.end;
  }
  codeOnly += original.slice(cursor);
  const usedInCode = (tag) =>
    new RegExp(`(?<![A-Za-z0-9-])${escapeRegExp(tag)}(?![A-Za-z0-9-])`).test(
      codeOnly,
    );

  const edits = [];
  for (const r of ranges) {
    const raw = original.slice(r.pos, r.end);
    for (const line of commentLines(raw)) {
      const hit = matchPlanningTag(line.text, usedInCode);
      if (!hit) continue;
      const start = r.pos + line.offset + line.prefix.length;
      edits.push({
        start,
        end: start + line.text.length,
        replacement: hit.replacement,
      });
      tagsRemoved += Math.max(hit.tags.length, 1);
      if (!write) console.log(`${file}\t${line.text}\t${hit.replacement}`);
    }
  }
  if (edits.length === 0) continue;

  let next = original;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    next = next.slice(0, e.start) + e.replacement + next.slice(e.end);
  }

  if (printWithoutComments(parse(file, next)) !== printWithoutComments(sf)) {
    console.error(
      `${file}: rewrite would change code outside comments; left alone`,
    );
    failures++;
    continue;
  }
  filesChanged++;
  linesChanged += edits.length;
  if (write) writeFileSync(file, next);
}

console.log(
  `${write ? "rewrote" : "found"} ${linesChanged} comment lines (${tagsRemoved} tags) in ${filesChanged} files`,
);
if (failures > 0) process.exit(2);
if (!write && linesChanged > 0) process.exit(1);
