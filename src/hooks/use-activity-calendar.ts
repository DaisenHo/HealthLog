"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPatch } from "@/lib/api/api-fetch";
import { queryKeys } from "@/lib/query-keys";
import type { ActivityCalendarResponse } from "@/lib/validations/activity-calendar";
import type {
  ActivityGoals,
  ActivityGoalsInput,
} from "@/lib/validations/activity-goals";

/**
 * `GET /api/activity/calendar` for one period. `date` null = the period that
 * contains today. The server computes everything, the client only draws it.
 */
export function useActivityCalendar(
  period: "week" | "month",
  date: string | null,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.activityCalendar(period, date),
    queryFn: () => {
      const params = new URLSearchParams({ period });
      if (date) params.set("date", date);
      return apiGet<ActivityCalendarResponse>(
        `/api/activity/calendar?${params.toString()}`,
      );
    },
    enabled: opts?.enabled,
    staleTime: 60_000,
  });
}

/** `PATCH /api/activity/goals`; refreshes every calendar cell on success. */
export function useSaveActivityGoals() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ActivityGoalsInput) =>
      apiPatch<ActivityGoals>("/api/activity/goals", patch),
    onSuccess: (goals) => {
      queryClient.setQueryData(queryKeys.activityGoals(), goals);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.activityCalendarAll(),
      });
    },
  });
}
