/**
 * What every domain's export is handed, and what it hands back.
 *
 * Each domain reads its own tables and returns its slice of the payload with
 * its row counts. `buildFullBackupPayload` lays the slices out in the order
 * `backup-domains.ts` lists them, which is the order the file has always had.
 */
import type { PrismaClient } from "@/generated/prisma/client";

export type BackupPurpose = "portable-export" | "disaster-recovery";

export interface BackupExportContext {
  readonly prisma: PrismaClient;
  readonly userId: string;
  readonly purpose: BackupPurpose;
  /** `purpose === "disaster-recovery"`, spelled out because every row asks. */
  readonly disasterRecovery: boolean;
  /**
   * Leave the bulk tables unread and put `DeferredRows` markers where their
   * arrays sit (`deferred-rows.ts`); only the streaming writer asks for this.
   */
  readonly deferBulk: boolean;
}

export interface BackupExportPart {
  /** The payload keys this domain writes, in the order they appear. */
  section: Record<string, unknown>;
  /** Row counts for the audit trail, in the order they appear. */
  counts: Record<string, number>;
}
