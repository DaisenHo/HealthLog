/**
 * GET / PATCH the caller's preview-feature opt-ins.
 *
 * GET answers every flag, off unless the caller switched it on. PATCH sets
 * the flags the body names and keeps the rest; unknown flags are refused
 * with the multi-issue 422 so a typo cannot silently do nothing. The blob
 * lives on its own `User` column (`preview_features_json`).
 *
 * The opt-ins are the caller's own, so this is an actor surface
 * (`requireActorAuth`): a browser acting for another record keeps reaching
 * the person's own switch. The PATCH reads and writes under a row lock, so two
 * flags switched at once both stay switched.
 */
import { apiHandler, requireActorAuth } from "@/lib/api-handler";
import { apiSuccess, returnAllZodIssues, safeJson } from "@/lib/api-response";
import { prisma, toJson } from "@/lib/db";
import { annotate } from "@/lib/logging/context";
import {
  PREVIEW_FEATURE_KEYS,
  resolvePreviewFeatures,
  type PreviewFeatures,
} from "@/lib/settings/preview-features";
import { previewFeaturesPatchSchema } from "@/lib/validations/settings-prefs";

export const dynamic = "force-dynamic";

async function readStored(
  userId: string,
  db: Pick<typeof prisma, "user"> = prisma,
): Promise<unknown> {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { previewFeaturesJson: true },
  });
  return row?.previewFeaturesJson;
}

function enabledFlags(features: PreviewFeatures): string[] {
  return PREVIEW_FEATURE_KEYS.filter((key) => features[key]);
}

export const GET = apiHandler(async () => {
  const { user } = await requireActorAuth();
  const features = resolvePreviewFeatures(await readStored(user.id));
  annotate({
    action: { name: "settings.preview-features.read" },
    meta: { enabled: enabledFlags(features) },
  });
  return apiSuccess(features);
});

export const PATCH = apiHandler(async (request: Request) => {
  const { user } = await requireActorAuth();

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 1024,
  });
  if (jsonError) return jsonError;

  const parsed = previewFeaturesPatchSchema.safeParse(body);
  if (!parsed.success) {
    annotate({
      action: { name: "settings.preview-features.validation-failed" },
    });
    return returnAllZodIssues(parsed.error, 422);
  }

  const next = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${user.id} FOR UPDATE`;
    const current = resolvePreviewFeatures(await readStored(user.id, tx));
    const merged: PreviewFeatures = {
      topics: parsed.data.topics ?? current.topics,
    };
    await tx.user.update({
      where: { id: user.id },
      data: { previewFeaturesJson: toJson(merged) },
    });
    return merged;
  });

  annotate({
    action: { name: "settings.preview-features.update" },
    meta: { enabled: enabledFlags(next) },
  });
  return apiSuccess(next);
});
