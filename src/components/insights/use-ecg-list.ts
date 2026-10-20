"use client";

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/use-auth";
import { apiGetList } from "@/lib/api/api-fetch";
import { queryKeys } from "@/lib/query-keys";

import type { EcgRecordingListItem } from "./ecg-section";

export interface EcgListResponse {
  recordings: EcgRecordingListItem[];
  hasRecordings: boolean;
}

/**
 * The ECG list, one query cell for every reader (the section, the page, the
 * cross-link, the tab strip, the catalog). The cell holds `{ data, cap }`,
 * so every reader shares one shape and the cap the route sends reaches the
 * list that shows it.
 */
export function useEcgList(enabled = true) {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.insightsEcgList(),
    // The ApiError passes through untouched: the error row reads its status
    // and code to tell an ended session from a real failure.
    queryFn: () => apiGetList<EcgListResponse>("/api/insights/ecg"),
    enabled: enabled && isAuthenticated,
  });
}
