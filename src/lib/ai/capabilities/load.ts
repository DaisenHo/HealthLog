/**
 * The AI capability loader: gathers the resolver's inputs for one record.
 *
 * One read per input, all of them in parallel, all of them memoised per
 * request, and most of them shared with reads the request makes anyway:
 *
 *   - operator switches: the `AppSettings` singleton (`loadAssistantSwitches`);
 *   - the record's module map and the operator's module availability: the same
 *     memoised reads the account payload and every module gate use;
 *   - provider presence: the record's credential row and the operator's
 *     provider columns (`probeProviderChain`), presence only;
 *   - consent: the kinds of the record's active receipts, one indexed read;
 *   - the record's AI usage level (v1.43): the operator's bounds (memoised)
 *     and one point read of the record's choice.
 *
 * Any failure resolves to `null`, which the resolver turns into
 * `check_failed` for every capability. Failing closed is safe because no data
 * depends on a capability; failing open would switch AI work on during a
 * database blip.
 */
import { prisma } from "@/lib/db";
import { loadAssistantSwitches } from "@/lib/feature-flags";
import { getEvent } from "@/lib/logging/context";
import {
  getOperatorModuleAvailability,
  resolveModuleMap,
} from "@/lib/modules/gate";
import { probeProviderChain } from "@/lib/ai/provider";
import { memoizePerRequest } from "@/lib/request-cache";
import { buildModuleDisclosure } from "@/lib/sharing/module-disclosure";
import {
  mayEnqueueProviderWork,
  type ProviderWorkAuthority,
} from "@/lib/sharing/provider-work-authority";
import type { ShareDomain } from "@/lib/sharing/scope";

import {
  resolveAiBlock,
  type AiCapabilityInputs,
  type AiRecordKind,
} from "./resolve";
import type { AiCapabilities } from "./types";
import { loadAiUsageState, loadRecordUsageLevel } from "./usage";

/** Whose record, seen by whom, through which grant. */
export interface AiCapabilityScope {
  /** The record the capability is resolved for. */
  recordId: string;
  /** The provider-work authority for that record; `null` admits nothing. */
  authority: ProviderWorkAuthority | null;
  /**
   * The sections the active grant opens, `null` for the whole record (one's
   * own record, an unscoped grant, a background job). Masks module access
   * exactly as the account payload masks `moduleAccess`.
   */
  sections: readonly ShareDomain[] | null;
  recordKind: AiRecordKind;
}

/** The kinds of the record's active consent receipts. */
function loadActiveConsentKinds(recordId: string): Promise<Set<string>> {
  return memoizePerRequest(
    `ai-consent-kinds:${recordId}`,
    async () => {
      const rows = await prisma.consentReceipt.findMany({
        where: { userId: recordId, revokedAt: null },
        select: { kind: true },
      });
      return new Set(rows.map((row) => row.kind));
    },
    { freshInBackground: true },
  );
}

function scopeKey(scope: AiCapabilityScope): string {
  return [
    scope.recordId,
    scope.authority?.origin ?? "none",
    scope.sections === null ? "*" : [...scope.sections].sort().join(","),
    scope.recordKind,
  ].join(":");
}

/**
 * Load the resolver's inputs for one scope, or `null` when any of them could
 * not be read.
 */
export function loadAiCapabilityInputs(
  scope: AiCapabilityScope,
): Promise<AiCapabilityInputs | null> {
  return memoizePerRequest(
    `ai-capability-inputs:${scopeKey(scope)}`,
    async () => {
      try {
        const [
          switches,
          modules,
          availability,
          provider,
          activeConsentKinds,
          usageLevel,
        ] = await Promise.all([
          loadAssistantSwitches(),
          resolveModuleMap(scope.recordId),
          getOperatorModuleAvailability(),
          probeProviderChain(scope.recordId, scope.authority),
          loadActiveConsentKinds(scope.recordId),
          loadRecordUsageLevel(scope.recordId),
        ]);
        if (switches === null) return null;
        const { moduleAccess } = buildModuleDisclosure(
          modules,
          availability,
          scope.sections,
        );
        return {
          switches,
          moduleAccess,
          providerWorkAdmitted: mayEnqueueProviderWork(scope.authority),
          provider,
          activeConsentKinds,
          recordKind: scope.recordKind,
          usageLevel,
        };
      } catch {
        getEvent()?.addWarning(
          "Failed to load AI capability inputs; every AI capability is off for this request",
        );
        return null;
      }
    },
    { freshInBackground: true },
  );
}

/**
 * The whole `ai` block for one scope, the record's AI usage level included
 * (v1.43). The measured use and the estimates are published for one's own
 * record only: a delegate sees which level a record runs at, not what its
 * owner spends. A usage read that fails leaves `usage` out rather than
 * failing the block; the capabilities already carry the level they resolved.
 */
export async function loadAiCapabilities(
  scope: AiCapabilityScope,
): Promise<AiCapabilities> {
  const [inputs, usage] = await Promise.all([
    loadAiCapabilityInputs(scope),
    loadAiUsageState(scope.recordId, {
      withMeasurement: scope.recordKind === "self",
    }).catch(() => undefined),
  ]);
  const block = resolveAiBlock(inputs);
  return usage ? { ...block, usage } : block;
}
