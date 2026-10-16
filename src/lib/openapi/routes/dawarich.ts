/**
 * OpenAPI route table — Dawarich movement context (v1.43).
 *
 * Part of the OpenAPI route table; aggregated in `./index.ts`. Request bodies
 * reuse the runtime schemas from `@/lib/validations/dawarich`. Daily values
 * only; no coordinate or place name is stored. Every route belongs to the
 * `environment` module and is the caller's own account. The day block
 * (`DayMovement`) is published with `GET /api/day/{date}`.
 */
import type { ZodOpenApiObject } from "zod-openapi";
import { z } from "zod/v4";

import {
  dawarichConnectSchema,
  dawarichDisconnectSchema,
  dawarichSettingsSchema,
  dawarichSyncSchema,
} from "@/lib/validations/dawarich";

import { connectionHealth } from "./integrations";
import {
  dataEnvelope,
  errorEnvelope,
  moduleDisabledResponse,
  stdResponses,
} from "./shared";
import { isoDateTime } from "@/lib/validations/datetime";

const dawarichConnectRequest = dawarichConnectSchema.meta({
  id: "DawarichConnectRequest",
  description:
    "`url` (http or https, at most 2048) and `apiKey` (1..512); both sealed at rest. A private host needs its origin in `DAWARICH_PRIVATE_ORIGINS`.",
});

const dawarichSettings = dawarichSettingsSchema.meta({
  id: "DawarichSettings",
  description:
    "The home place (an id on the Dawarich instance) and the home country (ISO 3166-1 alpha-2). Without a home country the most frequent country of the last 365 days is used, and without one there is no travel day.",
});

const dawarichStatus = z
  .object({
    connected: z.boolean(),
    configured: z.boolean(),
    homePlaceSet: z.boolean(),
    homeCountry: z.string().nullable(),
    daysStored: z.number().int(),
    oldestDay: z.string().nullable(),
    latestDay: z.string().nullable(),
    health: connectionHealth.nullable(),
  })
  .meta({
    id: "DawarichStatus",
    description:
      "The Dawarich connection. `health` is the shape every connection publishes; there are no legacy ledger fields.",
  });

const travelSuggestion = z
  .object({
    id: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    countryCode: z.string(),
  })
  .meta({
    id: "TravelSuggestion",
    description:
      "A run of consecutive travel days no stored trip covers. Accept it through `POST /api/environment/travel` (the person picks the place).",
  });

const responses = (
  ok: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  ...ok,
  ...moduleDisabledResponse,
  ...extra,
  ...stdResponses,
});

const errorOnly = (description: string) => ({
  description,
  content: { "application/json": { schema: errorEnvelope } },
});

export const dawarichPaths: NonNullable<ZodOpenApiObject["paths"]> = {
  "/api/dawarich/connect": {
    post: {
      tags: ["Integrations"],
      summary: "Connect Dawarich (v1.43)",
      description:
        "Checks the key against the instance, stores the connection sealed and starts a 30-day backfill. 422 `dawarich.invalid`, `private_origin_not_approved`, `dawarich.credentials_rejected` or `dawarich.unreachable`; 429 `dawarich.rate_limited` (ten a minute).",
      requestBody: {
        required: true,
        content: { "application/json": { schema: dawarichConnectRequest } },
      },
      responses: responses({
        "200": {
          description: "Connected.",
          content: {
            "application/json": {
              schema: dataEnvelope(
                z.object({ connected: z.literal(true) }),
                "DawarichConnectEnvelope",
              ),
            },
          },
        },
      }),
    },
  },
  "/api/dawarich/status": {
    get: {
      tags: ["Integrations"],
      summary: "Dawarich connection status (v1.43)",
      responses: responses({
        "200": {
          description: "The connection.",
          content: {
            "application/json": {
              schema: dataEnvelope(dawarichStatus, "DawarichStatusEnvelope"),
            },
          },
        },
      }),
    },
  },
  "/api/dawarich/places": {
    get: {
      tags: ["Integrations"],
      summary: "Places on the Dawarich instance (v1.43)",
      description:
        "Read live from Dawarich to pick the home place (at most 200, filtered by `q`); never stored. 409 `dawarich.not_connected`; 502 `dawarich.unreachable`.",
      requestParams: {
        query: z.object({ q: z.string().max(80).optional() }),
      },
      responses: responses(
        {
          "200": {
            description: "The places.",
            content: {
              "application/json": {
                schema: dataEnvelope(
                  z.object({
                    places: z.array(
                      z.object({ id: z.number().int(), name: z.string() }),
                    ),
                  }),
                  "DawarichPlacesEnvelope",
                ),
              },
            },
          },
        },
        {
          "409": errorOnly("`dawarich.not_connected`."),
          "502": errorOnly("`dawarich.unreachable`."),
        },
      ),
    },
  },
  "/api/dawarich/settings": {
    patch: {
      tags: ["Integrations"],
      summary: "Dawarich home place and country (v1.43)",
      description:
        "422 `dawarich.invalid`; 422 `dawarich.home_place_unknown` for a place id the instance does not have; 409 `dawarich.not_connected`; 502 `dawarich.unreachable` when the place cannot be checked. A new home country re-judges the stored travel days at once; a new home place fetches the stored days again in the background (up to a year).",
      requestBody: {
        required: true,
        content: { "application/json": { schema: dawarichSettings } },
      },
      responses: responses(
        {
          "200": {
            description: "The settings after the change.",
            content: {
              "application/json": {
                schema: dataEnvelope(
                  z.object({
                    homePlaceId: z.number().int().nullable(),
                    homeCountry: z.string().nullable(),
                  }),
                  "DawarichSettingsEnvelope",
                ),
              },
            },
          },
        },
        {
          "409": errorOnly("`dawarich.not_connected`."),
          "502": errorOnly("`dawarich.unreachable`."),
        },
      ),
    },
  },
  "/api/dawarich/test": {
    post: {
      tags: ["Integrations"],
      summary: "Probe the Dawarich connection (v1.43)",
      description:
        "Answers the shared integration probe shape. A failed probe is a 502 whose `errorCode` is one of the shared probe classes (`credentials_rejected`, `rate_limited`, `upstream_error`, `timeout`, `url_not_public`, `connection_failed`); 422 `not_configured` without a connection; 429 `rate_limited_self` past five probes a minute.",
      responses: responses(
        {
          "200": {
            description: "The probe reached the instance.",
            content: {
              "application/json": {
                schema: dataEnvelope(
                  z.object({
                    ok: z.literal(true),
                    lastSyncedAt: isoDateTime().nullable(),
                    latencyMs: z.number().int(),
                  }),
                  "DawarichProbeEnvelope",
                ),
              },
            },
          },
        },
        {
          "502": errorOnly("A probe class; see the description."),
        },
      ),
    },
  },
  "/api/dawarich/sync": {
    post: {
      tags: ["Integrations"],
      summary: "Fetch Dawarich daily values again (v1.43)",
      description:
        "From `fromDate` (inside the 365 days ending yesterday; without it the nightly window of seven days). `enqueued` is false when a run for this account is already queued or no worker is bound. 409 `dawarich.not_connected`; 422 `dawarich.invalid`.",
      requestBody: {
        required: false,
        content: { "application/json": { schema: dawarichSyncSchema } },
      },
      responses: responses(
        {
          "202": {
            description: "Queued.",
            content: {
              "application/json": {
                schema: dataEnvelope(
                  z.object({ enqueued: z.boolean() }),
                  "DawarichSyncEnvelope",
                ),
              },
            },
          },
        },
        { "409": errorOnly("`dawarich.not_connected`.") },
      ),
    },
  },
  "/api/dawarich/disconnect": {
    post: {
      tags: ["Integrations"],
      summary: "Disconnect Dawarich (v1.43)",
      description:
        "Forgets the connection; with `deleteData: true` the stored days go too. No body is `{ deleteData: false }`. Disconnecting twice is harmless.",
      requestBody: {
        required: false,
        content: { "application/json": { schema: dawarichDisconnectSchema } },
      },
      responses: responses({
        "200": {
          description: "Disconnected.",
          content: {
            "application/json": {
              schema: dataEnvelope(
                z.object({
                  disconnected: z.literal(true),
                  deletedDays: z.number().int(),
                }),
                "DawarichDisconnectEnvelope",
              ),
            },
          },
        },
      }),
    },
  },
  "/api/environment/travel/suggestions": {
    get: {
      tags: ["Environment"],
      summary: "Suggested trips from Dawarich travel days (v1.43)",
      description:
        "Runs of at least two consecutive travel days in one country, inside the last year, that no stored trip overlaps and the person has not dismissed; newest first. Empty without a Dawarich connection.",
      responses: responses({
        "200": {
          description: "The suggestions.",
          content: {
            "application/json": {
              schema: dataEnvelope(
                z.object({ suggestions: z.array(travelSuggestion) }),
                "TravelSuggestionsEnvelope",
              ),
            },
          },
        },
      }),
    },
  },
  "/api/environment/travel/suggestions/{id}/dismiss": {
    post: {
      tags: ["Environment"],
      summary: "Dismiss a suggested trip (v1.43)",
      description: "404 `environment.travel_suggestion.not_found`.",
      requestParams: { path: z.object({ id: z.string() }) },
      responses: responses(
        {
          "200": {
            description: "Dismissed.",
            content: {
              "application/json": {
                schema: dataEnvelope(
                  z.object({ dismissed: z.literal(true) }),
                  "TravelSuggestionDismissEnvelope",
                ),
              },
            },
          },
        },
        { "404": errorOnly("`environment.travel_suggestion.not_found`.") },
      ),
    },
  },
};
