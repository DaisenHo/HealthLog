/**
 * Asking the catalogue whether it has a sentence.
 *
 * `t()` answers a missing key with the key itself, so the only way to learn
 * whether a key exists is to compare the answer with the question. That probe
 * lives here and nowhere else: it had been written inline at each call site
 * that wanted "a code's sentence, or else the fallback", once per site.
 * `src/__tests__/translate-probe-guard.test.ts` refuses it outside this file.
 */

type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/** The catalogue's sentence for `key`, or null when the bundle has none. */
export function translateOrNull(
  t: Translate,
  key: string,
  params?: Record<string, string | number>,
): string | null {
  const value = t(key, params);
  return value === key ? null : value;
}

/**
 * The sentence for a machine code under `namespace` (`apiErrors`,
 * `settings.testConnection.errors`, …), or null when there is no code or the
 * code has no sentence of its own.
 */
export function translateCodeOrNull(
  t: Translate,
  namespace: string,
  code: string | null | undefined,
): string | null {
  return code ? translateOrNull(t, `${namespace}.${code}`) : null;
}

/** The code's sentence, or the fallback key's when it has none. */
export function translateCode(
  t: Translate,
  namespace: string,
  code: string | null | undefined,
  fallbackKey: string,
): string {
  return translateCodeOrNull(t, namespace, code) ?? t(fallbackKey);
}
