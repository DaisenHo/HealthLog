/**
 * Seed one synthetic account the size of a heavy real one, for the benchmark
 * harness (`scripts/bench/run.ts`) and for reproducing the maintenance jobs:
 * about 1.26 million measurement rows over ten years, plus workouts, mood
 * entries and medications with their intake history.
 *
 *   DATABASE_URL=postgresql://… pnpm dlx tsx scripts/bench/seed-large-account.ts \
 *     [--user bench-large] [--years 10] [--anchor 2026-10-22] [--reset]
 *     [--no-rollups]
 *
 * Never point this at a database that holds real data: it inserts rows under
 * the given user id and, with `--reset`, deletes that user (and, through the
 * cascades, everything it owns) first.
 *
 * Deterministic: every value and timestamp is a function of the row index and
 * the anchor day (`--anchor`, UTC midnight; default today), and ids are
 * derived from the user id, the series and the index. Two runs with the same
 * arguments write the same rows.
 *
 * The shape follows what the integrations write, with overlapping sources so
 * the canonical-source pick has work to do:
 *
 *   - Apple Health dense spot rows (heart rate about every ten minutes, HRV,
 *     SpO2, respiratory rate, gait metrics, audio exposure) keyed by a hashed
 *     sample id;
 *   - Withings morning and evening blood pressure with its pulse, and daily
 *     weight, body fat and muscle mass; a weekly manual weight beside it;
 *   - Oura nightly resting heart rate and RMSSD for the last three years,
 *     beside Apple Health's resting heart rate;
 *   - Nightscout CGM glucose every five minutes for the last 90 days;
 *   - one `stats:` daily row per cumulative type and day (the export import)
 *     and per-sample cumulative rows with opaque ids for the last 90 days
 *     (the iOS sync);
 *   - sleep-stage segments every night;
 *   - about 3,000 workouts, a mood entry a day for three years, and three
 *     daily medications with their intake events for three years.
 *
 * Everything goes in through set-based `INSERT … SELECT … generate_series`,
 * so a million rows take seconds rather than a million round trips. The
 * rollup tier is then folded with `recomputeUserRollups`, the same path the
 * boot backfill takes for an imported account, so reads see the state a real
 * account is in. `ANALYZE` runs at the end: a planner reading pre-seed
 * statistics picks plans no production table of this size would get.
 */
import { prisma } from "@/lib/db";
import {
  ALL_GRANULARITIES,
  recomputeUserRollups,
} from "@/lib/rollups/measurement-rollups";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const USER_ID = arg("user", "bench-large");
const YEARS = Number(arg("years", "10"));
const ANCHOR = arg("anchor", new Date().toISOString().slice(0, 10));
const RESET = process.argv.includes("--reset");
const ROLLUPS = !process.argv.includes("--no-rollups");
const ZONE = "Europe/Berlin";

if (!/^\d{4}-\d{2}-\d{2}$/.test(ANCHOR)) {
  throw new Error(`--anchor must be YYYY-MM-DD, got ${ANCHOR}`);
}

/**
 * A spot series: rows evenly spaced over the last `days` days before the
 * anchor. `perDay` above one spaces rows through the day; `everyDays` above
 * one writes one row every that many days at `offsetSec` past midnight UTC.
 */
interface SpotSeries {
  type: string;
  unit: string;
  source: string;
  base: number;
  spread: number;
  days: number;
  perDay?: number;
  everyDays?: number;
  offsetSec?: number;
  /** externalId prefix; `stats:` rows are generated separately. */
  idPrefix: string;
}

async function insertSpot(s: SpotSeries): Promise<number> {
  const step = s.everyDays
    ? s.everyDays * 86_400
    : Math.floor(86_400 / (s.perDay ?? 1));
  const count = Math.floor((s.days * 86_400) / step);
  // Jitter stays below the step so every measured_at is distinct per type
  // and source (the (user, type, measured_at, source, sleep_stage) unique
  // index). Series that share a step and offset (BP systolic, diastolic and
  // the Withings pulse) share their timestamps, as a cuff reading does.
  const jitter = Math.max(1, Math.min(59, step - 1));
  return prisma.$executeRawUnsafe(
    `
    INSERT INTO measurements
      (id, user_id, type, value, unit, source, measured_at, external_id, created_at, updated_at)
    SELECT
      'seed-' || $1 || '-' || $2 || '-' || $10 || '-' || g,
      $1,
      $2::measurement_type,
      round(($3 + $4 * sin(g / 37.0) + ($4 / 2) * ((g * 7919) % 100) / 100.0)::numeric, 2),
      $5,
      $10::measurement_source,
      $11::date::timestamp - make_interval(secs => $6 * $7::bigint)
        + make_interval(secs => g * $6 + $12 + (g * 31) % $8),
      $9 || md5($2 || $10 || g::text),
      now(), now()
    FROM generate_series(0, $7::bigint - 1) AS g
    `,
    USER_ID,
    s.type,
    s.base,
    s.spread,
    s.unit,
    step,
    count,
    jitter,
    s.idPrefix,
    s.source,
    ANCHOR,
    s.offsetSec ?? 0,
  );
}

function log(label: string, n: number): void {
  console.log(`${label.padEnd(40)} ${String(n).padStart(9)}`);
}

async function seedMeasurements(days: number): Promise<number> {
  const recent = Math.min(days, 90);
  const threeYears = Math.min(days, 3 * 365);
  const spot: SpotSeries[] = [
    // Apple Health, the dense tier.
    {
      type: "PULSE",
      unit: "bpm",
      source: "APPLE_HEALTH",
      perDay: 147,
      base: 62,
      spread: 25,
      days,
      idPrefix: "hk-",
    },
    {
      type: "HEART_RATE_VARIABILITY",
      unit: "ms",
      source: "APPLE_HEALTH",
      perDay: 12,
      base: 45,
      spread: 20,
      days,
      idPrefix: "hk-",
    },
    {
      type: "OXYGEN_SATURATION",
      unit: "%",
      source: "APPLE_HEALTH",
      perDay: 24,
      base: 96,
      spread: 2,
      days,
      idPrefix: "hk-",
    },
    {
      type: "RESPIRATORY_RATE",
      unit: "breaths/min",
      source: "APPLE_HEALTH",
      perDay: 24,
      base: 14,
      spread: 3,
      days,
      idPrefix: "hk-",
    },
    {
      type: "WALKING_SPEED",
      unit: "m/s",
      source: "APPLE_HEALTH",
      perDay: 12,
      base: 1.3,
      spread: 0.2,
      days,
      idPrefix: "hk-",
    },
    {
      type: "WALKING_STEP_LENGTH",
      unit: "m",
      source: "APPLE_HEALTH",
      perDay: 12,
      base: 0.72,
      spread: 0.06,
      days,
      idPrefix: "hk-",
    },
    {
      type: "WALKING_ASYMMETRY",
      unit: "%",
      source: "APPLE_HEALTH",
      perDay: 12,
      base: 3,
      spread: 2,
      days,
      idPrefix: "hk-",
    },
    {
      type: "WALKING_DOUBLE_SUPPORT",
      unit: "%",
      source: "APPLE_HEALTH",
      perDay: 12,
      base: 28,
      spread: 3,
      days,
      idPrefix: "hk-",
    },
    {
      type: "AUDIO_EXPOSURE_ENV",
      unit: "dBA",
      source: "APPLE_HEALTH",
      perDay: 24,
      base: 62,
      spread: 12,
      days,
      idPrefix: "hk-",
    },
    {
      type: "RESTING_HEART_RATE",
      unit: "bpm",
      source: "APPLE_HEALTH",
      perDay: 1,
      offsetSec: 6 * 3600,
      base: 56,
      spread: 4,
      days,
      idPrefix: "hk-",
    },
    {
      type: "TIME_IN_DAYLIGHT",
      unit: "minutes",
      source: "APPLE_HEALTH",
      perDay: 1,
      offsetSec: 18 * 3600,
      base: 60,
      spread: 40,
      days,
      idPrefix: "hk-",
    },
    // The iOS sync's per-sample cumulative rows: dense, recent, opaque ids.
    {
      type: "ACTIVITY_STEPS",
      unit: "steps",
      source: "APPLE_HEALTH",
      perDay: 100,
      base: 90,
      spread: 60,
      days: recent,
      idPrefix: "uuid-",
    },
    {
      type: "ACTIVE_ENERGY_BURNED",
      unit: "kcal",
      source: "APPLE_HEALTH",
      perDay: 400,
      base: 1.2,
      spread: 0.9,
      days: recent,
      idPrefix: "uuid-",
    },
    {
      type: "WALKING_RUNNING_DISTANCE",
      unit: "m",
      source: "APPLE_HEALTH",
      perDay: 100,
      base: 70,
      spread: 50,
      days: recent,
      idPrefix: "uuid-",
    },
    // Withings: a cuff reading morning and evening, and the scale.
    {
      type: "BLOOD_PRESSURE_SYS",
      unit: "mmHg",
      source: "WITHINGS",
      perDay: 2,
      offsetSec: 6 * 3600,
      base: 126,
      spread: 10,
      days,
      idPrefix: "wi-",
    },
    {
      type: "BLOOD_PRESSURE_DIA",
      unit: "mmHg",
      source: "WITHINGS",
      perDay: 2,
      offsetSec: 6 * 3600,
      base: 81,
      spread: 7,
      days,
      idPrefix: "wi-",
    },
    {
      type: "PULSE",
      unit: "bpm",
      source: "WITHINGS",
      perDay: 2,
      offsetSec: 6 * 3600,
      base: 66,
      spread: 8,
      days,
      idPrefix: "wi-",
    },
    {
      type: "WEIGHT",
      unit: "kg",
      source: "WITHINGS",
      perDay: 1,
      offsetSec: 5 * 3600,
      base: 82,
      spread: 1.5,
      days,
      idPrefix: "wi-",
    },
    {
      type: "BODY_FAT",
      unit: "%",
      source: "WITHINGS",
      perDay: 1,
      offsetSec: 5 * 3600,
      base: 22,
      spread: 2,
      days,
      idPrefix: "wi-",
    },
    {
      type: "MUSCLE_MASS",
      unit: "kg",
      source: "WITHINGS",
      perDay: 1,
      offsetSec: 5 * 3600,
      base: 61,
      spread: 1,
      days,
      idPrefix: "wi-",
    },
    // A weekly manual weight beside the scale.
    {
      type: "WEIGHT",
      unit: "kg",
      source: "MANUAL",
      everyDays: 7,
      offsetSec: 19 * 3600,
      base: 82.4,
      spread: 1.5,
      days,
      idPrefix: "man-",
    },
    // Oura, nightly, the last three years.
    {
      type: "RESTING_HEART_RATE",
      unit: "bpm",
      source: "OURA",
      perDay: 1,
      offsetSec: 4 * 3600,
      base: 54,
      spread: 4,
      days: threeYears,
      idPrefix: "oura-",
    },
    {
      type: "HRV_RMSSD",
      unit: "ms",
      source: "OURA",
      perDay: 1,
      offsetSec: 4 * 3600,
      base: 48,
      spread: 15,
      days: threeYears,
      idPrefix: "oura-",
    },
    // Nightscout CGM, every five minutes, the last 90 days.
    {
      type: "BLOOD_GLUCOSE",
      unit: "mg/dL",
      source: "NIGHTSCOUT",
      perDay: 288,
      base: 105,
      spread: 30,
      days: recent,
      idPrefix: "ns-",
    },
  ];

  let total = 0;
  for (const s of spot) {
    const n = await insertSpot(s);
    total += n;
    log(`${s.type} (${s.source})`, n);
  }

  // One export-estimate `stats:` row per cumulative type and local day, at
  // local noon — what `flushCumulativeBuckets` in the export import writes —
  // for every day older than the per-sample window.
  for (const [type, hk, unit, base] of [
    ["ACTIVITY_STEPS", "HKQuantityTypeIdentifierStepCount", "steps", 8000],
    [
      "ACTIVE_ENERGY_BURNED",
      "HKQuantityTypeIdentifierActiveEnergyBurned",
      "kcal",
      550,
    ],
    [
      "WALKING_RUNNING_DISTANCE",
      "HKQuantityTypeIdentifierDistanceWalkingRunning",
      "m",
      6000,
    ],
    ["FLIGHTS_CLIMBED", "HKQuantityTypeIdentifierFlightsClimbed", "flights", 9],
  ] as const) {
    const n = await prisma.$executeRawUnsafe(
      `
      INSERT INTO measurements
        (id, user_id, type, value, unit, source, measured_at, external_id,
         aggregation_provenance, created_at, updated_at)
      SELECT
        'seed-' || $1 || '-' || $2 || '-stats-' || d,
        $1, $2::measurement_type, $5 + (d * 7919) % ($5 / 2), $4, 'APPLE_HEALTH',
        (($7::date - d)::timestamp + interval '12 hours')
          AT TIME ZONE $8 AT TIME ZONE 'UTC',
        'stats:' || $3 || ':' || to_char($7::date - d, 'YYYY-MM-DD'),
        'EXPORT_XML_SOURCE_MAX', now(), now()
      FROM generate_series(91, $6::int) AS d
      `,
      USER_ID,
      type,
      hk,
      unit,
      base,
      days,
      ANCHOR,
      ZONE,
    );
    total += n;
    log(`${type} (stats:)`, n);
  }

  // Sleep: 30 segments a night from 23:00 local, 16 minutes apart, rotating
  // through the stages. Distinct measured_at per segment.
  const sleep = await prisma.$executeRawUnsafe(
    `
    INSERT INTO measurements
      (id, user_id, type, value, unit, source, measured_at, external_id,
       sleep_stage, created_at, updated_at)
    SELECT
      'seed-' || $1 || '-sleep-' || d || '-' || s,
      $1, 'SLEEP_DURATION', 16, 'minutes', 'APPLE_HEALTH',
      (($3::date - d)::timestamp - interval '1 hour' + s * interval '16 minutes')
        AT TIME ZONE $4 AT TIME ZONE 'UTC',
      'hk-' || md5('sleep' || d || '-' || s),
      (ARRAY['CORE','DEEP','CORE','REM','AWAKE','CORE']::sleep_stage[])[1 + s % 6],
      now(), now()
    FROM generate_series(1, $2::int) AS d, generate_series(0, 29) AS s
    `,
    USER_ID,
    days,
    ANCHOR,
    ZONE,
  );
  total += sleep;
  log("SLEEP_DURATION (APPLE_HEALTH)", sleep);
  return total;
}

async function seedWorkouts(days: number): Promise<number> {
  // About one workout every 29 hours, rotating through five sports.
  const count = Math.floor((days * 24) / 29);
  return prisma.$executeRawUnsafe(
    `
    INSERT INTO workouts
      (id, user_id, sport_type, started_at, ended_at, duration_sec,
       total_energy_kcal, total_distance_m, avg_heart_rate, max_heart_rate,
       source, external_id, created_at, updated_at)
    SELECT
      'seed-' || $1 || '-workout-' || g,
      $1,
      (ARRAY['walking','running','cycling','hiking','swimming'])[1 + g % 5],
      $3::date::timestamp - make_interval(hours => (g * 29)::int) + interval '17 hours',
      $3::date::timestamp - make_interval(hours => (g * 29)::int) + interval '17 hours'
        + make_interval(secs => (1800 + (g * 97) % 3600)::int),
      (1800 + (g * 97) % 3600)::int,
      round((250 + (g * 13) % 400)::numeric, 1),
      round((3000 + (g * 211) % 9000)::numeric, 1),
      (115 + (g * 7) % 40)::int,
      (150 + (g * 5) % 35)::int,
      'APPLE_HEALTH',
      'hk-workout-' || md5($1 || g::text),
      now(), now()
    FROM generate_series(0, $2::int - 1) AS g
    `,
    USER_ID,
    count,
    ANCHOR,
  );
}

async function seedMood(days: number): Promise<number> {
  const span = Math.min(days, 3 * 365);
  return prisma.$executeRawUnsafe(
    `
    INSERT INTO mood_entries
      (id, user_id, date, mood, score, mood_a1, stress_a2, energy_a3,
       source, mood_logged_at, tz, synced_at, created_at, updated_at)
    SELECT
      'seed-' || $1 || '-mood-' || d,
      $1,
      to_char($3::date - d, 'YYYY-MM-DD'),
      (ARRAY['LAUSIG','SCHLECHT','OKAY','GUT','SUPER_GUT'])[1 + (d * 7) % 5],
      1 + (d * 7) % 5,
      2 * ((d * 7) % 5) + 1,
      (d * 3) % 11,
      (d * 5) % 11,
      'MANUAL',
      (($3::date - d)::timestamp + interval '20 hours') AT TIME ZONE $4 AT TIME ZONE 'UTC',
      $4,
      now(), now(), now()
    FROM generate_series(1, $2::int) AS d
    `,
    USER_ID,
    span,
    ANCHOR,
    ZONE,
  );
}

async function seedMedications(days: number): Promise<number> {
  const span = Math.min(days, 3 * 365);
  const meds = [
    { key: "a", name: "Synthetic A", dose: "5 mg", window: ["08:00", "09:00"] },
    {
      key: "b",
      name: "Synthetic B",
      dose: "100 mg",
      window: ["08:00", "09:00"],
    },
    {
      key: "c",
      name: "Synthetic C",
      dose: "20 mg",
      window: ["20:00", "21:00"],
    },
  ];
  let events = 0;
  for (const m of meds) {
    const medId = `seed-${USER_ID}-med-${m.key}`;
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO medications
        (id, user_id, name, dose, starts_on, created_at, updated_at)
      VALUES ($1, $2, $3, $4, ($5::date - $6::int)::timestamp, now(), now())
      `,
      medId,
      USER_ID,
      m.name,
      m.dose,
      ANCHOR,
      span,
    );
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO medication_schedules
        (id, medication_id, window_start, window_end, schedule_type)
      VALUES ($1, $2, $3, $4, 'SCHEDULED')
      `,
      `${medId}-schedule`,
      medId,
      m.window[0],
      m.window[1],
    );
    // One intake event per day; about one in twelve skipped, the rest taken
    // a few minutes into the window.
    events += await prisma.$executeRawUnsafe(
      `
      INSERT INTO medication_intake_events
        (id, user_id, medication_id, scheduled_for, taken_at, skipped,
         attribution_source, source, created_at, updated_at)
      SELECT
        $1 || '-intake-' || d,
        $2,
        $1,
        (($3::date - d)::timestamp + $5::time) AT TIME ZONE $6 AT TIME ZONE 'UTC',
        CASE WHEN d % 12 = 0 THEN NULL
             ELSE (($3::date - d)::timestamp + $5::time
                    + make_interval(mins => (d * 7) % 40)) AT TIME ZONE $6 AT TIME ZONE 'UTC'
        END,
        d % 12 = 0,
        'AUTO',
        'WEB',
        now(), now()
      FROM generate_series(1, $4::int) AS d
      `,
      medId,
      USER_ID,
      ANCHOR,
      span,
      m.window[0],
      ZONE,
    );
  }
  return events;
}

async function main(): Promise<void> {
  const days = Math.round(YEARS * 365);
  const started = Date.now();

  if (RESET) {
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = $1`, USER_ID);
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO users (id, username, timezone, onboarding_completed_at, updated_at)
     VALUES ($1, $1, $2, now(), now())
     ON CONFLICT (id) DO NOTHING`,
    USER_ID,
    ZONE,
  );

  const measurements = await seedMeasurements(days);
  log("measurements total", measurements);
  log("workouts", await seedWorkouts(days));
  log("mood entries", await seedMood(days));
  log("medication intake events", await seedMedications(days));

  if (ROLLUPS) {
    const folded = await recomputeUserRollups(USER_ID, {
      granularities: ALL_GRANULARITIES,
      statementTimeoutMs: 600_000,
    });
    log("rollup rows", folded.rowsUpserted);
  }

  for (const table of [
    "measurements",
    "measurement_rollups",
    "workouts",
    "mood_entries",
    "medication_intake_events",
  ]) {
    await prisma.$executeRawUnsafe(`ANALYZE ${table}`);
  }
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
