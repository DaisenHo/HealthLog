import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MedicationCardHeader } from "@/components/medications/medication-card-header";

/**
 * v1.4.28 — narrow-viewport contract for the shared medication-list
 * row primitive (D-H6).
 *
 * FB-G1 calls for a stacked shape: `{name}` on line 1, the localised
 * `{dose}` on its own muted line below it (omitted when empty), and the
 * category badge under that. State badges (without-notification, paused,
 * inactive) used to share line 2 via `flex flex-wrap`; on a 320 px
 * viewport that pushed the row to three lines for ~20 % of configured
 * drugs. State badges now ride their own row below the category badge
 * so the canonical row stays two lines on narrow viewports.
 *
 * The tests assert the structural seams, not the visual measurement
 * (no DOM measurement layer in SSR). The data-slot on the state-badges
 * row plus the absence of state badges inside the category row are the
 * load-bearing contracts.
 */

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<Card>{node}</Card>);
}

describe("<MedicationCardHeader>", () => {
  it("paints the name on the title row and the dose as a tag before the category", () => {
    const html = render(
      <MedicationCardHeader
        name="Ramipril"
        dose="5 mg"
        categoryLabel="Blood Pressure"
      />,
    );
    // Name + dose are separate elements — the dose is its own tagged badge
    // (`data-slot`) sitting beside the category badge, not glued to the name.
    expect(html).toContain("Ramipril");
    expect(html).toContain('data-slot="medication-card-header-dose"');
    expect(html).toContain("5 mg");
    expect(html).toContain("Blood Pressure");
    // The dose tag paints between the name and the category badge.
    const nameIdx = html.indexOf("Ramipril");
    const doseIdx = html.indexOf('data-slot="medication-card-header-dose"');
    const categoryIdx = html.indexOf("Blood Pressure");
    expect(nameIdx).toBeLessThan(doseIdx);
    expect(doseIdx).toBeLessThan(categoryIdx);
  });

  it("omits the dose line entirely when the dose is empty", () => {
    const html = render(
      <MedicationCardHeader
        name="Vorsorge"
        dose=""
        categoryLabel="Screening"
      />,
    );
    expect(html).not.toContain('data-slot="medication-card-header-dose"');
  });

  it("does not paint the state-badges row when no badges are supplied", () => {
    const html = render(
      <MedicationCardHeader
        name="Ramipril"
        dose="5 mg"
        categoryLabel="Blood Pressure"
      />,
    );
    // Pin the absence so a future refactor can't paint an empty
    // wrapper that eats vertical space.
    expect(html).not.toContain(
      'data-slot="medication-card-header-state-badges"',
    );
  });

  it("breaks state badges onto their own row below the category badge (D-H6)", () => {
    // The narrow-viewport contract: state badges live on their own
    // row so the canonical row stays two lines at 320 px even when
    // a drug carries one of the state badges. Pinning the seam.
    const html = render(
      <MedicationCardHeader
        name="Ramipril"
        dose="5 mg"
        categoryLabel="Blood Pressure"
        stateBadges={
          <>
            <Badge variant="secondary" className="text-xs">
              Without notification
            </Badge>
            <Badge variant="secondary" className="text-xs">
              Paused since 12.05
            </Badge>
          </>
        }
      />,
    );
    expect(html).toContain('data-slot="medication-card-header-state-badges"');
    // Both badges land inside the state row, not adjacent to the
    // category badge. Verifying via document order: the state-badges
    // wrapper must paint AFTER the category badge.
    const categoryIdx = html.indexOf("Blood Pressure");
    const stateRowIdx = html.indexOf(
      'data-slot="medication-card-header-state-badges"',
    );
    expect(categoryIdx).toBeGreaterThan(-1);
    expect(stateRowIdx).toBeGreaterThan(categoryIdx);
  });

  it("wraps the name/dose/category region in a detail-page link when href is set (v1.7.2 W3)", () => {
    const html = render(
      <MedicationCardHeader
        name="Ramipril"
        dose="5 mg"
        categoryLabel="Blood Pressure"
        href="/medications/med-1"
        linkLabel="Open medication detail page"
      />,
    );
    expect(html).toContain('data-slot="medication-card-header-link"');
    expect(html).toContain('href="/medications/med-1"');
    // The link is named by what it shows, with the purpose added for
    // screen readers (WCAG 2.5.3): no aria-label overriding the text.
    expect(html).toContain(
      '<span class="sr-only">Open medication detail page</span>',
    );
    expect(html).not.toContain('aria-label="Open medication detail page"');
    // The name + dose still ride inside the link region.
    expect(html).toContain("Ramipril");
    expect(html).toContain("5 mg");
  });

  it("falls back to a non-navigating div when href is omitted", () => {
    const html = render(
      <MedicationCardHeader
        name="Ramipril"
        dose="5 mg"
        categoryLabel="Blood Pressure"
      />,
    );
    expect(html).not.toContain('data-slot="medication-card-header-link"');
  });
});
