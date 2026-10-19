/**
 * A supplementary read that fails is reported by what the failure means.
 *
 * Several strips and tiles answer a failed read with a retry row. Two
 * failures are not worth one: a refusal (a read-only share reaching a
 * manage-level read, a grant without the section) cannot be retried into
 * success and must draw nothing, and a spent read budget would only be
 * refused again by an immediate retry.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ApiError } from "@/lib/api/api-fetch";
import { I18nProvider } from "@/lib/i18n/context";
import { ReadFailureRow, readFailureKind } from "../read-failure-row";

function ssr(error: unknown) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <ReadFailureRow
        error={error}
        message="Could not load the strip."
        onRetry={() => {}}
        slot="probe"
      />
    </I18nProvider>,
  );
}

describe("readFailureKind", () => {
  it("names refusals, a spent budget and everything else", () => {
    expect(readFailureKind(new ApiError("x", 401))).toBe("denied");
    expect(readFailureKind(new ApiError("x", 403))).toBe("denied");
    expect(readFailureKind(new ApiError("x", 429))).toBe("throttled");
    expect(readFailureKind(new ApiError("x", 500))).toBe("failed");
    expect(readFailureKind(new ApiError("x", 404))).toBe("failed");
    expect(readFailureKind(new TypeError("Failed to fetch"))).toBe("failed");
  });
});

describe("<ReadFailureRow>", () => {
  it("draws nothing for a refused read", () => {
    expect(ssr(new ApiError("Forbidden", 403))).toBe("");
    expect(ssr(new ApiError("Unauthorized", 401))).toBe("");
  });

  it("says a spent budget without offering a retry", () => {
    const html = ssr(new ApiError("Too many", 429));
    expect(html).toContain('data-slot="probe"');
    expect(html).toContain("Too many requests just now.");
    expect(html).not.toContain("query-error-row-retry");
  });

  it("offers a retry for a real failure", () => {
    const html = ssr(new ApiError("Boom", 500));
    expect(html).toContain("Could not load the strip.");
    expect(html).toContain('data-slot="query-error-row-retry"');
    expect(ssr(new TypeError("Failed to fetch"))).toContain(
      'data-slot="query-error-row-retry"',
    );
  });
});
