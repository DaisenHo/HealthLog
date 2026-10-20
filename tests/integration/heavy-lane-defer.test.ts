/**
 * The heavy lane against a real pg-boss on a real Postgres: a heavy job that
 * finds the lane taken goes back to its queue, keeps its id and its attempt,
 * is not settled by pg-boss's completion of the handler that sent it back,
 * and does not spend its expiry while it waits.
 *
 * The case it replaces: a job that waited in the handler ran its expiry down
 * while it stood in line, because pg-boss counts the expiry from the fetch.
 * Here the holder runs for six seconds against a two-second expiry on the
 * waiting job; the waiting job still runs once, after the holder, without a
 * single failed attempt.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgBoss, type Job } from "pg-boss";

import { prisma } from "@/lib/db";
import { deferLaneJobs, heavyLane } from "@/lib/jobs/heavy-lane";
import { jobDone } from "@/lib/jobs/job-outcome";

let boss: PgBoss;

const HOLDER_QUEUE = "data-backup-offhost";
const WAITER_QUEUE = "data-backup";
const WORK = { localConcurrency: 1, pollingIntervalSeconds: 0.5 } as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
  await boss.start();
  await boss.createQueue(HOLDER_QUEUE);
  await boss.createQueue(WAITER_QUEUE);
}, 120_000);

afterAll(async () => {
  await boss?.stop({ graceful: false });
});

async function row(id: string) {
  const rows = await prisma.$queryRaw<
    Array<{
      state: string;
      retry_count: number;
      started_on: Date | null;
      future: boolean;
    }>
  >`
    SELECT state::text AS state, retry_count, started_on,
           start_after > now() AS future
    FROM pgboss.job WHERE id = ${id}::uuid
  `;
  return rows[0];
}

describe("deferLaneJobs", () => {
  it("returns an active job to created, later, at the same attempt", async () => {
    const id = await boss.send(WAITER_QUEUE, { probe: 1 });
    const [fetched] = await boss.fetch(WAITER_QUEUE);
    expect(fetched?.id).toBe(id);
    expect((await row(id!))?.state).toBe("active");

    expect(await deferLaneJobs(WAITER_QUEUE, [fetched!], 30)).toBe(1);
    expect(await row(id!)).toMatchObject({
      state: "created",
      retry_count: 0,
      started_on: null,
      future: true,
    });
    // Not claimable before its time.
    expect(await boss.fetch(WAITER_QUEUE)).toEqual([]);
    // pg-boss's completion of the handler finds no active row to settle.
    await boss.complete(WAITER_QUEUE, id!);
    expect((await row(id!))?.state).toBe("created");
    await boss.deleteJob(WAITER_QUEUE, id!);
  });

  it("leaves a job alone that is no longer active", async () => {
    const id = await boss.send(WAITER_QUEUE, { probe: 2 });
    const job = { id, name: WAITER_QUEUE, data: {} } as unknown as Job<object>;
    expect(await deferLaneJobs(WAITER_QUEUE, [job], 30)).toBe(0);
    expect((await row(id!))?.future).toBe(false);
    await boss.deleteJob(WAITER_QUEUE, id!);
  });
});

describe("a heavy job behind a long one", () => {
  it("waits in the queue, not in the handler, and runs once after it", async () => {
    const log: string[] = [];
    const deliveries: string[] = [];
    const shortDefer = (queue: string, jobs: readonly Job<unknown>[]) =>
      deferLaneJobs(queue, jobs, 1);

    await boss.work(
      HOLDER_QUEUE,
      WORK,
      heavyLane(
        HOLDER_QUEUE,
        async () => {
          log.push("start:holder");
          await sleep(6_000);
          log.push("end:holder");
          return jobDone({ jobs: 1 });
        },
        undefined,
        shortDefer,
      ),
    );
    await boss.work(
      WAITER_QUEUE,
      WORK,
      heavyLane(
        WAITER_QUEUE,
        async () => {
          log.push("run:waiter");
          return jobDone({ jobs: 1 });
        },
        undefined,
        async (queue, jobs) => {
          deliveries.push(jobs[0]!.id);
          return shortDefer(queue, jobs);
        },
      ),
    );

    await boss.send(HOLDER_QUEUE, {}, { expireInSeconds: 60 });
    await sleep(1_000);
    const waiter = await boss.send(
      WAITER_QUEUE,
      {},
      { expireInSeconds: 2, retryLimit: 0 },
    );

    await sleep(9_000);
    await boss.offWork(WAITER_QUEUE);
    await boss.offWork(HOLDER_QUEUE);

    // Three times its expiry in line, and not a single failed attempt.
    expect(await row(waiter!)).toMatchObject({
      state: "completed",
      retry_count: 0,
    });
    // Sent back several times while the holder ran, then run once after it.
    expect(deliveries.length).toBeGreaterThanOrEqual(2);
    expect(new Set(deliveries)).toEqual(new Set([waiter]));
    expect(log).toEqual(["start:holder", "end:holder", "run:waiter"]);
  }, 60_000);
});
