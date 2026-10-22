/**
 * The reminders slice of the backup payload schema.
 *
 * Part of the reminders backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import {
  MeasurementReminderEventKind,
  MeasurementType,
  ReminderOrigin,
} from "@/generated/prisma/enums";
import { isoDateTime } from "@/lib/export/backup-schema-kit";
import { REMINDER_EVENT_SOURCES } from "@/lib/measurement-reminders/satisfy";

/**
 * One Vorsorge reminder, and one row of its completion ledger (v1.37.20,
 * #223 / iOS #68).
 *
 * `id` is required on both: an encounter, a vaccination record and every
 * ledger row address a reminder by it, and a ledger row is addressed by its
 * own id on re-insert. The enums are exactly the API's own — `origin` and
 * `kind` are the Prisma enums, and the ledger `source` is validated against
 * the engine's closed call-site set rather than accepted as free text, so a
 * file cannot smuggle a value the engine itself would never write.
 */
export const measurementReminderBackupSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    measurementType: z.enum(MeasurementType).nullable().optional(),
    intervalDays: z.number().int().nullable().optional(),
    rrule: z.string().nullable().optional(),
    anchorDate: isoDateTime.nullable().optional(),
    endsOn: isoDateTime.nullable().optional(),
    origin: z.enum(ReminderOrigin).optional(),
    notifyHour: z.number().int().min(0).max(23).optional(),
    location: z.string().nullable().optional(),
    // Server-computed and restored verbatim — recomputing on restore would
    // move a due date the person had already been shown.
    nextDueAt: isoDateTime.nullable().optional(),
    lastSatisfiedAt: isoDateTime.nullable().optional(),
    enabled: z.boolean().optional(),
    vaccinationAntigen: z.string().nullable().optional(),
    snoozedUntil: isoDateTime.nullable().optional(),
    lastSkippedAt: isoDateTime.nullable().optional(),
    skipCount: z.number().int().min(0).optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    deletedAt: isoDateTime.nullable().optional(),
  })
  .passthrough();
export const measurementReminderEventBackupSchema = z
  .object({
    id: z.string().min(1),
    reminderId: z.string().min(1),
    kind: z.enum(MeasurementReminderEventKind),
    occurredAt: isoDateTime,
    onTime: z.boolean(),
    source: z.enum(REMINDER_EVENT_SOURCES),
    createdAt: isoDateTime,
  })
  .passthrough();
