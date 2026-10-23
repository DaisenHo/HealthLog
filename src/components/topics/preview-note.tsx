"use client";

import { FlaskConical } from "lucide-react";

import { useTranslations } from "@/lib/i18n/context";

/**
 * The line every topic page ends on: this is a preview, it may change, and
 * the single-metric pages are untouched. Neutral, with no link out.
 */
export function PreviewNote() {
  const { t } = useTranslations();
  return (
    <p
      className="text-muted-foreground flex items-start gap-2 text-xs"
      data-slot="topics-preview-note"
    >
      <FlaskConical className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{t("topics.previewNote")}</span>
    </p>
  );
}
