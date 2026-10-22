/**
 * The inlang project that the Fink browser editor opens.
 *
 * `project.inlang/settings.json` names the locales Fink offers and the files it
 * writes. A locale added to the i18n config but not here never shows
 * up in the editor, and one listed here but not shipped would invite
 * translations of a bundle the app never loads. The plugin is pinned to an
 * exact version: it decides how the nested JSON is written back, and the
 * round trip was verified against that version only (an unpinned URL would
 * pick up a new serialiser on its own).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultLocale, locales } from "@/lib/i18n/config";

const SETTINGS = join(__dirname, "../../project.inlang/settings.json");

interface InlangSettings {
  baseLocale: string;
  locales: string[];
  modules: string[];
  "plugin.inlang.messageFormat"?: { pathPattern?: string };
}

const settings = JSON.parse(readFileSync(SETTINGS, "utf8")) as InlangSettings;

describe("inlang project settings", () => {
  it("offers exactly the shipped locales, English as the source", () => {
    expect(settings.baseLocale).toBe(defaultLocale);
    expect([...settings.locales].sort()).toEqual([...locales].sort());
  });

  it("points the message-format plugin at the catalogues", () => {
    expect(settings["plugin.inlang.messageFormat"]?.pathPattern).toBe(
      "./messages/{locale}.json",
    );
  });

  it("pins the one plugin to an exact version", () => {
    expect(settings.modules).toHaveLength(1);
    expect(settings.modules[0]).toMatch(
      /^https:\/\/cdn\.jsdelivr\.net\/npm\/@inlang\/plugin-message-format@\d+\.\d+\.\d+\/dist\/index\.js$/,
    );
  });
});
