import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  facts: null as unknown,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: state.facts }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/api-fetch", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));
vi.mock("@/components/outcome/outcome-toast", () => ({
  toastWrittenOutcome: vi.fn(),
}));

import { I18nProvider } from "@/lib/i18n/context";
import { auditCInstrument } from "@/lib/mental-health/audit-c";
import { AuditCPanel } from "../audit-c-panel";

function render() {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <AuditCPanel
        data={{
          latest: null,
          history: [],
          offerDue: true,
          instrument: auditCInstrument("en"),
        }}
        onChanged={() => {}}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  state.facts = null;
});

describe("the old alcohol pattern in the alcohol section", () => {
  it("lists the stored pattern with a way to remove it", () => {
    state.facts = {
      current: {
        SMOKING_STATUS: null,
        SHIFT_SCHEDULE: null,
        ALCOHOL_PATTERN: { id: "fact-1", value: "WEEKLY" },
      },
      history: [],
    };
    const html = render();
    expect(html).toContain('data-slot="audit-c-legacy-pattern"');
    expect(html).toContain("Earlier answer: Weekly");
    expect(html).toContain("audit-c-legacy-remove");
  });

  it("shows nothing when there is no stored pattern", () => {
    state.facts = {
      current: {
        SMOKING_STATUS: null,
        SHIFT_SCHEDULE: null,
        ALCOHOL_PATTERN: null,
      },
      history: [],
    };
    expect(render()).not.toContain("audit-c-legacy-pattern");
  });
});
