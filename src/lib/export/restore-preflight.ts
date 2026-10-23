/**
 * Everything a restore checks before it deletes anything.
 *
 * Each check that fails writes an `admin.backups.restore.failed` audit row
 * with its reason and answers with a refusal; the account has not been
 * touched at that point. The checks run in a fixed order, and the order is
 * part of the contract: a file that fails two of them is refused for the
 * first.
 */
import { auditLog } from "@/lib/auth/audit";
import { prisma } from "@/lib/db";
import {
  assessBackupKeys,
  BACKUP_KEY_MISSING_CODE,
  describeBackupKeyProblem,
} from "@/lib/export/backup-key-ids";
import { findIncompleteDocument } from "@/lib/export/documents-backup";
import type { MeasurementRestorePrepass } from "@/lib/export/restore-context";
import type {
  RestoreBackupInput,
  RestoreBackupOutcome,
  RestoreFailureCode,
  RestoreProgressTracker,
} from "@/lib/export/restore-backup";
import { findMissingBackupSections } from "@/lib/export/restore-skips";
import {
  isStoredBackupReadError,
  openStoredBackup,
  storedBackupRefusal,
} from "@/lib/export/stored-backup";
import {
  readStreamedBackup,
  type BackupSource,
  type StreamedBackup,
} from "@/lib/export/streamed-backup";
import type { BackupPayload } from "@/lib/validations/backup";
import { isCompatibleSchemaVersion } from "@/lib/validations/backup-summary";

/**
 * Time kept free after the transaction for the rollup folds and the audit row,
 * when the restore checks it fits the caller's deadline.
 */
export const RESTORE_AFTER_TRANSACTION_ALLOWANCE_MS = 10 * 60 * 1000;

/**
 * How long the restore transaction may run, and with it every statement
 * inside it (`SET LOCAL statement_timeout`, see the transaction).
 *
 * The work is deleting the readings the account holds now and writing the
 * ones the file carries. Both count: an account whose readings were folded
 * into hourly averages still holds the originals as deleted rows until the
 * nightly purge removes them, and the restore deletes and rewrites those too
 * (#1031). Writing is the slow half, since every reading goes into thirteen
 * indexes. The budget is two minutes, plus a second per 1 000 readings in the
 * file and per 10 000 in the account. A seeded account of 1.89 million
 * readings restored in 196 s on a fast host and in 19 min on a database held
 * to half a CPU and 40 MB/s of writes, where its transaction ran 16 min of a
 * 37 min budget.
 */
export function restoreTransactionTimeoutMs(
  fileMeasurements: number,
  currentMeasurements: number,
): number {
  return 120_000 + fileMeasurements + Math.ceil(currentMeasurements / 10);
}

export function refused(
  status: number,
  code: RestoreFailureCode,
  message: string,
  meta?: Record<string, unknown>,
): RestoreBackupOutcome {
  return { ok: false, status, code, message, ...(meta ? { meta } : {}) };
}

function readingsPhrase(count: number): string {
  return `${count} ${count === 1 ? "reading" : "readings"}`;
}

async function auditRefusal(
  input: RestoreBackupInput,
  details: Record<string, unknown>,
): Promise<void> {
  await auditLog("admin.backups.restore.failed", {
    userId: input.actorUserId,
    ipAddress: input.ipAddress,
    details: { backupId: input.backup.id, ...details },
  });
}

export interface ReadBackup {
  streamed: StreamedBackup;
  raw: unknown;
  payload: BackupPayload;
}

/**
 * Open the stored copy and read it once, checking every reading as it goes.
 *
 * Opened, not unpacked: the JSON of a large record is longer than any string
 * V8 can hold (#1031), so it is read as a stream. Opening authenticates every
 * stored piece first, and checks they add up to the copy that was written,
 * before anything is read or deleted.
 *
 * The rest of the file is parsed once and kept, because the schema's
 * per-section `.default([])` erases the difference between a section that is
 * absent and one that is empty — and that difference is what the
 * completeness check reads. The measurements are the exception:
 * `readStreamedBackup` checks each one against the element schema as it goes
 * and keeps only their count, and the transaction reads them a second time,
 * in batches, as it writes them.
 */
export async function openAndReadBackup(
  input: RestoreBackupInput,
  tracker: RestoreProgressTracker,
  prepass: MeasurementRestorePrepass,
): Promise<
  { ok: true; read: ReadBackup } | { ok: false; outcome: RestoreBackupOutcome }
> {
  const { backup } = input;
  let source: BackupSource;
  try {
    source = await openStoredBackup(prisma, backup);
  } catch (err) {
    await auditRefusal(input, {
      ownerId: backup.userId,
      reason: err instanceof Error ? err.message : "decrypt_failed",
    });
    // Bad stored input, not a broken server: a copy written under a key the
    // operator has since dropped, or one whose bytes have changed. Refused
    // above the transaction, so nothing was touched.
    const refusal = storedBackupRefusal(err);
    return {
      ok: false,
      outcome: refused(refusal.status, refusal.code, refusal.message, {
        errorCode: refusal.code,
      }),
    };
  }

  try {
    const streamed = await readStreamedBackup(source, {
      onMeasurementChecked: (checked, row) => {
        tracker.progress.measurementsChecked = checked;
        tracker.report("validating");
        prepass.note(row);
      },
    });
    tracker.progress.measurementsTotal = streamed.measurementCount;
    tracker.report("validating", true);
    const raw = streamed.raw;
    // Loaded here, not at import: the schema is ~12 MB of heap and a server
    // that never validates a backup should not hold it (`backup-summary.ts`).
    const { parseBackupPayload } = await import("@/lib/validations/backup");
    const payload = parseBackupPayload(raw);
    return { ok: true, read: { streamed, raw, payload } };
  } catch (err) {
    const readFailure = isStoredBackupReadError(err);
    await auditRefusal(input, {
      ownerId: backup.userId,
      reason: readFailure ? "read_failed" : "schema_invalid",
      message: err instanceof Error ? err.message : String(err),
    });
    if (readFailure) {
      // The copy changed after it was opened: replaced by the weekly run, or
      // altered. Nothing has been deleted yet.
      const refusal = storedBackupRefusal(err);
      return {
        ok: false,
        outcome: refused(refusal.status, refusal.code, refusal.message, {
          errorCode: refusal.code,
        }),
      };
    }
    return {
      ok: false,
      outcome: refused(
        422,
        "schema_invalid",
        "Backup payload failed schema validation",
      ),
    };
  }
}

/**
 * The file's version, and whose it is.
 *
 * The payload declares its own owner, and the backup ROW records who the
 * backup was taken for. Those must agree. Taking the owner from the payload
 * alone means the restored-into account is whatever the blob claims — so an
 * admin who selects one user's backup could write into a different account
 * without the interface ever showing it. Both values are already in hand
 * here; refuse on mismatch rather than trusting the blob.
 *
 * The target of the restore is whoever the backup is for, NOT the admin
 * running the operation. That user has to still exist — an upload
 * referencing a since-deleted user would otherwise leave the operation
 * half-done.
 */
async function checkOwnership(
  input: RestoreBackupInput,
  payload: BackupPayload,
): Promise<
  | { ok: true; owner: { id: string; username: string } }
  | { ok: false; outcome: RestoreBackupOutcome }
> {
  const { backup } = input;
  if (!isCompatibleSchemaVersion(payload.schemaVersion)) {
    await auditRefusal(input, {
      ownerId: backup.userId,
      reason: "incompatible_schema_version",
      schemaVersion: payload.schemaVersion,
    });
    return {
      ok: false,
      outcome: refused(
        422,
        "incompatible_schema_version",
        `Backup schema version '${payload.schemaVersion}' is not supported by this server`,
      ),
    };
  }

  if (payload.userId !== backup.userId) {
    await auditRefusal(input, {
      ownerId: backup.userId,
      reason: "owner_mismatch",
      declaredOwnerId: payload.userId,
    });
    return {
      ok: false,
      outcome: refused(
        409,
        "owner_mismatch",
        "Backup payload declares a different owner than the backup record",
      ),
    };
  }

  const ownerId = payload.userId;
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { id: true, username: true },
  });
  if (!owner) {
    await auditRefusal(input, { ownerId, reason: "owner_not_found" });
    return {
      ok: false,
      outcome: refused(
        422,
        "owner_not_found",
        `Backup owner '${ownerId}' no longer exists in this DB`,
      ),
    };
  }
  return { ok: true, owner };
}

/**
 * The keys the file's ciphertext needs, and the sections it says it carries.
 *
 * The ciphertext inside the file is written back verbatim, so every key it
 * was written under has to be on this host, and has to be the key that wrote
 * it. A copy taken before a key rotation still needs the key the rotation
 * retired: the rotation re-seals the stored copy's envelope but cannot reach
 * inside it. Refused here, above the first delete, because the alternative is
 * an account whose notes, documents and coach history come back as rows no
 * reader can open. The instance settings count only when the operator asked
 * for them back.
 */
async function checkCarriage(
  input: RestoreBackupInput,
  read: ReadBackup,
  owner: { id: string; username: string },
): Promise<RestoreBackupOutcome | null> {
  const { payload, streamed, raw } = read;
  const ownerId = owner.id;
  const keyVerdict = assessBackupKeys(streamed.keys, {
    ignoreSections: input.restoreInstanceSettings
      ? new Set<string>()
      : new Set(["appSettings"]),
  });
  const keyProblem = describeBackupKeyProblem(keyVerdict);
  if (keyProblem) {
    const keyIds = [...keyVerdict.missing, ...keyVerdict.unreadable];
    await auditRefusal(input, {
      ownerId,
      reason: "key_missing",
      missingKeyIds: keyVerdict.missing,
      unreadableKeyIds: keyVerdict.unreadable,
      affectedValues: keyVerdict.affectedValues,
    });
    return refused(422, BACKUP_KEY_MISSING_CODE, keyProblem, {
      errorCode: BACKUP_KEY_MISSING_CODE,
      keyIds,
    });
  }

  // Audit the *intent* before the transaction begins so the trail describing
  // "an admin is about to restore <user>" survives even if the operation
  // crashes midway.
  await auditLog("admin.backups.restore.start", {
    userId: input.actorUserId,
    ipAddress: input.ipAddress,
    details: {
      backupId: input.backup.id,
      ownerId,
      ownerUsername: owner.username,
      snapshotExportedAt: payload.exportedAt,
      restoreInstanceSettings: input.restoreInstanceSettings,
    },
  });

  // A section the file's own manifest says it carries, and does not.
  //
  // The restore's first act is to delete the class it is about to rebuild, so
  // an absent section is not a gap in the file — it is an erasure of that part
  // of the account, reported as a success. #237: a portable file whose
  // document payload was gone emptied the vault and said nothing. The whole
  // file is refused instead, above the transaction, for the same reason the
  // metadata-only check below sits there.
  //
  // A DECLARED omission is not this. The portable export leaves the screener
  // administrations and the consent receipts out on purpose and says so in the
  // manifest; `findMissingBackupSections` reads the manifest and not the
  // emptiness of an array, so those files stay restorable. So does every file
  // written before the manifest existed, which declares nothing at all.
  const missingSections = findMissingBackupSections(raw);
  if (missingSections.length > 0) {
    await auditRefusal(input, {
      ownerId,
      reason: "section_missing",
      sections: missingSections,
    });
    return refused(
      422,
      "backup.section.missing",
      `Backup is missing ${missingSections.join(", ")} — the file's own manifest says it carries ${missingSections.length === 1 ? "that section" : "those sections"}. Nothing was changed. Use a disaster-recovery snapshot, or export the account again.`,
      { errorCode: "backup.section.missing", sections: missingSections },
    );
  }

  const incompleteDocument = findIncompleteDocument(payload);
  if (incompleteDocument) {
    await auditRefusal(input, {
      ownerId,
      reason: "document_ciphertext_missing",
      documentId: incompleteDocument.id,
    });
    return refused(
      422,
      "document_ciphertext_missing",
      `Document '${incompleteDocument.id}' is metadata-only and cannot be restored`,
    );
  }
  return null;
}

/**
 * The transaction's own limit grows with the measurements. When a caller has
 * a deadline of its own (the background job's time budget) and that limit
 * would run past it, the restore is refused here, above the first delete,
 * rather than started and cut off by the queue. Counted here, before the
 * transaction, because the delete costs time in proportion to what the
 * account holds, deleted rows included.
 */
async function checkTimeBudget(
  input: RestoreBackupInput,
  streamed: StreamedBackup,
  ownerId: string,
): Promise<
  | { ok: true; transactionTimeoutMs: number }
  | { ok: false; outcome: RestoreBackupOutcome }
> {
  const currentMeasurements = await prisma.measurement.count({
    where: { userId: ownerId },
  });
  const transactionTimeoutMs = restoreTransactionTimeoutMs(
    streamed.measurementCount,
    currentMeasurements,
  );
  if (
    input.deadline !== undefined &&
    Date.now() + transactionTimeoutMs + RESTORE_AFTER_TRANSACTION_ALLOWANCE_MS >
      input.deadline
  ) {
    await auditRefusal(input, {
      ownerId,
      reason: "time_budget",
      measurements: streamed.measurementCount,
      currentMeasurements,
    });
    // Both counts, because both cost time: the account's readings are deleted
    // (removed ones included, until the nightly clean-up purges them) before
    // the file's are written.
    return {
      ok: false,
      outcome: refused(
        503,
        "time_budget",
        `Restoring ${readingsPhrase(streamed.measurementCount)} in the backup over the ${readingsPhrase(currentMeasurements)} this account holds now (removed readings count until the nightly clean-up) needs more time than the restore job allows. Nothing was changed.`,
      ),
    };
  }
  return { ok: true, transactionTimeoutMs };
}

/** Every check between a parsed file and the first delete, in order. */
export async function checkBackupBeforeRestore(
  input: RestoreBackupInput,
  read: ReadBackup,
): Promise<
  | {
      ok: true;
      owner: { id: string; username: string };
      transactionTimeoutMs: number;
    }
  | { ok: false; outcome: RestoreBackupOutcome }
> {
  const ownership = await checkOwnership(input, read.payload);
  if (!ownership.ok) return ownership;
  const { owner } = ownership;
  const carriage = await checkCarriage(input, read, owner);
  if (carriage) return { ok: false, outcome: carriage };
  const budget = await checkTimeBudget(input, read.streamed, owner.id);
  if (!budget.ok) return budget;
  return {
    ok: true,
    owner,
    transactionTimeoutMs: budget.transactionTimeoutMs,
  };
}
