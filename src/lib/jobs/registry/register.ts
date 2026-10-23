/**
 * Turn the registry into running queues.
 *
 * For one group, in this order: create every queue (policy and retention
 * included), reconcile the policies of queues that already exist, schedule
 * every cron, remove the retired queues, then bind a handler to every queue.
 * The order is the one the hand-written registrars kept, and
 * `tests/integration/queue-registration-parity.test.ts` holds what it leaves
 * in pg-boss to the golden they produced.
 *
 * A handler is loaded on its queue's first job, not here. The wrappers that
 * shape how a job runs (the lock, the heavy lane) are applied at binding, so a
 * queue's protections do not depend on whether its module has loaded yet. A
 * module that fails to load fails the job that asked for it, with the queue's
 * name on the error, and the next job tries the import again.
 */
import type { Job, PgBoss } from "pg-boss";

import { heavyLane } from "@/lib/jobs/heavy-lane";
import { lockedPass } from "@/lib/jobs/long-pass";
import {
  createAndSchedule,
  createAndWork,
  retireQueues,
  type QueuePolicyTable,
  type ScheduleEntry,
} from "@/lib/jobs/reminder/registrar-shared";
import { workerLog } from "@/lib/jobs/reminder/shared";

import type {
  BatchHandler,
  BootDiscovery,
  JobContext,
  JobDefinition,
  JobGroup,
} from "./define-job";

/**
 * The handler a definition binds: its loaded module behind the lock and the
 * lane it declares.
 */
export function bindableHandler(
  definition: JobDefinition,
  ctx: JobContext,
): BatchHandler<Job<unknown>> {
  let loading: Promise<BatchHandler<Job<unknown>>> | null = null;
  const load = (): Promise<BatchHandler<Job<unknown>>> => {
    loading ??= definition.load(ctx).catch((err: unknown) => {
      loading = null;
      throw err;
    });
    return loading;
  };
  let handler: BatchHandler<Job<unknown>> = async (jobs) =>
    (await load())(jobs);
  if (definition.lane) {
    handler = heavyLane(
      definition.queue,
      handler,
      definition.lane === true ? undefined : definition.lane,
    );
  }
  if (definition.lock) {
    handler = lockedPass(definition.queue, definition.lock, handler);
  }
  return handler;
}

/** The schedule tuples of a group, in declaration order. */
export function schedulesOf(jobs: readonly JobDefinition[]): ScheduleEntry[] {
  return jobs.flatMap((job): ScheduleEntry[] =>
    job.cron
      ? [
          job.scheduleOptions
            ? [job.queue, job.cron, { ...job.scheduleOptions }]
            : [job.queue, job.cron],
        ]
      : [],
  );
}

/** The policy table of a group. */
export function policiesOf(jobs: readonly JobDefinition[]): QueuePolicyTable {
  return Object.fromEntries(
    jobs.flatMap((job) => (job.policy ? [[job.queue, job.policy]] : [])),
  );
}

/**
 * Register one group: create, schedule, retire, bind. Returns the queue names
 * it created.
 */
export async function registerJobGroup(
  boss: PgBoss,
  group: JobGroup,
): Promise<readonly string[]> {
  const queues = group.jobs.map((job) => job.queue);
  await createAndSchedule(
    boss,
    queues,
    schedulesOf(group.jobs),
    policiesOf(group.jobs),
  );
  if (group.retired) await retireQueues(boss, group.retired);
  const ctx: JobContext = { boss };
  for (const job of group.jobs) {
    await createAndWork(boss, job.queue, job.work, bindableHandler(job, ctx));
  }
  if (group.afterBind) await group.afterBind(ctx);
  return queues;
}

/**
 * Run one group's boot discovery. A pass that fails is logged and the next
 * one runs: a discovery miss never fails the boot, and the next boot or cron
 * tick offers the work again.
 */
export async function runBootDiscovery(
  passes: readonly BootDiscovery[],
): Promise<void> {
  for (const pass of passes) {
    try {
      const result = await pass.run();
      if (!result) continue;
      if (result.error) {
        workerLog(
          "error",
          `[${pass.name}] boot discovery failed: ${result.error}`,
        );
      } else {
        const skipped =
          result.skipped === undefined ? "" : ` skipped=${result.skipped}`;
        workerLog(
          "info",
          `[${pass.name}] boot discovery: enqueued=${result.enqueued}${skipped}`,
        );
      }
    } catch (err) {
      workerLog(
        "error",
        `[${pass.name}] boot discovery threw an unexpected error`,
        err,
      );
    }
  }
}
