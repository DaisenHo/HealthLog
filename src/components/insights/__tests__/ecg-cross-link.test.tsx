import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";

/**
 * `<EcgCrossLink>` unit tests.
 *
 * The load-bearing behaviour under test:
 *   - data-availability gating: the pointer un-mounts entirely when the user
 *     has no ECG recordings;
 *   - the NON-DIAGNOSTIC framing: it surfaces only that recordings exist and
 *     the RECORDING DEVICE's own latest result, attributed to the device — no
 *     HealthLog interpretation, no waveform.
 *
 * `useAuth` + TanStack Query are mocked and assertions run through SSR, exactly
 * like the sibling `ecg-section` test.
 */

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true, user: null })),
}));

const useQueryMock = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => useQueryMock(opts),
}));

const { EcgCrossLink } = await import("../ecg-cross-link");

interface Item {
  id: string;
  classification: "IRREGULAR" | "NOT_DETECTED" | "INCONCLUSIVE" | null;
}

function render(
  data: { recordings: Item[]; hasRecordings: boolean } | undefined,
) {
  useQueryMock.mockReturnValue({
    data: data ? { data, cap: null } : undefined,
  });
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <EcgCrossLink />
    </I18nProvider>,
  );
}

describe("<EcgCrossLink>", () => {
  it("renders nothing before the payload resolves", () => {
    expect(render(undefined)).toBe("");
  });

  it("renders nothing when the user has no recordings (gate)", () => {
    expect(render({ recordings: [], hasRecordings: false })).toBe("");
  });

  it("links into the ECG viewer and attributes the latest result to the device", () => {
    const html = render({
      recordings: [
        { id: "a", classification: "IRREGULAR" },
        { id: "b", classification: "NOT_DETECTED" },
      ],
      hasRecordings: true,
    });
    expect(html).toContain('data-slot="ecg-cross-link"');
    expect(html).toContain('href="/insights/ecg"');
    expect(html).toContain("2 recordings on file.");
    // The latest (first) recording's DEVICE result, attributed to the device.
    expect(html).toContain("Latest device result:");
    // Never a HealthLog interpretation.
    expect(html).not.toMatch(/we (detected|found)|our (reading|analysis)/i);
  });

  it("omits the result line when the latest recording has no device verdict", () => {
    const html = render({
      recordings: [{ id: "a", classification: null }],
      hasRecordings: true,
    });
    expect(html).toContain("1 recording on file.");
    expect(html).not.toContain("Latest device result:");
  });
});
