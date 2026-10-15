"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { recordErrorId, shortErrorId } from "@/lib/errors/error-id";
import { useTranslations } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * "Error ID 3f9a2c1b" with a copy button: the one way the web shows the id of
 * a failure, in toasts (`showErrorToast`) and in error boundaries. The first 8
 * characters are shown; the button copies the whole id, which the operator's
 * log search matches as well as the short one.
 *
 * Showing an id also records it for the session's support info.
 */
export function ErrorIdLine({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const { t } = useTranslations();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    recordErrorId(id);
  }, [id]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t("common.errorIdCopy"), id);
    }
  }

  return (
    <span
      data-slot="error-id"
      className={cn("inline-flex items-center gap-1.5 text-xs", className)}
    >
      <span className="text-muted-foreground">{t("common.errorIdLabel")}</span>
      <code className="text-foreground font-mono">{shortErrorId(id)}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 sm:size-8"
        onClick={(event) => {
          // Inside a toast, a click must not count as a dismiss swipe.
          event.stopPropagation();
          void copy();
        }}
        aria-label={
          copied ? t("common.errorIdCopied") : t("common.errorIdCopy")
        }
        title={copied ? t("common.errorIdCopied") : t("common.errorIdCopy")}
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
      </Button>
    </span>
  );
}
