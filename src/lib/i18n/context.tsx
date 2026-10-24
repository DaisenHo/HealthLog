"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { apiFetchRaw } from "@/lib/api/api-fetch";
import {
  locales,
  defaultLocale,
  isLocale,
  localeFromLanguageTag,
  type Locale,
} from "./config";
import {
  makeFormatters,
  type Formatters,
  type TimeFormatPreference,
  type DateFormatPreference,
} from "../format-locale";
import { readStoredTimeFormat, subscribeTimeFormat } from "../time-format";
import { readStoredDateFormat, subscribeDateFormat } from "../date-format";
import { readStoredTimezone, subscribeTimezone } from "../timezone-mirror";
import { resolveKey } from "./resolve-key";
import { pluralKey } from "./plural";
import {
  getCachedMessages,
  getFallbackMessages,
  loadMessages,
  primeMessages,
  type MessageBundle,
} from "./load-locale";
import { DEFAULT_TIMEZONE } from "@/lib/tz/format";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => Promise<boolean>;
  /**
   * Non-null while a locale switch loads its bundle and saves the account
   * preference. The switcher uses it for a short pending state;
   * `locale` / `t` only flip once the bundle is in so the UI never
   * renders the new locale with the old (or fallback) strings.
   */
  pendingLocale: Locale | null;
  localeErrorKey: string | null;
  t: (key: string, params?: Record<string, string | number>) => string;
  /**
   * Plural-aware `t`. Resolves `<baseKey><One|Few|Other>` under the active
   * locale's CLDR rules and passes `count` through as a parameter.
   *
   * Lives on the context rather than as a standalone helper each component
   * imports: `pluralTier` is tiny, but a new module edge from a
   * widely-instantiated component (the dashboard trend tile) gets duplicated
   * into every chunk that contains it, which measured ~78 KB gz across the
   * route chunks. The provider is already in every chunk, so routing through
   * it is free.
   */
  tCount: (
    baseKey: string,
    count: number,
    params?: Record<string, string | number>,
  ) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function detectSystemLocale(): Locale {
  if (typeof window === "undefined") return defaultLocale;
  return localeFromLanguageTag(navigator.language) ?? defaultLocale;
}

function readLocaleCookie(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)healthlog-locale=([^;]+)/);
  const value = match?.[1];
  if (value && (locales as readonly string[]).includes(value)) {
    return value as Locale;
  }
  return null;
}

function getSavedLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  // Cookie wins over localStorage: the root layout already rendered the
  // server HTML using the cookie, so matching the cookie on first client
  // render avoids a hydration flash of the wrong language.
  const fromCookie = readLocaleCookie();
  if (fromCookie) return fromCookie;
  try {
    const saved = localStorage.getItem("healthlog-locale");
    if (isLocale(saved)) return saved;
  } catch {
    // Storage can be unavailable in private browsing.
  }
  return null;
}

// Persist a locale choice everywhere the next render / request reads
// it: localStorage (client preference), cookie (SSR handoff — layout +
// metadata render in the user's language), <html lang>. Called ONLY
// alongside the `setActive` flip so a failed bundle load never leaves
// the persisted locale pointing at strings the UI isn't showing.
function persistLocale(newLocale: Locale) {
  try {
    localStorage.setItem("healthlog-locale", newLocale);
  } catch {
    // The server preference and cookie still preserve the choice.
  }
  // 1-year expiry, Lax samesite, not HttpOnly so the client continues
  // to own it.
  document.cookie = `healthlog-locale=${newLocale}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  document.documentElement.lang = newLocale;
}

export function I18nProvider({
  children,
  initialLocale,
  initialMessages,
}: {
  children: ReactNode;
  initialLocale?: Locale;
  /**
   * Optional pre-resolved bundle for standalone mounts (tests, embedded
   * providers). The APP no longer passes this: the active bundle reaches
   * the provider through the `load-locale` cache — seeded server-side from
   * the full catalog map during SSR and client-side by the layout's
   * versioned `/i18n/<locale>` boot script — so the catalog is never
   * serialized into the RSC flight payload (it used to be 392 KB of every
   * dashboard document).
   */
  initialMessages?: MessageBundle;
}) {
  const [active, setActive] = useState<{
    locale: Locale;
    messages: MessageBundle;
  }>(() => {
    const locale =
      initialLocale && (locales as readonly string[]).includes(initialLocale)
        ? initialLocale
        : (getSavedLocale() ?? detectSystemLocale());
    if (initialMessages && locale === initialLocale) {
      primeMessages(locale, initialMessages);
      return { locale, messages: initialMessages };
    }
    return {
      locale,
      messages: getCachedMessages(locale) ?? getFallbackMessages() ?? {},
    };
  });
  const { locale, messages } = active;
  const pathname = usePathname();
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const [localeErrorKey, setLocaleErrorKey] = useState<string | null>(null);
  const localeGeneration = useRef(0);
  const [, setFallbackTick] = useState(0);
  const fallbackRequestedRef = useRef(false);
  const requestedLocaleRef = useRef<Locale | null>(null);
  useEffect(() => {
    if (getCachedMessages(locale)) return;
    let cancelled = false;
    void loadMessages(locale).then((loaded) => {
      if (cancelled) return;
      setActive((prev) =>
        prev.locale === locale ? { locale, messages: loaded } : prev,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    const controller = new AbortController();
    async function syncAccountLocale() {
      if (!navigator.onLine || requestedLocaleRef.current !== null) return;
      const generation = ++localeGeneration.current;
      try {
        const response = await apiFetchRaw("/api/auth/me/locale", {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body: { data?: { locale?: unknown } } = await response.json();
        const next = body.data?.locale;
        if (!isLocale(next)) return;
        const loaded = await loadMessages(next);
        if (
          controller.signal.aborted ||
          generation !== localeGeneration.current
        )
          return;
        persistLocale(next);
        setActive((prev) =>
          prev.locale === next ? prev : { locale: next, messages: loaded },
        );
      } catch {}
    }
    void syncAccountLocale();
    window.addEventListener("focus", syncAccountLocale);
    window.addEventListener("online", syncAccountLocale);
    return () => {
      controller.abort();
      window.removeEventListener("focus", syncAccountLocale);
      window.removeEventListener("online", syncAccountLocale);
    };
  }, [pathname]);

  const setLocale = useCallback(
    async (newLocale: Locale): Promise<boolean> => {
      if (!isLocale(newLocale)) return false;
      const generation = ++localeGeneration.current;
      setLocaleErrorKey(null);
      if (!navigator.onLine) {
        setLocaleErrorKey("settings.languageOffline");
        return false;
      }
      requestedLocaleRef.current = newLocale;
      setPendingLocale(newLocale);
      try {
        const loaded = await loadMessages(newLocale);
        const response = await apiFetchRaw("/api/auth/me/locale", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: newLocale }),
          credentials: "same-origin",
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) {
          const saved: { data?: { locale?: unknown } } = await response.json();
          if (saved.data?.locale !== newLocale)
            throw new Error("Locale save failed");
        } else if (response.status !== 401 || !pathname?.startsWith("/auth/")) {
          throw new Error("Locale save failed");
        }
        if (generation !== localeGeneration.current) return false;
        persistLocale(newLocale);
        setActive({ locale: newLocale, messages: loaded });
        return true;
      } catch {
        if (generation === localeGeneration.current) {
          setLocaleErrorKey("settings.languageSaveFailed");
        }
        return false;
      } finally {
        if (generation === localeGeneration.current) {
          requestedLocaleRef.current = null;
          setPendingLocale(null);
        }
      }
    },
    [pathname],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
    document.cookie = `healthlog-locale=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  }, [locale]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      let value = resolveKey(messages, key);
      if (value === undefined && locale !== "en") {
        const fallback = getFallbackMessages();
        if (fallback) {
          value = resolveKey(fallback, key);
        } else if (!fallbackRequestedRef.current) {
          fallbackRequestedRef.current = true;
          void loadMessages("en")
            .then(() => setFallbackTick((n) => n + 1))
            .catch(() => {});
        }
      }
      if (value === undefined) {
        return key;
      }
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          value = value.replace(new RegExp(`\\{${k}\\}`, "g"), () => String(v));
        }
      }

      return value;
    },
    [locale, messages],
  );

  const tCount = useCallback(
    (
      baseKey: string,
      count: number,
      params?: Record<string, string | number>,
    ): string => t(pluralKey(baseKey, count, locale), { count, ...params }),
    [t, locale],
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      pendingLocale,
      localeErrorKey,
      t,
      tCount,
    }),
    [locale, setLocale, pendingLocale, localeErrorKey, t, tCount],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslations() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useTranslations must be used within I18nProvider");
  }
  return context;
}

/**
 * The user's hour-cycle preference (AUTO / H12 / H24), reactive to changes.
 * Backed by the localStorage mirror that `useAuth`'s `/api/auth/me` fetch
 * and the profile time-format select keep in sync with the server value —
 * no QueryClient required in the tree. SSR resolves AUTO.
 */
export function useTimeFormatPreference(): TimeFormatPreference {
  return useSyncExternalStore(
    subscribeTimeFormat,
    readStoredTimeFormat,
    () => "AUTO" as const,
  );
}

/**
 * The user's date-order preference (AUTO / DMY / MDY / YMD), reactive to
 * changes. Backed by the same localStorage-mirror pattern as the hour-cycle
 * preference — `useAuth`'s `/api/auth/me` fetch and the profile date-format
 * select keep it in sync with the server value, no QueryClient required.
 * SSR resolves AUTO.
 */
export function useDateFormatPreference(): DateFormatPreference {
  return useSyncExternalStore(
    subscribeDateFormat,
    readStoredDateFormat,
    () => "AUTO" as const,
  );
}

/**
 * The user's mirrored profile timezone, resolved to a renderable IANA zone:
 * valid mirror value → `DEFAULT_TIMEZONE` (Europe/Berlin). Reactive to
 * mirror changes (profile save, cross-tab, `/api/auth/me` re-fetch) via the
 * same localStorage-mirror pattern as the hour-cycle preference. SSR and the
 * pre-fetch state resolve Berlin — deliberately NO browser-timezone rung
 * (issue #490): the chain must match the server's `resolveUserTimezone`
 * fallback so on-screen times agree with the PDF / exports.
 *
 * Use this wherever a day-boundary or weekday must be derived in the SAME
 * zone `useFormatters()` renders clocks in (e.g. `formatUpdatedLabel`).
 */
export function useDisplayTimezone(): string {
  const stored = useSyncExternalStore(
    subscribeTimezone,
    readStoredTimezone,
    () => "",
  );
  return stored !== "" ? stored : DEFAULT_TIMEZONE;
}

/**
 * Locale-aware formatters tied to the active UI locale. Use for every number,
 * date, and time rendered in the UI so regional conventions (70,5 vs 70.5,
 * 19.02.2026 vs Feb 19, 2026) follow the user's language choice. Times honour
 * the per-user hour-cycle preference (AUTO follows the locale, H12 / H24 pin
 * the cycle) and render in the user's profile timezone (issue #490 — the
 * localStorage mirror `fetchMe` keeps in sync; "" falls back to Berlin
 * inside `makeFormatters`).
 */
export function useFormatters(): Formatters {
  const { locale } = useTranslations();
  const timeFormat = useTimeFormatPreference();
  const dateFormat = useDateFormatPreference();
  const timezone = useSyncExternalStore(
    subscribeTimezone,
    readStoredTimezone,
    () => "",
  );
  return useMemo(
    () => makeFormatters(locale, timezone, timeFormat, dateFormat),
    [locale, timezone, timeFormat, dateFormat],
  );
}
