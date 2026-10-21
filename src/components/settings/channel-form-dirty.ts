/**
 * Whether a notification channel card's form differs from what is saved.
 *
 * The Test button on these cards always sends through the saved channel
 * config, never the form. While the form holds an unsaved change, a test
 * would report on something other than what is on screen, and a "Saved"
 * note left over from an earlier save would say the opposite of the truth.
 * A secret field (header value, auth token, bot token) is write-only: the
 * server never returns it, so any typed value counts as a change.
 *
 * The enable switch is a field of the same form: it saves with the one Save
 * button like every other field, so a flipped switch is a change too.
 */

function enabledChanged(
  form: { enabled: boolean },
  saved: { enabled?: boolean },
): boolean {
  return form.enabled !== (saved.enabled ?? false);
}

export function isWebhookFormDirty(
  form: {
    url: string;
    headerName: string;
    headerValue: string;
    format: "generic" | "gotify";
    enabled: boolean;
  },
  saved:
    | { url: string; headerName: string; format?: string; enabled?: boolean }
    | undefined,
): boolean {
  if (!saved) return false;
  const savedFormat = saved.format === "gotify" ? "gotify" : "generic";
  return (
    form.url !== saved.url ||
    form.headerName !== saved.headerName ||
    form.headerValue !== "" ||
    form.format !== savedFormat ||
    enabledChanged(form, saved)
  );
}

export function isNtfyFormDirty(
  form: {
    serverUrl: string;
    topic: string;
    authToken: string;
    enabled: boolean;
  },
  saved: { serverUrl: string; topic: string; enabled?: boolean } | undefined,
): boolean {
  if (!saved) return false;
  return (
    form.serverUrl !== saved.serverUrl ||
    form.topic !== saved.topic ||
    form.authToken !== "" ||
    enabledChanged(form, saved)
  );
}

export function isEmailFormDirty(
  form: { recipient: string; enabled: boolean },
  saved: { recipient: string; enabled?: boolean } | undefined,
): boolean {
  if (!saved) return false;
  return form.recipient !== saved.recipient || enabledChanged(form, saved);
}

export function isTelegramFormDirty(
  form: { botToken: string; chatId: string; enabled: boolean },
  saved: { chatId?: string | null; enabled?: boolean } | undefined,
): boolean {
  if (!saved) return false;
  return (
    form.botToken.trim() !== "" ||
    form.chatId !== (saved.chatId ?? "") ||
    enabledChanged(form, saved)
  );
}
