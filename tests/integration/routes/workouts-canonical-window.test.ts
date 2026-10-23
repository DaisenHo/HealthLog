/**
 * The workout list and the workout detail resolve a duplicate cluster the same
 * way, whatever range either of them read.
 *
 *   - Two copies of one run thirty seconds apart on either side of a
 *     five-minute clock boundary: the list shows the Apple Health row, and the
 *     detail of the Withings copy names that row as `canonicalId`. The detail
 *     used to read only the clock slot of the requested row, found no twin,
 *     and declared the hidden copy canonical.
 *   - Runs at 09:58 (Withings), 10:02 (Apple Health) and 10:06 (Withings): a
 *     whole-history read pairs 09:58 with 10:02 and leaves 10:06 alone. A list
 *     filtered from 10:00 shows 10:02 and 10:06, the detail of every row agrees
 *     with that, and the session before 10:06 is 10:02.
 *   - The batch write clusters what it is about to insert together with the
 *     stored workouts around it: with 09:58 stored, a batch of 10:02 (Apple
 *     Health) and 10:06 (entered by hand) keeps both, where clustering the
 *     batch alone dropped 10:06 as a twin of 10:02 although every read shows
 *     it as a session of its own.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { User } from "@/generated/prisma/client";
import { GET as getDetail } from "@/app/api/workouts/[id]/route";
import { GET as getList } from "@/app/api/workouts/route";
import { POST as postBatch } from "@/app/api/workouts/batch/route";

import { callRoute, type RouteAuth } from "../../kit/call-route";
import { makeSession, makeUser, makeWorkout } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();

beforeEach(() => truncateAllTables(prisma));

const DAY_MS = 24 * 60 * 60 * 1000;
/** A day ten days back, so the list's default window always holds it. */
const DAY = new Date(Date.now() - 10 * DAY_MS).toISOString().slice(0, 10);
/** An instant on that day, `HH:MM:SS` in UTC. */
const at = (time: string) => `${DAY}T${time}.000Z`;

interface ListBody {
  workouts: Array<{ id: string }>;
}
interface DetailBody {
  id: string;
  canonicalId: string;
  previousWorkoutId: string | null;
}

async function run(
  user: Pick<User, "id">,
  startedAt: string,
  source: "APPLE_HEALTH" | "WITHINGS",
) {
  return makeWorkout(user, {
    startedAt: new Date(startedAt),
    endedAt: new Date(new Date(startedAt).getTime() + 30 * 60 * 1000),
    durationSec: 30 * 60,
    source,
    externalId: `${source}-${startedAt}`,
  });
}

async function list(auth: RouteAuth, query: Record<string, string> = {}) {
  const res = await callRoute<ListBody>(getList, {
    method: "GET",
    route: "/api/workouts",
    query,
    auth,
  });
  expect(res.status).toBe(200);
  return res.data!.workouts.map((w) => w.id);
}

async function detail(auth: RouteAuth, id: string) {
  const res = await callRoute<DetailBody>(getDetail, {
    method: "GET",
    route: "/api/workouts/{id}",
    params: { id },
    query: { compact: "1" },
    auth,
  });
  expect(res.status).toBe(200);
  return res.data!;
}

describe("list and detail agree on the canonical workout", () => {
  it("resolves a twin across a clock-slot boundary to the row the list shows", async () => {
    const user = await makeUser();
    const auth = await makeSession(user);
    const apple = await run(user, at("08:04:50"), "APPLE_HEALTH");
    const withings = await run(user, at("08:05:20"), "WITHINGS");

    expect(await list(auth)).toEqual([apple.id]);
    expect((await detail(auth, apple.id)).canonicalId).toBe(apple.id);
    // The deep link to the hidden copy lands on the row the list shows.
    expect((await detail(auth, withings.id)).canonicalId).toBe(apple.id);
  });

  it("draws the clusters of a filtered range as a read of the whole history does", async () => {
    const user = await makeUser();
    const auth = await makeSession(user);
    const early = await run(user, at("09:58:00"), "WITHINGS");
    const middle = await run(user, at("10:02:00"), "APPLE_HEALTH");
    const late = await run(user, at("10:06:00"), "WITHINGS");

    expect(await list(auth)).toEqual([late.id, middle.id]);
    // Filtered from 10:00 the list no longer holds the 09:58 run, and still
    // draws the clusters the whole history draws: 10:06 is a session of its
    // own, not a twin of 10:02.
    expect(await list(auth, { since: at("10:00:00") })).toEqual([
      late.id,
      middle.id,
    ]);
    // Up to 10:04 the list must still hide 10:02's twin from 09:58 and show
    // 10:02, though the read stops before 10:06.
    expect(
      await list(auth, {
        since: at("09:59:00"),
        until: at("10:04:00"),
      }),
    ).toEqual([middle.id]);

    expect((await detail(auth, early.id)).canonicalId).toBe(middle.id);
    expect((await detail(auth, middle.id)).canonicalId).toBe(middle.id);
    const lateDetail = await detail(auth, late.id);
    expect(lateDetail.canonicalId).toBe(late.id);
    expect(lateDetail.previousWorkoutId).toBe(middle.id);
    // The session before the 10:02 run is none: 09:58 is its own twin.
    expect((await detail(auth, middle.id)).previousWorkoutId).toBeNull();
  });
});

describe("the batch write draws clusters where the reads draw them", () => {
  it("keeps a workout the reads show as a session of its own", async () => {
    const user = await makeUser();
    const auth = await makeSession(user);
    await run(user, at("09:58:00"), "WITHINGS");

    const res = await callRoute<{
      entries: Array<{ index: number; status: string }>;
    }>(postBatch, {
      method: "POST",
      route: "/api/workouts/batch",
      body: {
        workouts: [
          {
            sportType: "running",
            startedAt: at("10:02:00"),
            endedAt: at("10:32:00"),
            source: "APPLE_HEALTH",
            externalId: "apple-1002",
          },
          {
            sportType: "running",
            startedAt: at("10:06:00"),
            endedAt: at("10:36:00"),
            source: "MANUAL",
            externalId: "manual-1006",
          },
        ],
      },
      auth,
    });

    expect(res.status).toBe(200);
    expect(res.data!.entries.map((e) => e.status)).toEqual([
      "inserted",
      "inserted",
    ]);
    const stored = await prisma.workout.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: "asc" },
      select: { id: true, externalId: true },
    });
    expect(await list(auth)).toEqual([stored[2]!.id, stored[1]!.id]);
  });

  it("still drops the twin a batch carries of its own winner", async () => {
    const user = await makeUser();
    const auth = await makeSession(user);

    const res = await callRoute<{
      entries: Array<{ index: number; status: string }>;
    }>(postBatch, {
      method: "POST",
      route: "/api/workouts/batch",
      body: {
        workouts: [
          {
            sportType: "running",
            startedAt: at("08:04:50"),
            endedAt: at("08:34:50"),
            source: "APPLE_HEALTH",
            externalId: "apple-0804",
          },
          {
            sportType: "running",
            startedAt: at("08:05:20"),
            endedAt: at("08:35:20"),
            source: "MANUAL",
            externalId: "manual-0805",
          },
        ],
      },
      auth,
    });

    expect(res.status).toBe(200);
    expect(res.data!.entries.map((e) => e.status)).toEqual([
      "inserted",
      "duplicate",
    ]);
  });
});
