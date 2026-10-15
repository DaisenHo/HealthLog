/**
 * "Copy support info": the person's side of the support report.
 *
 * Assembled in the browser from what the app already reads, with no route of
 * its own: `/api/version` (build), `/api/auth/me` (language, time zone, the
 * enabled modules, the AI state), `/api/integrations/status` (each
 * connection's server-resolved `health`), and the last error ids this
 * session saw. The iOS app builds the same text from the same reads.
 *
 * Never a username, an email address, a server address, a token, a recorded
 * value or a record id. The text runs through the support report's redaction
 * with the account's own username, email, name and id as known values, so a
 * field that ever starts carrying one of them is caught here too.
 */
import type { ConnectionHealth } from "@/lib/integrations/connection-health";
import { redactSupportText } from "./redact";

export interface SupportInfoInput {
  version: { version: string; buildSha: string | null } | null;
  me: {
    id: string;
    username: string;
    email: string | null;
    fullName: string | null;
    timezone: string;
    modules?: Partial<Record<string, boolean>>;
    ai?: {
      capabilities?: Record<
        string,
        { available: boolean; reason: string | null }
      >;
      provider?: { configured: boolean; managedBy: string | null };
      usage?: { level?: string | null } | null;
    } | null;
  } | null;
  locale: string;
  connections: Array<{
    integration: string;
    connected?: boolean;
    health?: ConnectionHealth | null;
  }> | null;
  recentErrorIds: readonly string[];
  client: { userAgent: string | null; standalone: boolean };
  generatedAt: string;
}

/** The support info as plain text, redacted. */
export function buildSupportInfo(input: SupportInfoInput): string {
  const lines: string[] = ["# HealthLog support info"];
  lines.push(`Generated: ${input.generatedAt}`);

  lines.push("", "## App");
  lines.push(`- Server version: ${input.version?.version ?? "unknown"}`);
  lines.push(`- Build SHA: ${input.version?.buildSha ?? "unknown"}`);
  lines.push(
    `- Client: web${input.client.standalone ? " (installed app)" : ""}`,
  );
  if (input.client.userAgent) {
    lines.push(`- Browser: ${input.client.userAgent}`);
  }

  lines.push("", "## Account");
  lines.push(`- Language: ${input.locale}`);
  lines.push(`- Time zone: ${input.me?.timezone ?? "unknown"}`);
  const modules = Object.entries(input.me?.modules ?? {})
    .filter(([, on]) => on === true)
    .map(([key]) => key)
    .sort();
  lines.push(`- Enabled modules: ${modules.join(", ") || "none"}`);

  const ai = input.me?.ai ?? null;
  lines.push("", "## AI");
  if (!ai) {
    lines.push("- State: not reported");
  } else {
    if (ai.provider) {
      lines.push(
        `- Provider configured: ${ai.provider.configured ? "yes" : "no"}${ai.provider.managedBy ? ` (${ai.provider.managedBy})` : ""}`,
      );
    }
    if (ai.usage?.level) lines.push(`- Usage level: ${ai.usage.level}`);
    for (const [key, state] of Object.entries(ai.capabilities ?? {}).sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      lines.push(
        `- ${key}: ${state.available ? "available" : `unavailable (${state.reason ?? "unknown"})`}`,
      );
    }
  }

  lines.push("", "## Connections");
  const connected = (input.connections ?? []).filter((c) => c.health);
  if (input.connections === null) {
    lines.push("- Not loaded");
  } else if (connected.length === 0) {
    lines.push("- None connected");
  }
  for (const c of connected) {
    const h = c.health!;
    lines.push(
      `- ${c.integration}: ${h.state} / ${h.reason}${h.since ? ` since ${h.since}` : ""}${h.action ? `, action ${h.action}` : ""}`,
    );
    if (h.lastSuccessAt) lines.push(`  - Last success: ${h.lastSuccessAt}`);
    if (h.lastDataAt) lines.push(`  - Newest data: ${h.lastDataAt}`);
    if (h.unavailable.length > 0) {
      lines.push(
        `  - Unavailable: ${h.unavailable.map((u) => `${u.item} (${u.cause})`).join(", ")}`,
      );
    }
    const d = h.diagnostics;
    lines.push(
      `  - Ledger: ${d.ledgerState ?? "none"}, verdict ${d.verdict}${d.failingLegs.length > 0 ? `, failing ${d.failingLegs.join(", ")}` : ""}${d.failingSince ? ` since ${d.failingSince}` : ""}`,
    );
    for (const call of d.recentCalls.slice(0, 5)) {
      lines.push(
        `  - ${call.at} ${call.endpoint}: ${call.status}${call.errorCode ? ` (${call.errorCode})` : ""}`,
      );
    }
  }

  lines.push("", "## Recent error ids (this session)");
  if (input.recentErrorIds.length === 0) lines.push("- None");
  for (const id of input.recentErrorIds) lines.push(`- ${id}`);

  const knownValues = input.me
    ? [
        input.me.id,
        input.me.username,
        input.me.email,
        input.me.fullName,
      ].filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  // The error ids are this session's own request ids, which the person is
  // meant to hand over; they are put back after the id-shaped scrub.
  const placeholders = input.recentErrorIds.map((_, i) => `@@ERRORID${i}@@`);
  let text = `${lines.join("\n")}\n`;
  input.recentErrorIds.forEach((id, i) => {
    text = text.split(`- ${id}\n`).join(`- ${placeholders[i]}\n`);
  });
  text = redactSupportText(text, { knownValues });
  input.recentErrorIds.forEach((id, i) => {
    text = text.split(placeholders[i]).join(id);
  });
  return text;
}
