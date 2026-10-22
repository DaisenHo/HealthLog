/**
 * The document vault, with both backup ends in one file.
 *
 * A disaster-recovery file carries each document's stored bytes verbatim; a
 * portable one carries metadata only and cannot be restored into documents.
 */
import {
  decodeEncryptedBytes,
  type RestoreContext,
} from "@/lib/export/restore-context";
import { normaliseSourceInstance } from "@/lib/validations/inbound-documents";
import type { BackupPayload } from "@/lib/validations/backup";

// ── Restore ──────────────────────────────────────────────────────────────────

/**
 * The first document the file carries as metadata only, if any.
 *
 * Portable exports intentionally omit document ciphertext. They remain valid
 * upload/download artifacts, but cannot be used to manufacture an
 * InboundDocument row. A DR restore must fail before any delete rather than
 * inventing empty/plaintext content.
 */
export function findIncompleteDocument(
  payload: Pick<BackupPayload, "documents">,
): BackupPayload["documents"][number] | undefined {
  return payload.documents.find(
    (document) =>
      document.contentEncrypted === undefined ||
      document.contentSha256 === undefined ||
      document.contentCodec === undefined ||
      document.providerType === undefined ||
      document.reportDate === undefined ||
      document.documentDate === undefined ||
      document.errorReason === undefined ||
      document.summaryEncrypted === undefined ||
      document.summaryGeneratedAt === undefined ||
      document.summaryState === undefined ||
      document.createdAt === undefined ||
      document.updatedAt === undefined,
  );
}

export async function clearDocuments(ctx: RestoreContext): Promise<void> {
  const documents = await ctx.tx.inboundDocument.deleteMany({
    where: { userId: ctx.ownerId },
  });
  ctx.cleared.documents = documents.count;
}

/**
 * One document at a time, its stored bytes read from the file again
 * (`forEachDocumentContent`): the first read left them out, because a vault
 * held whole does not fit a 524 MB heap (#1239). The rows are in file order
 * on both reads.
 */
export async function restoreDocuments(ctx: RestoreContext): Promise<void> {
  const { tx, ownerId, payload, streamed } = ctx;
  if (payload.documents.length === 0) return;
  let written = 0;
  await streamed.forEachDocumentContent(async (content, index) => {
    const document = payload.documents[index];
    if (!document || content === undefined) {
      throw new Error(
        `Document ${index} of the backup has no stored bytes on the second read`,
      );
    }
    await tx.inboundDocument.create({
      data: {
        id: document.id,
        userId: ownerId,
        kind: document.kind as never,
        title: document.title ?? null,
        filename: document.filename ?? null,
        mimeType: document.mimeType,
        byteSize: document.byteSize,
        contentEncrypted: decodeEncryptedBytes(content),
        contentSha256: document.contentSha256 ?? null,
        contentCodec: document.contentCodec!,
        status: document.status as never,
        providerType: document.providerType ?? null,
        reportDate: document.reportDate ? new Date(document.reportDate) : null,
        documentDate: document.documentDate
          ? new Date(document.documentDate)
          : null,
        errorReason: document.errorReason ?? null,
        summaryEncrypted: document.summaryEncrypted
          ? decodeEncryptedBytes(document.summaryEncrypted)
          : null,
        summaryGeneratedAt: document.summaryGeneratedAt
          ? new Date(document.summaryGeneratedAt)
          : null,
        summaryState: document.summaryState as never,
        lastIndexAttemptAt: document.lastIndexAttemptAt
          ? new Date(document.lastIndexAttemptAt)
          : null,
        lastIndexOutcome: document.lastIndexOutcome ?? null,
        // An older file has no marker: those documents predate the hold and
        // restore as ordinary ones.
        aiReadDeferred: document.aiReadDeferred ?? false,
        sourceSystem: document.sourceSystem ?? null,
        sourceId: document.sourceSystem ? (document.sourceId ?? null) : null,
        // A file written before v1.39.3 has no instance: the key then
        // matches any instance of its system, as it did when stored.
        sourceInstance:
          document.sourceSystem && document.sourceId
            ? document.sourceInstance
              ? normaliseSourceInstance(document.sourceInstance)
              : null
            : null,
        createdAt: new Date(document.createdAt!),
        updatedAt: new Date(document.updatedAt!),
      },
      select: { id: true },
    });
    written += 1;
  });
  if (written !== payload.documents.length) {
    throw new Error(
      `The backup's second read found ${written} of ${payload.documents.length} documents`,
    );
  }
}
