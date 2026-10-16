/**
 * `GET /api/admin/support-report` — a redacted plain-text report an operator
 * can paste into an issue: build, database, configuration as yes/no, jobs,
 * connections by health state, AI ledger and usage levels, notifications,
 * backups and the most frequent recent error actions. Never an email address,
 * a user id, a value, a token or a foreign host name; accounts appear as
 * "Account 1..n". Admin only, cookie session only.
 *
 * What goes in and how it is redacted lives in `src/lib/support/report.ts`;
 * the redaction guard is `src/lib/support/__tests__/support-report-redaction.test.ts`.
 */
import { apiHandler, requireAdmin } from "@/lib/api-handler";
import { apiSuccess } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import {
  buildSupportReportText,
  collectSupportReportFacts,
} from "@/lib/support/report";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  await requireAdmin();
  annotate({ action: { name: "admin.support_report.get" } });

  const { facts, context } = await collectSupportReportFacts();
  const text = buildSupportReportText(facts, context);

  annotate({
    meta: {
      support_report_accounts: facts.accounts.total,
      support_report_bytes: text.length,
    },
  });
  return apiSuccess({ generatedAt: facts.generatedAt, text });
});
