"use client";

/**
 * Per-item answer breakdown for one recorded administration, expanded from a
 * history row. Fetches the detail read (`GET …/assessments/[id]`), which is
 * where the server decrypts `responsesEncrypted` — the answers never ride the
 * list payload.
 *
 * Grammar: the detail surface's label/value rows — official item text muted
 * (validated instrument copy resolved through `instrumentText`, exactly as
 * the check-in wizard does: the validated translation, or the English source
 * for a language the instrument is not validated in; never re-worded here), the chosen answer label +
 * its value in foreground. The WHO-5 / SCI recall stems paint once above each
 * run of items, as on the source forms. PHQ-9 item 9 renders like every other
 * item — no alarm colour; the row's existing "support shown" marker is the
 * crisis affordance and is not duplicated here.
 */
import { useQuery } from "@tanstack/react-query";

import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "@/lib/i18n/context";
import { apiGet } from "@/lib/api/api-fetch";
import { queryKeys } from "@/lib/query-keys";
import {
  INSTRUMENTS,
  optionLabelKey,
  stemKey,
} from "@/lib/mental-health/instruments";
import {
  FUNCTIONAL_TITLE_KEY,
  functionalOptionKey,
  instrumentText,
  itemKey,
} from "@/lib/mental-health/instrument-wording";

import type { AssessmentDetail, InstrumentId } from "./types";
import { QueryErrorRow } from "@/components/ui/query-error-row";

export function AssessmentItemBreakdown({
  assessmentId,
  instrument,
}: {
  assessmentId: string;
  instrument: InstrumentId;
}) {
  const { t, locale } = useTranslations();
  const def = INSTRUMENTS[instrument];
  const wording = (k: string) => instrumentText(instrument, k, locale, t);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.mentalHealthAssessmentDetail(assessmentId),
    queryFn: () =>
      apiGet<{ assessment: AssessmentDetail }>(
        `/api/mental-health/assessments/${assessmentId}`,
      ),
  });

  if (isPending) {
    return (
      <div
        className="flex flex-col gap-2"
        data-slot="assessment-item-breakdown"
        aria-busy="true"
      >
        {Array.from({ length: def.itemCount }, (_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <QueryErrorRow
        inset
        error={error}
        slot="assessment-item-breakdown"
        message={t("mentalHealth.error")}
        onRetry={() => void refetch()}
      />
    );
  }

  const detail = data.assessment;
  if (detail.items === null) {
    // The server's honest degrade: the blob exists but cannot be decrypted
    // (key gap / corruption). The score above this breakdown still answers.
    return (
      <p
        className="text-muted-foreground text-sm"
        data-slot="assessment-item-breakdown"
      >
        {t("mentalHealth.history.answersUnavailable")}
      </p>
    );
  }

  return (
    <div
      className="flex flex-col gap-2 text-sm"
      data-slot="assessment-item-breakdown"
    >
      {detail.items.map((value, index) => {
        // Stem captions group runs of items exactly as the wizard presents
        // them: paint the stem only where it differs from the previous item's.
        const stem = stemKey(instrument, index);
        const caption =
          stem !== (index > 0 ? stemKey(instrument, index - 1) : null)
            ? stem
            : null;
        return (
          <div key={index} className="flex flex-col gap-1">
            {caption && (
              <p className="text-muted-foreground pt-1 text-xs">
                {wording(`mentalHealth.stems.${caption}`)}
              </p>
            )}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground min-w-0 flex-1">
                {wording(itemKey(instrument, index))}
              </span>
              <span className="text-foreground shrink-0 text-right">
                {wording(optionLabelKey(instrument, index, value))}
                {" · "}
                <span className="tabular-nums">{value}</span>
              </span>
            </div>
          </div>
        );
      })}
      {detail.functionalDifficulty !== null && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground min-w-0 flex-1">
            {wording(FUNCTIONAL_TITLE_KEY)}
          </span>
          {/* Unscored follow-up: the label alone, no value — it never counts
              into the total and a number would imply it does. */}
          <span className="text-foreground shrink-0 text-right">
            {wording(functionalOptionKey(detail.functionalDifficulty))}
          </span>
        </div>
      )}
    </div>
  );
}
