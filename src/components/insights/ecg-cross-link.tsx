"use client";

import Link from "next/link";
import { ArrowRight, HeartPulse } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/use-auth";
import { queryKeys } from "@/lib/query-keys";
import { apiGet } from "@/lib/api/api-fetch";
import { useTranslations } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { TileHeader } from "@/components/insights/tile-header";

/**
 * ECG cross-link, the pointer from the resting-HR / pulse context into
 * the ECG viewer (`/insights/ecg`). Points at the routed sub-page, which
 * always mounts, rather than the overview `#ecg` fragment, which is absent
 * until the overview section's own fetch resolves (UX-flows finding F1-1).
 *
 * NON-DIAGNOSTIC (load-bearing, mirrors `EcgSection` / `RhythmEventsCard`): the
 * card surfaces ONLY that recordings exist + the RECORDING DEVICE's OWN latest
 * result, attributed to the device. HealthLog never reads or interprets the
 * waveform, and this pointer never touches it — the list route returns metadata
 * only. All copy renders as plain React text children (no markdown library).
 *
 * Data-availability-gated: the card un-mounts entirely (`return null`) when the
 * user has no recordings, so a pulse page without any ECG never paints it. It
 * reuses the SAME query cell as `EcgSection` (`insightsEcgList`), so the two
 * surfaces share one cache entry with an identical response shape.
 */

type EcgClassification = "IRREGULAR" | "NOT_DETECTED" | "INCONCLUSIVE" | null;

interface EcgRecordingListItem {
  id: string;
  classification: EcgClassification;
}

interface EcgListResponse {
  recordings: EcgRecordingListItem[];
  hasRecordings: boolean;
}

/** The device verdict, surfaced verbatim and attributed to the device. */
const RESULT_LABEL_KEYS: Record<string, string> = {
  IRREGULAR: "insights.ecg.result.irregular",
  NOT_DETECTED: "insights.ecg.result.notDetected",
  INCONCLUSIVE: "insights.ecg.result.inconclusive",
};

interface EcgCrossLinkProps {
  enabled?: boolean;
  className?: string;
}

export function EcgCrossLink({ enabled = true, className }: EcgCrossLinkProps) {
  const { isAuthenticated } = useAuth();
  const { t } = useTranslations();

  const { data } = useQuery({
    queryKey: queryKeys.insightsEcgList(),
    queryFn: async () => {
      try {
        return await apiGet<EcgListResponse>("/api/insights/ecg");
      } catch {
        throw new Error(t("insights.ecg.loadError"));
      }
    },
    enabled: enabled && isAuthenticated,
  });

  // Data-availability gate — never paint an empty pointer.
  if (!data || !data.hasRecordings || data.recordings.length === 0) return null;

  const count = data.recordings.length;
  const latestClassification = data.recordings[0]?.classification ?? null;
  const resultKey = latestClassification
    ? RESULT_LABEL_KEYS[latestClassification]
    : null;

  const countText =
    count === 1
      ? t("insights.ecg.crossLink.recordingsOne")
      : t("insights.ecg.crossLink.recordingsMany", { count });
  const resultText = resultKey
    ? t("insights.ecg.crossLink.latestResult", { result: t(resultKey) })
    : null;

  return (
    <Link
      href="/insights/ecg"
      data-slot="ecg-cross-link"
      className={cn(
        // `.metric-accent` — the heart-family identity edge (`--tile-strain`,
        // the wellness vocabulary's cardiovascular hue), the same mark the
        // `ecg_new_recording` rail card carries, so the two ECG pointers
        // read as one family.
        "bg-card hover:bg-accent/40 focus-visible:ring-ring/50 metric-accent block space-y-1.5 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
      style={{ "--tile-hue": "var(--tile-strain)" } as React.CSSProperties}
    >
      <TileHeader icon={HeartPulse} title={t("insights.ecg.crossLink.title")} />
      <span className="text-muted-foreground block text-xs leading-snug">
        {resultText ? `${countText} ${resultText}` : countText}
      </span>
      <span className="text-primary inline-flex shrink-0 items-center gap-1 text-xs font-medium">
        {t("insights.ecg.crossLink.cta")}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </span>
    </Link>
  );
}
