#!/usr/bin/env node
/**
 * Checks that every shipped locale has a message catalog that parses.
 *
 * The server reads `messages/<locale>.json` from disk at run time
 * (`src/lib/i18n/server-catalogs.ts`); nothing is bundled, so an image that
 * lost the directory, or one file of it, builds and starts clean and only
 * shows the gap when a page asks for that locale. The Dockerfile runs this
 * twice: in the builder against the locale list in `src/lib/i18n/config.ts`,
 * writing that list out, and in the runner stage against the catalogs the
 * image actually carries.
 *
 *   node scripts/verify-message-catalogs.mjs --dir messages \
 *     --config src/lib/i18n/config.ts [--write .message-locales]
 *   node verify-message-catalogs.mjs --dir /app/messages \
 *     --locales .message-locales
 *
 * Exits 1 with every problem listed when a catalog is missing, does not parse
 * or is not a JSON object, or when the locale list cannot be read.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function localesFromConfig(path) {
  const source = readFileSync(path, "utf8");
  const block = /export const locales = \[([^\]]*)\]/.exec(source);
  if (!block) throw new Error(`no \`export const locales = [...]\` in ${path}`);
  const list = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (list.length === 0) throw new Error(`the locale list in ${path} is empty`);
  return list;
}

function localesFromFile(path) {
  const list = readFileSync(path, "utf8").split("\n").filter(Boolean);
  if (list.length === 0) throw new Error(`the locale list in ${path} is empty`);
  return list;
}

const dir = arg("dir");
const config = arg("config");
const listFile = arg("locales");
if (!dir || (!config && !listFile)) {
  console.error(
    "usage: verify-message-catalogs.mjs --dir <messages> (--config <config.ts> | --locales <file>) [--write <file>]",
  );
  process.exit(2);
}

let locales;
try {
  locales = config ? localesFromConfig(config) : localesFromFile(listFile);
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}

const problems = [];
for (const locale of locales) {
  const path = join(dir, `${locale}.json`);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    problems.push(
      `${path}: ${error.code === "ENOENT" ? "missing" : error.message}`,
    );
    continue;
  }
  try {
    const parsed = JSON.parse(text);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      problems.push(`${path}: not a JSON object`);
    }
  } catch (error) {
    problems.push(`${path}: does not parse (${error.message})`);
  }
}

if (problems.length > 0) {
  console.error(
    "ERROR: message catalogs the server reads at run time are broken:",
  );
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const write = arg("write");
if (write) writeFileSync(write, `${locales.join("\n")}\n`);
console.log(`message catalogs ok: ${locales.join(", ")} in ${dir}`);
