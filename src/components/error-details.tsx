"use client";

import { useState } from "react";
import { Copy, CheckCircle2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorIdLine } from "@/components/errors/error-id-line";
import { errorIdOf } from "@/lib/errors/error-id";
import { useTranslations } from "@/lib/i18n/context";

export interface ErrorDetailsProps {
  /** The error object, whether it's a runtime Error or a typed API error. */
  error: Error & { digest?: string };
  /** Pass Next.js' `reset()` callback if available. */
  reset?: () => void;
  /** Request ID propagated from the server (x-request-id), if known. */
  requestId?: string | null;
  /** Extra fields to include in the diagnostic payload. */
  context?: Record<string, unknown>;
}

/**
 * Structured error panel with a copy-to-clipboard payload that includes
 * everything we'd need to reproduce or file an issue: message, stack digest,
 * URL, user agent, locale, timestamp.
 */
export function ErrorDetails({
  error,
  reset,
  requestId,
  context,
}: ErrorDetailsProps) {
  const { t, locale } = useTranslations();
  const [copied, setCopied] = useState(false);
  // The id the operator finds this failure by: the request id of an API
  // failure that reached the boundary, else the server render's digest.
  const errorId = requestId ?? errorIdOf(error, { unexpected: true });

  async function handleCopy() {
    // Only capture the pathname — some flows carry OAuth codes / state tokens
    // in the query string (Withings connect, password reset) and we don't
    // want users pasting those into public GitHub issues. Preserve the count
    // for context without exposing values.
    const loc = typeof window !== "undefined" ? window.location : null;
    const urlPath = loc?.pathname ?? null;
    const searchParamCount = loc?.search
      ? new URLSearchParams(loc.search).toString().split("&").filter(Boolean)
          .length
      : 0;

    const payload = {
      message: error.message,
      digest: error.digest,
      name: error.name,
      stack: error.stack?.split("\n").slice(0, 10).join("\n"),
      requestId: errorId,
      urlPath,
      searchParamCount,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      locale,
      timestamp: new Date().toISOString(),
      context,
    };

    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: open a prompt the user can copy from manually.
      window.prompt(t("common.copyDetails"), text);
    }
  }

  return (
    // v1.4.27 — `min-h-dvh flex flex-col justify-center` makes
    // the error panel anchor in the middle of the available viewport
    // even when this component is mounted at the root layout. Without
    // it the panel hugged the top edge under the notch on
    // small-screen devices.
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center space-y-4 p-6">
      <h1 className="text-xl font-semibold">{t("errorBoundary.title")}</h1>
      <p className="text-muted-foreground text-sm">
        {t("errorBoundary.description")}
      </p>
      <div className="bg-muted/50 text-muted-foreground rounded-md border p-3 font-mono text-xs break-all">
        {error.message || t("common.unknownError")}
      </div>
      {errorId && <ErrorIdLine id={errorId} />}
      <div className="flex flex-wrap items-center gap-2">
        {reset && (
          <Button onClick={reset} variant="outline">
            <RotateCcw className="h-4 w-4" />
            {t("common.retry")}
          </Button>
        )}
        <Button onClick={handleCopy} variant="outline">
          {copied ? (
            <CheckCircle2 className="text-success h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {copied ? t("common.copied") : t("common.copyDetails")}
        </Button>
      </div>
    </div>
  );
}
