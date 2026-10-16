/**
 * `POST /api/medications/{id}/ingredients/extract` — read a supplement label.
 *
 * Multipart `file` (JPEG, PNG, WebP or PDF, at most 10 MB). Answers 202 with
 * an AI run; `GET /api/ai-runs/{id}` (`SUPPLEMENT_LABEL_EXTRACT`) carries a
 * proposal of ingredients, unmatched lines and a serving note. Nothing is
 * stored until the composition is saved through the PUT beside this route.
 *
 * Guards, in order: the account's own session (see below), the `nutrients`
 * module, the medication, the `supplementLabel` AI capability (the one gate:
 * operator switch, modules, usage level, consent), a provider that can read
 * an image re-checked for exactly that provider, six reads an hour, the day's
 * AI budget, then the upload (size, then a magic-byte sniff). A slot and a
 * reservation taken early go back when a later check refuses.
 *
 * HEIC is refused with `medications.ingredients.extract.fileType`: no
 * provider HealthLog speaks reads it, and the server has no decoder for it.
 * The web picker does not offer it, so a phone browser hands over a JPEG.
 *
 * Authority: the account's own session (`requireAuth`), like the lab scan.
 * Reading a label is provider work, and provider work is never admitted for
 * a delegate inside somebody else's record (`not_permitted_for_record`), so
 * a MANAGE admission here would open a door the capability closes on the
 * next line. The composition itself is saved through the PUT, which is
 * MANAGE.
 */
import { Buffer } from "node:buffer";
import { NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { apiHandler, requireAuth } from "@/lib/api-handler";
import { apiError } from "@/lib/api-response";
import { requireAiCapability } from "@/lib/ai/capabilities/gate";
import {
  buildDateKey,
  reconcileSpend,
  reserveBudget,
  resolveCostOwner,
  resolveDailyCap,
} from "@/lib/ai/coach/budget";
import { startAiRun } from "@/lib/documents/ai-runs/start";
import {
  BodyTooLargeError,
  detectOcrMimeType,
  readBoundedBody,
} from "@/lib/labs/ocr-upload";
import { annotate } from "@/lib/logging/context";
import {
  SUPPLEMENT_LABEL_RESERVE_TOKENS,
  requireSupplementLabelProvider,
} from "@/lib/medications/ingredients/label-extract";
import { requireModuleEnabled } from "@/lib/modules/gate";
import {
  checkRateLimit,
  rateLimitHeaders,
  refundRateLimit,
} from "@/lib/rate-limit";
import { SUPPLEMENT_LABEL_MAX_BYTES } from "@/lib/validations/medication-ingredients";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

const LABEL_LIMIT_PER_HOUR = 6;
const LABEL_WINDOW_MS = 60 * 60 * 1000;

function bucket(userId: string): string {
  return `supplement-label:${userId}`;
}

async function refundSlot(userId: string): Promise<void> {
  try {
    await refundRateLimit(bucket(userId));
  } catch {
    // The original response matters more than the bookkeeping.
  }
}

function fileTooLarge(): Response {
  return apiError("File is too large (max 10 MB).", 413, {
    errorCode: "medications.ingredients.extract.fileTooLarge",
  });
}

function wrongFileType(): Response {
  return apiError("Upload a JPEG, PNG, WebP or PDF.", 422, {
    errorCode: "medications.ingredients.extract.fileType",
  });
}

export const POST = apiHandler(
  async (request: NextRequest, { params }: RouteParams) => {
    const { user } = await requireAuth();
    const { id } = await params;
    const gate = await requireModuleEnabled(user.id, "nutrients");
    if (!gate.enabled) return gate.response;

    const medication = await prisma.medication.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!medication || medication.userId !== user.id) {
      return apiError("Medication not found", 404, {
        errorCode: "medications.notFound",
      });
    }

    // The one AI gate. The provider and the consent receipt are answered by
    // the pick below, for the provider actually used.
    await requireAiCapability("supplementLabel", { pickDecides: true });
    const pick = await requireSupplementLabelProvider(user.id);

    const rl = await checkRateLimit(
      bucket(user.id),
      LABEL_LIMIT_PER_HOUR,
      LABEL_WINDOW_MS,
    );
    if (!rl.allowed) {
      annotate({
        action: { name: "medication.ingredients.extract.rateLimited" },
      });
      return apiError("Too many label reads. Try again later.", 429, {
        errorCode: "medications.ingredients.extract.rateLimited",
        retryAt: new Date(rl.resetAt).toISOString(),
        headers: rateLimitHeaders(rl),
      });
    }

    const dateKey = await buildDateKey(user.id);
    const reservation = await reserveBudget(
      user.id,
      SUPPLEMENT_LABEL_RESERVE_TOKENS,
      dateKey,
      resolveDailyCap([{ providerType: pick.entry.providerType }]),
      resolveCostOwner([{ providerType: pick.entry.providerType }]),
      "coach",
    );
    if (!reservation.allowed) {
      await refundSlot(user.id);
      annotate({
        action: { name: "medication.ingredients.extract.budgetExceeded" },
      });
      return apiError("Your AI usage budget for today is reached.", 429, {
        errorCode: "medications.ingredients.extract.budgetExceeded",
      });
    }
    const giveBack = async () => {
      await reconcileSpend(user.id, reservation.reserved, 0, dateKey, 0, {
        servedBy: null,
        reservedOwner: reservation.owner,
      }).catch(() => {});
      await refundSlot(user.id);
    };

    try {
      const declared = Number(request.headers.get("content-length") ?? 0);
      // Multipart framing adds a few hundred bytes around the file.
      if (declared > SUPPLEMENT_LABEL_MAX_BYTES + 64 * 1024) {
        await giveBack();
        return fileTooLarge();
      }
      let formData: FormData;
      try {
        const bytes = await readBoundedBody(
          request.body,
          SUPPLEMENT_LABEL_MAX_BYTES + 64 * 1024,
        );
        formData = await new Response(new Blob([bytes]), {
          headers: {
            "content-type": request.headers.get("content-type") ?? "",
          },
        }).formData();
      } catch (err) {
        await giveBack();
        if (err instanceof BodyTooLargeError) return fileTooLarge();
        return apiError("Invalid multipart body", 400);
      }

      const file = formData.get("file");
      if (!(file instanceof File)) {
        await giveBack();
        return apiError("Field 'file' must be a file", 422, {
          errorCode: "medications.ingredients.extract.fileType",
        });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length > SUPPLEMENT_LABEL_MAX_BYTES) {
        await giveBack();
        return fileTooLarge();
      }
      // The wire Content-Type is untrusted; the bytes decide.
      const mime = detectOcrMimeType(buffer);
      if (!mime) {
        await giveBack();
        annotate({
          action: { name: "medication.ingredients.extract.fileRejected" },
        });
        return wrongFileType();
      }

      return await startAiRun({
        userId: user.id,
        kind: "SUPPLEMENT_LABEL_EXTRACT",
        params: {
          mode: "vision",
          mime,
          budget: {
            reserved: reservation.reserved,
            owner: reservation.owner,
            dateKey,
          },
        },
        input: buffer,
        refundSlot: () => refundSlot(user.id),
      });
    } catch (err) {
      await giveBack();
      throw err;
    }
  },
);
