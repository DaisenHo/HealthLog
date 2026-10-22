/**
 * Readers for the two files `boot-profile.ts` collects: a V8 CPU profile
 * (`.cpuprofile`) and a heap snapshot (`.heapsnapshot`). Both are plain
 * JSON; these turn them into the few tables a boot investigation needs, so a
 * before/after comparison does not depend on opening DevTools by hand.
 *
 * Frames are attributed to source modules through the module ids Turbopack
 * writes into every server chunk (`"[project]/src/lib/x.ts [app-route] …"`):
 * a sample at chunk line N belongs to the last module id that starts at or
 * before N.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- modules

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

interface ChunkMap {
  sources: string[];
  /** Per generated line: [column, source index] pairs, ascending. */
  lines: Array<Array<[number, number]>>;
}
const chunkMapCache = new Map<string, ChunkMap | null>();

/** Decode a chunk's source map down to (line, column) → source. */
function chunkMap(url: string): ChunkMap | null {
  if (chunkMapCache.has(url)) return chunkMapCache.get(url)!;
  let path = url;
  try {
    if (url.startsWith("file://")) path = fileURLToPath(url);
  } catch {
    // not a file URL
  }
  let result: ChunkMap | null = null;
  if (existsSync(`${path}.map`)) {
    type RawMap = {
      sources?: string[];
      mappings?: string;
      sections?: Array<{ offset: { line: number }; map: RawMap }>;
    };
    const raw = JSON.parse(readFileSync(`${path}.map`, "utf8")) as RawMap;
    const sources: string[] = [];
    const lines: Array<Array<[number, number]>> = [];
    // An index map (`sections`) holds one ordinary map per offset.
    const flat: Array<{ line: number; map: RawMap }> = raw.sections
      ? raw.sections.map((s) => ({ line: s.offset.line, map: s.map }))
      : [{ line: 0, map: raw }];
    for (const { line: lineOffset, map } of flat) {
      const base = sources.length;
      sources.push(...(map.sources ?? []));
      let src = 0;
      let lineNo = lineOffset;
      for (const line of (map.mappings ?? "").split(";")) {
        const segs: Array<[number, number]> = lines[lineNo] ?? [];
        let col = 0;
        for (const seg of line.split(",")) {
          if (!seg) continue;
          const vals: number[] = [];
          let shift = 0;
          let value = 0;
          for (const ch of seg) {
            const d = B64_INDEX.get(ch)!;
            value += (d & 31) << shift;
            if (d & 32) shift += 5;
            else {
              const neg = value & 1;
              value >>= 1;
              vals.push(neg ? -value : value);
              value = 0;
              shift = 0;
            }
          }
          col += vals[0] ?? 0;
          if (vals.length > 1) {
            src += vals[1]!;
            segs.push([col, base + src]);
          }
        }
        lines[lineNo] = segs;
        lineNo++;
      }
    }
    for (const segs of lines) segs?.sort((x, y) => x[0] - y[0]);
    result = { sources, lines };
  }
  chunkMapCache.set(url, result);
  return result;
}

function packageOf(path: string): string {
  const parts = path.split("node_modules/");
  const rest = parts[parts.length - 1]!.split("/");
  return `npm:${rest[0]!.startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0]}`;
}

/** The source module a frame at (url, 0-based line, column) belongs to. */
export function moduleForFrame(url: string, line: number, column = 0): string {
  if (!url) return "(native)";
  if (url.startsWith("node:")) return url;
  if (url.includes("/node_modules/") && !url.includes("/.next/")) {
    return packageOf(url);
  }
  const map = chunkMap(url);
  const segs = map?.lines[line];
  if (map && segs && segs.length > 0) {
    let lo = 0;
    let hi = segs.length - 1;
    let found = segs[0]![1];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid]![0] <= column) {
        found = segs[mid]![1];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const source = (map.sources[found] ?? "")
      .replace(/^turbopack:\/\/\/\[project\]\//, "")
      .replace(/^(\.\.\/)+/, "");
    if (source.includes("node_modules/")) return packageOf(source);
    return source || url;
  }
  return url.replace(/^.*\/\.next\//, ".next/");
}

// ------------------------------------------------------------ CPU profile

interface CpuNode {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  children?: number[];
}

interface CpuProfile {
  nodes: CpuNode[];
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
}

export interface LongTask {
  startMs: number;
  durationMs: number;
  /** Self time by source module, descending. */
  byModule: Array<[string, number]>;
  /** Self time by function, descending. */
  byFunction: Array<[string, number]>;
  /** Inclusive time of the outermost application frames. */
  byEntry: Array<[string, number]>;
}

const IDLE = new Set(["(idle)", "(root)"]);

/**
 * Busy stretches of the main thread: consecutive non-idle samples whose gaps
 * stay under `gapMs`, longer than `minMs`. Each comes with its self time by
 * module and by function.
 */
export function longTasks(
  profile: CpuProfile,
  minMs = 100,
  gapMs = 5,
): LongTask[] {
  const byId = new Map<number, CpuNode>();
  const parent = new Map<number, number>();
  for (const n of profile.nodes) {
    byId.set(n.id, n);
    for (const c of n.children ?? []) parent.set(c, n.id);
  }
  const tasks: LongTask[] = [];
  let current: {
    start: number;
    end: number;
    samples: Array<[number, number]>;
  } | null = null;
  const flush = () => {
    if (!current) return;
    const dur = (current.end - current.start) / 1000;
    if (dur >= minMs) {
      const mods = new Map<string, number>();
      const fns = new Map<string, number>();
      const entries = new Map<string, number>();
      for (const [id, dt] of current.samples) {
        const n = byId.get(id)!;
        const cf = n.callFrame;
        const mod = moduleForFrame(cf.url, cf.lineNumber, cf.columnNumber);
        mods.set(mod, (mods.get(mod) ?? 0) + dt);
        const fn = `${cf.functionName || "(anonymous)"} ${mod}`;
        fns.set(fn, (fns.get(fn) ?? 0) + dt);
        // Inclusive: every distinct module on the stack gets the sample once.
        const seen = new Set<string>();
        let cur: number | undefined = id;
        while (cur !== undefined) {
          const c = byId.get(cur)!.callFrame;
          if (c.url) {
            const m = moduleForFrame(c.url, c.lineNumber, c.columnNumber);
            if (m.startsWith("src/") && !seen.has(m)) {
              seen.add(m);
              entries.set(m, (entries.get(m) ?? 0) + dt);
            }
          }
          cur = parent.get(cur);
        }
      }
      const top = (m: Map<string, number>) =>
        [...m.entries()]
          .map(([k, v]) => [k, Math.round(v / 100) / 10] as [string, number])
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15);
      tasks.push({
        startMs: Math.round((current.start - profile.startTime) / 1000),
        durationMs: Math.round(dur),
        byModule: top(mods),
        byFunction: top(fns),
        byEntry: top(entries),
      });
    }
    current = null;
  };
  let at = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    at += profile.timeDeltas[i] ?? 0;
    const id = profile.samples[i]!;
    const name = byId.get(id)?.callFrame.functionName ?? "";
    const dt = profile.timeDeltas[i + 1] ?? 0;
    if (IDLE.has(name)) {
      if (current && at - current.end > gapMs * 1000) flush();
      continue;
    }
    if (!current) current = { start: at, end: at, samples: [] };
    else if (at - current.end > gapMs * 1000) {
      flush();
      current = { start: at, end: at, samples: [] };
    }
    current.end = at + dt;
    current.samples.push([id, dt]);
  }
  flush();
  return tasks;
}

/** Self time per module over the whole profile, or a window of it. */
export function selfTimeByModule(
  profile: CpuProfile,
  fromMs = 0,
  toMs = Infinity,
): Array<[string, number]> {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const mods = new Map<string, number>();
  let at = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    at += profile.timeDeltas[i] ?? 0;
    const rel = (at - profile.startTime) / 1000;
    if (rel < fromMs || rel > toMs) continue;
    const n = byId.get(profile.samples[i]!)!;
    if (IDLE.has(n.callFrame.functionName)) continue;
    const mod = moduleForFrame(
      n.callFrame.url,
      n.callFrame.lineNumber,
      n.callFrame.columnNumber,
    );
    const dt = profile.timeDeltas[i + 1] ?? 0;
    mods.set(mod, (mods.get(mod) ?? 0) + dt);
  }
  return [...mods.entries()]
    .map(([k, v]) => [k, Math.round(v / 100) / 10] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------- heap snapshot

interface HeapSnapshot {
  snapshot: {
    meta: {
      node_fields: string[];
      node_types: [string[], ...unknown[]];
      edge_fields: string[];
      edge_types: [string[], ...unknown[]];
    };
    node_count: number;
  };
  nodes: number[];
  edges: number[];
  strings: string[];
}

export interface HeapSummary {
  totalMb: number;
  nodeCount: number;
  byType: Array<[string, number]>;
  byConstructor: Array<[string, number, number]>;
  largestStrings: Array<[number, string]>;
  /** Retained size of the largest dominator subtrees below the GC roots. */
  topRetainers: Array<{ mb: number; name: string; path: string }>;
  /** Module source strings (whole chunk scripts) over 50 KB. */
  sourceStringsMb: number;
  /**
   * For each probe, the objects that carry every listed property: how many,
   * and their summed retained size (the outermost ones only).
   */
  probes: Record<string, { count: number; retainedMb: number }>;
}

/**
 * Self size by node type and constructor, the largest strings, and retained
 * sizes from the dominator tree (Cooper, Harvey, Kennedy), with a retaining
 * path for each of the largest subtrees.
 */
export function summariseHeap(
  file: string,
  probes: Record<string, string[]> = {},
): HeapSummary {
  const snap = JSON.parse(readFileSync(file, "utf8")) as HeapSnapshot;
  const nf = snap.snapshot.meta.node_fields;
  const ef = snap.snapshot.meta.edge_fields;
  const nodeTypes = snap.snapshot.meta.node_types[0];
  const edgeTypes = snap.snapshot.meta.edge_types[0];
  const NF = nf.length;
  const EF = ef.length;
  const iType = nf.indexOf("type");
  const iName = nf.indexOf("name");
  const iSelf = nf.indexOf("self_size");
  const iEdges = nf.indexOf("edge_count");
  const eType = ef.indexOf("type");
  const eName = ef.indexOf("name_or_index");
  const eTo = ef.indexOf("to_node");
  const weak = edgeTypes.indexOf("weak");
  const shortcut = edgeTypes.indexOf("shortcut");
  const elementT = edgeTypes.indexOf("element");
  const hiddenT = edgeTypes.indexOf("hidden");
  const N = snap.nodes.length / NF;
  const nodes = snap.nodes;
  const edges = snap.edges;
  const strings = snap.strings;

  const firstEdge = new Uint32Array(N + 1);
  for (let i = 0, e = 0; i < N; i++) {
    firstEdge[i] = e;
    e += nodes[i * NF + iEdges]! * EF;
  }
  firstEdge[N] = edges.length;

  const self = (i: number) => nodes[i * NF + iSelf]!;
  const typeOf = (i: number) => nodeTypes[nodes[i * NF + iType]!]!;
  const nameOf = (i: number) => strings[nodes[i * NF + iName]!]!;

  let total = 0;
  const byType = new Map<string, number>();
  const byCtor = new Map<string, [number, number]>();
  const big: Array<[number, string]> = [];
  let sourceStrings = 0;
  for (let i = 0; i < N; i++) {
    const s = self(i);
    total += s;
    const t = typeOf(i);
    byType.set(t, (byType.get(t) ?? 0) + s);
    if (t === "object" || t === "closure" || t === "array" || t === "native") {
      const k = `${t}:${nameOf(i)}`.slice(0, 80);
      const cur = byCtor.get(k) ?? [0, 0];
      cur[0] += s;
      cur[1] += 1;
      byCtor.set(k, cur);
    }
    if (
      t === "string" ||
      t === "concatenated string" ||
      t === "sliced string"
    ) {
      if (s > 200_000)
        big.push([s, nameOf(i).slice(0, 100).replace(/\s+/g, " ")]);
      const nm = nameOf(i);
      if (
        s > 50_000 &&
        /__turbopack_context__|"use strict";|module\.exports/.test(
          nm.slice(0, 2000),
        )
      ) {
        sourceStrings += s;
      }
    }
  }

  // Graph for the dominator tree: strong edges only.
  const isStrong = (et: number) => et !== weak && et !== shortcut;
  // Post-order DFS from node 0.
  const order = new Int32Array(N).fill(-1);
  const post: number[] = [];
  const stackN: number[] = [0];
  const stackE: number[] = [firstEdge[0]!];
  order[0] = -2;
  while (stackN.length) {
    const top = stackN.length - 1;
    const n = stackN[top]!;
    const e = stackE[top]!;
    if (e < firstEdge[n + 1]!) {
      stackE[top] = e + EF;
      const et = edges[e + eType]!;
      if (!isStrong(et)) continue;
      const to = edges[e + eTo]! / NF;
      if (order[to] === -1) {
        order[to] = -2;
        stackN.push(to);
        stackE.push(firstEdge[to]!);
      }
    } else {
      order[n] = post.length;
      post.push(n);
      stackN.pop();
      stackE.pop();
    }
  }
  const R = post.length;
  // Predecessors in post-order numbering (CSR).
  const predCount = new Uint32Array(R + 1);
  for (let n = 0; n < N; n++) {
    if (order[n]! < 0) continue;
    for (let e = firstEdge[n]!; e < firstEdge[n + 1]!; e += EF) {
      if (!isStrong(edges[e + eType]!)) continue;
      const to = edges[e + eTo]! / NF;
      if (order[to]! >= 0) predCount[order[to]! + 1]! += 1;
    }
  }
  for (let i = 0; i < R; i++) predCount[i + 1]! += predCount[i]!;
  const preds = new Uint32Array(predCount[R]!);
  const fill = predCount.slice(0, R);
  for (let n = 0; n < N; n++) {
    if (order[n]! < 0) continue;
    for (let e = firstEdge[n]!; e < firstEdge[n + 1]!; e += EF) {
      if (!isStrong(edges[e + eType]!)) continue;
      const to = edges[e + eTo]! / NF;
      if (order[to]! >= 0) preds[fill[order[to]!]!++] = order[n]!;
    }
  }
  const rootPo = order[0]!;
  const idom = new Int32Array(R).fill(-1);
  idom[rootPo] = rootPo;
  let changed = true;
  while (changed) {
    changed = false;
    for (let b = R - 1; b >= 0; b--) {
      if (b === rootPo) continue;
      let ni = -1;
      for (let p = predCount[b]!; p < predCount[b + 1]!; p++) {
        let q = preds[p]!;
        if (idom[q] === -1) continue;
        if (ni === -1) {
          ni = q;
          continue;
        }
        let a = ni;
        while (a !== q) {
          while (a < q) a = idom[a]!;
          while (q < a) q = idom[q]!;
        }
        ni = a;
      }
      if (ni !== -1 && idom[b] !== ni) {
        idom[b] = ni;
        changed = true;
      }
    }
  }
  const retained = new Float64Array(R);
  for (let b = 0; b < R; b++) retained[b] += self(post[b]!);
  for (let b = 0; b < R; b++) {
    if (b !== rootPo && idom[b]! >= 0) retained[idom[b]!] += retained[b]!;
  }

  // A retaining path: the first strong, named predecessor edge, walked up.
  const retainerEdge = new Map<number, [number, string]>();
  const wanted = new Set<number>();
  const candidates: number[] = [];
  for (let b = 0; b < R; b++) {
    const n = post[b]!;
    const t = typeOf(n);
    if (b === rootPo || t === "synthetic" || t === "hidden") continue;
    // Skip nodes whose immediate dominator is itself a big application
    // object: report the outermost holders only.
    if (retained[b]! < 2_000_000) continue;
    candidates.push(b);
  }
  candidates.sort((a, b) => retained[b]! - retained[a]!);
  const picked: number[] = [];
  for (const b of candidates) {
    // keep the outermost: skip if an ancestor in the dominator tree is
    // already picked and within 1.5× (it would be a duplicate line)
    let a = idom[b]!;
    let dup = false;
    while (a !== rootPo && a >= 0) {
      if (picked.includes(a) && retained[a]! < retained[b]! * 1.5) {
        dup = true;
        break;
      }
      a = idom[a]!;
    }
    if (!dup) picked.push(b);
    if (picked.length >= 40) break;
  }
  for (const b of picked) wanted.add(post[b]!);
  // Build one retainer per node in a BFS from the root (shortest path).
  const dist = new Int32Array(N).fill(-1);
  const queue = new Int32Array(N);
  let qh = 0;
  let qt = 0;
  queue[qt++] = 0;
  dist[0] = 0;
  while (qh < qt) {
    const n = queue[qh++]!;
    for (let e = firstEdge[n]!; e < firstEdge[n + 1]!; e += EF) {
      const et = edges[e + eType]!;
      if (!isStrong(et)) continue;
      const to = edges[e + eTo]! / NF;
      if (dist[to] !== -1) continue;
      dist[to] = dist[n]! + 1;
      const label =
        et === elementT || et === hiddenT
          ? `[${edges[e + eName]}]`
          : String(strings[edges[e + eName]!] ?? "");
      retainerEdge.set(to, [n, label]);
      queue[qt++] = to;
    }
  }
  const pathOf = (n: number) => {
    const parts: string[] = [];
    let cur = n;
    for (let depth = 0; depth < 12 && cur !== 0; depth++) {
      const r = retainerEdge.get(cur);
      if (!r) break;
      parts.unshift(`${r[1]}`);
      cur = r[0];
      const t = typeOf(cur);
      if (t !== "hidden" && t !== "synthetic" && depth > 0) {
        parts.unshift(`${nameOf(cur).slice(0, 40)}`);
        if (depth > 4) break;
      }
    }
    return parts.join(" > ");
  };

  const mb = (n: number) => Math.round((n / 1048576) * 10) / 10;
  const probeResults: HeapSummary["probes"] = {};
  const propertyT = edgeTypes.indexOf("property");
  for (const [label, props] of Object.entries(probes)) {
    const hits = new Set<number>();
    for (let n = 0; n < N; n++) {
      if (typeOf(n) !== "object" || order[n]! < 0) continue;
      const seen = new Set<string>();
      for (let e = firstEdge[n]!; e < firstEdge[n + 1]!; e += EF) {
        if (edges[e + eType] !== propertyT) continue;
        seen.add(strings[edges[e + eName]!]!);
      }
      if (props.every((p) => seen.has(p))) hits.add(order[n]!);
    }
    let retainedSum = 0;
    for (const b of hits) {
      // Count a hit only when no dominator above it is a hit too.
      let a = idom[b]!;
      let nested = false;
      while (a !== rootPo && a >= 0) {
        if (hits.has(a)) {
          nested = true;
          break;
        }
        a = idom[a]!;
      }
      if (!nested) retainedSum += retained[b]!;
    }
    probeResults[label] = { count: hits.size, retainedMb: mb(retainedSum) };
  }
  return {
    probes: probeResults,
    totalMb: mb(total),
    nodeCount: N,
    byType: [...byType.entries()]
      .map(([k, v]) => [k, mb(v)] as [string, number])
      .sort((a, b) => b[1] - a[1]),
    byConstructor: [...byCtor.entries()]
      .map(([k, [s, c]]) => [k, mb(s), c] as [string, number, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30),
    largestStrings: big
      .sort((a, b) => b[0] - a[0])
      .slice(0, 25)
      .map(([s, t]) => [mb(s), t]),
    topRetainers: picked.map((b) => ({
      mb: mb(retained[b]!),
      name: `${typeOf(post[b]!)}:${nameOf(post[b]!).slice(0, 60).replace(/\s+/g, " ")}`,
      path: pathOf(post[b]!),
    })),
    sourceStringsMb: mb(sourceStrings),
  };
}
