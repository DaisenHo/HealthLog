#!/usr/bin/env node
/**
 * Client-bundle report + budget gate for the Turbopack build.
 *
 * What a reader downloads is a set of chunk files: the shared
 * `rootMainFiles` from `build-manifest.json` plus the chunks a page's
 * `*_client-reference-manifest.js` names. This script measures that set per
 * page and gates it, and separately measures how much distinct client code
 * the build holds.
 *
 * METHOD
 *
 *   First load per page. The union of `rootMainFiles` and the page's
 *   client-reference chunks, deduplicated by content hash (sha-256 of the
 *   file), each file gzipped at level 9 and summed. A file that two
 *   manifests list under different names counts once. Every page in the
 *   build is measured, not a hand-picked few: a heavy import into a page
 *   nobody watched is how Zod sat in fifty metric pages for three months.
 *
 *   Across pages. p50, p95 and max of the per-page first loads.
 *
 *   Unique client code. Every emitted chunk is evaluated in a `node:vm`
 *   sandbox with a stub `TURBOPACK` array, which collects the module
 *   factories the chunk registers without running any of them. Each factory
 *   is keyed by its Turbopack module id, which is global to the build, so a
 *   module the bundler copied into forty chunk groups counts once. (Not by
 *   the factory's text: each chunk is minified on its own, so the copies of
 *   one module differ in their mangled local names.) One copy per module,
 *   from the first chunk in file-name order, without the lazy message
 *   catalogs, is concatenated in id order and gzipped once. A file that
 *   registers no factories (the runtime, the polyfills) counts as one unit
 *   by its content hash.
 *
 *   The old aggregate (every emitted chunk gzipped and summed) is still
 *   printed, for continuity, but no longer gated: it counts a module once
 *   per chunk group it lands in, so it rose every time a page got lighter
 *   by moving code into on-demand chunks.
 *
 * GATES (bundle-budget.json)
 *
 *   - routeBaselineKbGz: measured first load per page; a page fails when it
 *     is more than routeDriftAllowanceKbGz over its baseline, or when it is
 *     a page with no baseline (write one with --write-baselines).
 *   - firstLoadP95KbGz / firstLoadMaxKbGz: caps on the distribution.
 *   - uniqueClientKbGz: cap on the distinct client code.
 *   - maxCatalogKbGz: per lazy message catalog.
 *   - maxRechartsChunks: chunks carrying the Recharts fingerprint (one, the
 *     shared chart-runtime group).
 *   - no message catalog referenced by a page or the shared baseline.
 *
 * Usage:
 *   pnpm bundle-report                       # print the report
 *   pnpm bundle-check                        # enforce bundle-budget.json
 *   node scripts/check-bundle-budget.mjs --write-baselines
 *                                            # rewrite routeBaselineKbGz from
 *                                            # this build (a reviewed change)
 *   node scripts/check-bundle-budget.mjs --dir <build dir> [--json <file>]
 *
 * Numbers are KB gzip. A local arm64 build measures each page about 1.5 KB
 * lighter than the CI runner; the drift allowance covers that and ordinary
 * week-to-week movement, while the step changes the gate exists for (a
 * statically imported catalog, a duplicated chart library, Zod on a page
 * that had none: 60 to 100 KB each) are several times larger.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const CHECK = flag("--check");
const WRITE_BASELINES = flag("--write-baselines");
const BUILD_DIR = option("--dir") ?? join(process.cwd(), ".next");
const JSON_OUT = option("--json");
const APP_DIR = join(BUILD_DIR, "server", "app");
const BUDGET_PATH = join(process.cwd(), "bundle-budget.json");

if (!existsSync(join(BUILD_DIR, "build-manifest.json"))) {
  console.error(
    `check-bundle-budget: no ${join(BUILD_DIR, "build-manifest.json")} — run \`pnpm build\` first.`,
  );
  process.exit(2);
}

/** Recharts library fingerprint (present once in the shared runtime chunk). */
const RECHARTS_MARK = "CartesianGrid";
/**
 * Message-catalog fingerprint. The key set is identical across all locales,
 * so a KEY-position match ("typeTimeInDaylight" directly followed by a colon,
 * in either the plain or the JSON.parse-escaped chunk encoding) marks a
 * bundled catalog. Source modules only ever carry the namespaced call-site
 * form (`measurements.typeTimeInDaylight`), which matches neither.
 */
const CATALOG_MARKS = ['"typeTimeInDaylight":', 'typeTimeInDaylight\\":'];

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const kb = (bytes) => bytes / 1024;
const fmt = (bytes) => `${kb(bytes).toFixed(0)} KB`;
const round1 = (n) => Math.round(n * 10) / 10;

const fileCache = new Map();
function chunkInfo(file) {
  if (!fileCache.has(file)) {
    let info = {
      hash: `missing:${file}`,
      raw: 0,
      gz: 0,
      recharts: false,
      catalog: false,
    };
    try {
      const buf = readFileSync(join(BUILD_DIR, file));
      info = {
        hash: sha(buf),
        raw: buf.length,
        gz: gz(buf),
        recharts: buf.includes(RECHARTS_MARK),
        catalog: CATALOG_MARKS.some((m) => buf.includes(m)),
        buf,
      };
    } catch {
      // A manifest naming a file the build did not emit: counted as zero and
      // reported by its missing hash rather than crashing the report.
    }
    fileCache.set(file, info);
  }
  return fileCache.get(file);
}

function routeChunks(manifestFile) {
  const src = readFileSync(manifestFile, "utf8");
  const idx = src.indexOf("= {");
  const json = JSON.parse(src.slice(idx + 2).replace(/;\s*$/, ""));
  const files = new Set();
  for (const key of Object.keys(json.clientModules ?? {})) {
    for (const chunk of json.clientModules[key].chunks ?? []) {
      if (chunk.endsWith(".js")) files.add(chunk.replace(/^\/_next\//, ""));
    }
  }
  return files;
}

function findPageManifests(dir, prefix = "") {
  let out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(findPageManifests(p, `${prefix}/${entry.name}`));
    } else if (entry.name === "page_client-reference-manifest.js") {
      out.push({ route: `${prefix}/page`, file: p });
    }
  }
  return out;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, i)];
}

/**
 * The `[module id, factory source]` pairs a Turbopack chunk registers,
 * without running them: `TURBOPACK.push([script, id, factory, id, factory,
 * …])`. Null when the file is not in that shape.
 */
function chunkFactories(buf) {
  const sandbox = { TURBOPACK: [] };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  try {
    vm.runInNewContext(buf.toString("utf8"), sandbox, { timeout: 5000 });
  } catch {
    return null;
  }
  const modules = [];
  for (const entry of sandbox.TURBOPACK) {
    if (!Array.isArray(entry)) continue;
    for (let i = 1; i < entry.length; i++) {
      if (typeof entry[i] !== "function") continue;
      const id = entry[i - 1];
      if (typeof id !== "number" && typeof id !== "string") continue;
      modules.push([String(id), entry[i].toString()]);
    }
  }
  return modules.length > 0 ? modules : null;
}

// ── Shared baseline ─────────────────────────────────────────────────────────
const buildManifest = JSON.parse(
  readFileSync(join(BUILD_DIR, "build-manifest.json"), "utf8"),
);
const rootFiles = buildManifest.rootMainFiles ?? [];
let rootGz = 0;
for (const f of rootFiles) rootGz += chunkInfo(f).gz;
const rootCatalogRef = rootFiles.some((f) => chunkInfo(f).catalog);

// ── Per-page first load, deduplicated by content hash ──────────────────────
const pages = new Map();
for (const { route, file } of findPageManifests(APP_DIR)) {
  const byHash = new Map();
  let catalogRef = false;
  for (const chunk of [...rootFiles, ...routeChunks(file)]) {
    const info = chunkInfo(chunk);
    byHash.set(info.hash, info.gz);
    if (info.catalog && !rootFiles.includes(chunk)) catalogRef = true;
  }
  let total = 0;
  for (const size of byHash.values()) total += size;
  pages.set(route, { gz: total, catalogRef });
}
const firstLoads = [...pages.values()].map((p) => p.gz).sort((a, b) => a - b);
const p50 = percentile(firstLoads, 50);
const p95 = percentile(firstLoads, 95);
const max = firstLoads[firstLoads.length - 1] ?? 0;

// ── Whole build: old aggregate, catalogs, recharts, unique modules ─────────
const chunkDir = join(BUILD_DIR, "static", "chunks");
let summedGz = 0;
let rechartsChunks = 0;
let catalogChunks = 0;
let catalogGz = 0;
let largestCatalog = { file: "-", gz: 0 };
const uniqueUnits = new Map();
for (const f of readdirSync(chunkDir).sort()) {
  if (!f.endsWith(".js")) continue;
  const info = chunkInfo(join("static", "chunks", f));
  summedGz += info.gz;
  if (info.recharts) rechartsChunks += 1;
  if (info.catalog) {
    catalogChunks += 1;
    catalogGz += info.gz;
    if (info.gz > largestCatalog.gz) largestCatalog = { file: f, gz: info.gz };
    continue;
  }
  const modules = info.buf ? chunkFactories(info.buf) : null;
  if (modules) {
    for (const [id, source] of modules) {
      if (!uniqueUnits.has(`m:${id}`)) uniqueUnits.set(`m:${id}`, source);
    }
  } else if (info.buf) {
    uniqueUnits.set(`f:${info.hash}`, info.buf.toString("utf8"));
  }
}
const uniqueKeys = [...uniqueUnits.keys()].sort();
const uniqueGz = gz(
  Buffer.from(uniqueKeys.map((k) => uniqueUnits.get(k)).join("\n"), "utf8"),
);

// ── Report ──────────────────────────────────────────────────────────────────
const budget = existsSync(BUDGET_PATH)
  ? JSON.parse(readFileSync(BUDGET_PATH, "utf8"))
  : null;
const baselines = budget?.routeBaselineKbGz ?? {};
const allowanceKb = budget?.routeDriftAllowanceKbGz ?? 0;

console.log(`pages measured:                  ${pages.size}`);
console.log(`shared baseline (rootMainFiles): ${fmt(rootGz)} gz`);
console.log(
  `first load across pages:         p50 ${fmt(p50)}, p95 ${fmt(p95)}, max ${fmt(max)} gz`,
);
console.log(
  `unique client code:              ${fmt(uniqueGz)} gz  (${uniqueKeys.length} distinct modules, catalogs excluded)`,
);
console.log(
  `lazy message catalogs:           ${fmt(catalogGz)} gz  (${catalogChunks} chunks, largest ${fmt(largestCatalog.gz)} ${largestCatalog.file})`,
);
console.log(
  `summed chunks, not gated:        ${fmt(summedGz - catalogGz)} gz  (every emitted chunk once, catalogs excluded)`,
);
console.log(`recharts-fingerprint chunks:     ${rechartsChunks}`);
console.log("");

const rows = [...pages.entries()]
  .map(([route, { gz: size }]) => {
    const baseline = baselines[route];
    return {
      route,
      kb: round1(kb(size)),
      baseline: baseline ?? null,
      delta: baseline == null ? null : round1(kb(size) - baseline),
    };
  })
  .sort((a, b) => (b.delta ?? Infinity) - (a.delta ?? Infinity) || b.kb - a.kb);
console.log("largest movers against their baseline:");
for (const r of rows.slice(0, 15)) {
  const delta =
    r.delta == null
      ? "no baseline"
      : `${r.delta >= 0 ? "+" : "−"}${Math.abs(r.delta).toFixed(1)} KB of ${allowanceKb}`;
  console.log(
    `${`${r.kb.toFixed(0)} KB`.padStart(8)} gz  ${r.route}  (${delta})`,
  );
}

const report = {
  pages: Object.fromEntries(rows.map((r) => [r.route, r.kb])),
  firstLoadKbGz: {
    p50: round1(kb(p50)),
    p95: round1(kb(p95)),
    max: round1(kb(max)),
  },
  uniqueClientKbGz: round1(kb(uniqueGz)),
  summedChunksKbGz: round1(kb(summedGz - catalogGz)),
  catalogKbGz: round1(kb(catalogGz)),
  largestCatalogKbGz: round1(kb(largestCatalog.gz)),
  rechartsChunks,
};
if (JSON_OUT) writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`);

if (WRITE_BASELINES) {
  if (!budget) {
    console.error("check-bundle-budget: bundle-budget.json missing.");
    process.exit(2);
  }
  budget.routeBaselineKbGz = Object.fromEntries(
    rows
      .map((r) => [r.route, Math.round(r.kb)])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(BUDGET_PATH, `${JSON.stringify(budget, null, 2)}\n`);
  console.log(`\nwrote ${rows.length} page baselines to bundle-budget.json`);
}

if (!CHECK) process.exit(0);

// ── Budget gate ─────────────────────────────────────────────────────────────
if (!budget) {
  console.error("check-bundle-budget: bundle-budget.json missing.");
  process.exit(2);
}
// A budget that states no page baselines gates nothing, and would do it
// quietly. A build with no pages is a broken build, not a light one.
if (Object.keys(baselines).length === 0 || pages.size === 0) {
  console.error(
    "check-bundle-budget: no page baselines in bundle-budget.json, or no " +
      "pages in the build. Measure them with --write-baselines.",
  );
  process.exit(2);
}

const failures = [];
for (const r of rows) {
  if (r.baseline == null) {
    failures.push(
      `${r.route}: ${r.kb} KB gz and no baseline. A new page gets one with --write-baselines in the same change.`,
    );
  } else if (r.delta > allowanceKb) {
    failures.push(
      `${r.route}: ${r.kb} KB gz is ${r.delta.toFixed(1)} KB over its ${r.baseline} KB baseline, past the ${allowanceKb} KB drift allowance`,
    );
  }
}
for (const route of Object.keys(baselines)) {
  if (!pages.has(route)) {
    failures.push(
      `${route} has a baseline but is not in the build; remove it with --write-baselines`,
    );
  }
}
if (budget.firstLoadP95KbGz && kb(p95) > budget.firstLoadP95KbGz) {
  failures.push(
    `first-load p95 ${kb(p95).toFixed(1)} KB gz exceeds the ${budget.firstLoadP95KbGz} KB budget`,
  );
}
if (budget.firstLoadMaxKbGz && kb(max) > budget.firstLoadMaxKbGz) {
  failures.push(
    `largest first load ${kb(max).toFixed(1)} KB gz exceeds the ${budget.firstLoadMaxKbGz} KB budget`,
  );
}
if (budget.uniqueClientKbGz && kb(uniqueGz) > budget.uniqueClientKbGz) {
  failures.push(
    `unique client code ${kb(uniqueGz).toFixed(1)} KB gz exceeds the ${budget.uniqueClientKbGz} KB budget`,
  );
}
if (budget.maxCatalogKbGz && kb(largestCatalog.gz) > budget.maxCatalogKbGz) {
  failures.push(
    `message catalog ${largestCatalog.file} ${fmt(largestCatalog.gz)} gz exceeds the ${budget.maxCatalogKbGz} KB per-catalog budget`,
  );
}
if (
  budget.maxRechartsChunks != null &&
  rechartsChunks > budget.maxRechartsChunks
) {
  failures.push(
    `${rechartsChunks} recharts-fingerprint chunks (budget ${budget.maxRechartsChunks}) — a chart import bypassed the shared chart-runtime boundary`,
  );
}
const catalogRefPages = [...pages.entries()]
  .filter(([, v]) => v.catalogRef)
  .map(([r]) => r);
if (catalogRefPages.length > 0 || rootCatalogRef) {
  failures.push(
    `message catalog statically referenced by ${rootCatalogRef ? "the shared baseline" : catalogRefPages.join(", ")} — catalogs must stay lazy (/i18n/<locale> + dynamic import)`,
  );
}

if (failures.length > 0) {
  console.error("\nBundle budget check FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nBundle budget check passed.");
