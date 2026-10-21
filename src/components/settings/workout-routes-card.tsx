"use client";

/**
 * The workout-route opt-in on the Data & Privacy page.
 *
 * Off by default. A GPS track shows where a person lives, works and trains,
 * so new tracks from the iPhone app and the Apple Health export are kept
 * only once this is on; the workouts themselves are kept either way. No AI
 * feature ever reads a track.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinned } from "lucide-react";

import { toastWrittenOutcome } from "@/components/outcome/outcome-toast";
import { SettingsCardHeader } from "@/components/settings/_card-header";
import { SettingsCard } from "@/components/settings/settings-card";
import { QueryErrorRow } from "@/components/ui/query-error-row";
import { Switch } from "@/components/ui/switch";
import { apiGet, apiPatch } from "@/lib/api/api-fetch";
import { showErrorToast } from "@/lib/errors/error-toast";
import { useTranslations } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";

interface WorkoutRoutesPref {
  storeWorkoutRoutes: boolean;
}

export function WorkoutRoutesCard() {
  const { t } = useTranslations();
  const queryClient = useQueryClient();
  const pref = useQuery<WorkoutRoutesPref>({
    queryKey: queryKeys.workoutRoutesPref(),
    queryFn: () => apiGet<WorkoutRoutesPref>("/api/auth/me/workout-routes"),
    staleTime: 60_000,
  });
  const update = useMutation<WorkoutRoutesPref, Error, boolean>({
    mutationFn: (storeWorkoutRoutes) =>
      apiPatch<WorkoutRoutesPref>("/api/auth/me/workout-routes", {
        storeWorkoutRoutes,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.workoutRoutesPref(), data);
    },
  });

  return (
    <SettingsCard data-testid="workout-routes-card">
      <SettingsCardHeader
        anchor="workout-routes"
        icon={MapPinned}
        title={t("settings.privacy.workoutRoutes.title")}
        description={t("settings.privacy.workoutRoutes.description")}
        status={
          <Switch
            checked={pref.data?.storeWorkoutRoutes ?? false}
            disabled={pref.isLoading || pref.isError || update.isPending}
            onCheckedChange={(checked) =>
              update.mutate(checked, {
                onSuccess: () =>
                  toastWrittenOutcome("success", t("settings.saved")),
                onError: (failure) =>
                  showErrorToast(t("settings.savingError"), {
                    cause: failure,
                  }),
              })
            }
            aria-label={t("settings.privacy.workoutRoutes.title")}
          />
        }
      />
      {pref.isError ? (
        <QueryErrorRow
          inset
          error={pref.error}
          onRetry={() => void pref.refetch()}
          message={t("settings.privacy.workoutRoutes.loadError")}
        />
      ) : (
        <p className="text-sm">{t("settings.privacy.workoutRoutes.detail")}</p>
      )}
    </SettingsCard>
  );
}
