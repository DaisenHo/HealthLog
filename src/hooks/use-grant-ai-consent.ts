"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiPost } from "@/lib/api/api-fetch";
import {
  aiInputDependentKeys,
  invalidateKeys,
  queryKeys,
} from "@/lib/query-keys";

/**
 * Record the person's explicit AI consent (`ai_full`).
 *
 * Call `mutate()` from the click handler of an "Agree" control that has
 * named the service and the data, and from nowhere else: the server records
 * this request as the person's consent act, and `confirm: true` is how the
 * request says so. A request on mount, on launch or after a sync is exactly
 * what v1.43.2 removed; `consent-grant-explicit-guard.test.ts` keeps it out.
 *
 * On success `/api/auth/me` is refetched, because the capabilities and the
 * `ai.consent` state every AI surface renders from changed.
 */
export function useGrantAiConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: queryKeys.aiConsentReceipt("ai_full"),
    mutationFn: () => apiPost("/api/consent/ai/web", { confirm: true }),
    onSuccess: async () => {
      await invalidateKeys(queryClient, aiInputDependentKeys);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.aiConsentReceipt("ai_full"),
      });
    },
  });
}
