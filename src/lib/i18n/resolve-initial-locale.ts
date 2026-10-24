import { headers, cookies } from "next/headers";
import { parseLocaleFromAcceptLanguage } from "@/lib/format-locale";
import { locales, type Locale } from "@/lib/i18n/config";
import { LOCALE_COOKIE } from "@/lib/i18n/locale-cookie";
import { getSessionUserLocale } from "@/lib/auth/session";

/** Account preference first; guests and failed session reads use the cache, then browser language. */
export async function resolveInitialLocale(): Promise<Locale> {
  try {
    const cookieStore = await cookies();
    try {
      const userLocale = await getSessionUserLocale();
      if (userLocale && (locales as readonly string[]).includes(userLocale)) {
        return userLocale as Locale;
      }
    } catch {
      // Offline/server failures can still use the browser's cached language.
    }
    const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
    if (cookieLocale && (locales as readonly string[]).includes(cookieLocale)) {
      return cookieLocale as Locale;
    }

    const headerList = await headers();
    return parseLocaleFromAcceptLanguage(headerList.get("accept-language"));
  } catch {
    return "en";
  }
}
