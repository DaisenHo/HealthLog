/**
 * One account with something in every section, for the GET contract run.
 *
 * Rows go in through the app's own write routes wherever one exists, so the
 * fixture carries exactly what a client would have created — encrypted
 * columns encrypted, derived columns derived — rather than what a hand-written
 * Prisma literal guesses. Prisma is used directly only where no route writes
 * the row (imported recordings, job ledgers, conversations).
 *
 * A list that comes back empty parses against almost any schema, so the point
 * of the seed is that the lists the contract run reads are not empty.
 */
import { NextRequest } from "next/server";
import { join } from "node:path";

import type { PrismaClient } from "@/generated/prisma/client";

export interface ContractFixture {
  userId: string;
  sessionId: string;
  /** A second session of the same account, switched into the managed profile. */
  guardianSessionId: string;
  guardianRecordEpoch: number;
  managedProfileId: string;
  /** Writes that did not land; the contract run reports them first. */
  seedFailures: string[];
  /** The path parameters for a published path, or null when none is seeded. */
  pathParams(path: string): Record<string, string> | null;
  /** A seeded id by name, for query fixtures. */
  id(name: string): string;
}

export const CONTRACT_USER_ID = "user-openapi-get-contract";
const MANAGED_PROFILE_ID = "user-openapi-get-contract-managed";

type Handler = (req: NextRequest, ctx: unknown) => Promise<Response>;

function routeFile(path: string): string {
  return join(process.cwd(), "src/app", path, "route.ts");
}

/**
 * Call one route handler in-process, as the seeded session.
 *
 * `path` is the file-system path under `src/app` (`api/allergies`,
 * `api/medications/[id]/courses`); `params` fills its dynamic segments.
 */
export async function callRoute(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: {
    body?: unknown;
    params?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: unknown }> {
  const mod = (await import(/* @vite-ignore */ routeFile(path))) as Record<
    string,
    Handler | undefined
  >;
  const handler = mod[method];
  if (!handler) throw new Error(`${path} exports no ${method}`);
  let urlPath = `/${path}`;
  for (const [name, value] of Object.entries(options.params ?? {})) {
    urlPath = urlPath.replace(`[${name}]`, encodeURIComponent(value));
  }
  const url = new URL(`http://localhost${urlPath}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const init: { method: string; body?: string; headers?: HeadersInit } = {
    method,
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { "content-type": "application/json" };
  }
  const res = await handler(new NextRequest(url, init), {
    params: Promise.resolve(options.params ?? {}),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON; keep the text for the failure message
  }
  return { status: res.status, body };
}

const DAY = 24 * 60 * 60 * 1000;

function daysAgo(n: number, hour = 8): Date {
  const d = new Date(Date.now() - n * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function seedContractAccount(
  prisma: PrismaClient,
): Promise<ContractFixture> {
  await prisma.user.create({
    data: {
      id: CONTRACT_USER_ID,
      username: "openapi-get-contract",
      email: "openapi-get-contract@example.test",
      gender: "FEMALE",
      timezone: "UTC",
      role: "ADMIN",
      dateOfBirth: new Date("1985-04-12T00:00:00.000Z"),
      heightCm: 170,
    },
  });
  const session = await prisma.session.create({
    data: {
      userId: CONTRACT_USER_ID,
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    },
  });

  const { cookieJar } = await import("./mock-next-headers");
  cookieJar.set("healthlog_session", session.id);

  const ids: Record<string, string> = {};
  const failures: string[] = [];

  /** Write through a route; on success return `data`, on failure note it. */
  async function write(
    label: string,
    method: "POST" | "PUT" | "PATCH",
    path: string,
    body: unknown,
    params?: Record<string, string>,
  ): Promise<Record<string, unknown> | null> {
    try {
      const res = await callRoute(method, path, { body, params });
      if (res.status >= 200 && res.status < 300) {
        const data = (res.body as { data?: unknown }).data;
        return (data ?? {}) as Record<string, unknown>;
      }
      failures.push(
        `${label}: ${res.status} ${JSON.stringify(res.body).slice(0, 600)}`,
      );
    } catch (error) {
      failures.push(`${label}: threw ${(error as Error).message}`);
    }
    return null;
  }

  function keep(name: string, data: Record<string, unknown> | null, at = "id") {
    const value = data?.[at];
    if (typeof value === "string") ids[name] = value;
  }

  // ── Modules that are off by default ────────────────────────────────────
  await write("modules", "PATCH", "api/auth/me/modules", {
    nutrients: true,
    timeline: true,
  });

  // ── Measurements: ninety days of the common series ─────────────────────
  const rows: Array<{
    type: string;
    value: number;
    unit: string;
    measuredAt: Date;
    glucoseContext?: string;
  }> = [];
  for (let n = 0; n < 90; n++) {
    rows.push(
      {
        type: "WEIGHT",
        value: 72 + Math.sin(n / 7),
        unit: "kg",
        measuredAt: daysAgo(n, 7),
      },
      {
        type: "BLOOD_PRESSURE_SYS",
        value: 122 + (n % 9),
        unit: "mmHg",
        measuredAt: daysAgo(n, 8),
      },
      {
        type: "BLOOD_PRESSURE_DIA",
        value: 79 + (n % 5),
        unit: "mmHg",
        measuredAt: daysAgo(n, 8),
      },
      {
        type: "PULSE",
        value: 64 + (n % 7),
        unit: "bpm",
        measuredAt: daysAgo(n, 8),
      },
      {
        type: "RESTING_HEART_RATE",
        value: 58 + (n % 4),
        unit: "bpm",
        measuredAt: daysAgo(n, 6),
      },
      {
        type: "HEART_RATE_VARIABILITY",
        value: 40 + (n % 11),
        unit: "ms",
        measuredAt: daysAgo(n, 6),
      },
      {
        type: "ACTIVITY_STEPS",
        value: 6000 + ((n * 977) % 5000),
        unit: "count",
        measuredAt: daysAgo(n, 20),
      },
      {
        type: "SLEEP_DURATION",
        value: 400 + (n % 60),
        unit: "min",
        measuredAt: daysAgo(n, 6),
      },
      {
        type: "BODY_FAT",
        value: 24 + (n % 3) / 2,
        unit: "%",
        measuredAt: daysAgo(n, 7),
      },
      {
        type: "OXYGEN_SATURATION",
        value: 97,
        unit: "%",
        measuredAt: daysAgo(n, 6),
      },
      {
        type: "BLOOD_GLUCOSE",
        value: 92 + (n % 13),
        unit: "mg/dL",
        measuredAt: daysAgo(n, 9),
        glucoseContext: "FASTING",
      },
    );
  }
  await prisma.measurement.createMany({
    data: rows.map((row, i) => ({
      userId: CONTRACT_USER_ID,
      type: row.type as never,
      value: row.value,
      unit: row.unit,
      measuredAt: row.measuredAt,
      source: "MANUAL",
      externalId: `contract-${i}`,
      ...(row.glucoseContext
        ? { glucoseContext: row.glucoseContext as never }
        : {}),
    })),
  });
  const firstMeasurement = await prisma.measurement.findFirst({
    where: { userId: CONTRACT_USER_ID, type: "WEIGHT" },
    orderBy: { measuredAt: "desc" },
  });
  if (firstMeasurement) ids.measurement = firstMeasurement.id;

  // ── Mood ───────────────────────────────────────────────────────────────
  const binaryTag = await prisma.moodTag.findFirst({
    where: { userId: null, kind: { not: "RATED" } },
  });
  const ratedTag = await prisma.moodTag.findFirst({
    where: { userId: null, kind: "RATED" },
  });
  for (let n = 0; n < 20; n++) {
    const mood = await write("mood", "POST", "api/mood-entries", {
      date: dayKey(daysAgo(n + 1)),
      mood: ["GUT", "OKAY", "SUPER_GUT", "SCHLECHT"][n % 4],
      moodLoggedAt: daysAgo(n + 1, 21).toISOString(),
      note: n === 0 ? "A contract note" : undefined,
      ...(n === 0 && binaryTag ? { tagKeys: [binaryTag.key] } : {}),
      ...(n === 0 && ratedTag
        ? { ratedFactors: [{ key: ratedTag.key, rating: 3 }] }
        : {}),
    });
    if (n === 0) keep("mood", mood);
  }

  // ── Medication ─────────────────────────────────────────────────────────
  const medication = await write("medication", "POST", "api/medications", {
    name: "Contract compound",
    dose: "10 mg",
    schedules: [
      {
        time: "08:00",
        windowStart: "07:00",
        windowEnd: "10:00",
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      },
    ],
  });
  keep("medication", medication);

  // ── Records ────────────────────────────────────────────────────────────
  keep(
    "allergy",
    await write("allergy", "POST", "api/allergies", {
      substance: "Pollen",
      category: "ENVIRONMENT",
      type: "ALLERGY",
      status: "ACTIVE",
      reaction: "Sneezing",
    }),
  );
  keep(
    "familyHistory",
    await write("family-history", "POST", "api/family-history", {
      relationship: "MOTHER",
      condition: "Hypertension",
    }),
  );
  keep(
    "practitioner",
    await write("practitioner", "POST", "api/practitioners", {
      name: "Dr. Example",
      specialty: "General practice",
    }),
  );
  keep(
    "encounter",
    await write("encounter", "POST", "api/encounters", {
      kind: "ROUTINE",
      occurredAt: daysAgo(30).toISOString(),
      reason: "Check-up",
    }),
  );
  keep(
    "vaccination",
    await write("vaccination", "POST", "api/vaccinations", {
      vaccineName: "Tetanus",
      occurredAt: daysAgo(200).toISOString(),
    }),
  );
  keep(
    "illness",
    await write("illness", "POST", "api/illness/episodes", {
      label: "Cold",
      type: "INFECTION",
      onsetAt: daysAgo(14).toISOString(),
    }),
  );
  const assessment = await write(
    "assessment",
    "POST",
    "api/mental-health/assessments",
    { instrument: "PHQ9", items: [0, 1, 0, 1, 0, 0, 1, 0, 0] },
  );
  keep(
    "assessment",
    (assessment?.assessment as Record<string, unknown> | undefined) ?? null,
  );
  keep(
    "customMetric",
    await write("custom-metric", "POST", "api/custom-metrics", {
      name: "Contract metric",
      unit: "pts",
    }),
  );
  if (ids.customMetric) {
    await write(
      "custom-metric-entry",
      "POST",
      "api/custom-metrics/[id]/entries",
      { value: 3, measuredAt: daysAgo(1).toISOString() },
      { id: ids.customMetric },
    );
  }
  keep(
    "lab",
    await write("lab", "POST", "api/labs", {
      analyte: "HbA1c",
      value: 5.4,
      unit: "%",
      takenAt: daysAgo(40).toISOString(),
    }),
  );
  keep(
    "reminder",
    await write("reminder", "POST", "api/measurement-reminders", {
      type: "WEIGHT",
      label: "Morning weight",
      time: "07:30",
      intervalDays: 1,
    }),
  );
  await write("cycle-day", "POST", "api/cycle/day-logs", {
    date: dayKey(daysAgo(3)),
    loggedAt: daysAgo(3, 9).toISOString(),
    flow: "MEDIUM",
  });
  await write("symptom-definition", "POST", "api/symptoms/definitions", {
    label: "Headache",
  });
  const definitions = await callRoute("GET", "api/symptoms/definitions");
  const definition = (definitions.body as { data?: unknown }).data as
    Array<{ id: string }> | { definitions?: Array<{ id: string }> } | undefined;
  const definitionId = Array.isArray(definition)
    ? definition[0]?.id
    : definition?.definitions?.[0]?.id;
  if (definitionId) {
    await write("symptom", "POST", "api/symptoms/events", {
      definitionId,
      occurredAt: daysAgo(2).toISOString(),
      intensity: 4,
    });
  } else {
    failures.push(
      `symptom: no definition ${JSON.stringify(definitions.body).slice(0, 300)}`,
    );
  }
  await write("life-event", "POST", "api/life-events", {
    title: "Moved house",
    category: "HOME",
    startDate: dayKey(daysAgo(60)),
    precision: "DAY",
  });
  // Creating a managed profile asks for a fresh second factor, which a seeded
  // session cannot give; the profile and its MANAGE grant go in directly.
  await prisma.user.create({
    data: {
      id: MANAGED_PROFILE_ID,
      username: "openapi-get-contract-managed",
      email: null,
      role: "USER",
      managedProfileAt: new Date(),
    },
  });
  await prisma.accountGrant.create({
    data: {
      grantorId: MANAGED_PROFILE_ID,
      granteeId: CONTRACT_USER_ID,
      access: "MANAGE",
      acceptedAt: new Date(Date.now() - 60_000),
    },
  });
  ids.managedProfile = MANAGED_PROFILE_ID;

  // ── Medication detail ──────────────────────────────────────────────────
  if (ids.medication) {
    const medication = { id: ids.medication };
    await write(
      "side-effect",
      "POST",
      "api/medications/[id]/side-effects",
      { entry: "NAUSEA", severity: 2, occurredAt: daysAgo(5).toISOString() },
      medication,
    );
    await prisma.medicationIntakeEvent.createMany({
      data: Array.from({ length: 14 }, (_, n) => ({
        userId: CONTRACT_USER_ID,
        medicationId: ids.medication,
        scheduledFor: daysAgo(n + 1, 8),
        takenAt: n % 5 === 0 ? null : daysAgo(n + 1, 8),
        skipped: n % 5 === 0,
        source: "WEB" as const,
      })),
    });
    const intakeJob = await prisma.medicationIntakeImportJob.create({
      data: {
        recordUserId: CONTRACT_USER_ID,
        actorUserId: CONTRACT_USER_ID,
        medicationId: ids.medication,
        payload: {},
        progress: {
          processed: 0,
          total: 3,
          imported: 0,
          skippedByReason: {},
          skipDetails: [],
          skippedDetailsOmitted: 0,
          touchedDays: [],
          rollupProcessed: 0,
        },
      },
    });
    ids.intakeImportJob = intakeJob.id;
    const doseJob = await prisma.medicationIntakeImportJob.create({
      data: {
        recordUserId: CONTRACT_USER_ID,
        actorUserId: CONTRACT_USER_ID,
        payload: {},
        progress: {
          processed: 0,
          total: 3,
          imported: 0,
          skippedByReason: {},
          skipDetails: [],
          skippedDetailsOmitted: 0,
          touchedDays: [],
          rollupProcessed: 0,
        },
      },
    });
    ids.doseHistoryImportJob = doseJob.id;
  }

  if (ids.medication) {
    await write(
      "inventory",
      "POST",
      "api/medications/[id]/inventory",
      { unitsTotal: 30, containerType: "BLISTER" },
      { id: ids.medication },
    );
  }
  await write("cycle-symptom", "POST", "api/cycle/symptoms/custom", {
    label: "Contract symptom",
  });
  await write("device", "POST", "api/devices", {
    token: "contract-device-token",
    bundleId: "dev.healthlog.contract",
    apnsToken: "a".repeat(64),
    apnsEnvironment: "sandbox",
    appVersion: "1.0",
    model: "iPhone",
  });
  await write("share-link", "POST", "api/share-links", {
    label: "For the practice",
    rangeStart: daysAgo(60).toISOString(),
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  await write("mcp-token", "POST", "api/mcp/tokens", {
    name: "Contract connector",
    scope: "read",
  });
  // A device's irregular-rhythm notification: the EVENT row the rhythm
  // timeline reads.
  await prisma.measurement.create({
    data: {
      userId: CONTRACT_USER_ID,
      type: "IRREGULAR_RHYTHM_NOTIFICATION",
      value: 1,
      unit: "count",
      measuredAt: daysAgo(6, 3),
      source: "APPLE_HEALTH",
      externalId: "contract-rhythm-1",
      rhythmClassification: "IRREGULAR",
    },
  });

  // ── Workouts ───────────────────────────────────────────────────────────
  const workouts = await write("workouts", "POST", "api/workouts/batch", {
    workouts: [1, 3, 6].map((n) => ({
      sportType: "running",
      startedAt: daysAgo(n, 17).toISOString(),
      endedAt: new Date(daysAgo(n, 17).getTime() + 40 * 60_000).toISOString(),
      totalEnergyKcal: 420,
      totalDistanceM: 6500,
      avgHeartRate: 148,
      externalId: `contract-workout-${n}`,
    })),
  });
  void workouts;
  const workout = await prisma.workout.findFirst({
    where: { userId: CONTRACT_USER_ID },
  });
  if (workout) ids.workout = workout.id;

  // ── Biomarker, a lab against it ────────────────────────────────────────
  keep(
    "biomarker",
    await write("biomarker", "POST", "api/biomarkers", {
      name: "Contract marker",
      unit: "mg/dL",
      lowerBound: 10,
      upperBound: 50,
    }),
  );
  if (ids.biomarker) {
    await write("lab-on-biomarker", "POST", "api/labs", {
      biomarkerId: ids.biomarker,
      value: 31,
      unit: "mg/dL",
      takenAt: daysAgo(20).toISOString(),
    });
  }

  if (ids.illness) {
    await write(
      "illness-day",
      "POST",
      "api/illness/episodes/[id]/day-logs",
      { date: dayKey(daysAgo(13)), functionalImpact: 2, feverC: 38.1 },
      { id: ids.illness },
    );
  }
  await write("custom-vaccine", "POST", "api/vaccinations/custom", {
    name: "Contract vaccine",
    components: ["tetanus"],
  });
  await write("coach-reminder", "POST", "api/coach/reminders", {
    note: "Check weight trend",
  });

  // ── ECG: a recording through the persistence path the importers use ───
  const { persistEcgRecording } = await import("@/lib/ecg/persist-recording");
  const ecg = await persistEcgRecording(
    {
      userId: CONTRACT_USER_ID,
      source: "APPLE_HEALTH",
      externalRecordingId: "contract-ecg-1",
      recordedAt: daysAgo(4, 10),
      samples: Array.from({ length: 512 }, (_, i) =>
        Math.round(Math.sin(i / 8) * 400),
      ),
      samplingFrequency: 512,
      averageHeartRate: 66,
      rhythmClassification: "NOT_DETECTED",
    },
    prisma,
  );
  ids.ecg = ecg.id;

  // ── A Coach conversation with an exchange in it ────────────────────────
  const { createConversation, appendMessage } =
    await import("@/lib/ai/coach/persistence");
  const conversation = await createConversation({
    userId: CONTRACT_USER_ID,
    title: "Contract conversation",
  });
  ids.conversation = conversation.id;
  await appendMessage({
    conversationId: conversation.id,
    role: "user",
    content: "How is my blood pressure?",
  });
  const answer = await appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "It has been steady over the last month.",
  });
  ids.message = answer.id;

  // ── A document, through the same ingest the upload route calls ────────
  const { ingestDocument } = await import("@/lib/documents/ingest");
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  );
  const ingested = await ingestDocument({
    userId: CONTRACT_USER_ID,
    scoped: false,
    ipAddress: null,
    bytes: pdf,
    filename: "contract.pdf",
    title: "Contract letter",
    kind: null,
    documentDate: dayKey(daysAgo(10)),
    episodeIds: [],
    encounterIds: [],
    sourceSystem: "PAPERLESS",
    sourceId: "4711",
    sourceInstance: null,
    aiDeferred: true,
    sourceKeyChecked: false,
    limits: { maxFileBytes: 10 * 1024 * 1024, quotaBytes: 100 * 1024 * 1024 },
    documentAi: async () => ({
      available: false,
      reason: "no_provider",
      onDeviceAllowed: false,
    }),
  });
  if (ingested.kind === "stored") ids.document = ingested.document.id;
  else failures.push(`document: ingest answered ${ingested.kind}`);

  // ── An AI run ──────────────────────────────────────────────────────────
  const { createAiRun } = await import("@/lib/documents/ai-runs/store");
  if (ids.document) {
    ids.aiRun = await createAiRun({
      userId: CONTRACT_USER_ID,
      kind: "DOCUMENT_INDEX",
      documentId: ids.document,
      params: { mode: "vision", mime: "application/pdf" },
    });
  }

  // ── Import ledger rows ─────────────────────────────────────────────────
  const importJob = await prisma.importJob.create({
    data: {
      userId: CONTRACT_USER_ID,
      uploadBytes: 2048,
      status: "completed",
      completedAt: daysAgo(1),
    },
  });
  ids.importJob = importJob.id;

  // ── A stored backup of this very account, and a restore job for it ─────
  const { storeBackupBlob } = await import("@/lib/export/store-backup-blob");
  const { streamFullBackupJson } =
    await import("@/lib/export/full-backup-stream");
  const stored = await storeBackupBlob(
    prisma,
    { userId: CONTRACT_USER_ID, type: "WEEKLY_AUTO", preview: () => null },
    async (out) => {
      await streamFullBackupJson(prisma, CONTRACT_USER_ID, out, {
        purpose: "disaster-recovery",
      });
    },
  );
  ids.backup = stored.id;
  const restore = await prisma.backupRestoreJob.create({
    data: {
      userId: CONTRACT_USER_ID,
      actorUserId: CONTRACT_USER_ID,
      backupId: stored.id,
      backupDigest: "contract-digest",
      status: "completed",
    },
  });
  ids.restoreJob = restore.id;

  // Fixed keys for the parameters that are not row ids.
  ids.today = dayKey(daysAgo(1));
  ids.paperless = "paperless";
  ids.profileFamily = "profile";

  const guardianSession = await prisma.session.create({
    data: {
      userId: CONTRACT_USER_ID,
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      actingAsUserId: MANAGED_PROFILE_ID,
      recordEpoch: 1,
    },
  });

  return {
    userId: CONTRACT_USER_ID,
    sessionId: session.id,
    guardianSessionId: guardianSession.id,
    guardianRecordEpoch: guardianSession.recordEpoch,
    managedProfileId: MANAGED_PROFILE_ID,
    seedFailures: failures,
    id(name) {
      const value = ids[name];
      if (value === undefined) throw new Error(`no seeded ${name}`);
      return value;
    },
    pathParams(path) {
      const names = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      if (names.length === 0) return {};
      const value = PATH_PARAM_SOURCES[path];
      if (!value) return null;
      const out: Record<string, string> = {};
      for (const name of names) {
        const source = value[name];
        const resolved = source ? ids[source] : undefined;
        if (resolved === undefined) return null;
        out[name] = resolved;
      }
      return out;
    },
  };
}

/** Which seeded id fills which path parameter. */
const PATH_PARAM_SOURCES: Record<string, Record<string, string>> = {
  "/api/measurements/{id}": { id: "measurement" },
  "/api/mood-entries/{id}": { id: "mood" },
  "/api/medications/{id}": { id: "medication" },
  "/api/medications/{id}/glp1": { id: "medication" },
  "/api/medications/{id}/api-endpoint": { id: "medication" },
  "/api/medications/{id}/phase-config": { id: "medication" },
  "/api/medications/{id}/side-effects": { id: "medication" },
  "/api/medications/{id}/courses": { id: "medication" },
  "/api/medications/{id}/intake": { id: "medication" },
  "/api/medications/{id}/inventory": { id: "medication" },
  "/api/medications/{id}/cadence": { id: "medication" },
  "/api/medications/{id}/compliance": { id: "medication" },
  "/api/medications/{id}/efficacy": { id: "medication" },
  "/api/medications/{id}/dose-history": { id: "medication" },
  "/api/medications/{id}/schedule-revisions": { id: "medication" },
  "/api/allergies/{id}": { id: "allergy" },
  "/api/family-history/{id}": { id: "familyHistory" },
  "/api/practitioners/{id}": { id: "practitioner" },
  "/api/encounters/{id}": { id: "encounter" },
  "/api/vaccinations/{id}": { id: "vaccination" },
  "/api/illness/episodes/{id}": { id: "illness" },
  "/api/illness/episodes/{id}/day-logs": { id: "illness" },
  "/api/illness/episodes/{id}/correlation": { id: "illness" },
  "/api/mental-health/assessments/{id}": { id: "assessment" },
  "/api/custom-metrics/{id}": { id: "customMetric" },
  "/api/custom-metrics/{id}/entries": { id: "customMetric" },
  "/api/labs/{id}": { id: "lab" },
  "/api/measurement-reminders/{id}": { id: "reminder" },
  "/api/measurement-reminders/{id}/history": { id: "reminder" },
  "/api/managed-profiles/{id}": { id: "managedProfile" },
  "/api/managed-profiles/{id}/guardians": { id: "managedProfile" },
  "/api/managed-profiles/{id}/handover": { id: "managedProfile" },
  "/api/workouts/{id}": { id: "workout" },
  "/api/biomarkers/{id}": { id: "biomarker" },
  "/api/insights/ecg/{id}": { id: "ecg" },
  "/api/insights/chat/{id}": { id: "conversation" },
  "/api/insights/chat/{id}/messages/{messageId}/results": {
    id: "conversation",
    messageId: "message",
  },
  "/api/insights/chat/{id}/messages/{messageId}/trail": {
    id: "conversation",
    messageId: "message",
  },
  "/api/documents/inbound/{id}": { id: "document" },
  "/api/documents/inbound/{id}/chat": { id: "document" },
  "/api/ai-runs/{id}": { id: "aiRun" },
  "/api/import/apple-health-export/{jobId}/status": { jobId: "importJob" },
  "/api/medications/{id}/intake/import/{jobId}/status": {
    id: "medication",
    jobId: "intakeImportJob",
  },
  "/api/medications/intake/dose-history-import/{jobId}/status": {
    jobId: "doseHistoryImportJob",
  },
  "/api/admin/backups/{id}/download": { id: "backup" },
  "/api/admin/backups/restores/{jobId}": { jobId: "restoreJob" },
  "/api/documents/sources/{system}/tags": { system: "paperless" },
  "/api/documents/sources/{system}/search": { system: "paperless" },
  "/api/day/{date}": { date: "today" },
  "/api/record-settings/{family}": { family: "profileFamily" },
};
