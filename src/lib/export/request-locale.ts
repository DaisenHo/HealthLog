import type { NextRequest } from "next/server";
import { parseLocaleFromAcceptLanguage } from "@/lib/format-locale";
import { locales, type Locale } from "@/lib/i18n/config";

function shipped(value: string | null | undefined): Locale | null {
  return (locales as readonly string[]).includes(value ?? "")
    ? (value as Locale)
    : null;
}

/** Explicit export choice, requesting account, then legacy request hints. */
export function resolveExportLocale(
  explicit: Locale | undefined,
  account: string | null | undefined,
  request: NextRequest,
): Locale {
  return (
    explicit ??
    shipped(account) ??
    shipped(request.cookies.get("healthlog-locale")?.value) ??
    parseLocaleFromAcceptLanguage(request.headers.get("accept-language") ?? "")
  );
}
