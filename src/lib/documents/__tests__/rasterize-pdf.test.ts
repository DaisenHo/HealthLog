import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/context", () => ({ annotate: vi.fn() }));

import {
  pageText,
  RASTER_HARD_MAX_PAGES,
  RASTER_MAX_PAGES,
  RASTER_PAGE_TEXT_MAX,
  rasterizePdf,
  TEXT_LAYER_CUT_MARK,
} from "../rasterize-pdf";

/**
 * Rasterization renders a PDF's pages to bounded JPEG images. Pins: a text-layer
 * PDF and a synthetic image-only (graphics-only, no text layer) PDF both render
 * to JPEG page images; the page cap is honoured; malformed input degrades to
 * `{ ok: false }` and never throws.
 *
 * The fixtures are built inline (a tiny hand-assembled PDF with a correct xref)
 * so the test carries no binary blobs.
 */
function buildPdf(pageCount: number, withText: boolean): Buffer {
  return buildPdfFromContents(
    Array.from({ length: pageCount }, (_, p) =>
      withText
        ? `BT /F1 24 Tf 40 120 Td (Page ${p + 1} lab report glucose creatinine) Tj ET`
        : `0 0 1 rg 40 40 120 120 re f`,
    ),
  );
}

/** A PDF with one page per content stream, on the given media box. */
function buildPdfFromContents(
  contents: string[],
  mediaBox = "0 0 200 200",
): Buffer {
  const pageCount = contents.length;
  const pageNums: number[] = [];
  const perPage: { pageNum: number; contentNum: number; content: string }[] =
    [];
  let n = 4;
  for (const content of contents) {
    const pageNum = n++;
    const contentNum = n++;
    pageNums.push(pageNum);
    perPage.push({ pageNum, contentNum, content });
  }

  const bodies: string[] = [];
  bodies[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  bodies[2] = `<< /Type /Pages /Kids [${pageNums
    .map((x) => `${x} 0 R`)
    .join(" ")}] /Count ${pageCount} >>`;
  bodies[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  for (const { pageNum, contentNum, content } of perPage) {
    bodies[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`;
    bodies[contentNum] =
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
  }

  const total = n - 1;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i <= total; i++) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${bodies[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= total; i++) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

/** JPEG magic bytes. */
function isJpeg(base64: string): boolean {
  const head = Buffer.from(base64, "base64").subarray(0, 2).toString("hex");
  return head === "ffd8";
}

describe("rasterizePdf", () => {
  it("renders a text-layer PDF's pages to JPEG images", async () => {
    const result = await rasterizePdf(buildPdf(3, true));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(3);
    for (const img of result.images) {
      expect(img.mediaType).toBe("image/jpeg");
      expect(isJpeg(img.dataBase64)).toBe(true);
    }
  });

  it("renders a synthetic image-only (no text layer) PDF", async () => {
    const result = await rasterizePdf(buildPdf(1, false));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(1);
    expect(isJpeg(result.images[0]!.dataBase64)).toBe(true);
  });

  it("reads each page's text layer beside its image when asked", async () => {
    const result = await rasterizePdf(buildPdf(2, true), 20, {
      withText: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The fixture's line runs off its 200 pt page; pdfjs keeps what is on it.
    expect(result.texts).toHaveLength(2);
    expect(result.texts?.[0]).toMatch(/^Page 1 lab/);
    expect(result.texts?.[1]).toMatch(/^Page 2 lab/);
  });

  it("gives a page without a text layer an empty text, and none unless asked", async () => {
    const scanned = await rasterizePdf(buildPdf(1, false), 20, {
      withText: true,
    });
    expect(scanned.ok && scanned.texts).toEqual([""]);
    const plain = await rasterizePdf(buildPdf(1, true));
    expect(plain.ok && plain.texts).toBeUndefined();
  });

  it("stops collecting a page's text at the cap while reading, cut at a line and marked", async () => {
    // 900 short lines on one tall page: past RASTER_PAGE_TEXT_MAX.
    const lines = Array.from(
      { length: 900 },
      (_, i) => `(Marker ${String(i).padStart(4, "0")} value 12,34) Tj T*`,
    );
    const pdf = buildPdfFromContents(
      // The filled box gives the page ink, so it is not taken for a blank.
      [
        `0 0 1 rg 0 0 200 3000 re f 0 g BT /F1 3 Tf 3 TL 5 2995 Td ${lines.join(" ")} ET`,
      ],
      "0 0 200 3000",
    );
    const result = await rasterizePdf(pdf, 1, { withText: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = result.texts?.[0] ?? "";
    expect(text.length).toBeLessThanOrEqual(RASTER_PAGE_TEXT_MAX);
    const kept = text.split("\n");
    expect(kept.at(-1)).toBe(TEXT_LAYER_CUT_MARK);
    expect(kept[0]).toBe("Marker 0000 value 12,34");
    expect(kept.at(-2)).toMatch(/^Marker \d{4} value 12,34$/);
  });

  it("hard-cuts a page that is one endless line instead of keeping only the mark", async () => {
    const endless = "1".repeat(16_000);
    const pdf = buildPdfFromContents(
      [
        `0 0 1 rg 0 0 20000 200 re f 0 g BT /F1 1 Tf 0 100 Td (${endless}) Tj ET`,
      ],
      "0 0 20000 200",
    );
    const result = await rasterizePdf(pdf, 1, { withText: true });
    const text = (result.ok && result.texts?.[0]) || "";
    expect(text.length).toBeLessThanOrEqual(RASTER_PAGE_TEXT_MAX);
    expect(text.endsWith(TEXT_LAYER_CUT_MARK)).toBe(true);
    expect(text.length).toBeGreaterThan(RASTER_PAGE_TEXT_MAX / 2);
  });

  it("stops reading a line that never ends once it passes the cap", async () => {
    // One text item after another with no line end: past the cap the rest
    // is not read into memory at all.
    let read = 0;
    const items = Array.from({ length: 5000 }, () => ({
      get str() {
        read += 1;
        return "123456789";
      },
      hasEOL: false,
    }));
    const text = await pageText({
      getTextContent: async () => ({ items }),
    });
    expect(text.endsWith(TEXT_LAYER_CUT_MARK)).toBe(true);
    expect(read).toBeLessThan(RASTER_PAGE_TEXT_MAX / 5);
  });

  it("lets a caller ask for more pages, never past RASTER_HARD_MAX_PAGES", async () => {
    const result = await rasterizePdf(
      buildPdf(RASTER_HARD_MAX_PAGES + 2, false),
      RASTER_HARD_MAX_PAGES + 10,
    );
    expect(result.ok && result.images).toHaveLength(RASTER_HARD_MAX_PAGES);
  });

  it("caps the number of rendered pages at RASTER_MAX_PAGES", async () => {
    const result = await rasterizePdf(buildPdf(RASTER_MAX_PAGES + 4, true));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(RASTER_MAX_PAGES);
    // The page count travels with the result, so a caller can say the
    // reading stopped short.
    expect(result.pageCount).toBe(RASTER_MAX_PAGES + 4);
  });

  it("honours a caller maxPages bound (thumbnail path renders page 1 only)", async () => {
    const result = await rasterizePdf(buildPdf(5, true), 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toHaveLength(1);
  });

  it("returns { ok: false } and never throws on malformed input", async () => {
    await expect(
      rasterizePdf(Buffer.from("this is not a pdf")),
    ).resolves.toEqual({ ok: false, reason: "render-failed" });
  });

  it("returns { ok: false } on an empty buffer", async () => {
    await expect(rasterizePdf(Buffer.alloc(0))).resolves.toEqual({
      ok: false,
      reason: "render-failed",
    });
  });
});
