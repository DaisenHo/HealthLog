import { ApiError } from "./api-fetch";
import { translateCode } from "@/lib/i18n/translate-code";

type Translate = (key: string) => string;

/**
 * Resolve an API envelope's stable error code through the locale catalog.
 * Missing/unknown codes, network failures, and non-API errors deliberately
 * collapse to the caller's safe domain fallback; server prose is never shown.
 */
export function localizedApiError(
  error: unknown,
  t: Translate,
  fallbackKey: string,
): string {
  const errorCode =
    error instanceof ApiError && typeof error.meta?.errorCode === "string"
      ? error.meta.errorCode
      : null;
  return translateCode(t, "apiErrors", errorCode, fallbackKey);
}
