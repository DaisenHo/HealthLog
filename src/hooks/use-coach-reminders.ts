"use client";

/**
 * v1.22 — read + mutate the user's Coach episodic reminders.
 *
 * One shared hook for the in-app reminder tile/indicator and the "Your context"
 * ledger. Reads unwrap `(await res.json()).data` per the envelope convention;
 * every key routes through `queryKeys.coachReminders(status)` so a lifecycle
 * mutation invalidates the matching list. The `status` arg keys the tile read
 * (`due,surfaced`) separately from the full ledger so they never share a slot.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import { apiDelete, apiGet, apiPatch } from "@/lib/api/api-fetch";

export interface CoachReminderDTO {
  id: string;
  note: string;
  metric: string | null;
  triggerKind: string;
  dueAt: string | null;
  contextCue: string | null;
  status: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

async function fetchReminders(status?: string): Promise<CoachReminderDTO[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await apiGet<{ reminders?: CoachReminderDTO[] } | undefined>(
    `/api/coach/reminders${qs}`,
  );
  return data?.reminders ?? [];
}

/** List the caller's reminders, optionally filtered to a status set. */
export function useCoachReminders(opts?: {
  status?: string;
  enabled?: boolean;
}) {
  const status = opts?.status;
  return useQuery({
    queryKey: queryKeys.coachReminders(status),
    queryFn: () => fetchReminders(status),
    enabled: opts?.enabled ?? true,
  });
}

/** Lifecycle + delete mutations, invalidating every reminders list slot. */
export function useCoachReminderMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.coachRemindersAll(),
    });

  const setStatus = useMutation({
    mutationFn: async (args: { id: string; status: string }) => {
      await apiPatch(`/api/coach/reminders/${encodeURIComponent(args.id)}`, {
        status: args.status,
      });
      return args.id;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/coach/reminders/${encodeURIComponent(id)}`);
      return id;
    },
    onSuccess: invalidate,
  });

  return { setStatus, remove };
}
