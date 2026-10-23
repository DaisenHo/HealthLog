/**
 * The awards slice of the backup payload schema.
 *
 * Part of the awards backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import {
  MeasurementSource,
  MeasurementType,
  PersonalRecordDirection,
} from "@/generated/prisma/enums";
import { isoDateTime } from "@/lib/export/backup-schema-kit";

/**
 * One personal best.
 *
 * `direction` is required rather than defaulted: it says whether higher or
 * lower wins, the read path orders by it, and a best time defaulted to MAX
 * would present the account's worst time as its record. `sourceMeasurementId`
 * is the provenance pointer the restore resolves, and a real foreign key in the
 * database, whatever `prisma/schema.prisma` says, so the restore nulls what it
 * cannot resolve rather than letting Postgres refuse the whole file.
 */
export const personalRecordBackupSchema = z
  .object({
    metricType: z.enum(MeasurementType),
    metricSlot: z.string().nullable().optional(),
    direction: z.enum(PersonalRecordDirection),
    value: z.number(),
    unit: z.string().min(1),
    achievedAt: isoDateTime,
    sourceMeasurementId: z.string().nullable().optional(),
    source: z.enum(MeasurementSource).optional(),
    externalId: z.string().nullable().optional(),
    createdAt: isoDateTime.optional(),
  })
  .passthrough();
/**
 * One unlocked badge.
 *
 * `achievementId` is a free string on purpose: it names a definition in the
 * code catalogue, which drifts between the release that wrote the file and the
 * one that reads it, and a row is evidence that a person earned something on a
 * day rather than a claim about what this build ships.
 *
 * `unlockedAt` is REQUIRED, unlike almost every other stamp in this file. It
 * is the field that cannot be recovered from anywhere else, and a file that
 * does not state it must fail rather than restore every badge to today.
 */
export const userAchievementBackupSchema = z
  .object({
    achievementId: z.string().min(1),
    unlockedAt: isoDateTime,
    createdAt: isoDateTime.optional(),
  })
  .passthrough();
