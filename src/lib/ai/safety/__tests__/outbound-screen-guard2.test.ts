/**
 * The plan-gated dose continuation exemption and the fr/es/it/pl risk-bank
 * parity.
 */
import { describe, it, expect } from "vitest";

import {
  screenModelOutput,
  CONVERSATIONAL_CONTRACTS,
} from "@/lib/ai/safety/outbound-screen";

describe("screenModelOutput — dose exemption gated on the plan", () => {
  const PLAN = [
    { name: "Semaglutide", dose: 7.5 },
    { name: "Ramipril", dose: 5 },
    { name: "Atorvastatin", dose: 40 },
  ];

  it("passes a continuation dose that MATCHES the user's plan", () => {
    const d = screenModelOutput(
      "You should keep taking your prescribed semaglutide 7.5 mg exactly as directed.",
      "en",
      CONVERSATIONAL_CONTRACTS,
      { dosePlan: PLAN },
    );
    expect(d.block).toBe(false);
  });

  it("BLOCKS a continuation dose that does NOT match the plan (closes the M6 window)", () => {
    // The plan says 7.5; "keep taking your 15 mg" is a wrong maintenance
    // dose and must not ride the continuation exemption.
    const d = screenModelOutput(
      "You should keep taking your semaglutide 15 mg as prescribed.",
      "en",
      CONVERSATIONAL_CONTRACTS,
      { dosePlan: PLAN },
    );
    expect(d.block).toBe(true);
    expect(d.reason).toBe("dose_prescription");
  });

  it("BLOCKS a stated continuation dose when no plan is supplied", () => {
    // "As before" is the model's claim. Without the plan nothing confirms it.
    for (const [text, locale] of [
      ["You should keep taking your 7.5 mg as prescribed.", "en"],
      ["Take 40 mg as before.", "en"],
      ["Tome 40 mg como antes.", "pt-BR"],
      ["Nimm 40 mg wie bisher.", "de"],
      ["Neem 40 mg zoals eerder.", "nl"],
    ] as const) {
      expect(
        screenModelOutput(text, locale, CONVERSATIONAL_CONTRACTS).block,
        text,
      ).toBe(true);
      expect(
        screenModelOutput(text, locale, CONVERSATIONAL_CONTRACTS, {
          dosePlan: [],
        }).block,
        text,
      ).toBe(true);
    }
  });

  it("passes a named continuation when the plan holds that dose for it", () => {
    for (const [text, locale] of [
      ["Take atorvastatin 40 mg as before.", "en"],
      ["Tome atorvastatina 40 mg como antes.", "pt-BR"],
      ["Nimm Atorvastatin 40 mg wie bisher.", "de"],
      ["Neem atorvastatine 40 mg zoals eerder.", "nl"],
    ] as const) {
      expect(
        screenModelOutput(text, locale, CONVERSATIONAL_CONTRACTS, {
          dosePlan: PLAN,
        }).block,
        text,
      ).toBe(false);
    }
  });

  it("blocks an amount with no medication named beside it, even on the plan", () => {
    for (const text of [
      "Take 40 mg as before.",
      "You should keep taking your prescribed 7.5 mg exactly as directed.",
    ]) {
      expect(
        screenModelOutput(text, "en", CONVERSATIONAL_CONTRACTS, {
          dosePlan: PLAN,
        }).block,
        text,
      ).toBe(true);
    }
  });

  it("blocks a brand the plan does not carry, and swapped doses", () => {
    for (const text of [
      "Take Eliquis 5 mg as before.",
      "Take Xarelto 40 mg as before.",
      "Take ramipril 40 mg and atorvastatin 5 mg as before.",
    ]) {
      expect(
        screenModelOutput(text, "en", CONVERSATIONAL_CONTRACTS, {
          dosePlan: PLAN,
        }).block,
        text,
      ).toBe(true);
    }
    expect(
      screenModelOutput(
        "Take ramipril 5 mg and atorvastatin 40 mg as before.",
        "en",
        CONVERSATIONAL_CONTRACTS,
        { dosePlan: PLAN },
      ).block,
    ).toBe(false);
  });

  it("holds a named medication to its own dose, not to any dose on the plan", () => {
    // 40 mg is on the plan, but for atorvastatin, not ramipril.
    expect(
      screenModelOutput(
        "Take 40 mg of ramipril as before.",
        "en",
        CONVERSATIONAL_CONTRACTS,
        { dosePlan: PLAN },
      ).block,
    ).toBe(true);
    expect(
      screenModelOutput(
        "Tome 40 mg de ramipril como antes.",
        "pt-BR",
        CONVERSATIONAL_CONTRACTS,
        { dosePlan: PLAN },
      ).block,
    ).toBe(true);
    expect(
      screenModelOutput(
        "Take 40 mg of atorvastatin as before.",
        "en",
        CONVERSATIONAL_CONTRACTS,
        { dosePlan: PLAN },
      ).block,
    ).toBe(false);
    expect(
      screenModelOutput(
        "Take 5 mg of ramipril as before.",
        "en",
        CONVERSATIONAL_CONTRACTS,
        { dosePlan: PLAN },
      ).block,
    ).toBe(false);
  });

  it("never trusts a continuation for a drug outside the plan", () => {
    expect(
      screenModelOutput(
        "Take 40 mg of simvastatin as before.",
        "en",
        CONVERSATIONAL_CONTRACTS,
        { dosePlan: PLAN },
      ).block,
    ).toBe(true);
  });

  it("still blocks a titration even when the change lands on a planned value", () => {
    // A change stem voids the exemption regardless of plan membership.
    const d = screenModelOutput(
      "You should continue tapering to 7.5 mg next week.",
      "en",
      CONVERSATIONAL_CONTRACTS,
      { dosePlan: PLAN },
    );
    expect(d.block).toBe(true);
  });

  it("matches a comma-decimal planned dose (DE reader)", () => {
    const d = screenModelOutput(
      "Nimm weiterhin dein Semaglutid 7,5 mg wie verordnet.",
      "de",
      CONVERSATIONAL_CONTRACTS,
      { dosePlan: PLAN },
    );
    expect(d.block).toBe(false);
  });
});

// ── fr / es / it / pl risk-bank parity ──────────────────────────────────────

describe("screenModelOutput — fabricated risk blocks in fr/es/it/pl", () => {
  const DIGIT_RISK: Record<string, string> = {
    fr: "Votre risque cardiovasculaire est d'environ 14 %.",
    es: "Su riesgo cardiovascular es de aproximadamente 14 %.",
    it: "Il suo rischio cardiovascolare è di circa 14 %.",
    pl: "Twoje ryzyko sercowo-naczyniowe wynosi około 14 %.",
  };
  for (const [locale, text] of Object.entries(DIGIT_RISK)) {
    it(`blocks a digit risk percentage in ${locale}`, () => {
      const d = screenModelOutput(
        text,
        locale as never,
        CONVERSATIONAL_CONTRACTS,
      );
      expect(d.block).toBe(true);
      expect(d.reason).toBe("risk_score");
    });
  }

  it("blocks a spelled-out risk percentage in fr", () => {
    const d = screenModelOutput(
      "Votre risque est d'environ quatorze pour cent selon vos chiffres.",
      "fr",
      CONVERSATIONAL_CONTRACTS,
    );
    expect(d.block).toBe(true);
  });

  it("blocks a named-engine result in es", () => {
    const d = screenModelOutput(
      "Según Framingham, un 14 % en diez años.",
      "es",
      CONVERSATIONAL_CONTRACTS,
    );
    expect(d.block).toBe(true);
  });

  it("blocks a categorical engine verdict (numberless) in it", () => {
    const d = screenModelOutput(
      "SCORE2 la colloca in una fascia ad alto rischio.",
      "it",
      CONVERSATIONAL_CONTRACTS,
    );
    expect(d.block).toBe(true);
  });

  it("does not over-block an ordinary wellness sentence in fr", () => {
    const d = screenModelOutput(
      "Votre sommeil s'est amélioré cette semaine, continuez comme ça.",
      "fr",
      CONVERSATIONAL_CONTRACTS,
    );
    expect(d.block).toBe(false);
  });
});
