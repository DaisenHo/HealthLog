/**
 * `GET /api/admin/support-report` — a redacted plain-text report an operator
 * can paste into an issue: build, database, configuration as yes/no, jobs,
 * connections by health state, AI ledger and usage levels, notifications,
 * backups and the most frequent recent error actions. Never an email address,
 * a user id, a value, a token or a foreign host name; accounts appear as
 * "Account 1..n". Admin only, cookie session only.
 */
import { apiHandler, requireAdmin } from "@/lib/api-handler";
import { notImplemented } from "@/lib/http/not-implemented";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  await requireAdmin();
  return notImplemented("admin.support_report.get");
});
