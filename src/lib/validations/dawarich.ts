/**
 * v1.43 — Dawarich as movement context (daily values only). Part of the
 * `environment` module; every route is the caller's own record.
 */
import { z } from "zod/v4";

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const dawarichConnectSchema = z.strictObject({
  url: z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine((value) => /^https?:\/\//i.test(value), "Use http or https"),
  apiKey: z.string().trim().min(1).max(512),
});
export type DawarichConnectInput = z.infer<typeof dawarichConnectSchema>;

export const dawarichPlacesQuerySchema = z.strictObject({
  q: z.string().trim().max(80).optional(),
});

export const dawarichSettingsSchema = z
  .strictObject({
    homePlaceId: z.number().int().positive().nullable().optional(),
    homeCountry: z
      .string()
      .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2")
      .nullable()
      .optional(),
  })
  .refine(
    (value) =>
      value.homePlaceId !== undefined || value.homeCountry !== undefined,
    "Send homePlaceId, homeCountry or both",
  );
export type DawarichSettingsInput = z.infer<typeof dawarichSettingsSchema>;

/** At most 365 days back, checked by the route against the account's today. */
export const DAWARICH_SYNC_MAX_DAYS = 365;
export const dawarichSyncSchema = z.strictObject({
  fromDate: dayKey.optional(),
});

export const dawarichDisconnectSchema = z.strictObject({
  deleteData: z.boolean().optional().default(false),
});
