"use client";

import { useQuery } from "@tanstack/react-query";
import { Droplet, ExternalLink, Plug } from "lucide-react";

import { IntegrationCard } from "@/components/settings/integrations/integration-card";
import { OAUTH_INTEGRATIONS } from "@/components/settings/integrations/oauth-integration-card";
import { QueryErrorCard } from "@/components/ui/query-error-card";
import { SectionHeading } from "@/components/ui/section-heading";
import { apiGet } from "@/lib/api/api-fetch";
import { useAuth } from "@/hooks/use-auth";
import { useTranslations } from "@/lib/i18n/context";
import type { ConnectionHealth } from "@/lib/integrations/connection-health";
import { queryKeys } from "@/lib/query-keys";
import { assertRecordSettingsResponseForRecord } from "@/lib/record-settings/response";

type ManagedIntegrationKey = keyof typeof INTEGRATION_DISPLAY_NAMES;

interface ManagedIntegrationStatusResponse {
  recordId: string;
  integrations: Array<{
    integration: ManagedIntegrationKey;
    /** The server-resolved state; null while the provider is not connected. */
    health: ConnectionHealth | null;
  }>;
}

const INTEGRATION_DISPLAY_NAMES = {
  withings: "Withings",
  whoop: "WHOOP",
  fitbit: "Fitbit",
  nightscout: "Nightscout",
  polar: "Polar",
  oura: "Oura",
  "google-health": "Google Health",
  strava: "Strava",
} as const;

/** Where the guardian boundary is explained, connected services included. */
const SHARING_DOCS_HREF =
  "https://docs.healthlog.dev/self-hosting/account-sharing#records-with-no-login";

function iconFor(key: ManagedIntegrationKey) {
  if (key === "nightscout") return Droplet;
  return OAUTH_INTEGRATIONS[key]?.icon ?? Plug;
}

/**
 * The managed record's connections, on the same card every integration in
 * Settings renders, from the same server-resolved `health`.
 *
 * Read-only by construction: a guardian cannot connect, reconnect, resume,
 * sync, test or disconnect a managed record's provider, because an OAuth flow
 * cannot safely carry a record selector. So the cards carry no menu and no
 * button, and one sentence above them says why, with the page that explains
 * the boundary.
 */
export function ManagedIntegrationStatus() {
  const { t } = useTranslations();
  const { user } = useAuth();
  const activeRecord = user?.accountAccess?.active ?? null;
  const recordId = activeRecord?.accountId ?? null;
  const statusQuery = useQuery({
    queryKey: queryKeys.recordSettingsIntegrations(recordId ?? ""),
    queryFn: async () => {
      const response = await apiGet<ManagedIntegrationStatusResponse>(
        "/api/record-settings/integrations",
      );
      assertRecordSettingsResponseForRecord(response, recordId);
      return response;
    },
    enabled: activeRecord?.recordKind === "managed" && recordId !== null,
  });

  if (statusQuery.isError) {
    return (
      <QueryErrorCard
        error={statusQuery.error}
        onRetry={() => void statusQuery.refetch()}
      />
    );
  }

  const loading = statusQuery.isLoading || !statusQuery.data;
  const entries =
    statusQuery.data?.integrations ??
    (Object.keys(INTEGRATION_DISPLAY_NAMES) as ManagedIntegrationKey[]).map(
      (integration) => ({ integration, health: null }),
    );

  return (
    <section
      className="space-y-4"
      aria-labelledby={loading ? undefined : "managed-integration-status-title"}
      aria-busy={loading || undefined}
      aria-live={loading ? "polite" : undefined}
      data-record-id={recordId ?? undefined}
      data-record-settings-family="integrations"
    >
      <SectionHeading
        icon={Plug}
        id="managed-integration-status-title"
        title={t("settings.sections.integrations.title")}
        subtitle={t("settings.sharedRecord.integrationStatusDescription")}
      />
      <p className="text-sm" data-slot="managed-integration-read-only">
        {t("settings.sharedRecord.integrationStatusDetail")}{" "}
        <a
          href={SHARING_DOCS_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          {t("settings.sharedRecord.integrationStatusDocs")}
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </p>
      <ul
        className="space-y-4"
        aria-label={activeRecord?.displayName ?? undefined}
      >
        {entries.map((entry) => (
          <li key={entry.integration}>
            <IntegrationCard
              provider={entry.integration}
              providerName={INTEGRATION_DISPLAY_NAMES[entry.integration]}
              icon={iconFor(entry.integration)}
              loading={loading}
              connected={entry.health !== null}
              health={entry.health}
              testId={`managed-integration-${entry.integration}`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
