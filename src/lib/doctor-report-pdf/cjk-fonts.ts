/** Server-side font loading; report text never leaves this process. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locale } from "@/lib/i18n/config";
import type { DoctorReportData } from "@/lib/doctor-report-data";
import type { DoctorReportFontData } from "@/lib/doctor-report-pdf-core";

let cached: Promise<DoctorReportFontData> | undefined;

export function loadDoctorReportFonts(
  data: DoctorReportData,
  locale: Locale,
): Promise<DoctorReportFontData | undefined> {
  if (locale !== "zh-CN" && !/\p{Script=Han}/u.test(JSON.stringify(data))) {
    return Promise.resolve(undefined);
  }
  cached ??= Promise.all(
    ["Regular", "Bold"].map((weight) =>
      readFile(
        join(process.cwd(), "public/fonts", `NotoSansSC-${weight}.ttf`),
        "base64",
      ),
    ),
  )
    .then(([normal, bold]) => ({ normal, bold }))
    .catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
  return cached;
}
