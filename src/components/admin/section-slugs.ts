/**
 * Server-safe constants for the v1.5 admin split. Mirrors the pattern in
 * `src/components/settings/section-slugs.ts` so server-rendered code paths
 * (`generateStaticParams()`, the page guard, route-existence tests) can
 * import the slug list without dragging the `<AdminShell>` client bundle
 * into the server graph.
 *
 * Order is the in-app navigation order — sidebar nav, mobile strip, and
 * `generateStaticParams()` all consume it directly.
 */

export const ADMIN_SECTION_SLUGS = [
  "system-status",
  "general",
  "services",
  "integrations",
  // v1.18.1 — the former `ai-quality`, `assistant`, and `coach-feedback`
  // sections collapse into one "Coach" area. It holds the assistant
  // surface toggles, the server-key operator config, and both
  // feedback-quality tables (Coach + Insights). Three navigation entries
  // for one coherent coach-quality concern read as clutter; one card opens
  // the full picture.
  "coach",
  // v1.18.6 — server-wide module availability is its own section now
  // (was stacked under Coach). It gates every module, not just the coach,
  // so it reads better next to Coach than buried inside it.
  "module-availability",
  "reminders",
  "users",
  // v1.16.0 — registration invites get their own section. They started
  // as a card inside Users, but the invite table (status, redemptions,
  // revocation) is a workflow of its own and was drowning under the
  // account list; "who may join" sits right next to "who is here".
  "invites",
  "api-tokens",
  "login-overview",
  "app-logs",
  "backups",
  // v1.23 — encryption coverage + key-rotation status / safe trigger. Sits
  // next to Backups (both are data-at-rest concerns) and just before the
  // danger zone.
  "encryption",
  "danger-zone",
  // v1.4.36 — About / version / update check folded into Admin
  // Console. Lives at /admin/about; the legacy /settings/about route
  // is unlinked from the user-card dropdown.
  "about",
] as const;

export type AdminSectionSlug = (typeof ADMIN_SECTION_SLUGS)[number];

export function isAdminSectionSlug(value: string): value is AdminSectionSlug {
  return (ADMIN_SECTION_SLUGS as readonly string[]).includes(value);
}
