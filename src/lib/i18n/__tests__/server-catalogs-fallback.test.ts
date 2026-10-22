/**
 * A message catalog that cannot be read costs its own locale, not every
 * request.
 *
 * The catalogs are read from `messages/` at run time. A missing or corrupt
 * file used to throw from `serverCatalog`, and because the matchers iterate
 * every locale (`localisedValues`), one bad non-English file made every
 * request that touched them a 500. Now that locale is served the English
 * catalog and the failure is logged once; the English catalog itself, which
 * everything falls back to, stops the process at boot with the file named.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/signal", () => ({ emitSignal: vi.fn() }));

import { emitSignal } from "@/lib/logging/signal";

import { localisedValues } from "../shared-resolve";
import {
  assertDefaultCatalogReadable,
  serverCatalog,
} from "../server-catalogs";

const CACHE = Symbol.for("healthlog.i18n.serverCatalogs");
const EN = { common: { save: "Save" } };

function clearCatalogCache() {
  (globalThis as { [CACHE]?: Map<string, unknown> })[CACHE]?.clear();
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hl-catalogs-"));
  mkdirSync(join(root, "messages"));
  writeFileSync(join(root, "messages", "en.json"), JSON.stringify(EN));
  writeFileSync(join(root, "messages", "de.json"), '{"common": {"save": ');
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.mocked(emitSignal).mockClear();
  clearCatalogCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearCatalogCache();
  rmSync(root, { recursive: true, force: true });
});

describe("a catalog that cannot be read", () => {
  it("serves a corrupt locale the English catalog and logs it once", () => {
    expect(serverCatalog("de")).toEqual(EN);
    expect(serverCatalog("de")).toEqual(EN);
    expect(emitSignal).toHaveBeenCalledTimes(1);
    expect(emitSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "i18n.catalog.fallback",
        level: "warn",
        meta: { locale: "de", reason: "corrupt", fallback: "en" },
      }),
    );
  });

  it("serves a missing locale the English catalog", () => {
    expect(serverCatalog("fr")).toEqual(EN);
    expect(emitSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: { locale: "fr", reason: "missing", fallback: "en" },
      }),
    );
  });

  it("keeps a matcher that reads every locale answering", () => {
    expect(localisedValues("common.save")).toEqual(["Save"]);
  });

  it("refuses to boot without the English catalog, naming the file", () => {
    rmSync(join(root, "messages", "en.json"));
    expect(() => assertDefaultCatalogReadable()).toThrow(
      /en message catalog at .*messages[/\\]en\.json is missing/,
    );
  });

  it("refuses to boot on an English catalog that does not parse", () => {
    writeFileSync(join(root, "messages", "en.json"), "[1, 2");
    expect(() => assertDefaultCatalogReadable()).toThrow(/is corrupt/);
  });
});
