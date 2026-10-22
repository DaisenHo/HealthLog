/**
 * The lab record: markers with their other spellings, the merge ledger, and
 * the results filed under them. Both backup ends in one file.
 *
 * A result travels with its marker's NAME as well as its id: a portable
 * restore mints fresh marker ids, and `(userId, name)` is what the catalogue
 * is unique on, so the name is what survives the trip.
 */
import { encryptContextToBytes } from "@/lib/labs/biomarker-store";
import { encryptNoteToBytes } from "@/lib/labs/store";
import { foldForMatch } from "@/lib/i18n/fold-for-match";
import { annotate } from "@/lib/logging/context";
import {
  decodeEncryptedBytes,
  type RestoreContext,
} from "@/lib/export/restore-context";

// ── Restore ──────────────────────────────────────────────────────────────────

export async function clearLabResults(ctx: RestoreContext): Promise<void> {
  const labResults = await ctx.tx.labResult.deleteMany({
    where: { userId: ctx.ownerId },
  });
  ctx.cleared.labResults = labResults.count;
}

export async function clearBiomarkers(ctx: RestoreContext): Promise<void> {
  const biomarkers = await ctx.tx.biomarker.deleteMany({
    where: { userId: ctx.ownerId },
  });
  ctx.cleared.biomarkers = biomarkers.count;
}

/**
 * The merge ledger, against the markers just written: by id where the file
 * carries one this restore kept, by name otherwise. A row whose target the
 * file does not carry has nothing to point at and is left out (counted on the
 * event).
 */
async function restoreBiomarkerMerges(ctx: RestoreContext): Promise<void> {
  const { tx, ownerId, payload } = ctx;
  const { biomarkerByName, restoredBiomarkerIds } = ctx.links;
  let unresolvedMerges = 0;
  const mergeRows = (payload.biomarkerMerges ?? []).flatMap((merge) => {
    const targetId =
      merge.targetBiomarkerId &&
      restoredBiomarkerIds.has(merge.targetBiomarkerId)
        ? merge.targetBiomarkerId
        : biomarkerByName.get(merge.targetName);
    if (!targetId) {
      unresolvedMerges += 1;
      return [];
    }
    return [
      {
        ...(merge.id ? { id: merge.id } : {}),
        userId: ownerId,
        targetBiomarkerId: targetId,
        sourceBiomarkerId: merge.sourceBiomarkerId,
        sourceName: merge.sourceName,
        readingCount: merge.readingCount,
        mergedAt: new Date(merge.mergedAt),
      },
    ];
  });
  if (mergeRows.length > 0) {
    await tx.biomarkerMerge.createMany({ data: mergeRows });
  }
  if (unresolvedMerges > 0) {
    annotate({
      action: { name: "backup.restore.biomarkerMerge.unresolved" },
      meta: { count: unresolvedMerges },
    });
  }
}

/** The markers, each with its other spellings, then the merge ledger. */
export async function restoreLabMarkers(ctx: RestoreContext): Promise<void> {
  const { tx, ownerId, payload } = ctx;
  const { biomarkerByName, restoredBiomarkerIds } = ctx.links;
  ctx.reportSection("labs");
  for (const biomarker of payload.biomarkers) {
    const created = await tx.biomarker.create({
      data: {
        ...(biomarker.id ? { id: biomarker.id } : {}),
        userId: ownerId,
        name: biomarker.name,
        unit: biomarker.unit,
        lowerBound: biomarker.lowerBound ?? null,
        upperBound: biomarker.upperBound ?? null,
        panel: biomarker.panel ?? null,
        hidden: biomarker.hidden ?? false,
        contextEncrypted:
          biomarker.context == null
            ? null
            : encryptContextToBytes(biomarker.context),
        analyteKey: biomarker.analyteKey ?? null,
        ...(biomarker.createdAt
          ? { createdAt: new Date(biomarker.createdAt) }
          : {}),
        ...(biomarker.updatedAt
          ? { updatedAt: new Date(biomarker.updatedAt) }
          : {}),
      },
    });
    biomarkerByName.set(biomarker.name, created.id);
    restoredBiomarkerIds.add(created.id);
    // The other spellings, folded the way the resolver reads them, so the
    // next scan matches them again.
    const aliasRows = (biomarker.aliases ?? [])
      .map((alias) => ({
        id: alias.id,
        name: alias.name.trim().slice(0, 120),
        nameFolded: foldForMatch(alias.name).slice(0, 120),
        source: alias.source,
        createdAt: alias.createdAt,
      }))
      .filter(
        (alias) =>
          alias.nameFolded !== "" &&
          alias.nameFolded !== foldForMatch(biomarker.name),
      );
    if (aliasRows.length > 0) {
      await tx.biomarkerAlias.createMany({
        data: aliasRows.map((alias) => ({
          ...(alias.id ? { id: alias.id } : {}),
          userId: ownerId,
          biomarkerId: created.id,
          name: alias.name,
          nameFolded: alias.nameFolded,
          source: alias.source,
          ...(alias.createdAt ? { createdAt: new Date(alias.createdAt) } : {}),
        })),
        // One spelling answers to one marker per account; a file that names
        // it twice keeps the first.
        skipDuplicates: true,
      });
    }
  }
  await restoreBiomarkerMerges(ctx);
}

/**
 * The results, against the markers written above. The ids written are
 * collected for the staged facts later on: an approved fact's
 * `committedRecordId` names the lab result it was committed to.
 */
export async function restoreLabResults(ctx: RestoreContext): Promise<void> {
  const { tx, ownerId, payload } = ctx;
  const {
    biomarkerByName,
    restoredBiomarkerIds,
    restoredLabResultIds,
    labResultIdBySourceId,
  } = ctx.links;
  for (const lab of payload.labResults) {
    const biomarkerId =
      lab.biomarkerId !== undefined
        ? lab.biomarkerId === null
          ? null
          : restoredBiomarkerIds.has(lab.biomarkerId)
            ? lab.biomarkerId
            : undefined
        : lab.biomarkerName
          ? biomarkerByName.get(lab.biomarkerName)
          : null;
    if (biomarkerId === undefined) {
      throw new Error(
        `Unknown biomarker reference: ${lab.biomarkerId ?? lab.biomarkerName}`,
      );
    }
    const createdLab = await tx.labResult.create({
      data: {
        ...(lab.id ? { id: lab.id } : {}),
        userId: ownerId,
        biomarkerId: biomarkerId ?? null,
        panel: lab.panel ?? null,
        analyte: lab.analyte,
        value: lab.value ?? null,
        valueText: lab.valueText ?? null,
        unit: lab.unit,
        referenceLow: lab.referenceLow ?? null,
        referenceHigh: lab.referenceHigh ?? null,
        sourceReferenceLow: lab.sourceReferenceLow ?? null,
        sourceReferenceHigh: lab.sourceReferenceHigh ?? null,
        sourceReferenceText: lab.sourceReferenceText ?? null,
        sourceValue: lab.sourceValue ?? null,
        sourceUnit: lab.sourceUnit ?? null,
        takenAt: new Date(lab.takenAt),
        source: lab.source,
        noteEncrypted:
          lab.noteEncrypted !== undefined
            ? lab.noteEncrypted === null
              ? null
              : decodeEncryptedBytes(lab.noteEncrypted)
            : lab.note == null
              ? null
              : encryptNoteToBytes(lab.note),
        deletedAt: lab.deletedAt ? new Date(lab.deletedAt) : null,
        ...(lab.createdAt ? { createdAt: new Date(lab.createdAt) } : {}),
        ...(lab.updatedAt ? { updatedAt: new Date(lab.updatedAt) } : {}),
      },
    });
    restoredLabResultIds.add(createdLab.id);
    // Same arrangement as the medications' source-id map.
    const labSourceId = lab.id ?? lab.ref;
    if (labSourceId) labResultIdBySourceId.set(labSourceId, createdLab.id);
  }
}
