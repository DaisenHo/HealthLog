/**
 * v1.16.10 — the inline manual-order editor mirrors the page's grouping.
 *
 * Both /medications views pin inactive medications after the active
 * block, so the editor drafts TWO sections (Aktiv / Inaktiv) with a
 * muted heading each: drag and arrows work within a section, and the
 * saved order is active ids first, inactive ids after — by
 * construction, not by validation. The editor renders inline in the
 * Medikamente settings section (`/settings/medications`); it started
 * life as a dialog on the /medications page and kept its contract when
 * it moved.
 *
 * Project convention is SSR-only component tests (`renderToStaticMarkup`)
 * plus pure-helper tests for the interactive plumbing an SSR mount
 * can't exercise, plus source-string structural assertions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

primeLocales("de");

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
}));

vi.mock("@/lib/charts/reduced-motion", () => ({
  prefersReducedMotion: () => true,
}));

vi.mock("@/lib/queries/use-medication-list-layout", () => ({
  runSaveMedicationListOrder: vi.fn().mockResolvedValue(true),
}));

const { MedicationOrderEditor, buildSavedOrder, moveWithinSection } =
  await import("../medication-order-editor");

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="de">{node}</I18nProvider>,
  );
}

const MEDS = [
  { id: "a1", name: "Ramipril", dose: "5 mg", active: true },
  { id: "a2", name: "Mounjaro", dose: "7.5 mg", active: true },
  { id: "i1", name: "Amoxicillin", dose: "500 mg", active: false },
  { id: "i2", name: "Ibuprofen", dose: "400 mg", active: false },
];

describe("moveWithinSection — moves stay inside the group", () => {
  it("swaps neighbours within the section (the arrow / drag contract)", () => {
    expect(moveWithinSection(["a1", "a2"], "a2", -1)).toEqual(["a2", "a1"]);
    expect(moveWithinSection(["i1", "i2"], "i1", 1)).toEqual(["i2", "i1"]);
  });

  it("cannot move past either section edge — the group boundary is unreachable", () => {
    expect(moveWithinSection(["a1", "a2"], "a1", -1)).toEqual(["a1", "a2"]);
    expect(moveWithinSection(["a1", "a2"], "a2", 1)).toEqual(["a1", "a2"]);
    // The first inactive row moving "up" stays where it is — it cannot
    // climb into the active block.
    expect(moveWithinSection(["i1", "i2"], "i1", -1)).toEqual(["i1", "i2"]);
  });
});

describe("buildSavedOrder — active ids always precede inactive ids", () => {
  it("composes active block first regardless of within-group churn", () => {
    expect(buildSavedOrder(["a2", "a1"], ["i2", "i1"])).toEqual([
      "a2",
      "a1",
      "i2",
      "i1",
    ]);
  });

  it("an inactive med can never land above an active one in the SAVED order", () => {
    // Drive the editor's own move primitive as far up as it allows and
    // compose the save payload exactly like save() does.
    let inactive = ["i1", "i2"];
    inactive = moveWithinSection(inactive, "i2", -1); // i2 to the top of its group
    inactive = moveWithinSection(inactive, "i2", -1); // edge — no-op
    const saved = buildSavedOrder(["a1", "a2"], inactive);
    expect(saved).toEqual(["a1", "a2", "i2", "i1"]);
    const firstInactiveIdx = Math.min(saved.indexOf("i1"), saved.indexOf("i2"));
    const lastActiveIdx = Math.max(saved.indexOf("a1"), saved.indexOf("a2"));
    expect(firstInactiveIdx).toBeGreaterThan(lastActiveIdx);
  });
});

describe("<MedicationOrderEditor> — two-section rendering", () => {
  it("renders an Aktiv and an Inaktiv section with the rows grouped", () => {
    const html = render(<MedicationOrderEditor medications={MEDS} />);
    expect(html).toContain('data-slot="medication-order-editor"');
    expect(html).toContain('data-slot="medication-reorder-section-active"');
    expect(html).toContain('data-slot="medication-reorder-section-inactive"');
    // Muted group headings.
    expect(html).toContain(">Aktiv</p>");
    expect(html).toContain(">Inaktiv</p>");
    // Every active row renders before every inactive row.
    const lastActive = Math.max(
      html.indexOf("Ramipril"),
      html.indexOf("Mounjaro"),
    );
    const firstInactive = Math.min(
      html.indexOf("Amoxicillin"),
      html.indexOf("Ibuprofen"),
    );
    expect(lastActive).toBeLessThan(firstInactive);
  });

  it("omits the Inaktiv section when every medication is active", () => {
    const html = render(
      <MedicationOrderEditor medications={MEDS.filter((m) => m.active)} />,
    );
    expect(html).toContain('data-slot="medication-reorder-section-active"');
    expect(html).not.toContain(
      'data-slot="medication-reorder-section-inactive"',
    );
  });

  it("hides the Save / Cancel pair until a draft exists (clean editor = no footer)", () => {
    const html = render(<MedicationOrderEditor medications={MEDS} />);
    expect(html).not.toContain(">Speichern<");
    expect(html).not.toContain(">Abbrechen<");
  });
});

describe("medication-order-editor — structural guards (source)", () => {
  const src = readFileSync(
    join(
      process.cwd(),
      "src/components/medications/medication-order-editor.tsx",
    ),
    "utf8",
  );

  it("saves through buildSavedOrder (active ids, then inactive ids)", () => {
    expect(src).toContain("buildSavedOrder(activeIds, inactiveIds)");
  });

  it("each section owns its own DndContext, so a drag cannot cross groups", () => {
    // One <DndContext> inside the per-section component, none at the
    // editor level spanning both lists.
    const sectionBody = src.slice(src.indexOf("function ReorderSection"));
    expect(sectionBody).toContain("<DndContext");
    expect(src.slice(0, src.indexOf("function ReorderSection"))).not.toContain(
      "<DndContext",
    );
  });
});
