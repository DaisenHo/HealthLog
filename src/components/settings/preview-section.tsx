"use client";

/**
 * Settings > System > Preview features.
 *
 * One switch per preview feature, each off until the person turns it on, each
 * saved the moment it changes (`PATCH /api/settings/preview-features`). A
 * preview adds something beside what is there and never replaces a page.
 *
 * The `topics` flag is stored and shown here; the topic overview pages that
 * read it arrive in a later release, and the card says so rather than
 * promising a change the switch does not make yet.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";

import { toastWrittenOutcome } from "@/components/outcome/outcome-toast";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsCardHeader } from "@/components/settings/_card-header";
import { InlineAction } from "@/components/ui/inline-action";
import { QueryErrorRow } from "@/components/ui/query-error-row";
import { Switch } from "@/components/ui/switch";
import { apiGet, apiPatch } from "@/lib/api/api-fetch";
import { showErrorToast } from "@/lib/errors/error-toast";
import { useTranslations } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";
import {
  DEFAULT_PREVIEW_FEATURES,
  type PreviewFeatures,
} from "@/lib/settings/preview-features";

const DISCUSSIONS_URL = "https://github.com/MBombeck/HealthLog/discussions";

export function PreviewSection() {
  const { t } = useTranslations();
  const queryClient = useQueryClient();
  const key = queryKeys.previewFeatures();

  const query = useQuery({
    queryKey: key,
    queryFn: () => apiGet<PreviewFeatures>("/api/settings/preview-features"),
  });
  const features = query.data ?? DEFAULT_PREVIEW_FEATURES;

  const toggle = useMutation({
    mutationKey: key,
    mutationFn: (topics: boolean) =>
      apiPatch<PreviewFeatures>("/api/settings/preview-features", { topics }),
    onMutate: async (topics) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PreviewFeatures>(key);
      queryClient.setQueryData<PreviewFeatures>(key, {
        ...(previous ?? DEFAULT_PREVIEW_FEATURES),
        topics,
      });
      return { previous };
    },
    onSuccess: (saved, topics) => {
      if (saved) queryClient.setQueryData(key, saved);
      toastWrittenOutcome(
        "success",
        topics
          ? t("settings.preview.topics.savedOn")
          : t("settings.preview.topics.savedOff"),
      );
    },
    onError: (failure, _topics, context) => {
      queryClient.setQueryData(key, context?.previous);
      showErrorToast(t("settings.savingError"), { cause: failure });
    },
  });

  return (
    <SettingsCard data-slot="settings-preview-topics">
      <SettingsCardHeader
        anchor="preview-topics"
        icon={LayoutDashboard}
        title={t("settings.preview.topics.title")}
        titleId="settings-preview-topics-title"
        description={t("settings.preview.topics.description")}
        status={
          <Switch
            data-slot="settings-preview-topics-switch"
            checked={features.topics}
            disabled={query.isLoading || toggle.isPending}
            onCheckedChange={(next) => toggle.mutate(next)}
            aria-labelledby="settings-preview-topics-title"
          />
        }
      />
      {query.isError ? (
        <QueryErrorRow
          inset
          error={query.error}
          slot="settings-preview-error"
          message={t("settings.preview.loadError")}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      <p className="text-sm">{t("settings.preview.topics.detail")}</p>
      <p className="text-muted-foreground text-xs">
        <InlineAction asChild tone="muted" size="xs">
          <Link
            href={DISCUSSIONS_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("settings.preview.feedbackLink")}
          </Link>
        </InlineAction>
      </p>
    </SettingsCard>
  );
}
