/**
 * A failed read is reported by what the failure means, and both read-failure
 * shapes decide it the same way from the query's error:
 *
 *  - 403: the viewer may not read this. Nothing a retry could fix; the surface
 *    draws its refused state, or nothing.
 *  - 429: the read budget is spent. A note, never a retry that would only be
 *    refused again.
 *  - 401: the session ended. Never a silent blank: the reader is offered the
 *    way back to sign-in.
 *  - anything else: a real failure, with a retry.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

import { ApiError } from "@/lib/api/api-fetch";
import { readFailureKind } from "@/lib/api/read-failure";
import { I18nProvider } from "@/lib/i18n/context";
import { QueryErrorCard } from "../query-error-card";
import { QueryErrorRow } from "../query-error-row";

function ssr(node: ReactNode) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">{node}</I18nProvider>,
  );
}

const row = (error: unknown, refused?: ReactNode) =>
  ssr(
    <QueryErrorRow
      error={error}
      refused={refused}
      message="Could not load the strip."
      onRetry={() => {}}
      slot="probe"
    />,
  );

const card = (error: unknown, refused?: ReactNode) =>
  ssr(
    <QueryErrorCard
      error={error}
      refused={refused}
      title="Could not load the list."
      description="Something on our side."
      onRetry={() => {}}
    />,
  );

describe("readFailureKind", () => {
  it("names an ended session, a refusal, a spent budget and the rest", () => {
    expect(readFailureKind(new ApiError("x", 401))).toBe("unauthenticated");
    expect(readFailureKind(new ApiError("x", 403))).toBe("refused");
    expect(readFailureKind(new ApiError("x", 429))).toBe("throttled");
    expect(readFailureKind(new ApiError("x", 500))).toBe("failed");
    expect(readFailureKind(new ApiError("x", 404))).toBe("failed");
    expect(readFailureKind(new TypeError("Failed to fetch"))).toBe("failed");
    expect(readFailureKind(null)).toBe("failed");
  });

  it("reads the code before the status", () => {
    const withCode = (status: number, errorCode: string) =>
      readFailureKind(new ApiError("x", status, { errorCode }));
    // A step-up or re-proof gate answers 401 on a session that is still good:
    // sending that reader to sign-in would end it.
    expect(withCode(401, "auth.stepup.required")).toBe("failed");
    expect(withCode(401, "auth.reproof.required")).toBe("failed");
    expect(withCode(401, "auth.mfa.code_invalid")).toBe("failed");
    expect(withCode(401, "auth.token.expired")).toBe("unauthenticated");
    expect(withCode(401, "http.unauthenticated")).toBe("unauthenticated");
    // An unknown code falls back to the status.
    expect(withCode(401, "auth.something.new")).toBe("unauthenticated");
    expect(withCode(403, "http.forbidden")).toBe("refused");
  });
});

describe.each([
  ["<QueryErrorRow>", row],
  ["<QueryErrorCard>", card],
])("%s", (_name, render) => {
  it("draws nothing for a refused read, or the surface's refused state", () => {
    expect(render(new ApiError("Forbidden", 403))).toBe("");
    expect(
      render(
        new ApiError("Forbidden", 403),
        <p data-slot="probe-refused">Not shared with you.</p>,
      ),
    ).toBe('<p data-slot="probe-refused">Not shared with you.</p>');
  });

  it("says a spent budget without offering a retry", () => {
    const html = render(new ApiError("Too many", 429));
    expect(html).toContain("There are too many requests just now");
    expect(html).not.toContain("retry");
    expect(html).not.toContain("Could not load");
    expect(html).not.toContain("Something on our side.");
  });

  it("offers sign-in for an ended session, never a blank", () => {
    const html = render(new ApiError("Unauthorized", 401));
    expect(html).not.toBe("");
    expect(html).toContain("Your session has ended");
    expect(html).toContain('data-slot="query-error-sign-in"');
    expect(html).not.toContain("retry");
  });

  it("offers a retry for a real failure", () => {
    for (const error of [
      new ApiError("Boom", 500),
      new TypeError("Failed to fetch"),
    ]) {
      const html = render(error);
      expect(html).toContain("Could not load the");
      expect(html).toMatch(/data-slot="query-error(-row)?-retry"/);
      expect(html).not.toContain("query-error-sign-in");
    }
  });
});
