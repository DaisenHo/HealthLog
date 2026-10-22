/**
 * Inter, self-hosted. The build fetches nothing from the network for it.
 *
 * These are the files `next/font/google` used to download at build time for
 * `Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] })`,
 * byte for byte: Google serves Inter 4.001 as one variable file per script
 * subset, the same file for every weight. That download failed often enough
 * to break image builds, so the files live here under their licence
 * (`./inter/OFL.txt`) and the declarations below rebuild the stylesheet
 * Google answered: twenty-eight faces, the four weights for each of the seven
 * subsets with Google's `unicode-range`s, in Google's order (where two ranges
 * overlap the face declared later wins, so the order is part of the result),
 * `font-display: swap`, and only the Latin file preloaded.
 *
 * `next/font/local` emits one `unicode-range` per call, hence one call per
 * subset, all declaring the family `Inter`. The fallback face and the
 * `--font-sans` stack are in `globals.css`: the local loader would derive the
 * Arial metric overrides from the font file, and they come out a little
 * different from the ones next/font/google shipped, which are kept as they
 * were.
 *
 * Imported by the root layout for its stylesheet only.
 */
import localFont from "next/font/local";

// `next/font/local` is evaluated at build time from the literal arguments of
// each call, so every option below has to be written out in place.
// The bindings are never read: importing this module is what attaches the
// faces, so each name carries the leading underscore of an intended unused.
const _interCyrillicExt = localFont({
  src: [
    {
      path: "./inter/inter-cyrillic-ext.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./inter/inter-cyrillic-ext.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./inter/inter-cyrillic-ext.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "./inter/inter-cyrillic-ext.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Inter" },
    {
      prop: "unicode-range",
      value:
        "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
    },
  ],
});

const _interCyrillic = localFont({
  src: [
    { path: "./inter/inter-cyrillic.woff2", weight: "400", style: "normal" },
    { path: "./inter/inter-cyrillic.woff2", weight: "500", style: "normal" },
    { path: "./inter/inter-cyrillic.woff2", weight: "600", style: "normal" },
    { path: "./inter/inter-cyrillic.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Inter" },
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const _interGreekExt = localFont({
  src: [
    { path: "./inter/inter-greek-ext.woff2", weight: "400", style: "normal" },
    { path: "./inter/inter-greek-ext.woff2", weight: "500", style: "normal" },
    { path: "./inter/inter-greek-ext.woff2", weight: "600", style: "normal" },
    { path: "./inter/inter-greek-ext.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Inter" },
    { prop: "unicode-range", value: "U+1F00-1FFF" },
  ],
});

const _interGreek = localFont({
  src: [
    { path: "./inter/inter-greek.woff2", weight: "400", style: "normal" },
    { path: "./inter/inter-greek.woff2", weight: "500", style: "normal" },
    { path: "./inter/inter-greek.woff2", weight: "600", style: "normal" },
    { path: "./inter/inter-greek.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Inter" },
    {
      prop: "unicode-range",
      value:
        "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF",
    },
  ],
});

const _interVietnamese = localFont({
  src: [
    { path: "./inter/inter-vietnamese.woff2", weight: "400", style: "normal" },
    { path: "./inter/inter-vietnamese.woff2", weight: "500", style: "normal" },
    { path: "./inter/inter-vietnamese.woff2", weight: "600", style: "normal" },
    { path: "./inter/inter-vietnamese.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Inter" },
    {
      prop: "unicode-range",
      value:
        "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    },
  ],
});

const _interLatinExt = localFont({
  src: [
    { path: "./inter/inter-latin-ext.woff2", weight: "400", style: "normal" },
    { path: "./inter/inter-latin-ext.woff2", weight: "500", style: "normal" },
    { path: "./inter/inter-latin-ext.woff2", weight: "600", style: "normal" },
    { path: "./inter/inter-latin-ext.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Inter" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});

const _interLatin = localFont({
  src: [
    { path: "./inter/inter-latin.woff2", weight: "400", style: "normal" },
    { path: "./inter/inter-latin.woff2", weight: "500", style: "normal" },
    { path: "./inter/inter-latin.woff2", weight: "600", style: "normal" },
    { path: "./inter/inter-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Inter" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});
