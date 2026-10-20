import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  auditCCutoff,
  auditCInstrument,
  auditCTotal,
  isValidatedAuditCLocale,
  normaliseAuditCLocale,
} from "../audit-c";
import { AUDIT_C_ITEMS, AUDIT_C_STANDARD_DRINK } from "../instruments";

describe("AUDIT-C cut-offs", () => {
  it("German entry, woman, sum 4: at the S3 cut-off of 4", () => {
    const cutoff = auditCCutoff("de", "FEMALE", "de");
    expect(cutoff).toMatchObject({
      value: 4,
      sex: "female",
      source: "S3_ALCOHOL_DE",
    });
    expect(cutoff?.sourceLabel).toContain("Deutschland");
    expect(auditCTotal([2, 1, 1]) >= cutoff!.value).toBe(true);
  });

  it("German men 5, Korean 5 and 4, everyone else Bradley 4 and 3", () => {
    expect(auditCCutoff("de", "MALE", "de")?.value).toBe(5);
    expect(auditCCutoff("ko", "MALE", "ko")).toMatchObject({
      value: 5,
      source: "KNHANES_KR",
    });
    expect(auditCCutoff("ko", "FEMALE", "ko")?.value).toBe(4);
    expect(auditCCutoff("en", "MALE", "en")).toMatchObject({
      value: 4,
      source: "BRADLEY_2007",
    });
    expect(auditCCutoff("fr", "FEMALE", "fr")?.value).toBe(3);
  });

  it("has no cut-off without a binary sex in the profile", () => {
    expect(auditCCutoff("de", null, "de")).toBeNull();
    expect(auditCCutoff("de", "OTHER", "de")).toBeNull();
  });

  it("names the country in the reader's language", () => {
    expect(auditCCutoff("en", "MALE", "es")?.sourceLabel).toContain(
      "Estados Unidos",
    );
  });
});

describe("AUDIT-C instrument", () => {
  it("serves the validated wording in the account language", () => {
    const de = auditCInstrument("de");
    expect(de.locale).toBe("de");
    expect(de.validatedLocale).toBe(true);
    expect(de.items).toHaveLength(3);
    expect(de.items[0].options.map((o) => o.value)).toEqual([0, 1, 2, 3, 4]);
    expect(de.attribution).toBe(
      "As a WHO-approved instrument, the AUDIT is in the public domain.",
    );
  });

  it("falls back to the WHO English items, never a translation of its own", () => {
    for (const locale of ["fr", "es", "it"]) {
      const instrument = auditCInstrument(locale);
      expect(instrument.locale).toBe("en");
      expect(instrument.validatedLocale).toBe(false);
      expect(instrument.items[0].stem).toBe(AUDIT_C_ITEMS.en.items[0].stem);
      // The help text is still in the account language.
      expect(instrument.standardDrink).toBe(AUDIT_C_STANDARD_DRINK[locale]);
    }
  });

  it("knows which languages are validated", () => {
    expect(["de", "en", "ko", "pl"].every(isValidatedAuditCLocale)).toBe(true);
    expect(["es", "fr", "it"].some(isValidatedAuditCLocale)).toBe(false);
    expect(normaliseAuditCLocale("pt-BR")).toBe("en");
    expect(normaliseAuditCLocale("de-AT")).toBe("de");
  });

  it("carries a standard-drink sentence for every app language", () => {
    for (const locale of ["de", "en", "es", "fr", "it", "pl", "ko", "nl"]) {
      expect(AUDIT_C_STANDARD_DRINK[locale]?.length).toBeGreaterThan(20);
    }
  });

  /**
   * The validated wording must not change: re-wording invalidates the score,
   * and the WHO licence forbids material changes. The hashes pin the exact
   * characters per language; a change here needs a new primary source, and
   * the source note in `instruments.ts` changes with it.
   */
  it("keeps the validated wording byte for byte", () => {
    const hashes = Object.fromEntries(
      Object.entries(AUDIT_C_ITEMS).map(([locale, wording]) => [
        locale,
        createHash("sha256")
          .update(JSON.stringify(wording.items))
          .digest("hex")
          .slice(0, 16),
      ]),
    );
    expect(hashes).toEqual(PINNED);
  });
});

const PINNED: Record<string, string> = {
  de: "4c072c57581dfa60",
  en: "7d91058682d56051",
  ko: "5617030281f6f963",
  pl: "1a06ca242af64e54",
};
