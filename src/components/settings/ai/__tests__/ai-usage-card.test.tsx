/**
 * #1217 — the AI usage setting renders what the server resolved: three
 * options, the ones above the operator's ceiling disabled with their reason,
 * each estimate labelled as one, and nothing computed on the client.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n/context";
import type { AiUsageState } from "@/lib/ai/usage-level";

const state = vi.hoisted(() => ({
  usage: null as AiUsageState | null,
  canConfigure: true,
}));

vi.mock("@/hooks/use-ai-capability", () => ({
  useAiUsage: () => state.usage,
  useAiProviderState: () => ({
    configured: true,
    managedBy: "user",
    canConfigure: state.canConfigure,
    responseTimeoutMs: 60_000,
  }),
}));

import { AiUsageCard } from "../ai-usage-card";

function render(usage: AiUsageState | null, canConfigure = true) {
  state.usage = usage;
  state.canConfigure = canConfigure;
  const client = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="en">
        <AiUsageCard />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const CAPPED: AiUsageState = {
  level: "standard",
  preference: "full",
  defaultLevel: "standard",
  maxLevel: "standard",
  source: "admin_cap",
  options: [
    { level: "frugal", allowed: true, estimatedTokensPerDay: 48_000 },
    { level: "standard", allowed: true, estimatedTokensPerDay: 100_000 },
    { level: "full", allowed: false, estimatedTokensPerDay: 400_000 },
  ],
  measuredTokensPerDay: 100_000,
  measuredDays: 7,
};

describe("AiUsageCard", () => {
  it("renders nothing on a server that publishes no level", () => {
    expect(render(null)).toBe("");
  });

  it("checks the level in effect and disables the ones above the ceiling", () => {
    const html = render(CAPPED);
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/aria-checked="true"[^>]*data-level="standard"/);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain('data-level="full" data-allowed="false"');
    expect(html).toContain("Limited by the server operator.");
    // The capped choice is named and kept.
    expect(html).toContain('data-slot="ai-usage-capped"');
    expect(html).toContain("You chose Full");
  });

  it("shows the server's estimates, labelled, in the reader's number format", () => {
    const html = render(CAPPED);
    expect(html).toContain("about 48,000 tokens a day, estimated");
    expect(html).toContain("about 400,000 tokens a day, estimated");
    expect(html).toContain(
      "Measured: 100,000 tokens a day over the last 7 days",
    );
  });

  it("says when there is no estimate yet instead of inventing one", () => {
    const html = render({
      ...CAPPED,
      source: "default",
      preference: null,
      options: CAPPED.options.map((o) => ({
        ...o,
        estimatedTokensPerDay: null,
      })),
      measuredTokensPerDay: null,
      measuredDays: 0,
    });
    expect(html).not.toContain("tokens a day, estimated");
    expect(html).toContain("An estimate per level appears after three days");
    expect(html).toContain("You follow the server default (Standard).");
    // No stored choice: nothing to return to.
    expect(html).not.toContain('data-slot="ai-usage-use-default"');
  });

  it("follows the server's estimates, not a day threshold of its own", () => {
    // Two measured days, but the server already published estimates: the
    // card shows the measured line because the server said it may.
    const ready = render({ ...CAPPED, measuredDays: 2 });
    expect(ready).toContain(
      "Measured: 100,000 tokens a day over the last 2 days",
    );
    // Seven days, but the server withheld every estimate: no measured line.
    const withheld = render({
      ...CAPPED,
      options: CAPPED.options.map((o) => ({
        ...o,
        estimatedTokensPerDay: null,
      })),
    });
    expect(withheld).toContain(
      "An estimate per level appears after three days",
    );
  });

  it("stacks the estimate under the level on a narrow screen", () => {
    const html = render(CAPPED);
    expect(html).toMatch(
      /class="[^"]*flex-col[^"]*sm:flex-row[^"]*"[^>]*>\s*<span class="min-w-0 flex-1">/,
    );
    expect(html).toMatch(
      /data-slot="ai-usage-estimate" class="[^"]*sm:shrink-0/,
    );
    expect(html).not.toMatch(
      /data-slot="ai-usage-estimate" class="(?:(?!sm:)[^"])*\bshrink-0/,
    );
  });

  it("offers the way back to the default when a choice is stored", () => {
    const html = render({
      ...CAPPED,
      source: "user",
      preference: "frugal",
      level: "frugal",
    });
    expect(html).toContain('data-slot="ai-usage-use-default"');
    expect(html).toContain("Use the server default (Standard)");
  });

  it("locks the options where the account cannot set its own level", () => {
    const html = render(CAPPED, false);
    expect(html).toContain(
      'role="radiogroup" aria-label="AI usage" aria-disabled="true"',
    );
  });
});
