"use client";

import Link from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import {
  ANTHROPIC_MODEL_PRESETS,
  LOCAL_MODEL_PRESETS,
  OPENAI_MODEL_PRESETS,
  uiToLegacyProviderEnum,
  type ProviderChainData,
  type ProviderType,
  type UserAIProvider,
} from "@/components/settings/ai/shared";
import { InlineAction } from "@/components/ui/inline-action";
import { QueryErrorRow } from "@/components/ui/query-error-row";
import { apiGet } from "@/lib/api/api-fetch";
import { useTranslations } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";

/**
 * Which provider answers the Coach and which model it uses, shown in the
 * Coach's settings overlay with a link to where it is chosen.
 *
 * The model is chosen in one place, Settings > AI. Until v1.44 this overlay
 * carried a second copy of the provider and model selects, writing through
 * the same routes; two controls for one setting meant a change in one place
 * surprised the person in the other. The overlay now reads the same two
 * queries and says what is in effect.
 */

export type ModelControl =
  | { kind: "preset"; presets: readonly string[]; value: string | null }
  | { kind: "gateway"; value: string | null }
  | { kind: "managed" };

const PRESETS: Partial<Record<ProviderType, readonly string[]>> = {
  openai: OPENAI_MODEL_PRESETS,
  anthropic: ANTHROPIC_MODEL_PRESETS,
  local: LOCAL_MODEL_PRESETS,
};

/**
 * Which model control the active provider gets. The model column is shared by
 * the OpenAI, Anthropic and Local providers and belongs to whichever of them
 * the person configured, so the control is offered only for that one; a
 * model name chosen for another would be sent to the wrong vendor.
 */
export function modelControlFor(
  active: ProviderType | null,
  userProvider: UserAIProvider | null | undefined,
): ModelControl {
  if (!active || !userProvider) return { kind: "managed" };
  if (active === "openai-compatible") {
    return { kind: "gateway", value: userProvider.compatModel };
  }
  const presets = PRESETS[active];
  if (presets && userProvider.provider === uiToLegacyProviderEnum(active)) {
    return { kind: "preset", presets, value: userProvider.model };
  }
  return { kind: "managed" };
}

export function CoachModelPicker() {
  const { t } = useTranslations();

  const chainQuery = useQuery({
    queryKey: queryKeys.insightsProviderChain(),
    queryFn: () => apiGet<ProviderChainData>("/api/insights/provider-chain"),
  });
  const providerQuery = useQuery({
    queryKey: queryKeys.userAiProvider(),
    queryFn: () => apiGet<UserAIProvider>("/api/user/ai-provider"),
  });

  if (chainQuery.isError || providerQuery.isError) {
    return (
      <QueryErrorRow
        inset
        error={chainQuery.error ?? providerQuery.error}
        slot="coach-model-picker-error"
        onRetry={() => {
          void chainQuery.refetch();
          void providerQuery.refetch();
        }}
      />
    );
  }

  const chain = chainQuery.data;
  const userProvider = providerQuery.data;
  if (!chain || !userProvider) {
    return (
      <p
        role="status"
        className="text-muted-foreground flex items-center gap-2 text-sm"
      >
        <Loader2
          className="size-4 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        {t("common.loading")}
      </p>
    );
  }

  // The server may answer with `admin-codex`, which the UI's type omits.
  const active = (chain.activeProvider ?? null) as string | null;
  const model = modelControlFor(chain.activeProvider ?? null, userProvider);
  const providerLabel =
    active === null
      ? t("insights.coach.frame.noProvider")
      : active === "admin-codex"
        ? t("insights.coach.frame.operatorCodex")
        : t(`settings.ai.providerChain.types.${active}`);
  const modelLabel =
    model.kind === "managed"
      ? t("insights.coach.frame.modelManaged")
      : (model.value ?? t("settings.ai.modelOptionDefault"));

  return (
    <div data-slot="coach-model-picker" className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">
          {t("insights.coach.frame.provider")}
        </dt>
        <dd data-slot="coach-quick-provider" data-value={active ?? ""}>
          {providerLabel}
        </dd>
        <dt className="text-muted-foreground">{t("settings.ai.modelLabel")}</dt>
        <dd
          data-slot="coach-quick-model"
          data-value={model.kind === "managed" ? "" : (model.value ?? "")}
        >
          {modelLabel}
        </dd>
      </dl>
      <p>
        <InlineAction asChild tone="muted">
          <Link href="/settings/ai#ai-provider" data-slot="coach-quick-change">
            {t("insights.coach.frame.changeModel")}
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Link>
        </InlineAction>
      </p>
    </div>
  );
}
