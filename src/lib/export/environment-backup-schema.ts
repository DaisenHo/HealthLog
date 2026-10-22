/**
 * The environment slice of the backup payload schema.
 *
 * Part of the environment backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import { EnvironmentLocationSource } from "@/generated/prisma/enums";
import { base64BytesSchema, isoDateTime } from "@/lib/export/backup-schema-kit";

/** `YYYY-MM-DD`, the day key both environment tables are addressed by. */
export const environmentDayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: "Expected a YYYY-MM-DD day key",
});
/**
 * One day's environmental reading.
 *
 * `source` is required: it is the only record that the day resolved somewhere
 * other than the home city, and a defaulted value would re-attribute a trip to
 * home. Every weather column is optional, because the feed is allowed to be partial
 * and a file written before a column existed says nothing about it.
 */
export const environmentContextBackupSchema = z
  .object({
    date: environmentDayKey,
    // Nullable since v1.42 (migration 0382): once the encryption backfill has
    // run, the location travels sealed in `locationEncrypted` instead.
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    locationLabel: z.string().nullable(),
    locationEncrypted: base64BytesSchema.nullable().optional(),
    source: z.enum(EnvironmentLocationSource),
    tempMin: z.number().nullable().optional(),
    tempMax: z.number().nullable().optional(),
    tempMean: z.number().nullable().optional(),
    apparentMean: z.number().nullable().optional(),
    sunshineSec: z.number().int().nullable().optional(),
    daylightSec: z.number().int().nullable().optional(),
    precipSum: z.number().nullable().optional(),
    pressureMean: z.number().nullable().optional(),
    pressureDelta: z.number().nullable().optional(),
    humidityMean: z.number().nullable().optional(),
    cloudMean: z.number().nullable().optional(),
    weatherCode: z.number().int().nullable().optional(),
    // Air quality, pollen and UV. Optional throughout.
    apparentMax: z.number().nullable().optional(),
    pm25Mean: z.number().nullable().optional(),
    pm25Max: z.number().nullable().optional(),
    pm10Mean: z.number().nullable().optional(),
    no2Mean: z.number().nullable().optional(),
    so2Mean: z.number().nullable().optional(),
    coMean: z.number().nullable().optional(),
    o3Max8h: z.number().nullable().optional(),
    eaqiMax: z.number().nullable().optional(),
    usaqiMax: z.number().nullable().optional(),
    uvIndexMax: z.number().nullable().optional(),
    dustMax: z.number().nullable().optional(),
    aodMax: z.number().nullable().optional(),
    pollenAlderMax: z.number().nullable().optional(),
    pollenBirchMax: z.number().nullable().optional(),
    pollenGrassMax: z.number().nullable().optional(),
    pollenMugwortMax: z.number().nullable().optional(),
    pollenOliveMax: z.number().nullable().optional(),
    pollenRagweedMax: z.number().nullable().optional(),
    aqDomain: z.string().nullable().optional(),
    aqHours: z.number().int().nullable().optional(),
    aqFetchedAt: isoDateTime.nullable().optional(),
    fetchedAt: isoDateTime.optional(),
    createdAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
  })
  .passthrough();
/**
 * One declared stretch spent away from home. Both bounds are day keys rather
 * than instants: the resolver compares them lexicographically against other
 * day keys, and routing one through a `Date` is how a day key loses a day.
 */
export const environmentTravelLocationBackupSchema = z
  .object({
    startDate: environmentDayKey,
    endDate: environmentDayKey,
    // Nullable since v1.42 (migration 0382), as above.
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    label: z.string().nullable(),
    locationEncrypted: base64BytesSchema.nullable().optional(),
    createdAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
  })
  .passthrough();
/**
 * One local day of Dawarich movement values. Daily values only; the
 * country rides readable (portable) or sealed (disaster recovery).
 */
export const dawarichDayBackupSchema = z
  .object({
    date: environmentDayKey,
    totalDistanceM: z.number().int().nonnegative().nullable().optional(),
    drivingDistanceM: z.number().int().nonnegative().nullable().optional(),
    trainDistanceM: z.number().int().nonnegative().nullable().optional(),
    placesVisited: z.number().int().nonnegative().nullable().optional(),
    awayFromHomeMinutes: z
      .number()
      .int()
      .min(0)
      .max(25 * 60)
      .nullable()
      .optional(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .optional(),
    countryCodeEncrypted: base64BytesSchema.nullable().optional(),
    isTravelDay: z.boolean().nullable().optional(),
    fetchedAt: isoDateTime.optional(),
    createdAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
  })
  .passthrough();
