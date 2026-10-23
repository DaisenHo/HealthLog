"use client";

/**
 * Settings > System > Preview features.
 *
 * One switch per preview feature, each off until the person turns it on, each
 * saved the moment it changes (`PATCH /api/settings/preview-features`). A
 * preview adds something beside what is there and never replaces a page.
 *
 * The switch is the person's own and stays theirs while they act on somebody
 * else's record. Saving refreshes the account payload too, because the
 * navigation reads the flag from there: the Topics entry appears or goes the
 * moment the switch moves.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Layers } from "lucide-react";

import { toastWrittenOutcome } from "@/components/outcome/outcome-toast";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsCardHeader } from "@/components/settings/_card-header";
import { PreviewBadge } from "@/components/topics/preview-badge";
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.authMe() });
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
        icon={Layers}
        title={t("settings.preview.topics.title")}
        titleId="settings-preview-topics-title"
        titleAccessory={<PreviewBadge label={t("nav.previewBadge")} />}
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
      {features.topics ? (
        <p className="text-sm">
          <InlineAction asChild tone="primary" size="sm">
            <Link href="/topics" data-slot="settings-preview-topics-open">
              {t("settings.preview.topics.open")}
            </Link>
          </InlineAction>
        </p>
      ) : null}
    </SettingsCard>
  );
}
