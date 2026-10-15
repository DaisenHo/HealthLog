/**
 * `related[]` on the six detail responses: every record the one shown points
 * at, or is pointed at by, resolved on the server.
 *
 * The relation matrix (lab result, visit, document, condition, medication,
 * vaccination; fifteen pairs) is declared once, in {@link RELATION_MATRIX}.
 * Every pair is one of three things:
 *
 *   - **stored**: a link table in `link-service.ts`, read in both directions;
 *   - **derived**: no table, the relation runs through something else the
 *     record already stores (a visit both are filed against, or the
 *     medication's efficacy target being this marker);
 *   - **exception**: no clinical relation the record stores, with the reason.
 *
 * `relation-matrix.test.ts` walks the fifteen pairs and fails when a pair has
 * neither a table nor a reader nor a written exception, so a dead end between
 * two features cannot come back quietly.
 *
 * Visibility is decided here, not at the call site: a kind is listed only when
 * its module is on for the record and the caller's sharing grant covers its
 * section. A derived relation through a visit also needs the visit's section,
 * because the relation itself says the visit exists.
 */
import type { Prisma } from "@/generated/prisma/client";

import { decryptField } from "@/lib/encounters/dto";
import { listTargets } from "@/lib/links/link-service";
import type { LinkSourceKind, LinkTargetKind } from "@/lib/links/link-service";
import { resolveModuleMap } from "@/lib/modules/gate";
import type { ModuleKey } from "@/lib/modules/registry";
import { actingDomainVisibility } from "@/lib/sharing/acting-domains";
import type { ShareDomain } from "@/lib/sharing/scope";
import type {
  RELATED_KINDS,
  RELATED_VIA,
} from "@/lib/validations/relation-links";

export type RelatedKind = (typeof RELATED_KINDS)[number];
export type RelatedVia = (typeof RELATED_VIA)[number];

/** One entry of `related[]`, the wire shape of `RelatedLink`. */
export interface RelatedLink {
  kind: RelatedKind;
  id: string;
  label: string;
  date: string | null;
  href: string;
  via: RelatedVia;
}

/** At most this many entries of one kind; a full panel stays readable. */
export const RELATED_PER_KIND_CAP = 50;

/** One cell of the matrix, seen from `from`. */
export type RelationCell =
  | { mode: "stored" }
  | { mode: "derived"; via: Exclude<RelatedVia, "direct"> }
  | { mode: "exception"; reason: string };

type Pair = `${RelatedKind}:${RelatedKind}`;

/**
 * The fifteen unordered pairs, keyed in one direction. The reverse direction is
 * the same cell; {@link relationCell} looks both up.
 */
export const RELATION_MATRIX: Readonly<Partial<Record<Pair, RelationCell>>> = {
  "labResult:encounter": { mode: "stored" },
  "labResult:document": { mode: "stored" },
  "labResult:conditionEpisode": { mode: "derived", via: "encounter" },
  "labResult:medication": { mode: "derived", via: "efficacyTarget" },
  "labResult:vaccination": {
    mode: "exception",
    reason:
      "A dose is not judged by a lab value the record stores; an antibody titre is a lab result in its own right and is filed against the visit or the report.",
  },
  "encounter:document": { mode: "stored" },
  "encounter:conditionEpisode": { mode: "stored" },
  "encounter:medication": { mode: "stored" },
  "encounter:vaccination": { mode: "stored" },
  "document:conditionEpisode": { mode: "stored" },
  "document:medication": { mode: "stored" },
  "document:vaccination": { mode: "stored" },
  "conditionEpisode:medication": { mode: "stored" },
  "conditionEpisode:vaccination": {
    mode: "exception",
    reason:
      "A vaccination prevents rather than treats, and the record stores no indication for a dose; the visit or the document carries the context.",
  },
  "medication:vaccination": {
    mode: "exception",
    reason:
      "A vaccine is logged in the immunization log, not as a medication, and nothing the record stores relates one to the other.",
  },
};

export function relationCell(
  a: RelatedKind,
  b: RelatedKind,
): RelationCell | undefined {
  return RELATION_MATRIX[`${a}:${b}`] ?? RELATION_MATRIX[`${b}:${a}`];
}

/** The module that owns each kind; `null` for the visit, which is core. */
export const RELATED_KIND_MODULE: Readonly<
  Record<RelatedKind, ModuleKey | null>
> = {
  labResult: "labs",
  encounter: null,
  document: "inboundDocuments",
  conditionEpisode: "illness",
  medication: "medications",
  vaccination: "vaccinations",
};

/** The sharing section each kind lives in. */
export const RELATED_KIND_DOMAIN: Readonly<Record<RelatedKind, ShareDomain>> = {
  labResult: "labs",
  encounter: "profile",
  document: "documents",
  conditionEpisode: "illness",
  medication: "medications",
  // A dose lives in the health background, like the visit itself.
  vaccination: "profile",
};

const ALL_KINDS: readonly RelatedKind[] = [
  "labResult",
  "encounter",
  "document",
  "conditionEpisode",
  "medication",
  "vaccination",
];

/* ── hydration: one query per kind, label + date + href ──────────────────── */

interface Hydrated {
  label: string;
  date: string | null;
  href: string;
}

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

async function hydrate(
  tx: Prisma.TransactionClient,
  userId: string,
  kind: RelatedKind,
  ids: string[],
): Promise<Map<string, Hydrated>> {
  const out = new Map<string, Hydrated>();
  if (ids.length === 0) return out;
  const scope = { id: { in: ids }, userId };
  switch (kind) {
    case "labResult": {
      const rows = await tx.labResult.findMany({
        where: { ...scope, deletedAt: null },
        select: { id: true, analyte: true, takenAt: true, biomarkerId: true },
      });
      for (const row of rows) {
        out.set(row.id, {
          label: row.analyte,
          date: iso(row.takenAt),
          href: row.biomarkerId
            ? `/labs/${encodeURIComponent(row.biomarkerId)}`
            : `/labs?analyte=${encodeURIComponent(row.analyte)}`,
        });
      }
      return out;
    }
    case "encounter": {
      const rows = await tx.encounter.findMany({
        where: { ...scope, deletedAt: null },
        select: {
          id: true,
          kind: true,
          occurredAt: true,
          reasonEncrypted: true,
          practitioner: { select: { name: true } },
        },
      });
      for (const row of rows) {
        out.set(row.id, {
          // The person's own reason first, then who they saw, then the
          // visit's kind as its enum constant (the one closed value a client
          // names from its own bundle).
          label:
            decryptField(row.reasonEncrypted, "reason") ??
            row.practitioner?.name ??
            row.kind,
          date: iso(row.occurredAt),
          href: `/checkups?visit=${encodeURIComponent(row.id)}`,
        });
      }
      return out;
    }
    case "document": {
      const rows = await tx.inboundDocument.findMany({
        where: { ...scope, deletedAt: null },
        select: {
          id: true,
          title: true,
          filename: true,
          documentDate: true,
          reportDate: true,
          createdAt: true,
        },
      });
      for (const row of rows) {
        out.set(row.id, {
          label: row.title || row.filename || row.id,
          date:
            iso(row.documentDate) ?? iso(row.reportDate) ?? iso(row.createdAt),
          href: `/documents?doc=${encodeURIComponent(row.id)}`,
        });
      }
      return out;
    }
    case "conditionEpisode": {
      const rows = await tx.illnessEpisode.findMany({
        where: { ...scope, deletedAt: null },
        select: { id: true, label: true, onsetAt: true },
      });
      for (const row of rows) {
        out.set(row.id, {
          label: row.label,
          date: iso(row.onsetAt),
          href: `/illness/${encodeURIComponent(row.id)}`,
        });
      }
      return out;
    }
    case "medication": {
      const rows = await tx.medication.findMany({
        where: scope,
        select: {
          id: true,
          name: true,
          dose: true,
          startsOn: true,
          createdAt: true,
        },
      });
      for (const row of rows) {
        out.set(row.id, {
          label: row.dose ? `${row.name} ${row.dose}` : row.name,
          date: iso(row.startsOn) ?? iso(row.createdAt),
          href: `/medications/${encodeURIComponent(row.id)}`,
        });
      }
      return out;
    }
    case "vaccination": {
      const rows = await tx.vaccinationRecord.findMany({
        where: { ...scope, deletedAt: null },
        select: {
          id: true,
          vaccineName: true,
          antigenSlug: true,
          occurredAt: true,
          customVaccine: { select: { name: true } },
        },
      });
      for (const row of rows) {
        out.set(row.id, {
          label:
            row.vaccineName ??
            row.customVaccine?.name ??
            row.antigenSlug ??
            row.id,
          date: iso(row.occurredAt),
          href: `/vaccinations?dose=${encodeURIComponent(row.id)}`,
        });
      }
      return out;
    }
  }
}

/* ── readers: the ids related to one record, per kind ────────────────────── */

interface Candidate {
  kind: RelatedKind;
  id: string;
  via: RelatedVia;
}

async function stored(
  tx: Prisma.TransactionClient,
  userId: string,
  from: RelatedKind,
  sourceId: string,
  to: RelatedKind,
): Promise<Candidate[]> {
  const rows = await listTargets(tx, {
    userId,
    sourceKind: from as LinkSourceKind,
    sourceId,
    targetKind: to as LinkTargetKind,
  });
  const ids = rows.map((row) => row.id);
  // A dose also names its visit by scalar (`VaccinationRecord.encounterId`,
  // the form's visit field). Both say the same thing, so both are read and
  // the visit is listed once.
  if (from === "vaccination" && to === "encounter") {
    const dose = await tx.vaccinationRecord.findFirst({
      where: { id: sourceId, userId },
      select: { encounterId: true },
    });
    if (dose?.encounterId) ids.push(dose.encounterId);
  } else if (from === "encounter" && to === "vaccination") {
    const doses = await tx.vaccinationRecord.findMany({
      where: { encounterId: sourceId, userId, deletedAt: null },
      select: { id: true },
      orderBy: { occurredAt: "asc" },
    });
    ids.push(...doses.map((dose) => dose.id));
  }
  return [...new Set(ids)].map((id) => ({ kind: to, id, via: "direct" }));
}

/** The things filed against the visits this record is filed against. */
async function throughEncounters(
  tx: Prisma.TransactionClient,
  userId: string,
  from: "labResult" | "conditionEpisode",
  sourceId: string,
  to: "labResult" | "conditionEpisode",
): Promise<Candidate[]> {
  const visits = await listTargets(tx, {
    userId,
    sourceKind: from,
    sourceId,
    targetKind: "encounter",
  });
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const visit of visits) {
    const rows = await listTargets(tx, {
      userId,
      sourceKind: "encounter",
      sourceId: visit.id,
      targetKind: to,
    });
    for (const row of rows) {
      if (row.id === sourceId || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({ kind: to, id: row.id, via: "encounter" });
    }
  }
  return out;
}

/** Medications whose efficacy target is this result's marker. */
async function medicationsTargetingLab(
  tx: Prisma.TransactionClient,
  userId: string,
  labResultId: string,
): Promise<Candidate[]> {
  const lab = await tx.labResult.findFirst({
    where: { id: labResultId, userId, deletedAt: null },
    select: { biomarkerId: true },
  });
  if (!lab?.biomarkerId) return [];
  const targets = await tx.medicationEfficacyTarget.findMany({
    where: { biomarkerId: lab.biomarkerId, medication: { userId } },
    select: { medicationId: true },
    orderBy: { createdAt: "asc" },
  });
  return [...new Set(targets.map((t) => t.medicationId))].map((id) => ({
    kind: "medication" as const,
    id,
    via: "efficacyTarget" as const,
  }));
}

/** The newest reading of each marker this medication targets. */
async function labsTargetedByMedication(
  tx: Prisma.TransactionClient,
  userId: string,
  medicationId: string,
): Promise<Candidate[]> {
  const targets = await tx.medicationEfficacyTarget.findMany({
    where: {
      medicationId,
      medication: { userId },
      biomarkerId: { not: null },
    },
    select: { biomarkerId: true },
  });
  const biomarkerIds = [
    ...new Set(targets.flatMap((t) => (t.biomarkerId ? [t.biomarkerId] : []))),
  ];
  if (biomarkerIds.length === 0) return [];
  const rows = await tx.labResult.findMany({
    where: { userId, deletedAt: null, biomarkerId: { in: biomarkerIds } },
    select: { id: true, biomarkerId: true },
    orderBy: { takenAt: "desc" },
    distinct: ["biomarkerId"],
  });
  return rows.map((row) => ({
    kind: "labResult" as const,
    id: row.id,
    via: "efficacyTarget" as const,
  }));
}

type Reader = (
  tx: Prisma.TransactionClient,
  userId: string,
  sourceId: string,
) => Promise<Candidate[]>;

/**
 * The reader of every derived cell, in both directions. A derived cell
 * without both readers here is a dead end, which `relation-matrix.test.ts`
 * refuses.
 */
export const DERIVED_READERS: Readonly<Partial<Record<Pair, Reader>>> = {
  "labResult:conditionEpisode": (tx, userId, id) =>
    throughEncounters(tx, userId, "labResult", id, "conditionEpisode"),
  "conditionEpisode:labResult": (tx, userId, id) =>
    throughEncounters(tx, userId, "conditionEpisode", id, "labResult"),
  "labResult:medication": medicationsTargetingLab,
  "medication:labResult": labsTargetedByMedication,
};

async function readCell(
  tx: Prisma.TransactionClient,
  userId: string,
  from: RelatedKind,
  sourceId: string,
  to: RelatedKind,
  cell: RelationCell,
): Promise<Candidate[]> {
  if (cell.mode === "exception") return [];
  if (cell.mode === "stored") return stored(tx, userId, from, sourceId, to);
  const reader = DERIVED_READERS[`${from}:${to}`];
  return reader ? reader(tx, userId, sourceId) : [];
}

/**
 * The `related` list for one record.
 *
 * `userId` is the record's owner (the one `requireRecordAuth` resolved), and
 * `grantId` the grant the caller acts under, or `null` for the owner. The
 * record itself must already have been read and authorised by the caller.
 */
export async function buildRelated(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    grantId: string | null;
    kind: RelatedKind;
    id: string;
  },
): Promise<RelatedLink[]> {
  const [visible, modules] = await Promise.all([
    actingDomainVisibility(tx, input.grantId),
    resolveModuleMap(input.userId),
  ]);
  const shown = (kind: RelatedKind) => {
    const mod = RELATED_KIND_MODULE[kind];
    return (mod === null || modules[mod]) && visible(RELATED_KIND_DOMAIN[kind]);
  };

  const out: RelatedLink[] = [];
  for (const to of ALL_KINDS) {
    if (to === input.kind || !shown(to)) continue;
    const cell = relationCell(input.kind, to);
    if (!cell) continue;
    // A relation through a visit says the visit exists, so it needs the
    // visit's own visibility as well.
    if (
      cell.mode === "derived" &&
      cell.via === "encounter" &&
      !shown("encounter")
    ) {
      continue;
    }
    const candidates = (
      await readCell(tx, input.userId, input.kind, input.id, to, cell)
    ).slice(0, RELATED_PER_KIND_CAP);
    const hydrated = await hydrate(
      tx,
      input.userId,
      to,
      candidates.map((c) => c.id),
    );
    for (const candidate of candidates) {
      const row = hydrated.get(candidate.id);
      if (!row) continue;
      out.push({ kind: to, id: candidate.id, via: candidate.via, ...row });
    }
  }
  return out;
}

/**
 * `{ ...detail, related }` for a detail route, so each route adds one call.
 */
export async function withRelated<T extends object>(
  tx: Prisma.TransactionClient,
  detail: T,
  input: Parameters<typeof buildRelated>[1],
): Promise<T & { related: RelatedLink[] }> {
  return { ...detail, related: await buildRelated(tx, input) };
}
