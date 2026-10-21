import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The emergency card's Save stayed enabled on an untouched, stored profile
// while every other Save on the medical-history page waits for a change.
// It now follows them: nothing edited, nothing to save.

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      bloodType: "A_POS",
      organDonor: null,
      advanceDirective: null,
      contacts: "A contact",
      implants: null,
      note: null,
      updatedAt: "2026-07-28T10:00:00.000Z",
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/api-fetch", () => ({ apiGet: vi.fn(), apiPatch: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { I18nProvider } from "@/lib/i18n/context";
import {
  emergencyProfileUpdateSchema,
  type EmergencyProfileDto,
} from "@/lib/validations/emergency-profile";
import {
  EmergencyProfileManager,
  emergencyPatchBody,
} from "../emergency-profile-manager";

describe("<EmergencyProfileManager> Save", () => {
  it("stays disabled until a field differs from the stored profile", () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <EmergencyProfileManager />
      </I18nProvider>,
    );
    const row = html.slice(html.indexOf('data-slot="settings-card-actions"'));
    expect(row).toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Save<\/button>/);
  });
});

describe("emergency selects can be taken back to not recorded", () => {
  // A blood type, donor status or directive, once chosen, could be changed
  // to another value but never cleared: the select offered no empty option,
  // and the save left out an empty select, so even a cleared draft would not
  // have reached the column.
  const stored: EmergencyProfileDto = {
    bloodType: "A_POS",
    organDonor: "YES",
    advanceDirective: null,
    contacts: "A contact",
    contactsUnreadable: false,
    implants: null,
    implantsUnreadable: false,
    note: null,
    noteUnreadable: false,
  };
  const draft = {
    bloodType: "A_POS",
    organDonor: "YES",
    advanceDirective: "",
    contacts: "A contact",
    implants: "",
    note: "",
  };

  it("sends a cleared select as null, which clears the column", () => {
    expect(
      emergencyPatchBody({ ...draft, bloodType: "" }, stored),
    ).toMatchObject({ bloodType: null });
  });

  it("leaves an untouched select out of the save", () => {
    const body = emergencyPatchBody(draft, stored);
    expect(body).not.toHaveProperty("bloodType");
    expect(body).not.toHaveProperty("organDonor");
    expect(body).not.toHaveProperty("advanceDirective");
  });

  it("sends a changed select's new value", () => {
    expect(
      emergencyPatchBody({ ...draft, advanceDirective: "YES" }, stored),
    ).toMatchObject({ advanceDirective: "YES" });
  });

  it("the server accepts what the card sends", () => {
    const body = emergencyPatchBody(
      { ...draft, bloodType: "", organDonor: "NO" },
      stored,
    );
    const parsed = emergencyProfileUpdateSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ bloodType: null, organDonor: "NO" });
  });

  it("offers a not-recorded option in every select", () => {
    // The options live in the popover, which a static render never opens;
    // read from the source that each select carries the option.
    const source = readFileSync(
      resolve(__dirname, "../emergency-profile-manager.tsx"),
      "utf8",
    );
    expect(source).toMatch(
      /<SelectItem value=\{NOT_RECORDED\}>\s*\{t\("records\.emergency\.notRecorded"\)\}/,
    );
    expect(source).toMatch(/next === NOT_RECORDED \? "" : next/);
  });
});
