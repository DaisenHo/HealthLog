"use client";

/**
 * The requests behind an integration card's menu, shared by every provider
 * controller: sync now (optionally the whole history), test the connection,
 * and the lines that report what happened. The card renders the lines in its
 * body; the menu only starts the request.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";

import { WrittenOutcomeLine } from "@/components/outcome/written-outcome-line";
import {
  runConnectionTest,
  TestConnectionFailure,
  type ConnectionTestResult,
} from "@/components/settings/test-connection-button";
import { apiFetchRaw } from "@/lib/api/api-fetch";
import { useTranslations } from "@/lib/i18n/context";
import {
  invalidateKeys,
  measurementDependentKeys,
  queryKeys,
} from "@/lib/query-keys";

import {
  readSyncOutcome,
  useSyncOutcomeMessage,
  type SyncOutcomeState,
} from "./sync-outcome";

export interface ProviderSync {
  syncing: boolean;
  result: SyncOutcomeState | null;
  run: (fullSync: boolean) => void;
}

/**
 * Sync now, for every provider whose sync route answers the shared written
 * outcome. The tone comes off what the run wrote, never off `res.ok`.
 */
export function useStandardSync({
  provider,
  i18nPrefix,
  acceptsFullSync,
  fullSyncResult,
  statusQueryKey,
}: {
  /** Route segment: POST `/api/<provider>/sync`. */
  provider: string;
  i18nPrefix: string;
  /** The route takes `{ fullSync }`; the others take no body. */
  acceptsFullSync: boolean;
  /** A full sync has its own success sentence (`…FullSyncResult`). */
  fullSyncResult?: boolean;
  statusQueryKey?: readonly unknown[];
}): ProviderSync {
  const { t } = useTranslations();
  const describeSyncOutcome = useSyncOutcomeMessage();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncOutcomeState | null>(null);

  async function run(fullSync: boolean) {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await apiFetchRaw(
        `/api/${provider}/sync`,
        acceptsFullSync
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fullSync }),
            }
          : { method: "POST" },
      );
      const json = await res.json();
      const result = res.ok ? readSyncOutcome(json) : null;
      if (result) {
        setSyncResult({
          outcome: result.outcome,
          message: describeSyncOutcome(
            result,
            fullSync && fullSyncResult
              ? t(`${i18nPrefix}FullSyncResult`, { count: result.imported })
              : t(`${i18nPrefix}SyncResult`, { count: result.imported }),
          ),
        });
        void invalidateKeys(queryClient, measurementDependentKeys);
        if (statusQueryKey) {
          queryClient.invalidateQueries({ queryKey: statusQueryKey });
        }
        queryClient.invalidateQueries({
          queryKey: queryKeys.integrationsStatus(),
        });
      } else {
        setSyncResult({
          outcome: "failed",
          message: json?.error || t(`${i18nPrefix}SyncFailed`),
        });
      }
    } catch {
      setSyncResult({
        outcome: "failed",
        message: t(`${i18nPrefix}SyncFailed`),
      });
    } finally {
      setSyncing(false);
    }
  }

  return {
    syncing,
    result: syncResult,
    run: (fullSync) => void run(fullSync),
  };
}

/** "Test connection" from the menu; the result shows in the card body. */
export function useConnectionTest(endpoint: string) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  async function run() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await runConnectionTest(endpoint));
    } finally {
      setTesting(false);
    }
  }
  return { testing, result, run: () => void run() };
}

/**
 * What the last menu action reported: a running sync or test, the sync's
 * written outcome, the test's answer. Renders nothing when nothing ran.
 */
export function ActionResultLines({
  provider,
  sync,
  test,
}: {
  provider: string;
  sync?: Pick<ProviderSync, "syncing" | "result">;
  test?: ReturnType<typeof useConnectionTest>;
}) {
  const { t } = useTranslations();

  function describeError(errorCode: string): string {
    const key = `settings.testConnection.errors.${errorCode}`;
    const translated = t(key);
    return translated === key
      ? t("settings.testConnection.errors.generic")
      : translated;
  }

  const busy = sync?.syncing || test?.testing;
  const syncResult = sync?.result ?? null;
  if (!busy && !syncResult && !test?.result) return null;

  return (
    <div className="space-y-2" data-slot="integration-action-results">
      {busy ? (
        <p
          role="status"
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          <Loader2
            aria-hidden="true"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
          {sync?.syncing
            ? t("settings.integrationCard.syncing")
            : t("settings.testConnection.testing")}
        </p>
      ) : null}
      {syncResult ? (
        <WrittenOutcomeLine
          outcome={syncResult.outcome}
          message={syncResult.message}
          testId={`${provider}-sync-result`}
        />
      ) : null}
      {test?.result?.kind === "ok" ? (
        <p
          role="status"
          className="text-success flex items-center gap-1.5 text-xs"
          data-testid={`${provider}-test-result`}
        >
          <CheckCircle2 aria-hidden="true" className="size-3.5" />
          {t("settings.testConnection.ok", { latency: test.result.latency })}
        </p>
      ) : null}
      {test?.result?.kind === "error" ? (
        <TestConnectionFailure
          message={describeError(test.result.errorCode)}
          upstreamStatus={test.result.upstreamStatus}
          smtpCode={test.result.smtpCode}
          upstreamBody={test.result.upstreamBody}
        />
      ) : null}
    </div>
  );
}
