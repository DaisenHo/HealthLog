/**
 * The routes that publish a contract and do not yet carry its effect.
 *
 * v1.43 fixed its API contract before the features behind it were built: the
 * routes exist, authenticate, gate and validate as documented, and answer
 * `501 not_implemented` until their feature lands (the helper was removed
 * with the last stub; bring it back from history with the next one). That is safe only while nothing reaches them, and nothing
 * should: every client path sits behind a `features` flag that stays `false`.
 *
 * This list is the debt register. A feature that lands removes its route here
 * in the same change; a new stub has to be named here to exist. The release is
 * not ready to tag while the list is not empty, which the last case below
 * makes impossible to miss: it states the count it was written against, so
 * the change that empties the list also has to touch this file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { walkSourceFiles } from "./helpers/source-files";

const API_ROOT = join(process.cwd(), "src", "app", "api");

/** Route file (under `src/app/api`) to the operations it still stubs. */
const CONTRACT_STUBS: Readonly<Record<string, readonly string[]>> = {};

/** The size of the register when it was written; see the header. */
const REGISTER_SIZE = 0;

function routeFiles(): string[] {
  return walkSourceFiles(API_ROOT, { floor: 400, extensions: [".ts"] })
    .filter((rel) => rel.endsWith("route.ts"))
    .filter((rel) => !rel.includes("__tests__"));
}

describe("contract stubs answering 501", () => {
  const routes = routeFiles();
  const found = routes
    .filter((rel) =>
      /\bnotImplemented\s*\(/.test(readFileSync(join(API_ROOT, rel), "utf8")),
    )
    .sort();

  it("sweeps the whole route tree", () => {
    // The register can and should reach zero; the tree it is checked against
    // cannot. A matcher that read nothing would make the register look clean.
    expect(routes.length).toBeGreaterThan(400);
  });

  it("are exactly the registered ones", () => {
    expect(found).toEqual(Object.keys(CONTRACT_STUBS).sort());
  });

  it("each still names the operations it was registered with", () => {
    for (const [rel, operations] of Object.entries(CONTRACT_STUBS)) {
      const source = readFileSync(join(API_ROOT, rel), "utf8");
      for (const operation of operations) {
        expect(source, `${rel} no longer stubs ${operation}`).toContain(
          `notImplemented(${operation.endsWith(".") ? "`" : '"'}${operation}`,
        );
      }
    }
  });

  it("authenticate before they answer", () => {
    for (const rel of found) {
      const source = readFileSync(join(API_ROOT, rel), "utf8");
      expect(
        /\b(requireAuth|requireRecordAuth|requireAdmin|claimGate)\s*\(/.test(
          source,
        ),
        `${rel} answers 501 without authenticating first`,
      ).toBe(true);
    }
  });

  it("are still the register the release was planned with", () => {
    // Empty before the release is tagged: set REGISTER_SIZE to 0 with the
    // change that fills the last route.
    expect(Object.keys(CONTRACT_STUBS)).toHaveLength(REGISTER_SIZE);
  });
});
