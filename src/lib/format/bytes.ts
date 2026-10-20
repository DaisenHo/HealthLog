import { getNumberFormat } from "@/lib/intl/formatter-cache";

/**
 * One spelling of a byte count for every surface: 0 B / 412 KB / 1.2 MB /
 * 2.4 GB, digits in the reader's locale ("1,2 MB" for a German reader).
 *
 * There used to be two: this module printed megabytes with two decimals and
 * no gigabyte step, the document vault printed one decimal up to gigabytes, so
 * the same backup read "1.25 MB" in the admin area and "1.2 MB" beside a
 * document. It takes the locale rather than a formatter object so the share
 * page, which renders on the server without the formatter hook, uses it too.
 */
export function formatBytes(bytes: number, locale: string): string {
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${getNumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}
