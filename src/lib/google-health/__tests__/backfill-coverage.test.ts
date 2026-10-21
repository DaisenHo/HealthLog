/**
 * Every Google Health collection the sync reads is one the backfill tracks.
 *
 * The backfill walks `GOOGLE_HEALTH_COLLECTION_KEYS` and stamps its marker
 * only when each is done or has ended with a reason. A collection the sync
 * reads but the key list leaves out would never be backfilled, and the card
 * would still say the history finished. Read off the sync modules' own call
 * labels so a new collection cannot join the sync without joining this list.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GOOGLE_HEALTH_COLLECTION_KEYS } from "../collection-keys";

/** Not time series: one profile read each, outside any history walk. */
const NOT_A_HISTORY = new Set(["fetchProfile", "fetchHeight"]);
/** The sleep walk is tracked under its own key. */
const ALIASES: Record<string, string> = { fetchSleep: "sleep" };

describe("Google Health backfill coverage", () => {
  it("tracks every collection the sync reads", () => {
    const dir = join(process.cwd(), "src/lib/google-health");
    const labels = new Set<string>();
    for (const file of readdirSync(dir)) {
      if (!/^sync-.*\.ts$/.test(file)) continue;
      const src = readFileSync(join(dir, file), "utf8");
      for (const m of src.matchAll(/"(fetch[A-Z][A-Za-z0-9]+)"/g)) {
        labels.add(m[1]!);
      }
    }
    expect(labels.size).toBeGreaterThan(10);
    const keys = new Set<string>(GOOGLE_HEALTH_COLLECTION_KEYS);
    const untracked = [...labels]
      .filter((l) => !NOT_A_HISTORY.has(l))
      .map((l) => ALIASES[l] ?? l)
      .filter((l) => !keys.has(l));
    expect(untracked).toEqual([]);
  });
});
