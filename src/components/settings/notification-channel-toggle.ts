/**
 * The instant enable switch of a notification channel card (Telegram, ntfy,
 * webhook, email).
 *
 * The switch saves on tap, optimistically, and rolls back when the server
 * refuses. It sits outside the card's form: the form's Save covers the
 * channel's fields (address, topic, token), the switch only whether the
 * channel delivers. The save-model guard holds that split.
 */
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { toastWrittenOutcome } from "@/components/outcome/outcome-toast";
import { apiFetchRaw } from "@/lib/api/api-fetch";
import { showErrorToast } from "@/lib/errors/error-toast";
import { useTranslations } from "@/lib/i18n/context";

interface EnabledSettings {
  enabled: boolean;
}

export async function persistChannelEnabled(
  endpoint: string,
  enabled: boolean,
  fallbackError: string,
): Promise<void> {
  // A request that never reaches the server (offline, a dropped connection)
  // is a refused change like any other.
  const response = await apiFetchRaw(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  }).catch(() => null);

  if (!response?.ok) {
    const json = (await response?.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(json?.error || fallbackError);
  }
}

export function optimisticallySetChannelEnabled<T extends EnabledSettings>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  enabled: boolean,
): T | undefined {
  const previous = queryClient.getQueryData<T>(queryKey);
  queryClient.setQueryData<T>(queryKey, (current) =>
    current ? { ...current, enabled } : current,
  );
  return previous;
}

export function rollbackChannelEnabled<T extends EnabledSettings>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  previous: T | undefined,
): void {
  queryClient.setQueryData(queryKey, previous);
}

/**
 * The mutation behind a channel's enable switch. A toggle is no form, so its
 * outcome is a toast either way; the switch itself already shows the state.
 */
export function useChannelEnabledToggle<T extends EnabledSettings>(
  endpoint: string,
  queryKey: QueryKey,
) {
  const { t } = useTranslations();
  const queryClient = useQueryClient();
  return useMutation<void, Error, boolean, T | undefined>({
    mutationFn: (enabled) =>
      persistChannelEnabled(endpoint, enabled, t("settings.savingError")),
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey });
      return optimisticallySetChannelEnabled<T>(queryClient, queryKey, enabled);
    },
    onSuccess: () => {
      toastWrittenOutcome("success", t("settings.saved"));
    },
    onError: (err, _enabled, previous) => {
      rollbackChannelEnabled(queryClient, queryKey, previous);
      showErrorToast(err.message, { cause: err });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}
