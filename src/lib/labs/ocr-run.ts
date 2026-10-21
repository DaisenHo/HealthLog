/**
 * A lab report scan, run in the background worker.
 *
 * `POST /api/labs/ocr/extract` checks the capability, the rate bucket and the
 * budget, validates the upload, seals it into a `DocumentAiRun` and answers
 * 202. This is the read itself: the report split into reads (a PDF a page at
 * a time, as many reads as the run's deadline allows; a photo as one; OCR'd
 * text in parts at line boundaries), one extraction per read with its
 * corrective retry, every read after the first reserved against the day's
 * budget on its own, and the whole settled against what the provider
 * reported it spent, a failed scan included.
 *
 * Nothing is written to the person's record here. The proposed rows go back
 * through the run for the mandatory review screen, and the commit route stays
 * the only write path.
 */
import type { Buffer } from "node:buffer";

import { AI_BUDGETS } from "@/lib/ai/ai-budgets";
import { reserveBudget, resolveDailyCap } from "@/lib/ai/coach/budget";
import type { ProviderChainType } from "@/lib/ai/provider-chain";
import { settleAiRunBudget } from "@/lib/documents/ai-runs/store";
import type { AiRunBudget, AiRunOutcome } from "@/lib/documents/ai-runs/types";
import { rasterizePdf } from "@/lib/documents/rasterize-pdf";
import type { ProviderChainResolved } from "@/lib/ai/provider-runner";
import type { VisionProviderPick } from "@/lib/labs/ocr-capability";
import {
  OcrExtractError,
  runOcrExtraction,
  type OcrChunk,
  type OcrMeter,
  type RunOcrExtractionArgs,
} from "@/lib/labs/ocr-extract";
import { annotate } from "@/lib/logging/context";
import type { OcrExtractResponseDto } from "@/lib/validations/labs-ocr";

/** The most sequential model calls one read makes: the call and one retry. */
export const OCR_EXTRACT_MODEL_CALLS = 2;

/**
 * The most PDF pages a scan reads. A multi-panel hospital report runs to a
 * dozen pages; past this the review screen says which pages were read.
 */
export const OCR_MAX_PAGES = 20;

/**
 * OCR'd text per read. A line of a lab table is about one reading, and this
 * many characters keep a read's JSON well inside the per-read output ceiling.
 * One photo's text is usually below it, so it stays one read.
 */
export const OCR_TEXT_READ_CHARS = 4000;

/** The tokens a scan reserves at enqueue, by mode. */
export const OCR_RESERVE_TOKENS = {
  vision: AI_BUDGETS.ocrExtract.maxTokens,
  text: AI_BUDGETS.ocrExtractText.maxTokens,
} as const;

/**
 * What the run's deadline allows. The worker knows the person's response time
 * and the job's expiry; the read only knows how many calls it wants to make.
 */
export interface OcrSchedule {
  /** Sequential model calls that still fit before the run's deadline. */
  maxModelCalls(): number;
  /** Move the run's deadline to cover `modelCalls` sequential calls. */
  arm(modelCalls: number): Promise<void>;
}

/**
 * Split `pageCount` pages into contiguous reads: one page each, unless the
 * deadline allows fewer reads than pages, in which case the pages are shared
 * out evenly. Every page lands in exactly one read.
 */
export function planPageReads(pageCount: number, maxReads: number): number[][] {
  const reads = Math.max(1, Math.min(pageCount, Math.floor(maxReads)));
  const perRead = Math.ceil(pageCount / reads);
  const out: number[][] = [];
  for (let first = 1; first <= pageCount; first += perRead) {
    const last = Math.min(first + perRead - 1, pageCount);
    out.push(Array.from({ length: last - first + 1 }, (_, i) => first + i));
  }
  return out;
}

/**
 * Split OCR'd text into reads at line boundaries (a lab table row is a line,
 * so no reading is cut in half), no more than `maxReads` of them. Text that
 * fits one read stays one read.
 */
export function splitOcrText(text: string, maxReads: number): string[] {
  const reads = Math.max(1, Math.floor(maxReads));
  const target = Math.max(OCR_TEXT_READ_CHARS, Math.ceil(text.length / reads));
  if (text.length <= target) return [text];
  const parts: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current && current.length + 1 + line.length > target) {
      parts.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) parts.push(current);
  while (parts.length > reads) {
    const last = parts.pop() as string;
    parts[parts.length - 1] = `${parts[parts.length - 1]}\n${last}`;
  }
  return parts;
}

/**
 * The most OCR'd text one read may carry. Past it the JSON for that much text
 * no longer fits one read's output ceiling, so a part this long is refused up
 * front instead of being read into a certain cut.
 */
export const OCR_TEXT_READ_MAX_CHARS = 8000;

/** The text layer of these pages, each headed by its number when several. */
function pageTextFor(pages: number[], texts: string[] | undefined): string {
  if (!texts) return "";
  const parts = pages
    .map((p) => ({ p, text: texts[p - 1]?.trim() ?? "" }))
    .filter((x) => x.text.length > 0);
  if (pages.length === 1) return parts[0]?.text ?? "";
  return parts.map((x) => `[page ${x.p}]\n${x.text}`).join("\n\n");
}

/** How many reads the deadline leaves room for. */
function maxReadsFor(schedule: OcrSchedule | undefined): number {
  if (!schedule) return Number.POSITIVE_INFINITY;
  return Math.max(
    1,
    Math.floor(schedule.maxModelCalls() / OCR_EXTRACT_MODEL_CALLS),
  );
}

export type OcrVisionPick = NonNullable<VisionProviderPick["pick"]>;
export interface OcrTextPick {
  entry: ProviderChainResolved;
  providerType: string;
}

export type OcrRunInput =
  | { mode: "text"; text: string; pick: OcrTextPick }
  | {
      mode: "vision";
      bytes: Buffer;
      mime: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
      pick: OcrVisionPick;
    };

/**
 * The wide-event facts of a failed provider call: the status and the model,
 * never the upstream body. The base URL can be one a user typed, and what an
 * arbitrary endpoint answers has no business in the event stream (v1.39.3);
 * the stored failure carries neither.
 */
function providerFailureMeta(error: unknown, mode?: "text") {
  const err = error as { httpStatus?: unknown; model?: unknown };
  return {
    reason: "provider_error",
    ...(mode ? { mode } : {}),
    ...(typeof err.httpStatus === "number"
      ? { upstreamStatus: err.httpStatus }
      : {}),
    ...(typeof err.model === "string" ? { model: err.model } : {}),
  };
}

/** A failure in the shape the route would answer with (`errorCode` literal, so the catalogue guard reads it). */
const failure = (f: {
  status: number;
  message: string;
  errorCode: string;
}): AiRunOutcome<never> => ({ ok: false, ...f });

/** The 422 a read that produced nothing usable answers with. */
function unreadable(err: OcrExtractError): AiRunOutcome<never> {
  return err.reason === "output_limit"
    ? failure({
        status: 422,
        message:
          "The AI provider stopped at its output limit before it returned a reading.",
        errorCode: "labs.ocr.outputLimit",
      })
    : failure({
        status: 422,
        message: "Couldn't read the report. Try a clearer photo.",
        errorCode: "labs.ocr.extractFailed",
      });
}

/** Read one lab report into proposed rows. The caller authorised the read. */
export async function executeOcrExtraction(args: {
  userId: string;
  input: OcrRunInput;
  budget: AiRunBudget | undefined;
  /** The run's deadline; absent, the read is planned without one. */
  schedule?: OcrSchedule;
}): Promise<AiRunOutcome<OcrExtractResponseDto>> {
  const { userId, input, budget, schedule } = args;
  const servedBy = input.pick.entry.providerType as ProviderChainType;
  const meter: OcrMeter = { spent: 0, cached: 0 };
  // The route reserved the first read. Every further read is reserved on its
  // own against the day's budget before it is sent, so a long report cannot
  // spend past the budget the route checked once; when the budget runs out
  // the scan stops there and names the pages it did not read.
  let reserved = budget?.reserved ?? 0;
  const reserveRead = budget
    ? async () => {
        const next = await reserveBudget(
          userId,
          AI_BUDGETS.ocrExtract.maxTokens,
          budget.dateKey,
          resolveDailyCap([{ providerType: servedBy }]),
          budget.owner,
          "coach",
          undefined,
          { countMessage: false },
        );
        if (next.allowed) reserved += next.reserved;
        return next.allowed;
      }
    : undefined;
  // Settled against everything reserved, with what the provider reported for
  // every call made, failed scans included: a scan that fails after several
  // reads is charged for them, and only what was never spent goes back. A
  // successful scan whose provider reported nothing is charged its
  // reservation.
  const settle = (succeeded: boolean) => {
    const spent =
      succeeded && meter.spent <= 0 ? reserved : Math.max(0, meter.spent);
    return settleAiRunBudget(
      userId,
      budget ? { ...budget, reserved } : undefined,
      spent,
      spent > 0 ? servedBy : null,
      spent > 0 ? meter.cached : 0,
    );
  };
  const read = async (
    run: Omit<
      RunOcrExtractionArgs,
      "userId" | "provider" | "providerType" | "meter" | "reserveRead"
    >,
  ): Promise<AiRunOutcome<OcrExtractResponseDto>> => {
    try {
      const result = await runOcrExtraction({
        userId,
        provider: input.pick.entry.instance,
        providerType: input.pick.providerType,
        meter,
        reserveRead,
        ...run,
      });
      await settle(true);
      return { ok: true, data: result.data };
    } catch (err) {
      await settle(false);
      if (err instanceof OcrExtractError) return unreadable(err);
      annotate({
        action: { name: "labs.ocr.extractFailed" },
        meta: providerFailureMeta(
          err,
          run.mode === "text" ? "text" : undefined,
        ),
      });
      return failure({
        status: 502,
        message:
          "The configured AI provider could not process this report. Check the provider configuration and retry.",
        errorCode: "labs.ocr.extractFailed",
      });
    }
  };

  if (input.mode === "text") {
    const parts = splitOcrText(input.text, maxReadsFor(schedule));
    // A part that one read cannot return in full is refused before anything
    // is sent, rather than read into a certain cut: the deadline left too
    // few reads for this much text.
    if (parts.some((part) => part.length > OCR_TEXT_READ_MAX_CHARS)) {
      annotate({
        action: { name: "labs.ocr.fileRejected" },
        meta: { reason: "text_too_large", parts: parts.length },
      });
      await settle(false);
      return failure({
        status: 422,
        message: "This text is too long for one scan.",
        errorCode: "labs.ocr.tooLarge",
      });
    }
    await schedule?.arm(parts.length * OCR_EXTRACT_MODEL_CALLS);
    return read({
      mode: "text",
      chunks: parts.map((text) => ({ text, pages: [] })),
    });
  }

  const { pick, bytes, mime } = input;
  let chunks: OcrChunk[];
  let totalPages: number | undefined;
  let pageCoverage: { read: number; total: number } | undefined;

  if (mime === "application/pdf") {
    // Every PDF is rendered first: a report of more than one page is read a
    // page at a time, whatever the provider, so no single call has to hold
    // the whole report. A provider that reads PDFs natively still gets the
    // document itself when it is one page, or when it cannot be rendered.
    // With each page's text layer: a digitally produced report states its
    // digits exactly there, and the rendered page alone is a picture at a
    // capped resolution.
    const raster = await rasterizePdf(bytes, OCR_MAX_PAGES, {
      withText: true,
    });
    if (raster.ok && (raster.images.length > 1 || !pick.pdfSupported)) {
      totalPages = raster.pageCount;
      chunks = planPageReads(raster.images.length, maxReadsFor(schedule)).map(
        (pages) => ({
          images: pages.map((p) => raster.images[p - 1]),
          documents: [],
          pages,
          pageText: pageTextFor(pages, raster.texts),
        }),
      );
      // A PDF longer than the page cap is read from its first pages only, and
      // the person reviewing the rows is the one who needs to know.
      if (raster.pageCount > raster.images.length) {
        pageCoverage = { read: raster.images.length, total: raster.pageCount };
        annotate({
          action: { name: "labs.ocr.pagesCapped" },
          meta: { read: raster.images.length, total: raster.pageCount },
        });
      }
    } else if (pick.pdfSupported) {
      chunks = [
        {
          images: [],
          documents: [
            {
              mediaType: "application/pdf",
              dataBase64: bytes.toString("base64"),
            },
          ],
          pages: [],
        },
      ];
    } else {
      annotate({
        action: { name: "labs.ocr.fileRejected" },
        meta: { reason: "pdf_rasterize_failed" },
      });
      await settle(false);
      return failure({
        status: 422,
        message: "Couldn't read this PDF; upload a photo instead.",
        errorCode: "labs.ocr.pdfNeedsAnthropic",
      });
    }
  } else {
    chunks = [
      {
        images: [{ mediaType: mime, dataBase64: bytes.toString("base64") }],
        documents: [],
        pages: [],
      },
    ];
  }

  await schedule?.arm(chunks.length * OCR_EXTRACT_MODEL_CALLS);
  const outcome = await read({ mode: "vision", chunks, totalPages });
  return outcome.ok && pageCoverage
    ? { ok: true, data: { ...outcome.data, pageCoverage } }
    : outcome;
}
