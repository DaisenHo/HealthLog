/**
 * The "end access" button of a grant sign-out-everywhere left standing.
 *
 * Its confirmation names the audit window, which rides the grant list. The
 * row used to render the button only once that list had loaded, so while it
 * loaded, and for good when the read failed, the row offered no way to end
 * the access it had just explained. Now the button is there, disabled, until
 * the list arrives, and a failed read draws the standard error row.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";
import { KeptGrantsList, type KeptGrant } from "../security-sessions-card";

const GRANTS: KeptGrant[] = [
  {
    id: "g1",
    account: { id: "a1", username: "carer", displayName: null },
    access: "WRITE",
  },
];

function render(grantList: Parameters<typeof KeptGrantsList>[0]["grantList"]) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <KeptGrantsList
        grants={GRANTS}
        grantList={grantList}
        revokeGrant={{ mutate: () => {}, isPending: false }}
        onRevoked={() => {}}
        onRevokeFailed={() => {}}
      />
    </I18nProvider>,
  );
}

function revokeButton(html: string): string {
  const at = html.indexOf('data-slot="kept-grant-revoke"');
  expect(at).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf("<button", at), html.indexOf(">", at));
}

describe("KeptGrantsList", () => {
  it("shows the button disabled while the grant list loads", () => {
    const html = render({ isError: false, error: null, refetch: () => {} });
    expect(revokeButton(html)).toMatch(/\sdisabled=""/);
    expect(html).not.toContain('data-slot="query-error-row"');
  });

  it("keeps the button and draws the error row when the read fails", () => {
    const html = render({
      isError: true,
      error: new Error("boom"),
      refetch: () => {},
    });
    expect(revokeButton(html)).toMatch(/\sdisabled=""/);
    expect(html).toContain("query-error-row");
  });

  it("enables the button once the audit window is known", () => {
    const html = render({
      data: { retentionDays: 90 },
      isError: false,
      error: null,
      refetch: () => {},
    });
    expect(revokeButton(html)).not.toMatch(/\sdisabled=""/);
  });
});
