"use client";

import Link from "next/link";

import { InlineAction } from "@/components/ui/inline-action";
import { useTranslations } from "@/lib/i18n/context";
import { isProvenanceType } from "@/lib/provenance/ranked-types";

/**
 * "Where these values come from": a small link from a metric's page to the
 * provenance view, offered for the metrics the source priority decides for.
 * Renders nothing for any other type.
 */
export function SourceProvenanceLink({ type }: { type: string }) {
  const { t } = useTranslations();
  if (!isProvenanceType(type)) return null;
  return (
    <InlineAction asChild tone="primary" size="xs">
      <Link
        href={`/insights/sources?type=${type}`}
        data-slot="source-provenance-link"
      >
        {t("sourceProvenance.metricLink")}
      </Link>
    </InlineAction>
  );
}
