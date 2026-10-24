import { resolveJobLocale } from "./job-locale";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import {
  defaultLocale,
  locales,
  localeFromLanguageTag,
  type Locale,
} from "./config";

const LOCALE_COOKIE_NAMES = ["healthlog-locale", "userLocale"] as const;

function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

function pickLocaleFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  // Accept-Language: "en-US,en;q=0.9,de;q=0.8"
  const candidates = header
    .split(",")
    .map((part) => {
      const [tag, qStr] = part.trim().split(";");
      const q = qStr?.startsWith("q=") ? Number(qStr.slice(2)) : 1;
      return {
        tag: tag.trim().toLowerCase(),
        q: Number.isFinite(q) ? q : 0,
      };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of candidates) {
    const locale = localeFromLanguageTag(tag);
    if (locale) return locale;
  }
  return null;
}

interface ResolveOptions {
  /** If a NextRequest is available, the Accept-Language header is read from it. */
  request?: NextRequest | null;
  /** The user-record locale (e.g. User.locale). */
  userLocale?: string | null;
  /** Explicit override (e.g. ?locale= query param). */
  override?: string | null;
}

/**
 * Resolve the active locale for a server-side request.
 *
 * Priority:
 *   1. Explicit override (e.g. `?locale=…` query param).
 *   2. The User.locale column, or the operator default for an account without a choice.
 *   3. healthlog-locale / userLocale cookie for guests and cached reads.
 *   4. Accept-Language header.
 *   5. defaultLocale (English).
 */
export async function resolveServerLocale(
  options: ResolveOptions = {},
): Promise<Locale> {
  if (isLocale(options.override)) return options.override;
  if (options.userLocale !== undefined)
    return resolveJobLocale(options.userLocale);

  try {
    const cookieStore = await cookies();
    for (const name of LOCALE_COOKIE_NAMES) {
      const value = cookieStore.get(name)?.value;
      if (isLocale(value)) return value;
    }
  } catch {
    // cookies() throws outside a request context — ignore.
  }

  const accept = options.request?.headers.get("accept-language") ?? null;
  const fromHeader = pickLocaleFromAcceptLanguage(accept);
  if (fromHeader) return fromHeader;

  return defaultLocale;
}
