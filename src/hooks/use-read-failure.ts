"use client";

import type { ReactNode } from "react";

import {
  readFailureKind,
  signInHref,
  type ReadFailureKind,
} from "@/lib/api/read-failure";
import { useTranslations } from "@/lib/i18n/context";

/**
 * What a read-failure primitive shows for one failed read: `null` for a
 * refusal (the caller's refused state stands in), otherwise the line and the
 * one action that can help. A real failure offers the caller's retry, an
 * ended session offers sign-in, a spent budget offers nothing.
 *
 * Shared by `QueryErrorRow` and `QueryErrorCard` so both shapes branch on
 * the failure the same way; a call site never decides it.
 */
export function useReadFailure(
  error: unknown,
  { message, onRetry }: { message?: ReactNode; onRetry?: () => void },
): {
  kind: Exclude<ReadFailureKind, "refused">;
  message: ReactNode;
  action: {
    label: string;
    onClick: () => void;
    kind: "retry" | "signIn";
  } | null;
} | null {
  const { t } = useTranslations();
  switch (readFailureKind(error)) {
    case "refused":
      return null;
    case "throttled":
      return {
        kind: "throttled",
        message: t("common.readThrottled"),
        action: null,
      };
    case "unauthenticated":
      return {
        kind: "unauthenticated",
        message: t("common.sessionEnded"),
        action: {
          label: t("common.signInAgain"),
          onClick: () => window.location.assign(signInHref()),
          kind: "signIn",
        },
      };
    case "failed":
      return {
        kind: "failed",
        message: message ?? t("common.loadFailed"),
        action: onRetry
          ? { label: t("common.retry"), onClick: onRetry, kind: "retry" }
          : null,
      };
  }
}
