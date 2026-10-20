import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/context";

vi.mock("@/hooks/use-record-capabilities", () => ({
  useRecordCapabilities: () => ({ canManageDomain: () => true }),
}));

import { BiomarkerAliases } from "../biomarker-aliases";
import { BiomarkerMergeSheet } from "../biomarker-merge-sheet";
import type { BiomarkerDto } from "../types";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

primeLocales("de");

vi.mock("@/components/ui/responsive-sheet", () => ({
  ResponsiveSheet: ({
    children,
    title,
    footer,
  }: {
    children: React.ReactNode;
    title: string;
    footer?: React.ReactNode;
  }) => (
    <div>
      <h2>{title}</h2>
      {children}
      {footer}
    </div>
  ),
}));

function wrap(node: React.ReactNode, locale: "en" | "de" = "en") {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider initialLocale={locale}>{node}</I18nProvider>
    </QueryClientProvider>,
  );
}

const marker = (overrides: Partial<BiomarkerDto>): BiomarkerDto => ({
  id: "bm-1",
  name: "Alkaline Phosphatase",
  unit: "U/L",
  lowerBound: null,
  upperBound: null,
  panel: null,
  analyteKey: null,
  hasContext: false,
  context: null,
  hidden: false,
  aliases: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("<BiomarkerAliases>", () => {
  it("shows the other spellings as chips, removable for a manager", () => {
    const html = wrap(
      <BiomarkerAliases
        marker={marker({ aliases: ["Alk.P", "AP"] })}
        canEdit
      />,
    );
    expect(html).toContain("Also written as");
    expect(html).toContain("Alk.P");
    expect(html).toContain('aria-label="Remove AP"');
    expect(html).toContain("Another name for this biomarker");
  });

  it("is read-only without the manage right, and absent when there is nothing to show", () => {
    const readOnly = wrap(
      <BiomarkerAliases
        marker={marker({ aliases: ["Alk.P"] })}
        canEdit={false}
      />,
    );
    expect(readOnly).toContain("Alk.P");
    expect(readOnly).not.toContain("Remove Alk.P");
    expect(readOnly).not.toContain("<form");
    expect(wrap(<BiomarkerAliases marker={marker({})} canEdit={false} />)).toBe(
      "",
    );
  });

  it("speaks German too", () => {
    expect(
      wrap(<BiomarkerAliases marker={marker({})} canEdit />, "de"),
    ).toContain("Auch geschrieben als");
  });
});

describe("<BiomarkerMergeSheet>", () => {
  it("opens on the pick step with every marker and no preview yet", () => {
    const html = wrap(
      <BiomarkerMergeSheet
        open
        onOpenChange={() => {}}
        markers={[
          marker({ id: "a", name: "Alkaline Phosphatase" }),
          marker({ id: "b", name: "Alk.P" }),
        ]}
      />,
    );
    expect(html).toContain("Merge biomarkers");
    expect(html).toContain('data-slot="biomarker-merge-select"');
    expect(html).toContain("Alk.P");
    expect(html).toContain("Select at least two biomarkers.");
    // The preview button waits for a selection.
    expect(html).toMatch(
      /<button[^>]*data-slot="biomarker-merge-preview"[^>]*disabled=""/,
    );
    expect(html).not.toContain('data-slot="biomarker-merge-confirm"');
  });
});
