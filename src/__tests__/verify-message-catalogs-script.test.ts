/**
 * `scripts/verify-message-catalogs.mjs`, which the image build runs in the
 * builder and again in the runner stage, passes the shipped catalogs and fails
 * on a missing or corrupt one. A check that cannot fail would let an image
 * without its catalogs through, so both directions are pinned.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "verify-message-catalogs.mjs");
const CONFIG = join(process.cwd(), "src", "lib", "i18n", "config.ts");

function run(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

let scratch: string | null = null;
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

describe("verify-message-catalogs", () => {
  it("passes the catalogs in the tree and writes the locale list", () => {
    scratch = mkdtempSync(join(tmpdir(), "hl-catalog-check-"));
    const list = join(scratch, "locales");
    const res = run([
      "--dir",
      join(process.cwd(), "messages"),
      "--config",
      CONFIG,
      "--write",
      list,
    ]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/message catalogs ok: .*\ben\b/);

    // The runner-stage form, against the list the builder wrote.
    expect(
      run(["--dir", join(process.cwd(), "messages"), "--locales", list]).status,
    ).toBe(0);
  });

  it("fails on a missing catalog and on one that does not parse", () => {
    scratch = mkdtempSync(join(tmpdir(), "hl-catalog-check-"));
    const dir = join(scratch, "messages");
    mkdirSync(dir);
    writeFileSync(join(dir, "en.json"), "{}");
    writeFileSync(join(dir, "de.json"), '{"common": ');
    const list = join(scratch, "locales");
    writeFileSync(list, "en\nde\nfr\n");

    const res = run(["--dir", dir, "--locales", list]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/de\.json: does not parse/);
    expect(res.stderr).toMatch(/fr\.json: missing/);
    expect(res.stderr).not.toMatch(/en\.json/);
  });
});
