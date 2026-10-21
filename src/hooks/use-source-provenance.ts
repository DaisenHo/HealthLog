"use client";

import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/api-fetch";
import { queryKeys } from "@/lib/query-keys";
import type {
  DayProvenanceResponse,
  SourceComparisonResponse,
} from "@/lib/validations/source-provenance";

/** `GET /api/measurements/provenance` for one metric and UTC day. */
export function useDayProvenance(type: string, date: string) {
  return useQuery({
    queryKey: queryKeys.provenanceDay(type, date),
    queryFn: () =>
      apiGet<DayProvenanceResponse>(
        `/api/measurements/provenance?${new URLSearchParams({ type, date })}`,
      ),
    staleTime: 60_000,
  });
}

/** `GET /api/measurements/provenance/compare` over a range of UTC days. */
export function useSourceComparison(opts: {
  type: string;
  from: string;
  to: string;
  a?: string;
  b?: string;
}) {
  return useQuery({
    queryKey: queryKeys.provenanceCompare(opts),
    queryFn: () => {
      const params = new URLSearchParams({
        type: opts.type,
        from: opts.from,
        to: opts.to,
      });
      if (opts.a) params.set("a", opts.a);
      if (opts.b) params.set("b", opts.b);
      return apiGet<SourceComparisonResponse>(
        `/api/measurements/provenance/compare?${params}`,
      );
    },
    staleTime: 60_000,
  });
}
