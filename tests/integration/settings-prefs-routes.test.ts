/**
 * The two per-user Settings preferences that live outside the account
 * payload, end to end against Postgres:
 *
 * - `/api/settings/module-list-layout`: defaults without a write, one list
 *   changed per PUT with preserve-when-absent fields and untouched neighbours,
 *   the multi-issue 422 for unknown values, and the column carrying only what
 *   was chosen.
 * - `/api/settings/preview-features`: all off by default, PATCH keeps the
 *   flags it does not name, an unknown flag or an empty body is refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { cookieJar, headerJar } from "./mock-next-headers";
import { getPrismaClient, switchSessionTo, truncateAllTables } from "./setup";

vi.mock("next/headers", async () => {
  const { cookieJar, headerJar } = await import("./mock-next-headers");
  return {
    headers: vi.fn(async () => ({
      get: (name: string) => headerJar.get(name.toLowerCase()) ?? null,
    })),
    cookies: vi.fn(async () => ({
      get: (name: string) => {
        const value = cookieJar.get(name);
        return value ? { name, value } : undefined;
      },
      set: (name: string, value: string) => {
        cookieJar.set(name, value);
      },
      delete: (name: string) => {
        cookieJar.delete(name);
      },
    })),
  };
});

vi.mock("@/lib/db-compat", () => ({
  ensureDbCompatibility: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(async () => {
  await truncateAllTables(getPrismaClient());
  cookieJar.clear();
  headerJar.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function seedUser(): Promise<{ userId: string }> {
  const prisma = getPrismaClient();
  const user = await prisma.user.create({
    data: {
      username: "settings-prefs-user",
      email: "settings-prefs@example.test",
      role: "USER",
    },
  });
  const session = await prisma.session.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
  });
  cookieJar.set("healthlog_session", session.id);
  return { userId: user.id };
}

type Handler = (req: Request) => Promise<Response>;

function json(method: string, url: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/settings/module-list-layout — integration", () => {
  const URL = "http://localhost/api/settings/module-list-layout";

  it("answers the defaults without writing a row", async () => {
    const { userId } = await seedUser();
    const { GET } = await import("@/app/api/settings/module-list-layout/route");
    const res = await (GET as Handler)(new Request(URL));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { lists: Record<string, { view: string; saved: boolean }> };
    };
    expect(body.data.lists.labs).toMatchObject({ view: "list", saved: false });
    expect(body.data.lists.illness).toMatchObject({
      view: "cards",
      saved: false,
    });
    const row = await getPrismaClient().user.findUnique({
      where: { id: userId },
      select: { moduleListLayoutJson: true },
    });
    expect(row?.moduleListLayoutJson).toBeNull();
  });

  it("changes one list per PUT and keeps the fields and lists it does not name", async () => {
    const { userId } = await seedUser();
    const { GET, PUT } =
      await import("@/app/api/settings/module-list-layout/route");

    const first = await (PUT as Handler)(
      json("PUT", URL, { version: 1, list: "labs", order: ["m2", "m1"] }),
    );
    expect(first.status).toBe(200);
    const second = await (PUT as Handler)(
      json("PUT", URL, { version: 1, list: "labs", sortDir: "manual" }),
    );
    expect(second.status).toBe(200);
    await (PUT as Handler)(
      json("PUT", URL, { version: 1, list: "illness", view: "list" }),
    );

    const res = await (GET as Handler)(new Request(URL));
    const body = (await res.json()) as {
      data: {
        lists: Record<
          string,
          { view: string; order: string[]; sortDir: string; saved: boolean }
        >;
      };
    };
    expect(body.data.lists.labs).toEqual({
      view: "list",
      order: ["m2", "m1"],
      sortDir: "manual",
      saved: true,
    });
    expect(body.data.lists.illness).toMatchObject({
      view: "list",
      order: [],
      saved: true,
    });
    expect(body.data.lists.vorsorge.saved).toBe(false);

    // Only chosen fields are stored, so a default can still move later.
    const row = await getPrismaClient().user.findUnique({
      where: { id: userId },
      select: { moduleListLayoutJson: true },
    });
    expect(row?.moduleListLayoutJson).toEqual({
      version: 1,
      labs: { order: ["m2", "m1"], sortDir: "manual" },
      illness: { view: "list" },
    });
  });

  it("refuses unknown lists, values and keys with every issue named", async () => {
    await seedUser();
    const { PUT } = await import("@/app/api/settings/module-list-layout/route");
    const res = await (PUT as Handler)(
      json("PUT", URL, {
        version: 1,
        list: "weight",
        view: "grid",
        extra: true,
      }),
    );
    expect(res.status).toBe(422);
  });

  it("refuses a caller without a session", async () => {
    const { GET } = await import("@/app/api/settings/module-list-layout/route");
    const res = await (GET as Handler)(new Request(URL));
    expect(res.status).toBe(401);
  });
});

describe("/api/settings/preview-features — integration", () => {
  const URL = "http://localhost/api/settings/preview-features";

  it("is all off by default and keeps a flag once switched on", async () => {
    const { userId } = await seedUser();
    const { GET, PATCH } =
      await import("@/app/api/settings/preview-features/route");

    const before = await (GET as Handler)(new Request(URL));
    expect(((await before.json()) as { data: unknown }).data).toEqual({
      topics: false,
    });

    const on = await (PATCH as Handler)(json("PATCH", URL, { topics: true }));
    expect(on.status).toBe(200);
    expect(((await on.json()) as { data: unknown }).data).toEqual({
      topics: true,
    });

    const after = await (GET as Handler)(new Request(URL));
    expect(((await after.json()) as { data: unknown }).data).toEqual({
      topics: true,
    });
    const row = await getPrismaClient().user.findUnique({
      where: { id: userId },
      select: { previewFeaturesJson: true },
    });
    expect(row?.previewFeaturesJson).toEqual({ topics: true });
  });

  it("refuses an unknown flag and an empty body", async () => {
    await seedUser();
    const { PATCH } = await import("@/app/api/settings/preview-features/route");
    const unknown = await (PATCH as Handler)(
      json("PATCH", URL, { topics: true, darkMagic: true }),
    );
    expect(unknown.status).toBe(422);
    const empty = await (PATCH as Handler)(json("PATCH", URL, {}));
    expect(empty.status).toBe(422);
  });
});

describe("settings presentation follows the person, also while acting for a record", () => {
  const LAYOUT = "http://localhost/api/settings/module-list-layout";
  const PREVIEW = "http://localhost/api/settings/preview-features";

  async function actingForAnotherRecord() {
    const prisma = getPrismaClient();
    const owner = await prisma.user.create({
      data: {
        username: "prefs-record-owner",
        email: "prefs-owner@example.test",
        role: "USER",
      },
    });
    const actor = await prisma.user.create({
      data: {
        username: "prefs-delegate",
        email: "prefs-delegate@example.test",
        role: "USER",
      },
    });
    await prisma.accountGrant.create({
      data: {
        grantorId: owner.id,
        granteeId: actor.id,
        access: "WRITE",
        acceptedAt: new Date(),
      },
    });
    const session = await prisma.session.create({
      data: { userId: actor.id, expiresAt: new Date(Date.now() + 60_000) },
    });
    cookieJar.set("healthlog_session", session.id);
    await switchSessionTo(session.id, owner.id);
    return { ownerId: owner.id, actorId: actor.id };
  }

  it("reads and saves the actor's own layout and preview switch", async () => {
    const { ownerId, actorId } = await actingForAnotherRecord();
    const layout = await import("@/app/api/settings/module-list-layout/route");
    const preview = await import("@/app/api/settings/preview-features/route");

    expect((await (layout.GET as Handler)(new Request(LAYOUT))).status).toBe(
      200,
    );
    const put = await (layout.PUT as Handler)(
      json("PUT", LAYOUT, { version: 1, list: "labs", view: "cards" }),
    );
    expect(put.status).toBe(200);
    expect((await (preview.GET as Handler)(new Request(PREVIEW))).status).toBe(
      200,
    );
    const patch = await (preview.PATCH as Handler)(
      json("PATCH", PREVIEW, { topics: true }),
    );
    expect(patch.status).toBe(200);

    const rows = await getPrismaClient().user.findMany({
      where: { id: { in: [ownerId, actorId] } },
      select: {
        id: true,
        moduleListLayoutJson: true,
        previewFeaturesJson: true,
      },
    });
    const actor = rows.find((r) => r.id === actorId)!;
    const owner = rows.find((r) => r.id === ownerId)!;
    expect(actor.moduleListLayoutJson).toMatchObject({
      labs: { view: "cards" },
    });
    expect(actor.previewFeaturesJson).toEqual({ topics: true });
    expect(owner.moduleListLayoutJson).toBeNull();
    expect(owner.previewFeaturesJson).toBeNull();
  });
});

describe("layout saves for different lists do not overwrite each other", () => {
  const URL = "http://localhost/api/settings/module-list-layout";

  it("keeps every list a burst of concurrent saves touched", async () => {
    const { userId } = await seedUser();
    const { PUT } = await import("@/app/api/settings/module-list-layout/route");
    const lists = ["labs", "illness", "vorsorge"] as const;
    await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        (PUT as Handler)(
          json("PUT", URL, {
            version: 1,
            list: lists[i % 3],
            ...(i < 3 ? { view: "cards" } : { order: [`item-${i}`] }),
          }),
        ),
      ),
    );
    const row = await getPrismaClient().user.findUniqueOrThrow({
      where: { id: userId },
      select: { moduleListLayoutJson: true },
    });
    const stored = row.moduleListLayoutJson as Record<
      string,
      { view?: string; order?: string[] }
    >;
    for (const list of lists) {
      expect(stored[list]?.view, list).toBe("cards");
      expect(stored[list]?.order, list).toBeDefined();
    }
  });
});
