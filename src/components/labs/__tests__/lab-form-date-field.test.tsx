import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n/context";

/**
 * #1214 — the lab form's draw date is the same full-width, typeable date
 * field as the measurement form's timestamp.
 *
 * It already was the same component (`DateTimeField`), but it sat in the
 * second column of a two-column grid, and `DateTimeField` puts its date and
 * time halves side by side from `sm:` up, so the date half was squeezed until
 * a date could only be set through the calendar. SSR markup (the suite's
 * dialect) pins the layout: no two-column grid in the form, the date field is
 * the shared primitive, and its date half is an editable text input, not a
 * read-only picker trigger.
 */

vi.mock("@/lib/api/api-fetch", () => ({
  apiGet: () => new Promise(() => {}),
  apiPost: vi.fn(),
}));

import { LabForm } from "../lab-form";

function render(): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale="en">
        <LabForm />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("<LabForm> draw date", () => {
  it("does not halve the date field's width with a second column", () => {
    expect(render()).not.toMatch(/grid-cols-2/);
  });

  it("uses the shared date-time field with a typeable date half", () => {
    const html = render();
    expect(html).toContain('data-slot="date-time-field"');
    // The id sits on the date half's hidden mirror; the input a person
    // types into is the overlay right after it.
    const field = html.slice(html.indexOf('id="lab-takenAt"'));
    const overlay = /<input(?![^>]*type="hidden")[^>]*>/.exec(field)?.[0];
    expect(overlay).toBeDefined();
    expect(overlay).toContain('type="text"');
    expect(overlay).not.toMatch(/\s(readonly|disabled)(=|\s|\/?>)/i);
  });
});
