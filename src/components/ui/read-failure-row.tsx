"use client";

import { QueryErrorRow } from "@/components/ui/query-error-row";
import { ApiError } from "@/lib/api/api-fetch";
import { useTranslations } from "@/lib/i18n/context";

/**
 * What a failed read means for the surface that made it.
 *
 *  - `denied`: 401 / 403. The viewer may not read this, typically a shared
 *    or delegated record whose grant leaves the section out. Nothing failed
 *    that a retry could fix, and the surface is simply not theirs to see.
 *  - `throttled`: 429. The read budget is spent for now; an immediate retry
 *    would only be refused again.
 *  - `failed`: everything else, a real read failure worth a retry.
 */
export type ReadFailureKind = "denied" | "throttled" | "failed";

export function readFailureKind(error: unknown): ReadFailureKind {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return "denied";
    if (error.status === 429) return "throttled";
  }
  return "failed";
}

/**
 * The compact failure row for a supplementary read, by what the failure
 * means: nothing for a refusal, a notice without a retry for a spent budget,
 * and `QueryErrorRow` with a retry for a real failure.
 *
 * For a surface the page can stand without (a strip, a tile, a block under a
 * card). A primary list keeps `QueryErrorCard`.
 */
export function ReadFailureRow({
  error,
  message,
  onRetry,
  slot,
  className,
}: {
  error: unknown;
  message?: string;
  onRetry: () => void;
  slot?: string;
  className?: string;
}) {
  const { t } = useTranslations();
  const kind = readFailureKind(error);
  if (kind === "denied") return null;
  if (kind === "throttled") {
    return (
      <QueryErrorRow
        slot={slot}
        message={t("common.readThrottled")}
        className={className}
      />
    );
  }
  return (
    <QueryErrorRow
      slot={slot}
      message={message}
      onRetry={onRetry}
      className={className}
    />
  );
}
