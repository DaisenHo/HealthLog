/**
 * `resolveOrMintBiomarker`: the auto-link-on-write helper.
 *
 * Every free-text lab write resolves (or mints) a user-scoped Biomarker so NO
 * `LabResult` row ever persists unlinked. Since v1.43 the name resolves
 * through the account's markers and aliases (`resolveInIndex`), loaded in one
 * read. Asserts: case-insensitive reuse, alias reuse, mint-on-miss from the
 * reading's own spelling, no silent rewrite of an existing marker, a minted
 * marker found by the next row through a shared index, and the concurrent
 * unique-violation race adopting the winner.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  biomarker: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  biomarkerAlias: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: db }));

import { loadMarkerIndex } from "@/lib/labs/biomarker-resolve";
import { resolveOrMintBiomarker } from "@/lib/labs/biomarker-store";

const baseInput = {
  analyte: "LDL",
  unit: "mg/dL",
  referenceLow: null,
  referenceHigh: 116 as number | null,
  panel: "lipids" as string | null,
};

function marker(overrides: Record<string, unknown>) {
  return {
    id: "bm",
    name: "Marker",
    unit: "mg/dL",
    lowerBound: null,
    upperBound: null,
    panel: null,
    analyteKey: null,
    hidden: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.biomarker.findMany.mockResolvedValue([]);
  db.biomarkerAlias.findMany.mockResolvedValue([]);
});

describe("resolveOrMintBiomarker", () => {
  it("reuses an existing marker (case-insensitive) without minting", async () => {
    db.biomarker.findMany.mockResolvedValue([
      marker({ id: "bm_existing", name: "LDL", upperBound: 100 }),
    ]);

    const out = await resolveOrMintBiomarker("u1", {
      ...baseInput,
      analyte: "ldl", // lowercase free-text spelling
    });

    expect(out.id).toBe("bm_existing");
    // Existing marker keeps its own unit/range — the incoming free-text
    // values do NOT rewrite it.
    expect(out.upperBound).toBe(100);
    expect(db.biomarker.create).not.toHaveBeenCalled();
    expect(db.biomarker.findMany.mock.calls[0][0].where).toEqual({
      userId: "u1",
    });
  });

  it("reuses the marker an alias of the account names", async () => {
    db.biomarker.findMany.mockResolvedValue([
      marker({ id: "bm_alp", name: "Alkaline Phosphatase", unit: "U/L" }),
    ]);
    db.biomarkerAlias.findMany.mockResolvedValue([
      { biomarkerId: "bm_alp", name: "Alk.P", nameFolded: "alk.p" },
    ]);

    const out = await resolveOrMintBiomarker("u1", {
      ...baseInput,
      analyte: "ALK.P",
      unit: "U/L",
    });

    expect(out.id).toBe("bm_alp");
    expect(db.biomarker.create).not.toHaveBeenCalled();
  });

  it("mints a new marker from the reading when none exists", async () => {
    db.biomarker.create.mockResolvedValue(
      marker({ id: "bm_new", name: "LDL", upperBound: 116, panel: "lipids" }),
    );

    const out = await resolveOrMintBiomarker("u1", baseInput);

    expect(out.id).toBe("bm_new");
    const data = db.biomarker.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: "u1",
      name: "LDL",
      unit: "mg/dL",
      lowerBound: null,
      upperBound: 116,
      panel: "lipids",
    });
  });

  it("trims the analyte before minting", async () => {
    db.biomarker.create.mockResolvedValue(
      marker({ id: "bm_x", name: "Ferritin", unit: "ng/mL" }),
    );

    await resolveOrMintBiomarker("u1", {
      analyte: "  Ferritin  ",
      unit: "ng/mL",
      referenceLow: 30,
      referenceHigh: 400,
      panel: null,
    });

    expect(db.biomarker.create.mock.calls[0][0].data.name).toBe("Ferritin");
  });

  it("finds a marker minted for an earlier row through the shared index", async () => {
    db.biomarker.create.mockResolvedValue(
      marker({ id: "bm_tsh", name: "TSH", unit: "mIU/L" }),
    );
    const index = await loadMarkerIndex(db as never, "u1");
    const input = { ...baseInput, analyte: "TSH", unit: "mIU/L" };

    const first = await resolveOrMintBiomarker("u1", input, { index });
    const second = await resolveOrMintBiomarker(
      "u1",
      { ...input, analyte: "tsh" },
      { index },
    );

    expect(first.id).toBe("bm_tsh");
    expect(second.id).toBe("bm_tsh");
    expect(db.biomarker.create).toHaveBeenCalledTimes(1);
    expect(db.biomarker.findMany).toHaveBeenCalledTimes(1);
  });

  it("adopts the race winner on a concurrent unique violation", async () => {
    // The index misses; create throws (the other writer won the unique
    // index); the re-lookup finds the winner.
    db.biomarker.findFirst.mockResolvedValueOnce(
      marker({ id: "bm_winner", name: "TSH", unit: "mIU/L" }),
    );
    db.biomarker.create.mockRejectedValue(new Error("unique constraint"));

    const out = await resolveOrMintBiomarker("u1", {
      analyte: "TSH",
      unit: "mIU/L",
      referenceLow: 0.4,
      referenceHigh: 4,
      panel: "thyroid",
    });

    expect(out.id).toBe("bm_winner");
    expect(db.biomarker.findFirst).toHaveBeenCalledTimes(1);
  });

  it("throws when the create fails and no race winner exists", async () => {
    db.biomarker.findFirst.mockResolvedValue(null);
    db.biomarker.create.mockRejectedValue(new Error("db down"));

    await expect(resolveOrMintBiomarker("u1", baseInput)).rejects.toThrow(
      /Failed to resolve biomarker/,
    );
  });
});
