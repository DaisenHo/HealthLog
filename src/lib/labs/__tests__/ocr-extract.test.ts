/**
 * The lab scan's reads and their merge. A report used to go to the provider
 * as one call under a fixed output ceiling and a 100-row envelope cap, and a
 * long report lost everything: the reply stopped mid-row and failed to parse
 * (the person saw "try a clearer photo"), or it held 101 rows and the schema
 * refused all of them. These pin the replacement: per-read calls, the cut
 * detected from the finish reason with the closed rows kept, the cap keeping
 * the first rows, and identical readings across pages merged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/context", () => ({ annotate: vi.fn() }));
vi.mock("@/lib/tz/resolver", () => ({
  resolveUserTimezone: vi.fn().mockResolvedValue("Europe/Berlin"),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    labResult: { findMany: vi.fn().mockResolvedValue([]) },
    biomarker: { findMany: vi.fn().mockResolvedValue([]) },
    biomarkerAlias: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import type { AIProvider, CompletionResult } from "@/lib/ai/types";
import {
  OcrExtractError,
  ocrChunkParams,
  runOcrExtraction,
  salvageTruncatedJson,
  type OcrChunk,
} from "@/lib/labs/ocr-extract";
import { OCR_MAX_ROWS } from "@/lib/validations/labs-ocr";

const row = (analyte: string, value: number, unit = "mg/dl") => ({
  analyte,
  value,
  valueText: null,
  unit,
  referenceText: null,
  referenceLow: null,
  referenceHigh: null,
  takenAt: null,
  confidence: { analyte: 1, value: 1, unit: 1, range: 1 },
});

const reply = (
  content: string,
  extra: Partial<CompletionResult> = {},
): CompletionResult => ({
  content,
  tokensUsed: 1000,
  model: "m",
  providerType: "anthropic",
  finishReason: "stop",
  ...extra,
});

const envelope = (rows: unknown[], reportDate: string | null = null) =>
  JSON.stringify({ reportDate, rows });

function provider(...replies: Array<CompletionResult | Error>) {
  const generateCompletion = vi.fn();
  for (const r of replies) {
    if (r instanceof Error) generateCompletion.mockRejectedValueOnce(r);
    else generateCompletion.mockResolvedValueOnce(r);
  }
  return {
    provider: { generateCompletion } as unknown as AIProvider,
    generateCompletion,
  };
}

const page = (n: number): OcrChunk => ({
  images: [{ mediaType: "image/jpeg", dataBase64: `p${n}` }],
  documents: [],
  pages: [n],
});
const photo: OcrChunk = {
  images: [{ mediaType: "image/jpeg", dataBase64: "photo" }],
  documents: [],
  pages: [],
};

const run = (p: AIProvider, chunks: OcrChunk[], totalPages?: number) =>
  runOcrExtraction({
    userId: "u1",
    provider: p,
    providerType: "anthropic",
    mode: "vision",
    chunks,
    totalPages,
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("salvageTruncatedJson", () => {
  it("keeps every row that closed before the cut", () => {
    const whole = envelope([row("Hb", 14), row("MCV", 90)], "2026-03-01");
    const cut = `${whole.slice(0, whole.indexOf('"MCV"') + 10)}`;
    expect(
      salvageTruncatedJson(`${whole.slice(0, -2)}, {"analyte": "X`),
    ).toEqual({
      reportDate: "2026-03-01",
      rows: [row("Hb", 14), row("MCV", 90)],
    });
    expect(salvageTruncatedJson(cut)).toEqual({
      reportDate: "2026-03-01",
      rows: [row("Hb", 14)],
    });
  });

  it("is not fooled by braces and escaped quotes inside strings", () => {
    const tricky = {
      ...row('Ab "}]{" \\ test', 1),
      referenceText: "< 5 } ]",
    };
    const whole = envelope([tricky, row("TSH", 2)]);
    const cut = whole.slice(0, whole.indexOf('"TSH"') + 3);
    expect(salvageTruncatedJson(cut)).toEqual({
      reportDate: null,
      rows: [tricky],
    });
  });

  it("is null for a complete document or one without a closed row", () => {
    expect(salvageTruncatedJson(envelope([row("Hb", 14)]))).toBeNull();
    expect(
      salvageTruncatedJson('{"reportDate": null, "rows": [{"ana'),
    ).toBeNull();
    expect(salvageTruncatedJson("")).toBeNull();
  });
});

describe("a read cut at the output limit", () => {
  it("keeps the rows before the cut, says so, and does not retry", async () => {
    const whole = envelope([row("Hb", 14), row("MCV", 90)]);
    const cut = whole.slice(0, whole.indexOf('"MCV"') + 10);
    const { provider: p, generateCompletion } = provider(
      reply(cut, { finishReason: "length" }),
    );
    const out = await run(p, [photo]);
    expect(out.data.rows.map((r) => r.analyte)).toEqual(["Hb"]);
    expect(out.data.truncated).toEqual({ pages: [] });
    expect(generateCompletion).toHaveBeenCalledTimes(1);
  });

  it("names the page whose read was cut", async () => {
    const whole = envelope([row("Hb", 14), row("MCV", 90)]);
    const cut = whole.slice(0, whole.indexOf('"MCV"') + 10);
    const { provider: p } = provider(
      reply(envelope([row("Na", 140, "mmol/l")])),
      reply(cut, { finishReason: "length" }),
    );
    const out = await run(p, [page(1), page(2)], 2);
    expect(out.data.rows.map((r) => r.analyte)).toEqual(["Na", "Hb"]);
    expect(out.data.truncated).toEqual({ pages: [2] });
    expect(out.data.unreadPages).toBeUndefined();
  });

  it("fails as an output limit, not as an unreadable photo, when no row closed", async () => {
    const { provider: p, generateCompletion } = provider(
      reply("", { finishReason: "length" }),
    );
    const err = await run(p, [photo]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrExtractError);
    expect((err as OcrExtractError).reason).toBe("output_limit");
    expect(generateCompletion).toHaveBeenCalledTimes(1);
  });

  it("reads Codex's incomplete stream as the same cut", async () => {
    const { provider: p } = provider(
      Object.assign(new Error("Codex stream incomplete: max_output_tokens"), {
        kind: "stream_failed",
        incompleteReason: "max_output_tokens",
      }),
    );
    const err = await run(p, [photo]).catch((e: unknown) => e);
    expect((err as OcrExtractError).reason).toBe("output_limit");
  });
});

describe("a reply that is not the schema", () => {
  it("is retried once, then fails as unreadable", async () => {
    const { provider: p, generateCompletion } = provider(
      reply("not json"),
      reply("still not json"),
    );
    const err = await run(p, [photo]).catch((e: unknown) => e);
    expect((err as OcrExtractError).reason).toBe("unparseable");
    expect(generateCompletion).toHaveBeenCalledTimes(2);
  });

  it("costs only its own page when the other pages read", async () => {
    const { provider: p } = provider(
      reply(envelope([row("Hb", 14)])),
      reply("nope"),
      reply("nope again"),
      reply(envelope([row("TSH", 2, "mU/l")])),
    );
    const out = await run(p, [page(1), page(2), page(3)], 3);
    expect(out.data.rows.map((r) => r.analyte)).toEqual(["Hb", "TSH"]);
    expect(out.data.unreadPages).toEqual([2]);
  });
});

describe("a provider failure partway through", () => {
  it("keeps the pages already read and names the rest", async () => {
    const { provider: p, generateCompletion } = provider(
      reply(envelope([row("Hb", 14)])),
      Object.assign(new Error("upstream 529"), { httpStatus: 529 }),
    );
    const out = await run(p, [page(1), page(2), page(3)], 3);
    expect(out.data.rows.map((r) => r.analyte)).toEqual(["Hb"]);
    expect(out.data.unreadPages).toEqual([2, 3]);
    // It stops: the third page is not sent to a provider that just failed.
    expect(generateCompletion).toHaveBeenCalledTimes(2);
  });

  it("is the scan's failure when nothing was read yet", async () => {
    const boom = Object.assign(new Error("upstream 401"), { httpStatus: 401 });
    const { provider: p } = provider(boom);
    await expect(run(p, [page(1), page(2)], 2)).rejects.toBe(boom);
  });
});

describe("the merge", () => {
  it("lists a reading printed on two pages once, in report order", async () => {
    const { provider: p } = provider(
      reply(envelope([row("Hb", 14), row("MCV", 90, "fl")], "2026-03-01")),
      reply(envelope([row("hb ", 14, "MG/DL"), row("TSH", 2, "mU/l")])),
    );
    const out = await run(p, [page(1), page(2)], 2);
    expect(out.data.rows.map((r) => r.analyte)).toEqual(["Hb", "MCV", "TSH"]);
    // The report's date reaches the rows of a page that printed none.
    expect(out.data.reportDate).toBe("2026-03-01");
    expect(out.data.rows.every((r) => r.takenAt === "2026-03-01")).toBe(true);
  });

  it("keeps the same value on another sample date", async () => {
    const { provider: p } = provider(
      reply(envelope([row("Hb", 14)], "2026-03-01")),
      reply(envelope([row("Hb", 14)], "2026-04-01")),
    );
    const out = await run(p, [page(1), page(2)], 2);
    expect(out.data.rows.map((r) => r.takenAt)).toEqual([
      "2026-03-01",
      "2026-04-01",
    ]);
  });

  it("keeps the first OCR_MAX_ROWS rows of a longer report and says how many there were", async () => {
    const rows = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => row(`Marker ${from + i}`, i));
    const { provider: p } = provider(
      reply(envelope(rows(0, 250))),
      reply(envelope(rows(250, 200))),
    );
    const out = await run(p, [page(1), page(2)], 2);
    expect(out.data.rows).toHaveLength(OCR_MAX_ROWS);
    expect(out.data.rows[0].analyte).toBe("Marker 0");
    expect(out.data.rowsCapped).toEqual({ kept: OCR_MAX_ROWS, found: 450 });
  });

  it("reports nothing extra for a clean read", async () => {
    const { provider: p } = provider(reply(envelope([row("Hb", 14)])));
    const out = await run(p, [photo]);
    expect(out.data).not.toHaveProperty("truncated");
    expect(out.data).not.toHaveProperty("unreadPages");
    expect(out.data).not.toHaveProperty("rowsCapped");
  });

  it("adds up what the reads cost, the ceiling standing in for an unreported one", async () => {
    const { provider: p } = provider(
      reply(envelope([row("Hb", 14)]), { tokensUsed: 1200 }),
      reply(envelope([row("TSH", 2)]), { tokensUsed: null }),
    );
    const out = await run(p, [page(1), page(2)], 2);
    expect(out.spentTokens).toBe(1200 + 8000);
  });
});

describe("what one read sends", () => {
  it("asks for no reasoning, the per-read ceiling and the OCR timeout", () => {
    const params = ocrChunkParams("vision", page(3), 2, 9, 9);
    expect(params.reasoning).toEqual({ effort: "off", summaries: false });
    expect(params.maxTokens).toBe(8000);
    expect(params.timeoutMs).toBe(120_000);
    expect(params.responseFormat).toBe("json");
    const content = params.messages[0].content;
    const text = Array.isArray(content) ? content[0] : null;
    expect(text).toMatchObject({ type: "text" });
    expect((text as { text: string }).text).toContain(
      "page 3 of a 9-page report",
    );
  });

  it("carries a text part in the user turn and nothing else", () => {
    const params = ocrChunkParams("text", { text: "Hb 14", pages: [] }, 1, 2);
    expect(params.reasoning).toEqual({ effort: "off", summaries: false });
    expect(typeof params.messages[0].content).toBe("string");
    expect(params.messages[0].content).toContain("(part 2 of 2)");
    expect(params.messages[0].content).toContain("Hb 14");
  });
});
