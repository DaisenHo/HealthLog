/**
 * The vaccinations slice of the backup payload schema.
 *
 * Part of the vaccinations backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import { VaccinationSite } from "@/generated/prisma/enums";
import { base64BytesSchema, isoDateTime } from "@/lib/export/backup-schema-kit";

/**
 * One administered dose.
 *
 * `antigenSlug` is a free string here rather than an enum of the catalogue
 * this release ships, deliberately: a slug the catalogue has since dropped
 * must still restore, and the renderer degrades to `vaccineName`. Validating
 * it at the restore boundary would refuse a file the app itself wrote.
 */
export const vaccinationBackupSchema = z
  .object({
    id: z.string().min(1),
    occurredAt: isoDateTime,
    antigenSlug: z.string().nullable().optional(),
    vaccineName: z.string().nullable().optional(),
    doseNumber: z.number().int().nullable().optional(),
    seriesDoses: z.number().int().nullable().optional(),
    lotNumber: z.string().nullable().optional(),
    site: z.enum(VaccinationSite).nullable().optional(),
    practitionerId: z.string().nullable().optional(),
    encounterId: z.string().nullable().optional(),
    // Remapped against the restored reminders (they travel since v1.37.20);
    // dropped to NULL, with the drop named, only when the file lacks the row.
    reminderId: z.string().nullable().optional(),
    // The person's own vaccine definition the dose names;
    // remapped against the restored definitions like `reminderId`.
    customVaccineId: z.string().nullable().optional(),
    // Ciphertext on a disaster-recovery file, readable on a portable one.
    noteEncrypted: base64BytesSchema.nullable().optional(),
    note: z.string().nullable().optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    deletedAt: isoDateTime.nullable().optional(),
  })
  .passthrough();
/**
 * One of the person's own vaccine definitions (v1.42, #1005). `components`
 * is a list of free strings rather than the antigen enum, for the reason
 * `antigenSlug` is: a file the app wrote must restore.
 */
export const customVaccineBackupSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    components: z.array(z.string()).optional(),
    typicalSeriesDoses: z.number().int().nullable().optional(),
    boosterIntervalMonths: z.number().int().nullable().optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    deletedAt: isoDateTime.nullable().optional(),
  })
  .passthrough();
export const vaccinationLinkBackupSchema = z
  .object({
    vaccinationId: z.string().min(1),
    targetId: z.string().min(1),
    createdAt: isoDateTime,
  })
  .passthrough();
