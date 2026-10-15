/**
 * Keeps this process's mirror of the pulse day-mean method in step with
 * `app_settings.pulse_day_mean_method` (#1107 follow-up).
 *
 * Every pulse reader computes synchronously through `day-mean.ts`, so the
 * method cannot be read per call; it is mirrored instead
 * (`activePulseDayMeanMethod`). `instrumentation.ts` loads it once at boot and
 * refreshes it every minute in every process, web and worker alike. The apply
 * step sets it at once in the process that ran it; any other process follows
 * within a minute. The rollup tier does not use the mirror: it reads the
 * setting inside its own statement (`storedHourWeightSql`).
 *
 * A failed read keeps the mirror as it is: the setting changes once, by hand,
 * and a database blip must not flip a process back to the old statistic.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

import {
  DEFAULT_PULSE_DAY_MEAN_METHOD,
  isPulseDayMeanMethod,
  setActivePulseDayMeanMethod,
  type PulseDayMeanMethod,
} from "./day-statistic";

/** How often a process re-reads the stored method. */
const REFRESH_MS = 60_000;

const TIMER_SYMBOL = Symbol.for("healthlog.pulseDayMeanMethodTimer");

type GlobalWithTimer = typeof globalThis & {
  [TIMER_SYMBOL]?: ReturnType<typeof setInterval>;
};

type SettingsReader = {
  appSettings: Pick<Prisma.TransactionClient["appSettings"], "findUnique">;
};

/** The stored method; the column default when there is no settings row. */
export async function loadPulseDayMeanMethod(
  db: SettingsReader = prisma,
): Promise<PulseDayMeanMethod> {
  const row = await db.appSettings.findUnique({
    where: { id: "singleton" },
    select: { pulseDayMeanMethod: true },
  });
  const stored = row?.pulseDayMeanMethod;
  return isPulseDayMeanMethod(stored) ? stored : DEFAULT_PULSE_DAY_MEAN_METHOD;
}

async function refresh(): Promise<void> {
  try {
    setActivePulseDayMeanMethod(await loadPulseDayMeanMethod());
  } catch {
    // Keep the mirror; the next tick tries again.
  }
}

/**
 * Load the stored method now and keep re-reading it. Idempotent per process;
 * the timer does not hold the process open.
 */
export async function startPulseDayMeanMethodSync(): Promise<void> {
  await refresh();
  const g = globalThis as GlobalWithTimer;
  if (g[TIMER_SYMBOL]) return;
  const timer = setInterval(() => void refresh(), REFRESH_MS);
  timer.unref?.();
  g[TIMER_SYMBOL] = timer;
}
