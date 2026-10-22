/**
 * The backup schema slices, one rule at a time.
 *
 * `backup.test.ts` parses whole payloads; this file holds each slice's own
 * refinements, patterns and bounds against the value just inside and just
 * outside them, and names the issue a refused value raises. Each rule here
 * is one that a whole-payload test only meets by accident: a day-key pattern
 * that stops anchoring, a two-ended free-text rule that accepts neither end,
 * a size cap off by its factor.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";

import { RESULTS_MAX_BYTES } from "@/lib/ai/coach/results/refs";
import { TRAIL_MAX_BYTES } from "@/lib/ai/coach/activity/contract";
import { base64BytesSchema, isoDateTime } from "@/lib/export/backup-schema-kit";
import {
  COACH_RESULTS_SEALED_MAX_CHARS,
  COACH_TRAIL_SEALED_MAX_CHARS,
  coachResultsJsonSchema,
  coachResultsSealedSchema,
  coachTrailJsonSchema,
  coachTrailSealedSchema,
} from "@/lib/export/coach-backup-schema";
import {
  dawarichDayBackupSchema,
  environmentDayKey,
} from "@/lib/export/environment-backup-schema";
import { lifeEventBackupSchema } from "@/lib/export/life-events-backup-schema";
import { healthProfileFactBackupSchema } from "@/lib/export/profile-backup-schema";
import { symptomDefinitionBackupSchema } from "@/lib/export/symptoms-backup-schema";

/** The issues a value raises, as `path: message`, or `[]` when it parses. */
function issues(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
}

const AT = "2026-07-01T08:00:00.000Z";
const SEALED = "QUJDRA==";

describe("the shared primitives", () => {
  it("takes an ISO instant and refuses a string Date cannot read", () => {
    expect(issues(isoDateTime, AT)).toEqual([]);
    expect(issues(isoDateTime, "yesterday")).toEqual([
      ": Expected ISO-8601 date-time string",
    ]);
    expect(issues(isoDateTime, "")).not.toEqual([]);
  });

  it("takes padded base64 and refuses anything else", () => {
    expect(issues(base64BytesSchema, SEALED)).toEqual([]);
    expect(issues(base64BytesSchema, "QUJDRA")).toEqual([
      ": Expected base64-encoded encrypted bytes",
    ]);
    expect(issues(base64BytesSchema, "QUJD RA=")).toEqual([
      ": Expected base64-encoded encrypted bytes",
    ]);
    expect(issues(base64BytesSchema, "QUJDRA===")).not.toEqual([]);
    expect(issues(base64BytesSchema, "")).not.toEqual([]);
  });
});

describe("the environment day key", () => {
  it("is anchored at both ends and wants four, two and two digits", () => {
    expect(issues(environmentDayKey, "2026-07-01")).toEqual([]);
    for (const bad of [
      "x2026-07-01",
      "2026-07-01x",
      "226-07-01",
      "2026-7-01",
      "2026-07-1",
      "abcd-07-01",
    ]) {
      expect(issues(environmentDayKey, bad), bad).toEqual([
        ": Expected a YYYY-MM-DD day key",
      ]);
    }
  });

  it("bounds a Dawarich day's time away by the hours of a long day", () => {
    const day = { date: "2026-07-01" };
    expect(
      issues(dawarichDayBackupSchema, { ...day, awayFromHomeMinutes: 25 * 60 }),
    ).toEqual([]);
    expect(
      issues(dawarichDayBackupSchema, {
        ...day,
        awayFromHomeMinutes: 25 * 60 + 1,
      }),
    ).not.toEqual([]);
    expect(
      issues(dawarichDayBackupSchema, { ...day, awayFromHomeMinutes: -1 }),
    ).not.toEqual([]);
    expect(
      issues(dawarichDayBackupSchema, { ...day, countryCode: "DE" }),
    ).toEqual([]);
    for (const bad of ["de", "DEU", "D", "1E"]) {
      expect(
        issues(dawarichDayBackupSchema, { ...day, countryCode: bad }),
        bad,
      ).not.toEqual([]);
    }
  });
});

describe("the Coach's stored tables and trail", () => {
  it("caps the readable tables at the live path's byte bound", () => {
    expect(
      issues(coachResultsJsonSchema, "a".repeat(RESULTS_MAX_BYTES)),
    ).toEqual([]);
    expect(
      issues(coachResultsJsonSchema, "a".repeat(RESULTS_MAX_BYTES + 1)),
    ).toEqual([`: Coach result tables exceed ${RESULTS_MAX_BYTES} bytes`]);
    // Counted in bytes, not characters: a two-byte letter halves the room.
    expect(
      issues(coachResultsJsonSchema, "ä".repeat(RESULTS_MAX_BYTES / 2 + 1)),
    ).not.toEqual([]);
  });

  it("caps the sealed tables at twice the readable bound", () => {
    expect(COACH_RESULTS_SEALED_MAX_CHARS).toBe(2 * RESULTS_MAX_BYTES);
    expect(
      issues(
        coachResultsSealedSchema,
        "A".repeat(COACH_RESULTS_SEALED_MAX_CHARS),
      ),
    ).toEqual([]);
    expect(
      issues(
        coachResultsSealedSchema,
        "A".repeat(COACH_RESULTS_SEALED_MAX_CHARS + 4),
      ),
    ).toEqual([": Coach result tables exceed the stored size"]);
  });

  it("caps the trail the same way", () => {
    expect(COACH_TRAIL_SEALED_MAX_CHARS).toBe(2 * TRAIL_MAX_BYTES);
    expect(issues(coachTrailJsonSchema, "a".repeat(TRAIL_MAX_BYTES))).toEqual(
      [],
    );
    expect(
      issues(coachTrailJsonSchema, "a".repeat(TRAIL_MAX_BYTES + 1)),
    ).toEqual([`: Coach trail exceeds ${TRAIL_MAX_BYTES} bytes`]);
    expect(
      issues(coachTrailSealedSchema, "A".repeat(COACH_TRAIL_SEALED_MAX_CHARS)),
    ).toEqual([]);
    expect(
      issues(
        coachTrailSealedSchema,
        "A".repeat(COACH_TRAIL_SEALED_MAX_CHARS + 4),
      ),
    ).toEqual([": Coach trail exceeds the stored size"]);
  });
});

describe("the two-ended free-text rules", () => {
  const lifeEvent = {
    category: "FAMILY",
    startDate: "2026-07-01",
    precision: "DAY",
    createdAt: AT,
    updatedAt: AT,
  };

  it("takes a life event with either end of its title, and refuses neither", () => {
    expect(
      issues(lifeEventBackupSchema, { ...lifeEvent, title: "Moved" }),
    ).toEqual([]);
    expect(
      issues(lifeEventBackupSchema, { ...lifeEvent, titleEncrypted: SEALED }),
    ).toEqual([]);
    expect(issues(lifeEventBackupSchema, lifeEvent)).toEqual([
      ": A life event needs a title or its ciphertext",
    ]);
  });

  it("reads a life event's dates as calendar days, anchored", () => {
    const titled = { ...lifeEvent, title: "Moved" };
    expect(
      issues(lifeEventBackupSchema, { ...titled, endDate: "2026-07-09" }),
    ).toEqual([]);
    for (const bad of ["2026-07-01T00:00", "x2026-07-01", "2026-7-01"]) {
      expect(
        issues(lifeEventBackupSchema, { ...titled, startDate: bad }),
        bad,
      ).not.toEqual([]);
      expect(
        issues(lifeEventBackupSchema, { ...titled, endDate: bad }),
        bad,
      ).not.toEqual([]);
    }
  });

  const definition = {
    sortOrder: 0,
    isActive: true,
    createdAt: AT,
    updatedAt: AT,
  };

  it("takes a symptom definition with either end of its label, and refuses neither", () => {
    expect(
      issues(symptomDefinitionBackupSchema, { ...definition, label: "Aura" }),
    ).toEqual([]);
    expect(
      issues(symptomDefinitionBackupSchema, {
        ...definition,
        labelEncrypted: SEALED,
      }),
    ).toEqual([]);
    expect(issues(symptomDefinitionBackupSchema, definition)).toEqual([
      ": A symptom definition needs a label or its ciphertext",
    ]);
  });

  it("bounds a symptom occurrence's intensity at zero and ten", () => {
    const event = { occurredAt: AT, createdAt: AT, updatedAt: AT };
    const withEvent = (intensity: number) => ({
      ...definition,
      label: "Aura",
      events: [{ ...event, intensity }],
    });
    expect(issues(symptomDefinitionBackupSchema, withEvent(0))).toEqual([]);
    expect(issues(symptomDefinitionBackupSchema, withEvent(10))).toEqual([]);
    expect(issues(symptomDefinitionBackupSchema, withEvent(11))).not.toEqual(
      [],
    );
    expect(issues(symptomDefinitionBackupSchema, withEvent(-1))).not.toEqual(
      [],
    );
  });
});

describe("a profile fact", () => {
  const fact = {
    id: "fact-1",
    kind: "SMOKING_STATUS",
    validFrom: "2026-07-01T00:00:00.000Z",
    validUntil: null,
    provenance: "USER_REPORTED",
    supersededByRevisionId: null,
    createdAt: AT,
  };

  it("needs a readable value of its kind when it carries no ciphertext", () => {
    expect(
      issues(healthProfileFactBackupSchema, { ...fact, value: "NEVER" }),
    ).toEqual([]);
    expect(issues(healthProfileFactBackupSchema, fact)).toEqual([
      "value: A portable profile fact requires a valid readable value",
    ]);
    expect(
      issues(healthProfileFactBackupSchema, { ...fact, value: "SOMETIMES" }),
    ).toEqual([
      "value: A portable profile fact requires a valid readable value",
    ]);
  });

  it("takes the ciphertext without a readable value", () => {
    expect(
      issues(healthProfileFactBackupSchema, {
        ...fact,
        valueEncrypted: SEALED,
      }),
    ).toEqual([]);
  });

  it("refuses a validity that ends before or as it starts", () => {
    const readable = { ...fact, value: "NEVER" };
    expect(
      issues(healthProfileFactBackupSchema, {
        ...readable,
        validUntil: "2026-07-02T00:00:00.000Z",
      }),
    ).toEqual([]);
    for (const end of [
      "2026-07-01T00:00:00.000Z",
      "2026-06-30T00:00:00.000Z",
    ]) {
      expect(
        issues(healthProfileFactBackupSchema, { ...readable, validUntil: end }),
        end,
      ).toEqual(["validUntil: validUntil must be later than validFrom"]);
    }
  });
});
