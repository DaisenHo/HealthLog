/**
 * The relation links that close the relation matrix (v1.43), with both backup
 * ends in one file.
 *
 * Same arrangement as `document-filing-backup.ts`, `visits-backup.ts` and the
 * other section files: a reader asking "is this carried at both ends?" answers
 * it here, and a reader who greps only the restore ROUTE gets a false negative
 * because the route delegates.
 *
 * Five tables ride, each a pair of an account's own records:
 *
 *   - `LabResultDocumentLink`: the report a lab result was read from;
 *   - `EncounterMedicationLink`: a medication prescribed, changed or reviewed
 *     at a visit;
 *   - `EncounterVaccinationLink`: a dose given at a visit;
 *   - `MedicationDocumentLink`: a prescription, a plan, a package insert;
 *   - `MedicationConditionLink`: the condition a medication treats.
 *
 * None holds anything but two ids and the instant the link was filed, so both
 * purposes carry the same bytes. Both ends are foreign keys that cascade, so
 * an end that cannot resolve does not dangle quietly: it violates the
 * constraint and costs the operator the WHOLE restore. The builder therefore
 * carries a link only when both of its ends are carried (mirroring the
 * tombstone choices of the sections that carry the records), and the restore
 * checks every link against the rows this transaction actually wrote and
 * reports what it could not place, because a hand-edited or truncated file is
 * the case the write-time filter cannot cover.
 *
 * Written directly rather than through the link service, under the standing
 * restore exemption the visit and vaccination backups hold: a restore rebuilds
 * an account rather than filing something in one, and it keeps the instant
 * each link was originally filed at, which the service's signature cannot
 * express.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import {
  recordUnknownKeys,
  type RestoreSkipLog,
} from "@/lib/export/restore-skips";

export interface RelationLinksBackupOptions {
  purpose?: "portable-export" | "disaster-recovery";
}

export interface LabResultDocumentLinkBackupEntry {
  labResultId: string;
  documentId: string;
  createdAt: string;
}

export interface EncounterMedicationLinkBackupEntry {
  encounterId: string;
  medicationId: string;
  createdAt: string;
}

export interface EncounterVaccinationLinkBackupEntry {
  encounterId: string;
  vaccinationId: string;
  createdAt: string;
}

export interface MedicationDocumentLinkBackupEntry {
  medicationId: string;
  documentId: string;
  createdAt: string;
}

export interface MedicationConditionLinkBackupEntry {
  medicationId: string;
  episodeId: string;
  createdAt: string;
}

export interface RelationLinksBackupSection {
  labResultDocumentLinks: LabResultDocumentLinkBackupEntry[];
  encounterMedicationLinks: EncounterMedicationLinkBackupEntry[];
  encounterVaccinationLinks: EncounterVaccinationLinkBackupEntry[];
  medicationDocumentLinks: MedicationDocumentLinkBackupEntry[];
  medicationConditionLinks: MedicationConditionLinkBackupEntry[];
}

/** The five tables summed, as the visit links are in the summary. */
export interface RelationLinksBackupCounts {
  relationLinks: number;
}

/** The section keys, in wire order. */
export const RELATION_LINK_SECTION_KEYS = [
  "labResultDocumentLinks",
  "encounterMedicationLinks",
  "encounterVaccinationLinks",
  "medicationDocumentLinks",
  "medicationConditionLinks",
] as const satisfies readonly (keyof RelationLinksBackupSection)[];

export async function buildRelationLinksBackupSection(
  prisma: Pick<
    PrismaClient,
    | "labResultDocumentLink"
    | "encounterMedicationLink"
    | "encounterVaccinationLink"
    | "medicationDocumentLink"
    | "medicationConditionLink"
  >,
  userId: string,
  options: RelationLinksBackupOptions = {},
): Promise<RelationLinksBackupSection> {
  const disasterRecovery = options.purpose === "disaster-recovery";
  // The document reader skips tombstoned documents in BOTH purposes; lab
  // results, visits, doses and conditions are skipped in a portable export
  // only. A medication carries no tombstone.
  const liveUnlessDr = disasterRecovery ? {} : { deletedAt: null };
  const order = { createdAt: "asc" } as const;

  const [labDocs, encounterMeds, encounterDoses, medDocs, medConditions] =
    await Promise.all([
      prisma.labResultDocumentLink.findMany({
        where: {
          userId,
          labResult: liveUnlessDr,
          document: { deletedAt: null },
        },
        orderBy: order,
        select: { labResultId: true, documentId: true, createdAt: true },
      }),
      prisma.encounterMedicationLink.findMany({
        where: { userId, encounter: liveUnlessDr },
        orderBy: order,
        select: { encounterId: true, medicationId: true, createdAt: true },
      }),
      prisma.encounterVaccinationLink.findMany({
        where: {
          userId,
          encounter: liveUnlessDr,
          vaccination: liveUnlessDr,
        },
        orderBy: order,
        select: { encounterId: true, vaccinationId: true, createdAt: true },
      }),
      prisma.medicationDocumentLink.findMany({
        where: { userId, document: { deletedAt: null } },
        orderBy: order,
        select: { medicationId: true, documentId: true, createdAt: true },
      }),
      prisma.medicationConditionLink.findMany({
        where: { userId, episode: liveUnlessDr },
        orderBy: order,
        select: { medicationId: true, episodeId: true, createdAt: true },
      }),
    ]);

  const at = <T extends { createdAt: Date }>(row: T) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  });
  return {
    labResultDocumentLinks: labDocs.map(at),
    encounterMedicationLinks: encounterMeds.map(at),
    encounterVaccinationLinks: encounterDoses.map(at),
    medicationDocumentLinks: medDocs.map(at),
    medicationConditionLinks: medConditions.map(at),
  };
}

/** Row counts for the audit trail, mirroring the other section counters. */
export function countRelationLinksBackupSection(
  section: RelationLinksBackupSection,
): RelationLinksBackupCounts {
  return {
    relationLinks: RELATION_LINK_SECTION_KEYS.reduce(
      (total, key) => total + section[key].length,
      0,
    ),
  };
}

/** Counts this restore wiped, for the audit trail. */
export type RelationLinksRestoreCleared = RelationLinksBackupCounts;

/** The ids of every record this restore has written, by kind. */
async function writtenIds(
  tx: Prisma.TransactionClient,
  ownerId: string,
): Promise<{
  labResults: Set<string>;
  documents: Set<string>;
  encounters: Set<string>;
  vaccinations: Set<string>;
  medications: Set<string>;
  episodes: Set<string>;
}> {
  const where = { userId: ownerId };
  const select = { id: true } as const;
  const [
    labResults,
    documents,
    encounters,
    vaccinations,
    medications,
    episodes,
  ] = await Promise.all([
    tx.labResult.findMany({ where, select }),
    tx.inboundDocument.findMany({ where, select }),
    tx.encounter.findMany({ where, select }),
    tx.vaccinationRecord.findMany({ where, select }),
    tx.medication.findMany({ where, select }),
    tx.illnessEpisode.findMany({ where, select }),
  ]);
  const ids = (rows: Array<{ id: string }>) => new Set(rows.map((r) => r.id));
  return {
    labResults: ids(labResults),
    documents: ids(documents),
    encounters: ids(encounters),
    vaccinations: ids(vaccinations),
    medications: ids(medications),
    episodes: ids(episodes),
  };
}

/**
 * Keep the links whose two ends both exist, and report the rest under the end
 * that is missing, so an operator can tell "the report is gone" from "the
 * result is gone".
 */
function placeable<T>(
  rows: readonly T[],
  ends: [(row: T) => string, ReadonlySet<string>][],
  skips: RestoreSkipLog,
): T[] {
  const dropped: string[] = [];
  const kept = rows.filter((row) => {
    for (const [end, written] of ends) {
      const id = end(row);
      if (!written.has(id)) {
        dropped.push(id);
        return false;
      }
    }
    return true;
  });
  recordUnknownKeys(skips, "relationLink", [...new Set(dropped)], dropped);
  return kept;
}

/**
 * The id each medication and lab result had in the file, to the id the
 * restore gave it. A portable file carries neither row's id (a restore there
 * mints fresh ones), only a `ref` naming the source row, so a link that names
 * the source id is re-pointed through this map. An id the map does not hold is
 * used as it is: a disaster-recovery file keeps its ids, and a hand-edited one
 * falls through to the placement check below.
 */
export interface RelationLinkSourceIds {
  medications: ReadonlyMap<string, string>;
  labResults: ReadonlyMap<string, string>;
}

/**
 * Re-create the five link tables.
 *
 * Delete-then-recreate inside the caller's transaction, matching every other
 * section. Each table cascades from both of its ends, so the record wipes
 * earlier in the restore have already emptied them; they are counted and
 * cleared explicitly anyway, so the cleared numbers are truthful.
 *
 * MUST be called AFTER the lab results, documents, visits, doses, medications
 * and conditions are restored: every end is a foreign key, and a link written
 * before its end exists aborts the transaction.
 */
export async function restoreRelationLinksData(
  tx: Prisma.TransactionClient,
  ownerId: string,
  payload: RelationLinksBackupSection,
  skips: RestoreSkipLog,
  sourceIds: RelationLinkSourceIds = {
    medications: new Map(),
    labResults: new Map(),
  },
): Promise<RelationLinksRestoreCleared> {
  const medication = (id: string) => sourceIds.medications.get(id) ?? id;
  const labResult = (id: string) => sourceIds.labResults.get(id) ?? id;
  const owned = { where: { userId: ownerId } };
  const [c1, c2, c3, c4, c5] = await Promise.all([
    tx.labResultDocumentLink.deleteMany(owned),
    tx.encounterMedicationLink.deleteMany(owned),
    tx.encounterVaccinationLink.deleteMany(owned),
    tx.medicationDocumentLink.deleteMany(owned),
    tx.medicationConditionLink.deleteMany(owned),
  ]);

  const written = await writtenIds(tx, ownerId);
  const stamp = (createdAt: string) => ({
    userId: ownerId,
    createdAt: new Date(createdAt),
  });

  const labDocs = placeable(
    payload.labResultDocumentLinks.map((r) => ({
      ...r,
      labResultId: labResult(r.labResultId),
    })),
    [
      [(r) => r.labResultId, written.labResults],
      [(r) => r.documentId, written.documents],
    ],
    skips,
  );
  if (labDocs.length > 0) {
    await tx.labResultDocumentLink.createMany({
      data: labDocs.map((r) => ({
        labResultId: r.labResultId,
        documentId: r.documentId,
        ...stamp(r.createdAt),
      })),
      skipDuplicates: true,
    });
  }

  const encounterMeds = placeable(
    payload.encounterMedicationLinks.map((r) => ({
      ...r,
      medicationId: medication(r.medicationId),
    })),
    [
      [(r) => r.encounterId, written.encounters],
      [(r) => r.medicationId, written.medications],
    ],
    skips,
  );
  if (encounterMeds.length > 0) {
    await tx.encounterMedicationLink.createMany({
      data: encounterMeds.map((r) => ({
        encounterId: r.encounterId,
        medicationId: r.medicationId,
        ...stamp(r.createdAt),
      })),
      skipDuplicates: true,
    });
  }

  const encounterDoses = placeable(
    payload.encounterVaccinationLinks,
    [
      [(r) => r.encounterId, written.encounters],
      [(r) => r.vaccinationId, written.vaccinations],
    ],
    skips,
  );
  if (encounterDoses.length > 0) {
    await tx.encounterVaccinationLink.createMany({
      data: encounterDoses.map((r) => ({
        encounterId: r.encounterId,
        vaccinationId: r.vaccinationId,
        ...stamp(r.createdAt),
      })),
      skipDuplicates: true,
    });
  }

  const medDocs = placeable(
    payload.medicationDocumentLinks.map((r) => ({
      ...r,
      medicationId: medication(r.medicationId),
    })),
    [
      [(r) => r.medicationId, written.medications],
      [(r) => r.documentId, written.documents],
    ],
    skips,
  );
  if (medDocs.length > 0) {
    await tx.medicationDocumentLink.createMany({
      data: medDocs.map((r) => ({
        medicationId: r.medicationId,
        documentId: r.documentId,
        ...stamp(r.createdAt),
      })),
      skipDuplicates: true,
    });
  }

  const medConditions = placeable(
    payload.medicationConditionLinks.map((r) => ({
      ...r,
      medicationId: medication(r.medicationId),
    })),
    [
      [(r) => r.medicationId, written.medications],
      [(r) => r.episodeId, written.episodes],
    ],
    skips,
  );
  if (medConditions.length > 0) {
    await tx.medicationConditionLink.createMany({
      data: medConditions.map((r) => ({
        medicationId: r.medicationId,
        episodeId: r.episodeId,
        ...stamp(r.createdAt),
      })),
      skipDuplicates: true,
    });
  }

  return {
    relationLinks: c1.count + c2.count + c3.count + c4.count + c5.count,
  };
}
