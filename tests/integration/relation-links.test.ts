/**
 * The relation links and `related[]` against real Postgres (v1.43).
 *
 * What is asserted here lives in `where` clauses and joins: the new link
 * pairs refuse another account's ids, both detail pages of a stored pair list
 * each other, the derived pairs run through a visit and through a medication's
 * efficacy target, a module that is off and a grant that does not cover a
 * section hide their kind, and the backup carries the five tables both ways.
 * A mocked client would report every one of them as working.
 */
import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import {
  buildRelationLinksBackupSection,
  restoreRelationLinksData,
} from "@/lib/export/relation-links-backup";
import type { RestoreSkipLog } from "@/lib/export/restore-skips";
import { linkTargets, unlinkTargets } from "@/lib/links";
import { buildRelated } from "@/lib/links/related";

import { getPrismaClient, truncateAllTables } from "./setup";

const OWNER = "relation-owner";
const STRANGER = "relation-stranger";
const READER = "relation-reader";

async function seedAccount(id: string) {
  const prisma = getPrismaClient();
  await prisma.user.create({
    data: { id, username: id, email: `${id}@example.test` },
  });
  const encounter = await prisma.encounter.create({
    data: {
      userId: id,
      occurredAt: new Date("2026-07-01T09:00:00.000Z"),
      status: "DONE",
      kind: "ROUTINE",
    },
  });
  const document = await prisma.inboundDocument.create({
    data: {
      userId: id,
      kind: "LAB_RESULT",
      title: `${id} report`,
      mimeType: "application/pdf",
      byteSize: 12,
      contentEncrypted: new Uint8Array([1, 2, 3]),
      contentCodec: "binary2",
      documentDate: new Date("2026-06-30T00:00:00.000Z"),
    },
  });
  const biomarker = await prisma.biomarker.create({
    data: { userId: id, name: "TSH", unit: "mU/L" },
  });
  const labResult = await prisma.labResult.create({
    data: {
      userId: id,
      biomarkerId: biomarker.id,
      analyte: "TSH",
      value: 2.1,
      unit: "mU/L",
      takenAt: new Date("2026-06-30T09:00:00.000Z"),
    },
  });
  const episode = await prisma.illnessEpisode.create({
    data: {
      userId: id,
      label: `${id} thyroid`,
      type: "CHRONIC",
      onsetAt: new Date("2026-01-20T00:00:00.000Z"),
    },
  });
  const medication = await prisma.medication.create({
    data: { userId: id, name: "Levothyroxine", dose: "50 µg" },
  });
  const vaccination = await prisma.vaccinationRecord.create({
    data: {
      userId: id,
      occurredAt: new Date("2026-05-14T00:00:00.000Z"),
      antigenSlug: "tdap",
      vaccineName: "Tdap",
    },
  });
  return {
    encounter,
    document,
    biomarker,
    labResult,
    episode,
    medication,
    vaccination,
  };
}

let owner: Awaited<ReturnType<typeof seedAccount>>;
let stranger: Awaited<ReturnType<typeof seedAccount>>;

beforeEach(async () => {
  await truncateAllTables(getPrismaClient());
  owner = await seedAccount(OWNER);
  stranger = await seedAccount(STRANGER);
});

const related = (
  kind: Parameters<typeof buildRelated>[1]["kind"],
  id: string,
) =>
  buildRelated(getPrismaClient(), { userId: OWNER, grantId: null, kind, id });

describe("new link pairs", () => {
  it("files a medication's indication, document and visit, and refuses foreign ids", async () => {
    const prisma = getPrismaClient();
    const cases = [
      ["conditionEpisode", owner.episode.id, stranger.episode.id],
      ["document", owner.document.id, stranger.document.id],
      ["encounter", owner.encounter.id, stranger.encounter.id],
    ] as const;
    for (const [targetKind, mine, theirs] of cases) {
      const result = await linkTargets(prisma, {
        userId: OWNER,
        sourceKind: "medication",
        sourceId: owner.medication.id,
        targetKind,
        targetIds: [mine, theirs],
      });
      expect(result.changed, targetKind).toBe(1);
      expect(result.unknownTargetIds, targetKind).toEqual([theirs]);
    }
    expect(await prisma.medicationConditionLink.count()).toBe(1);
    expect(await prisma.medicationDocumentLink.count()).toBe(1);
    expect(await prisma.encounterMedicationLink.count()).toBe(1);

    // Re-posting is a success that changes nothing.
    const again = await linkTargets(prisma, {
      userId: OWNER,
      sourceKind: "medication",
      sourceId: owner.medication.id,
      targetKind: "document",
      targetIds: [owner.document.id],
    });
    expect(again.changed).toBe(0);
  });

  it("refuses another account's medication as the source", async () => {
    const result = await linkTargets(getPrismaClient(), {
      userId: OWNER,
      sourceKind: "medication",
      sourceId: stranger.medication.id,
      targetKind: "document",
      targetIds: [owner.document.id],
    });
    expect(result.unknownSource).toBe(true);
  });

  it("files a lab result against its report and visit, and unfiles it", async () => {
    const prisma = getPrismaClient();
    for (const [targetKind, id] of [
      ["document", owner.document.id],
      ["encounter", owner.encounter.id],
    ] as const) {
      const result = await linkTargets(prisma, {
        userId: OWNER,
        sourceKind: "labResult",
        sourceId: owner.labResult.id,
        targetKind,
        targetIds: [id],
      });
      expect(result.changed, targetKind).toBe(1);
    }
    expect(await prisma.labResultDocumentLink.count()).toBe(1);
    expect(await prisma.encounterLabLink.count()).toBe(1);

    const removed = await unlinkTargets(prisma, {
      userId: OWNER,
      sourceKind: "labResult",
      sourceId: owner.labResult.id,
      targetKind: "document",
      targetIds: [owner.document.id],
    });
    expect(removed.changed).toBe(1);
    expect(await prisma.labResultDocumentLink.count()).toBe(0);
  });

  it("files a dose against a visit from either end, into one table", async () => {
    const prisma = getPrismaClient();
    await linkTargets(prisma, {
      userId: OWNER,
      sourceKind: "vaccination",
      sourceId: owner.vaccination.id,
      targetKind: "encounter",
      targetIds: [owner.encounter.id],
    });
    const fromVisit = await linkTargets(prisma, {
      userId: OWNER,
      sourceKind: "encounter",
      sourceId: owner.encounter.id,
      targetKind: "vaccination",
      targetIds: [owner.vaccination.id],
    });
    expect(fromVisit.changed).toBe(0);
    expect(await prisma.encounterVaccinationLink.count()).toBe(1);
  });
});

describe("related[]", () => {
  it("lists a stored pair on both detail pages, with its web path", async () => {
    await linkTargets(getPrismaClient(), {
      userId: OWNER,
      sourceKind: "medication",
      sourceId: owner.medication.id,
      targetKind: "conditionEpisode",
      targetIds: [owner.episode.id],
    });

    const fromMedication = await related("medication", owner.medication.id);
    expect(fromMedication).toContainEqual({
      kind: "conditionEpisode",
      id: owner.episode.id,
      label: `${OWNER} thyroid`,
      date: "2026-01-20T00:00:00.000Z",
      href: `/illness/${owner.episode.id}`,
      via: "direct",
    });

    const fromCondition = await related("conditionEpisode", owner.episode.id);
    expect(fromCondition).toContainEqual(
      expect.objectContaining({
        kind: "medication",
        id: owner.medication.id,
        label: "Levothyroxine 50 µg",
        href: `/medications/${owner.medication.id}`,
        via: "direct",
      }),
    );
  });

  it("derives a lab result's condition through the visit both are filed against", async () => {
    const prisma = getPrismaClient();
    await linkTargets(prisma, {
      userId: OWNER,
      sourceKind: "encounter",
      sourceId: owner.encounter.id,
      targetKind: "labResult",
      targetIds: [owner.labResult.id],
    });
    await linkTargets(prisma, {
      userId: OWNER,
      sourceKind: "encounter",
      sourceId: owner.encounter.id,
      targetKind: "conditionEpisode",
      targetIds: [owner.episode.id],
    });

    const fromLab = await related("labResult", owner.labResult.id);
    expect(fromLab).toContainEqual(
      expect.objectContaining({
        kind: "conditionEpisode",
        id: owner.episode.id,
        via: "encounter",
      }),
    );
    expect(fromLab).toContainEqual(
      expect.objectContaining({
        kind: "encounter",
        id: owner.encounter.id,
        href: `/checkups?visit=${owner.encounter.id}`,
        via: "direct",
      }),
    );
    const fromCondition = await related("conditionEpisode", owner.episode.id);
    expect(fromCondition).toContainEqual(
      expect.objectContaining({
        kind: "labResult",
        id: owner.labResult.id,
        href: `/labs/${owner.biomarker.id}`,
        via: "encounter",
      }),
    );
  });

  it("derives a medication and its marker's newest reading through the efficacy target", async () => {
    const prisma = getPrismaClient();
    await prisma.medicationEfficacyTarget.create({
      data: {
        medicationId: owner.medication.id,
        biomarkerId: owner.biomarker.id,
      },
    });
    const older = await prisma.labResult.create({
      data: {
        userId: OWNER,
        biomarkerId: owner.biomarker.id,
        analyte: "TSH",
        value: 4.4,
        unit: "mU/L",
        takenAt: new Date("2026-01-30T09:00:00.000Z"),
      },
    });

    const fromLab = await related("labResult", older.id);
    expect(fromLab).toContainEqual(
      expect.objectContaining({
        kind: "medication",
        id: owner.medication.id,
        via: "efficacyTarget",
      }),
    );
    const fromMedication = await related("medication", owner.medication.id);
    const labs = fromMedication.filter((r) => r.kind === "labResult");
    expect(labs).toEqual([
      expect.objectContaining({
        id: owner.labResult.id,
        via: "efficacyTarget",
      }),
    ]);
  });

  it("lists a dose's visit named by the form's scalar field, once", async () => {
    const prisma = getPrismaClient();
    await prisma.vaccinationRecord.update({
      where: { id: owner.vaccination.id },
      data: { encounterId: owner.encounter.id },
    });
    await linkTargets(prisma, {
      userId: OWNER,
      sourceKind: "vaccination",
      sourceId: owner.vaccination.id,
      targetKind: "encounter",
      targetIds: [owner.encounter.id],
    });
    const fromDose = await related("vaccination", owner.vaccination.id);
    expect(fromDose.filter((r) => r.kind === "encounter")).toHaveLength(1);
    const fromVisit = await related("encounter", owner.encounter.id);
    expect(fromVisit.filter((r) => r.kind === "vaccination")).toEqual([
      expect.objectContaining({
        id: owner.vaccination.id,
        href: `/vaccinations?dose=${owner.vaccination.id}`,
      }),
    ]);
  });

  it("never lists another account's records, nor a deleted one", async () => {
    const prisma = getPrismaClient();
    await linkTargets(prisma, {
      userId: OWNER,
      sourceKind: "document",
      sourceId: owner.document.id,
      targetKind: "labResult",
      targetIds: [owner.labResult.id, stranger.labResult.id],
    });
    expect(await related("document", owner.document.id)).toEqual([
      expect.objectContaining({ kind: "labResult", id: owner.labResult.id }),
    ]);

    await prisma.labResult.update({
      where: { id: owner.labResult.id },
      data: { deletedAt: new Date() },
    });
    expect(await related("document", owner.document.id)).toEqual([]);
  });

  it("hides a kind whose module is off", async () => {
    const prisma = getPrismaClient();
    await linkTargets(prisma, {
      userId: OWNER,
      sourceKind: "encounter",
      sourceId: owner.encounter.id,
      targetKind: "medication",
      targetIds: [owner.medication.id],
    });
    expect(
      (await related("encounter", owner.encounter.id)).map((r) => r.kind),
    ).toContain("medication");

    await prisma.user.update({
      where: { id: OWNER },
      data: { modulePreferencesJson: { medications: false } },
    });
    expect(
      (await related("encounter", owner.encounter.id)).map((r) => r.kind),
    ).not.toContain("medication");
  });

  it("hides a kind the caller's grant does not cover", async () => {
    const prisma = getPrismaClient();
    await prisma.user.create({
      data: { id: READER, username: READER, email: `${READER}@example.test` },
    });
    const grant = await prisma.accountGrant.create({
      data: {
        grantorId: OWNER,
        granteeId: READER,
        access: "READ",
        acceptedAt: new Date(),
        scopeJson: ["documents"],
      },
    });
    await linkTargets(prisma, {
      userId: OWNER,
      sourceKind: "document",
      sourceId: owner.document.id,
      targetKind: "medication",
      targetIds: [owner.medication.id],
    });

    const asOwner = await related("document", owner.document.id);
    expect(asOwner.map((r) => r.kind)).toContain("medication");
    const asReader = await buildRelated(prisma, {
      userId: OWNER,
      grantId: grant.id,
      kind: "document",
      id: owner.document.id,
    });
    expect(asReader).toEqual([]);
  });
});

describe("backup of the five relation link tables", () => {
  it("carries every table out and back, and reports a link whose end is gone", async () => {
    const prisma = getPrismaClient();
    const link = (
      sourceKind: Parameters<typeof linkTargets>[1]["sourceKind"],
      sourceId: string,
      targetKind: Parameters<typeof linkTargets>[1]["targetKind"],
      targetId: string,
    ) =>
      linkTargets(prisma, {
        userId: OWNER,
        sourceKind,
        sourceId,
        targetKind,
        targetIds: [targetId],
      });
    await link("labResult", owner.labResult.id, "document", owner.document.id);
    await link(
      "encounter",
      owner.encounter.id,
      "medication",
      owner.medication.id,
    );
    await link(
      "encounter",
      owner.encounter.id,
      "vaccination",
      owner.vaccination.id,
    );
    await link(
      "medication",
      owner.medication.id,
      "document",
      owner.document.id,
    );
    await link(
      "medication",
      owner.medication.id,
      "conditionEpisode",
      owner.episode.id,
    );

    const section = await buildRelationLinksBackupSection(prisma, OWNER, {
      purpose: "disaster-recovery",
    });
    for (const [key, rows] of Object.entries(section)) {
      expect(rows, key).toHaveLength(1);
    }

    // A file naming a medication this account does not have.
    const edited = {
      ...section,
      medicationDocumentLinks: [
        ...section.medicationDocumentLinks,
        {
          medicationId: "medication-not-in-this-file",
          documentId: owner.document.id,
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    };
    const skips: RestoreSkipLog = [];
    const cleared = await prisma.$transaction((tx) =>
      restoreRelationLinksData(tx, OWNER, edited, skips),
    );
    expect(cleared.relationLinks).toBe(5);
    expect(await prisma.labResultDocumentLink.count()).toBe(1);
    expect(await prisma.encounterMedicationLink.count()).toBe(1);
    expect(await prisma.encounterVaccinationLink.count()).toBe(1);
    expect(await prisma.medicationDocumentLink.count()).toBe(1);
    expect(await prisma.medicationConditionLink.count()).toBe(1);
    // The original filing instant survives the trip.
    const restored = await prisma.medicationConditionLink.findFirstOrThrow();
    expect(restored.createdAt.toISOString()).toBe(
      section.medicationConditionLinks[0].createdAt,
    );
    expect(skips).toEqual([
      {
        catalogue: "relationLink",
        key: "medication-not-in-this-file",
        links: 1,
      },
    ]);
  });
});
