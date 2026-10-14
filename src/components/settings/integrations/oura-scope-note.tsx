"use client";

import { Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTranslations } from "@/lib/i18n/context";
import type { OuraScopeGatedCollection } from "@/lib/oura/scope";

/**
 * A calm note on the Oura card when the stored grant does not cover some
 * collections (they answer 401 while their siblings succeed). Not an error and
 * not counted toward the reconnect threshold: everything else keeps syncing,
 * and one reconnect asks Oura for the missing scopes.
 */
export function OuraScopeNote({
  collections,
  onReconnect,
  disabled,
}: {
  collections: readonly OuraScopeGatedCollection[] | undefined;
  onReconnect: () => void;
  disabled?: boolean;
}) {
  const { t, locale } = useTranslations();
  if (!collections || collections.length === 0) return null;

  const labels: Record<OuraScopeGatedCollection, string> = {
    spo2: t("settings.integrations.oura.scope.items.spo2"),
    vo2max: t("settings.integrations.oura.scope.items.vo2max"),
    cardio_age: t("settings.integrations.oura.scope.items.cardio_age"),
    resilience: t("settings.integrations.oura.scope.items.resilience"),
  };
  const list = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(collections.map((c) => labels[c]));

  return (
    <div
      data-testid="oura-scope-note"
      className="border-info/30 bg-info/10 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
    >
      <p className="min-w-0 break-words">
        {t("settings.integrations.oura.scope.body", { list })}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onReconnect}
        disabled={disabled}
        data-testid="oura-scope-reconnect"
        className="min-h-11"
      >
        <Link2 className="h-3.5 w-3.5" />
        {t("settings.integrations.oura.scope.action")}
      </Button>
    </div>
  );
}
