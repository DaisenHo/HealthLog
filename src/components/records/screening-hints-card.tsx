"use client";

/**
 * v1.43 (#614) — screening hints from the life circumstances, in Settings →
 * Health profile → Medical history (under Checkups until v1.44). Low-dose CT
 * for lung cancer and the abdominal-aorta ultrasound, each with its status,
 * the reasons in the account's language and the rule's source and country.
 * A hint, never a reminder: nothing is scheduled here, and the card says so.
 * Resolved on the server; rendered as delivered.
 *
 * The card stays away until it has something to say: the person has said
 * something about smoking, or a hint already applies without it (the German
 * abdominal-aorta ultrasound is offered to every man from 65, smoker or not).
 * Before either, every hint would read "not enough information".
 */
import { useQuery } from "@tanstack/react-query";
import { Stethoscope } from "lucide-react";

import { SettingsCardHeader } from "@/components/settings/_card-header";
import { SettingsCard } from "@/components/settings/settings-card";
import { apiGet } from "@/lib/api/api-fetch";
import { useTranslations } from "@/lib/i18n/context";
import type { LifeCircumstancesDto } from "@/lib/profile/life-circumstances";
import { queryKeys } from "@/lib/query-keys";

export function ScreeningHintsCard() {
  const { t } = useTranslations();
  const query = useQuery({
    queryKey: queryKeys.lifeCircumstances(),
    queryFn: () =>
      apiGet<LifeCircumstancesDto>("/api/anamnesis/life-circumstances"),
  });
  const data = query.data;
  const tobacco = data?.sections.find((section) => section.key === "tobacco");
  if (!data) return null;
  const answeredTobacco = (tobacco?.facts.length ?? 0) > 0;
  const anySuggested = data.derived.screeningHints.some(
    (hint) => hint.status === "suggested",
  );
  if (!answeredTobacco && !anySuggested) return null;

  return (
    <SettingsCard data-slot="screening-hints-card">
      <SettingsCardHeader
        anchor="screening-hints"
        icon={Stethoscope}
        title={t("records.life.screening.cardTitle")}
        description={t("records.life.screening.cardDescription")}
      />
      <ul className="divide-border divide-y">
        {data.derived.screeningHints.map((hint) => (
          <li
            key={hint.id}
            className="space-y-1 py-3"
            data-slot={`screening-hint-${hint.id}`}
          >
            <p className="text-sm font-medium">
              {t(`records.life.screening.titles.${hint.id}`)}
            </p>
            <p className="text-sm">
              {t(`records.life.screening.status.${hint.status}`)}
              {hint.reasonKeys.length > 0
                ? ` ${hint.reasonKeys
                    .map((key) => t(`records.life.screening.reasons.${key}`))
                    .join(" ")}`
                : ""}
            </p>
            <p className="text-muted-foreground text-xs">
              <a
                href={hint.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                {t("records.life.screening.source", {
                  source: hint.sourceLabel,
                })}
              </a>
            </p>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        {t("records.life.screening.noReminder")}
      </p>
    </SettingsCard>
  );
}
