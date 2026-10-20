import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import { stripImageMetadata } from "@/lib/clinician-share/exif-strip";

/**
 * The stripper walks container structure and drops metadata carriers without
 * decoding pixels. These fixtures are hand-built minimal-but-valid segment
 * streams so we can assert exactly which markers survive.
 */

function u16be(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}
function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}
function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

/** A JPEG segment: FF <marker> <len BE incl. the 2 len bytes> <payload>. */
function jpegSegment(marker: number, payload: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, marker]),
    u16be(payload.length + 2),
    payload,
  ]);
}

describe("stripImageMetadata — passthrough", () => {
  it("leaves non-strippable types byte-for-byte unchanged", () => {
    const pdf = Buffer.from("%PDF-1.4 fake pdf body");
    expect(stripImageMetadata(pdf, "application/pdf")).toBe(pdf);
    const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 1, 2, 3]);
    expect(stripImageMetadata(tiff, "image/tiff")).toBe(tiff);
    const heic = Buffer.from("ftyp-heic-fake");
    expect(stripImageMetadata(heic, "image/heic")).toBe(heic);
  });

  it("returns malformed input for the claimed type unchanged (fail-safe)", () => {
    const notJpeg = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(stripImageMetadata(notJpeg, "image/jpeg")).toBe(notJpeg);
  });
});

describe("stripImageMetadata — JPEG", () => {
  // SOI + APP0(JFIF) + APP1(Exif w/ GPS) + APP2(ICC) + COM + DQT + SOS + scan.
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = jpegSegment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0"));
  const exifPayload = Buffer.concat([
    Buffer.from("Exif\0\0"),
    // A recognisable GPS marker string we can assert is gone.
    Buffer.from("GPSLatitude=48.137 GPSLongitude=11.575"),
  ]);
  const app1 = jpegSegment(0xe1, exifPayload);
  const iccPayload = Buffer.concat([
    Buffer.from("ICC_PROFILE\0"),
    Buffer.from([1, 2, 3, 4]),
  ]);
  const app2 = jpegSegment(0xe2, iccPayload);
  const com = jpegSegment(0xfe, Buffer.from("private comment"));
  const dqt = jpegSegment(0xdb, Buffer.from([0x00, 0x01, 0x02, 0x03]));
  const sosAndScan = Buffer.concat([
    Buffer.from([0xff, 0xda]),
    u16be(2 + 6),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
    Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]), // entropy-coded scan bytes
  ]);
  const jpeg = Buffer.concat([soi, app0, app1, app2, com, dqt, sosAndScan]);

  it("removes EXIF/GPS, XMP-carrying APP1, and the comment segment", () => {
    const out = stripImageMetadata(jpeg, "image/jpeg");
    expect(out.includes(Buffer.from("Exif\0\0"))).toBe(false);
    expect(out.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(out.includes(Buffer.from("private comment"))).toBe(false);
  });

  it("keeps JFIF (APP0), ICC (APP2), the quantisation table, and the scan data", () => {
    const out = stripImageMetadata(jpeg, "image/jpeg");
    expect(out.subarray(0, 2)).toEqual(soi);
    expect(out.includes(Buffer.from("JFIF"))).toBe(true);
    expect(out.includes(Buffer.from("ICC_PROFILE"))).toBe(true);
    // The DQT segment and the entropy-coded scan tail must survive verbatim.
    expect(out.includes(dqt)).toBe(true);
    expect(out.includes(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]))).toBe(true);
    // Output is strictly smaller (metadata removed).
    expect(out.length).toBeLessThan(jpeg.length);
  });
});

describe("stripImageMetadata — PNG", () => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function pngChunk(type: string, data: Buffer): Buffer {
    return Buffer.concat([
      u32be(data.length),
      Buffer.from(type, "ascii"),
      data,
      u32be(0),
    ]);
  }
  const ihdr = pngChunk(
    "IHDR",
    Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
  );
  const exif = pngChunk("eXIf", Buffer.from("GPSInfo private-location"));
  const text = pngChunk("tEXt", Buffer.from("Comment\0secret note"));
  const itxt = pngChunk(
    "iTXt",
    Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>"),
  );
  const gama = pngChunk("gAMA", Buffer.from([0, 0, 0x8a, 0x3d]));
  const idat = pngChunk("IDAT", Buffer.from([0x78, 0x9c, 0x01, 0x00]));
  const iend = pngChunk("IEND", Buffer.alloc(0));
  const png = Buffer.concat([sig, ihdr, exif, text, itxt, gama, idat, iend]);

  it("removes eXIf, tEXt, and iTXt (XMP) chunks", () => {
    const out = stripImageMetadata(png, "image/png");
    expect(out.includes(Buffer.from("GPSInfo"))).toBe(false);
    expect(out.includes(Buffer.from("secret note"))).toBe(false);
    expect(out.includes(Buffer.from("xmpmeta"))).toBe(false);
  });

  it("keeps IHDR, gAMA, IDAT, IEND and the signature", () => {
    const out = stripImageMetadata(png, "image/png");
    expect(out.subarray(0, 8)).toEqual(sig);
    expect(out.includes(gama)).toBe(true);
    expect(out.includes(idat)).toBe(true);
    expect(out.includes(iend)).toBe(true);
    expect(out.length).toBeLessThan(png.length);
  });
});

describe("stripImageMetadata — WebP", () => {
  function webpChunk(fourcc: string, data: Buffer): Buffer {
    const padded =
      data.length % 2 === 1 ? Buffer.concat([data, Buffer.from([0])]) : data;
    return Buffer.concat([
      Buffer.from(fourcc, "ascii"),
      u32le(data.length),
      padded,
    ]);
  }
  // VP8X with EXIF (0x08) + XMP (0x04) flags set, an image chunk, plus EXIF/XMP.
  const vp8xFlags = Buffer.from([0x08 | 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const vp8x = webpChunk("VP8X", vp8xFlags);
  const vp8 = webpChunk("VP8 ", Buffer.from([0x11, 0x22, 0x33, 0x44]));
  const exif = webpChunk("EXIF", Buffer.from("GPSLocation private"));
  const xmp = webpChunk("XMP ", Buffer.from("<x:xmpmeta>secret</x:xmpmeta>"));
  const body = Buffer.concat([vp8x, vp8, exif, xmp]);
  const header = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    u32le(4 + body.length),
    Buffer.from("WEBP", "ascii"),
  ]);
  const webp = Buffer.concat([header, body]);

  it("removes the EXIF and XMP chunks", () => {
    const out = stripImageMetadata(webp, "image/webp");
    expect(out.includes(Buffer.from("GPSLocation"))).toBe(false);
    expect(out.includes(Buffer.from("xmpmeta"))).toBe(false);
  });

  it("keeps the image chunk and clears the VP8X EXIF/XMP flag bits", () => {
    const out = stripImageMetadata(webp, "image/webp");
    expect(out.includes(Buffer.from([0x11, 0x22, 0x33, 0x44]))).toBe(true);
    // Locate VP8X and check its flag byte: EXIF/XMP bits cleared.
    const vp8xIdx = out.indexOf(Buffer.from("VP8X", "ascii"));
    expect(vp8xIdx).toBeGreaterThan(0);
    const flags = out[vp8xIdx + 8];
    expect(flags & 0x08).toBe(0);
    expect(flags & 0x04).toBe(0);
  });

  it("rewrites the RIFF size header to match the trimmed body", () => {
    const out = stripImageMetadata(webp, "image/webp");
    expect(out.toString("ascii", 0, 4)).toBe("RIFF");
    expect(out.toString("ascii", 8, 12)).toBe("WEBP");
    // Declared size == 4 (for "WEBP") + the remaining chunk bytes.
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
  });
});
