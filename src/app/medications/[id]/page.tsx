"use client";

/**
 * v1.15.18 — medication detail page as the full-page tabbed shell.
 *
 * Supersedes the v1.7.2 history-centric composition. The page now owns
 * auth + the medication read and hands the snapshot to
 * `<MedicationDetailTabs>`, which carries the tab strip (Übersicht ·
 * Zeitplan · Erinnerung · Bestand · Verlauf · Injektion* · Erweitert),
 * `?tab=` URL state, the read-only hero and the "Vollständig bearbeiten"
 * jump into the wizard. The former modal advanced-settings sheet and the
 * separate `/history` route both fold into tabs here.
 */

import { use, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PageAuthGate } from "@/components/ui/page-auth-gate";

import { useAuth } from "@/hooks/use-auth";
import { useTranslations } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";

import { BackLink } from "@/components/ui/back-link";
import { QueryErrorCard } from "@/components/ui/query-error-card";
import {
  MedicationDetailTabs,
  type MedicationDetailSnapshot,
} from "@/components/medications/detail/medication-detail-tabs";
import { apiGet } from "@/lib/api/api-fetch";

export default function MedicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useTranslations();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/auth/login");
    }
  }, [authLoading, isAuthenticated, router]);

  const {
    data: medication,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<MedicationDetailSnapshot>({
    queryKey: queryKeys.medicationDetail(id),
    queryFn: async () => {
      return apiGet<MedicationDetailSnapshot>(`/api/medications/${id}`);
    },
    // v1.15.20 — deliberately NOT gated on `isAuthenticated`: the session
    // cookie rides the fetch either way, so waiting for `/api/auth/me`
    // serialised two round-trips into a waterfall on every detail
    // navigation. An unauthenticated visit fails fast with a 401 here and
    // the redirect effect above still routes to the login page (the
    // render guard below keeps the spinner up until it does).
    // A deleted medication 404s here. Don't burn a retry/backoff cycle on
    // a resource that no longer exists — the delete handler evicts this
    // key on success, but `retry: false` hardens any caller that
    // prefix-invalidates `["medications"]` while this page is mounted.
    retry: false,
  });

  if (authLoading || isLoading || !isAuthenticated) {
    return <PageAuthGate label={t("common.loading")} />;
  }

  // `retry: false` above stays: a deleted medication 404s here and automatic
  // backoff against a row that no longer exists is pure waste. But that flag
  // also stranded the page on a single transient failure, with no way forward
  // short of navigating away and back. A user-initiated retry is the right
  // granularity — it costs one request per click and cannot storm.
  if (isError || !medication) {
    return (
      <div className="space-y-6">
        <BackLink href="/medications" label={t("medications.back")} />
        <div data-slot="medication-detail-error-card">
          <QueryErrorCard
            error={error}
            description={t("medications.detail.shell.loadFailed")}
            onRetry={() => void refetch()}
          />
        </div>
      </div>
    );
  }

  return <MedicationDetailTabs medication={medication} />;
}
