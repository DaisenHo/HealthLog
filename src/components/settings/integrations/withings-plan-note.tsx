"use client";

import { ExternalLink } from "lucide-react";

import { useTranslations } from "@/lib/i18n/context";
import {
  WITHINGS_API_PLANS_URL,
  type WithingsPlanFeature,
} from "@/lib/withings/plan-features";

/**
 * A calm note on the Withings card when the account's API plan withholds some
 * readings (status 277 since the 2026-10-12 plan split). Not an error: the
 * sync skips those readings and keeps importing the rest, so this sits in the
 * card body in the info wash, never in the pill.
 */
export function WithingsPlanNote({
  features,
}: {
  features: readonly WithingsPlanFeature[] | undefined;
}) {
  const { t, locale } = useTranslations();
  if (!features || features.length === 0) return null;

  const labels: Record<WithingsPlanFeature, string> = {
    spo2: t("settings.integrations.withings.plan.items.spo2"),
    vascularAge: t("settings.integrations.withings.plan.items.vascularAge"),
    pulseWaveVelocity: t(
      "settings.integrations.withings.plan.items.pulseWaveVelocity",
    ),
    vo2Max: t("settings.integrations.withings.plan.items.vo2Max"),
    visceralFat: t("settings.integrations.withings.plan.items.visceralFat"),
    skinTemperature: t(
      "settings.integrations.withings.plan.items.skinTemperature",
    ),
    ecg: t("settings.integrations.withings.plan.items.ecg"),
    sleepScore: t("settings.integrations.withings.plan.items.sleepScore"),
    sleepHrv: t("settings.integrations.withings.plan.items.sleepHrv"),
    sleepHeartRate: t(
      "settings.integrations.withings.plan.items.sleepHeartRate",
    ),
    sleepRespiratoryRate: t(
      "settings.integrations.withings.plan.items.sleepRespiratoryRate",
    ),
    sleepSpo2: t("settings.integrations.withings.plan.items.sleepSpo2"),
    bodyTemperature: t(
      "settings.integrations.withings.plan.items.bodyTemperature",
    ),
    bodyFat: t("settings.integrations.withings.plan.items.bodyFat"),
    fatMass: t("settings.integrations.withings.plan.items.fatMass"),
    fatFreeMass: t("settings.integrations.withings.plan.items.fatFreeMass"),
    muscleMass: t("settings.integrations.withings.plan.items.muscleMass"),
    bodyWater: t("settings.integrations.withings.plan.items.bodyWater"),
    boneMass: t("settings.integrations.withings.plan.items.boneMass"),
    heartRate: t("settings.integrations.withings.plan.items.heartRate"),
    bloodPressure: t("settings.integrations.withings.plan.items.bloodPressure"),
    weight: t("settings.integrations.withings.plan.items.weight"),
  };
  const list = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(features.map((f) => labels[f]));

  return (
    <div
      data-testid="withings-plan-note"
      className="border-info/30 bg-info/10 space-y-1 rounded-md border px-3 py-2 text-sm"
    >
      <p className="font-medium">
        {t("settings.integrations.withings.plan.title")}
      </p>
      <p>{t("settings.integrations.withings.plan.body", { list })}</p>
      <a
        href={WITHINGS_API_PLANS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
      >
        {t("settings.integrations.withings.plan.link")}
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
    </div>
  );
}
