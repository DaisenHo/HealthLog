/**
 * The directories under `src/lib` that hold a provider's client and sync,
 * derived from the connection keys the product knows (`CONNECTION_KEYS`),
 * so a guard over provider code cannot keep a list of its own that a new
 * integration slips past. Each key is checked to be a directory: a key that
 * names none fails here rather than narrowing a guard in silence.
 */
import { statSync } from "node:fs";
import { join } from "node:path";

import { CONNECTION_KEYS } from "@/lib/integrations/connection-health";

const LIB = join(process.cwd(), "src", "lib");

export const PROVIDER_DIRS: readonly string[] = CONNECTION_KEYS.map((key) => {
  if (!statSync(join(LIB, key), { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`provider-dirs: src/lib/${key} is not a directory`);
  }
  return key;
});
