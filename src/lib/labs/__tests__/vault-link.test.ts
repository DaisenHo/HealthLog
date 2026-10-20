import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cross-link OCR-committed labs to their source vault document. Pins the
 * module gate + ownership fail-closed (both directions), the APPROVED
 * OBSERVATION provenance fact per inserted lab (committedRecordId/Type), the
 * supersede-PENDING + mark-CONFIRMED transition, and idempotency (an empty
 * insert links nothing).
 */

vi.mock("@/lib/modules/gate", () => ({ isModuleEnabled: vi.fn() }));
vi.mock("@/lib/documents/store", () => ({
  encryptFactData: vi.fn(() => new Uint8Array([1])),
  encryptFactProvenance: vi.fn(() => new Uint8Array([2])),
}));

const findFirst = vi.fn();
const deleteMany = vi.fn();
const createMany = vi.fn();
const update = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    inboundDocument: {
      findFirst: (...a: unknown[]) => findFirst(...a),
    },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        extractedFact: {
          deleteMany: (...a: unknown[]) => deleteMany(...a),
          createMany: (...a: unknown[]) => createMany(...a),
        },
        inboundDocument: { update: (...a: unknown[]) => update(...a) },
      }),
  },
}));

import { linkOcrLabsToVaultDocument } from "../vault-link";
import { isModuleEnabled } from "@/lib/modules/gate";
import { encryptFactData } from "@/lib/documents/store";

const mockModule = vi.mocked(isModuleEnabled);
const mockEncrypt = vi.mocked(encryptFactData);

const LABS = [
  {
    labResultId: "lab1",
    analyte: "Hämoglobin",
    value: 14.2,
    valueText: null,
    unit: "g/dl",
    referenceLow: 13,
    referenceHigh: 17,
    takenAt: new Date("2026-07-10T12:00:00.000Z"),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockModule.mockResolvedValue(true);
  findFirst.mockResolvedValue({ id: "doc1" });
  deleteMany.mockResolvedValue({ count: 0 });
  createMany.mockResolvedValue({ count: 1 });
  update.mockResolvedValue({});
});

describe("linkOcrLabsToVaultDocument", () => {
  it("links each inserted lab as an APPROVED observation fact and confirms the doc", async () => {
    const res = await linkOcrLabsToVaultDocument("u1", "doc1", LABS);
    expect(res).toEqual({ linked: 1 });
    // PENDING cross-fire facts superseded, then APPROVED provenance facts.
    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING" }),
      }),
    );
    const created = createMany.mock.calls[0]![0] as {
      data: {
        status: string;
        factType: string;
        committedRecordId: string;
        committedRecordType: string;
      }[];
    };
    expect(created.data[0]).toMatchObject({
      status: "APPROVED",
      factType: "OBSERVATION",
      committedRecordId: "lab1",
      committedRecordType: "labResult",
    });
    // The Observation payload carries the stated value verbatim.
    expect(mockEncrypt).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Hämoglobin",
        value: 14.2,
        unit: "g/dl",
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CONFIRMED" } }),
    );
  });

  it("links nothing when the documents module is off", async () => {
    mockModule.mockResolvedValue(false);
    const res = await linkOcrLabsToVaultDocument("u1", "doc1", LABS);
    expect(res).toEqual({ linked: 0 });
    expect(findFirst).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("fails closed on a foreign / missing document", async () => {
    findFirst.mockResolvedValue(null);
    const res = await linkOcrLabsToVaultDocument("u1", "doc1", LABS);
    expect(res).toEqual({ linked: 0 });
    expect(createMany).not.toHaveBeenCalled();
  });

  it("is a no-op with no inserted labs (idempotent re-commit)", async () => {
    const res = await linkOcrLabsToVaultDocument("u1", "doc1", []);
    expect(res).toEqual({ linked: 0 });
    expect(mockModule).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });
});
