/**
 * The ecg slice of the backup payload schema.
 *
 * Part of the ecg backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import {
  MeasurementSource,
  RhythmClassification,
} from "@/generated/prisma/enums";
import { base64BytesSchema, isoDateTime } from "@/lib/export/backup-schema-kit";

/**
 * One ECG strip.
 *
 * `waveformEncrypted` and `waveform` are the two ends of the same contract, so
 * both are optional here and exactly one arrives: a disaster-recovery file
 * carries the ciphertext, a portable file carries the micro-volt samples.
 * Requiring either would refuse half the valid files. `samplingFrequency` and
 * `sampleCount` stay required in both, because without them the samples are a
 * list of numbers with no time axis.
 */
export const ecgRecordingBackupSchema = z
  .object({
    id: z.string().min(1).optional(),
    source: z.enum(MeasurementSource),
    externalRecordingId: z.string().min(1),
    recordedAt: isoDateTime,
    waveformEncrypted: base64BytesSchema.optional(),
    waveform: z.array(z.number()).optional(),
    samplingFrequency: z.number().int(),
    sampleCount: z.number().int(),
    durationSeconds: z.number().nullable().optional(),
    lead: z.string().nullable().optional(),
    averageHeartRate: z.number().int().nullable().optional(),
    rhythmClassification: z.enum(RhythmClassification).nullable().optional(),
    measurementId: z.string().min(1).nullable().optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .passthrough();
