/**
 * The German Settings glossary: one word per thing.
 *
 * Settings used "Provider" beside "Anbieter", "Default" beside "Standard",
 * and the score as "Health Score", "Health-Score", "Gesundheits-Score" and
 * "Gesundheitsscore", sometimes on one screen. The settled words are
 * Anbieter, Standard and Gesundheitsscore; the Insights area is "Insights"
 * (the name already dominant in the catalog). This reads the German catalog
 * under the Settings namespaces and fails on the retired spellings.
 *
 * Product names are not glossary words: "ChatGPT", "OpenAI" and the like are
 * left alone, and so is "Provider" inside a code-shaped token.
 */
import { describe, expect, it } from "vitest";

import de from "../../messages/de.json";

const NAMESPACES = ["settings", "thresholds"] as const;

const RETIRED: ReadonlyArray<{ pattern: RegExp; use: string }> = [
  { pattern: /\bProvider\b/, use: "Anbieter" },
  { pattern: /\bDefaults?\b/, use: "Standard" },
  { pattern: /\bHealth[- ]?Score\b/i, use: "Gesundheitsscore" },
  { pattern: /\bGesundheits-Score\b/, use: "Gesundheitsscore" },
];

function walk(node: unknown, path: string, out: Array<[string, string]>) {
  if (typeof node === "string") out.push([path, node]);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      walk(value, path ? `${path}.${key}` : key, out);
    }
  }
}

describe("German Settings glossary", () => {
  const strings: Array<[string, string]> = [];
  for (const ns of NAMESPACES) {
    walk((de as Record<string, unknown>)[ns], ns, strings);
  }

  it("reads the catalog (an empty read is a broken walker)", () => {
    expect(strings.length).toBeGreaterThan(500);
  });

  it("uses the settled words", () => {
    const offenders: string[] = [];
    for (const [key, value] of strings) {
      for (const { pattern, use } of RETIRED) {
        if (pattern.test(value)) offenders.push(`${key}: "${value}" → ${use}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("German wording settled in v1.44", () => {
  const at = (path: string): string =>
    path
      .split(".")
      .reduce<unknown>(
        (node, key) => (node as Record<string, unknown> | undefined)?.[key],
        de,
      ) as string;

  it("names the Tracking group with a German word", () => {
    expect(at("settings.shell.groups.tracking")).toBe("Erfassung");
  });

  it("points to another Settings page with 'Unter …' and returns to the Modules", () => {
    expect(at("settings.sections.modules.backToHub")).toBe(
      "Zurück zu den Modulen",
    );
    expect(at("settings.moduleState.change")).toBe("Unter Module ändern");
    expect(at("settings.sections.modules.pages.openArrangement")).toBe(
      "Unter Anordnung öffnen",
    );
    expect(at("settings.sections.modules.manageIn")).toMatch(/^Unter /);
  });

  it("calls the Insights area Insights where a string names it", () => {
    for (const key of [
      "measurements.openMetricInsights",
      "medications.category.custom.bpGateNote",
      "admin.aiQuality.title",
      "recordSharing.invite.accessManageDetail",
    ]) {
      expect(at(key), key).not.toMatch(/Auswertung/);
      expect(at(key), key).toMatch(/Insights/);
    }
  });
});
