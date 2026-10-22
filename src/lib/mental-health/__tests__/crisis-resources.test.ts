import { describe, expect, it } from "vitest";

import { locales } from "@/lib/i18n/config";
import { getServerTranslator } from "@/lib/i18n/server-translator";

import { crisisResourcesForLocale } from "../crisis-resources";

describe("crisisResourcesForLocale", () => {
  it("gives a Brazilian Portuguese reader CVV and SAMU", () => {
    const set = crisisResourcesForLocale("pt-BR");
    expect(set.emergencyNumber).toBe("192");
    expect(set.resources[0]).toEqual({
      id: "cvv",
      contacts: ["188", "cvv.org.br/chat"],
    });
  });

  it("keeps the international set for Portuguese outside Brazil", () => {
    // 188 does not connect from Portugal.
    for (const locale of ["pt", "pt-PT"]) {
      const set = crisisResourcesForLocale(locale);
      expect(set.emergencyNumber).toBe("112");
      expect(set.resources.map((r) => r.id)).not.toContain("cvv");
    }
  });

  it("names every resource of every locale's set in that locale", () => {
    for (const locale of locales) {
      const { t } = getServerTranslator(locale);
      for (const resource of crisisResourcesForLocale(locale).resources) {
        const key = `mentalHealth.crisisResource.${resource.id}.name`;
        expect(t(key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});
