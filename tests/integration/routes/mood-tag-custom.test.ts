/**
 * An account's own mood tags and tag groups, created, edited and removed
 * through `/api/mood/tags/custom` and `/api/mood/tags/groups`, against the
 * real database and through the real API kit.
 *
 * What is pinned, read back from the rows:
 *   - a created tag or group belongs to the caller, carries a minted key with
 *     its prefix, and stores its label sealed, never as plain text;
 *   - a tag's home group is the seeded `custom` category unless the request
 *     names a seeded category or one of the caller's own groups; another
 *     account's group, or a key nobody holds, is refused;
 *   - the per-account caps hold, and refused input writes nothing;
 *   - another account's tag or group answers 404 to every edit and removal,
 *     and is left exactly as it was;
 *   - removing a tag retires it by default and deletes it, with its entry
 *     links, only on `?purge=true`; removing a group never removes a tag: its
 *     tags move to the seeded `custom` category and the layout forgets it;
 *   - every create, edit and removal leaves an audit row.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { POST as createTag } from "@/app/api/mood/tags/custom/route";
import {
  DELETE as deleteTag,
  PATCH as patchTag,
} from "@/app/api/mood/tags/custom/[key]/route";
import { POST as createGroup } from "@/app/api/mood/tags/groups/route";
import {
  DELETE as deleteGroup,
  PATCH as patchGroup,
} from "@/app/api/mood/tags/groups/[key]/route";
import {
  CUSTOM_CATEGORY_ID,
  MAX_CUSTOM_GROUPS_PER_USER,
  MAX_CUSTOM_TAGS_PER_USER,
  decryptCustomLabel,
} from "@/lib/mood/custom-tags";

import { anonymous, callRoute } from "../../kit/call-route";
import { makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";
import {
  auditDetails,
  makeCustomGroup,
  makeCustomTag,
  makeMoodEntry,
} from "./mood-tag-fixtures";

const prisma = getPrismaClient();

interface TagOut {
  key: string;
  labelKey: string | null;
  label: string | null;
  icon: string | null;
  kind: string;
  scaleMin: number;
  scaleMax: number;
  inverse: boolean;
  isActive?: boolean;
  custom: boolean;
}

interface GroupOut {
  key: string;
  labelKey: string | null;
  label: string | null;
  icon: string | null;
  isActive?: boolean;
  custom: boolean;
}

interface Issue {
  path: string;
  code: string;
}

function issuePaths(body: unknown): string[] {
  const details =
    typeof body === "object" && body !== null && "details" in body
      ? (body as { details?: { issues?: Issue[] } }).details
      : undefined;
  return (details?.issues ?? []).map((i) => i.path);
}

beforeEach(async () => {
  await truncateAllTables(prisma);
});

describe("POST /api/mood/tags/custom", () => {
  it("creates a tag the caller owns, in the seeded custom category, with its label sealed", async () => {
    const owner = await makeUser();

    const res = await callRoute<TagOut>(createTag, {
      method: "POST",
      route: "/api/mood/tags/custom",
      body: { label: "Date night", icon: "Heart" },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      labelKey: null,
      label: "Date night",
      icon: "Heart",
      kind: "BINARY",
      custom: true,
    });
    expect(res.data.key.startsWith("custom:")).toBe(true);

    const row = await prisma.moodTag.findUniqueOrThrow({
      where: { key: res.data.key },
    });
    expect(row).toMatchObject({
      userId: owner.id,
      categoryId: CUSTOM_CATEGORY_ID,
      labelKey: res.data.key,
      icon: "Heart",
      kind: "BINARY",
      isActive: true,
    });
    expect(row.labelEncrypted).not.toContain("Date night");
    expect(decryptCustomLabel(row.labelEncrypted)).toBe("Date night");
    expect(await auditDetails(owner.id, "mood.tag.custom.create")).toEqual([
      { icon: "Heart" },
    ]);
  });

  it("homes the tag in a seeded category or the caller's own group when one is named", async () => {
    const owner = await makeUser();
    const auth = await makeSession(owner);
    const group = await makeCustomGroup(owner, "Therapy");
    const sleep = await prisma.moodTagCategory.findUniqueOrThrow({
      where: { key: "sleep" },
    });

    const seeded = await callRoute<TagOut>(createTag, {
      method: "POST",
      route: "/api/mood/tags/custom",
      body: { label: "Nap", categoryKey: "sleep" },
      auth,
    });
    const own = await callRoute<TagOut>(createTag, {
      method: "POST",
      route: "/api/mood/tags/custom",
      body: { label: "Session", categoryKey: group.key },
      auth,
    });

    expect(seeded.status).toBe(201);
    expect(own.status).toBe(201);
    expect(
      (
        await prisma.moodTag.findUniqueOrThrow({
          where: { key: seeded.data.key },
        })
      ).categoryId,
    ).toBe(sleep.id);
    expect(
      (await prisma.moodTag.findUniqueOrThrow({ where: { key: own.data.key } }))
        .categoryId,
    ).toBe(group.id);
  });

  it("refuses another account's group and a key nobody holds, writing nothing", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const theirs = await makeCustomGroup(other, "Theirs");
    const auth = await makeSession(owner);

    for (const categoryKey of [theirs.key, "customcat:nobody", "ghost"]) {
      const res = await callRoute(createTag, {
        method: "POST",
        route: "/api/mood/tags/custom",
        body: { label: "X", categoryKey },
        auth,
      });
      expect(res.status).toBe(422);
      expect(res.error).toBe("Unknown category");
    }
    expect(await prisma.moodTag.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("refuses a tag past the cap of active tags, and a retired tag does not count", async () => {
    const owner = await makeUser();
    const auth = await makeSession(owner);
    for (let i = 0; i < MAX_CUSTOM_TAGS_PER_USER - 1; i++) {
      await makeCustomTag(owner, `Tag ${i}`);
    }
    await makeCustomTag(owner, "Retired", { isActive: false });

    const last = await callRoute(createTag, {
      method: "POST",
      route: "/api/mood/tags/custom",
      body: { label: "Fiftieth" },
      auth,
    });
    const over = await callRoute(createTag, {
      method: "POST",
      route: "/api/mood/tags/custom",
      body: { label: "Fifty-first" },
      auth,
    });

    expect(last.status).toBe(201);
    expect(over.status).toBe(422);
    expect(over.error).toBe(
      `Custom tag limit reached (${MAX_CUSTOM_TAGS_PER_USER})`,
    );
    expect(
      await prisma.moodTag.count({
        where: { userId: owner.id, isActive: true },
      }),
    ).toBe(MAX_CUSTOM_TAGS_PER_USER);
  });

  it("refuses an empty label, an over-long label and an unknown icon, naming each field", async () => {
    const owner = await makeUser();
    const auth = await makeSession(owner);

    const cases: Array<[unknown, string]> = [
      [{ label: "" }, "label"],
      [{ label: "   " }, "label"],
      [{ label: "x".repeat(41) }, "label"],
      [{ label: "Fine", icon: "NoSuchIcon" }, "icon"],
      [{}, "label"],
    ];
    for (const [body, field] of cases) {
      const res = await callRoute(createTag, {
        method: "POST",
        route: "/api/mood/tags/custom",
        body,
        auth,
      });
      expect(res.status).toBe(422);
      expect(res.error).toBe("Validation failed");
      expect(issuePaths(res.body)).toContain(field);
    }
    expect(await prisma.moodTag.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("refuses an anonymous caller", async () => {
    const res = await callRoute(createTag, {
      method: "POST",
      route: "/api/mood/tags/custom",
      body: { label: "X" },
      auth: anonymous,
    });

    expect(res.status).toBe(401);
    expect(
      await prisma.moodTag.count({ where: { userId: { not: null } } }),
    ).toBe(0);
  });
});

describe("PATCH /api/mood/tags/custom/{key}", () => {
  it("renames, re-icons and retires the caller's tag", async () => {
    const owner = await makeUser();
    const tag = await makeCustomTag(owner, "Old name");

    const res = await callRoute<TagOut>(patchTag, {
      method: "PATCH",
      route: "/api/mood/tags/custom/{key}",
      params: { key: tag.key },
      body: { label: "New name", icon: "Heart", isActive: false },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      key: tag.key,
      label: "New name",
      icon: "Heart",
      isActive: false,
      custom: true,
    });
    const row = await prisma.moodTag.findUniqueOrThrow({
      where: { id: tag.id },
    });
    expect(decryptCustomLabel(row.labelEncrypted)).toBe("New name");
    expect(row).toMatchObject({ icon: "Heart", isActive: false });
    expect(await auditDetails(owner.id, "mood.tag.custom.update")).toEqual([
      { fields: ["label", "icon", "isActive"], isActive: false },
    ]);
  });

  it("moves the tag to the caller's own group, and refuses another account's", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const tag = await makeCustomTag(owner, "Session");
    const mine = await makeCustomGroup(owner, "Therapy");
    const theirs = await makeCustomGroup(other, "Theirs");
    const auth = await makeSession(owner);

    const moved = await callRoute(patchTag, {
      method: "PATCH",
      route: "/api/mood/tags/custom/{key}",
      params: { key: tag.key },
      body: { categoryKey: mine.key },
      auth,
    });
    expect(moved.status).toBe(200);
    expect(
      (await prisma.moodTag.findUniqueOrThrow({ where: { id: tag.id } }))
        .categoryId,
    ).toBe(mine.id);

    const refused = await callRoute(patchTag, {
      method: "PATCH",
      route: "/api/mood/tags/custom/{key}",
      params: { key: tag.key },
      body: { categoryKey: theirs.key, label: "Changed" },
      auth,
    });
    expect(refused.status).toBe(422);
    expect(refused.error).toBe("Unknown category");
    const row = await prisma.moodTag.findUniqueOrThrow({
      where: { id: tag.id },
    });
    expect(row.categoryId).toBe(mine.id);
    expect(decryptCustomLabel(row.labelEncrypted)).toBe("Session");
  });

  it("answers 404 for another account's tag and leaves it as it was", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const theirs = await makeCustomTag(other, "Private");

    const res = await callRoute(patchTag, {
      method: "PATCH",
      route: "/api/mood/tags/custom/{key}",
      params: { key: theirs.key },
      body: { label: "Taken over", isActive: false },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(404);
    expect(
      await prisma.moodTag.findUniqueOrThrow({ where: { id: theirs.id } }),
    ).toEqual(theirs);
  });

  it("answers 404 for a catalogue key and leaves the catalogue row alone", async () => {
    const owner = await makeUser();
    const happy = await prisma.moodTag.findUniqueOrThrow({
      where: { key: "happy" },
    });

    const res = await callRoute(patchTag, {
      method: "PATCH",
      route: "/api/mood/tags/custom/{key}",
      params: { key: "happy" },
      body: { isActive: false },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(404);
    expect(res.error).toBe("Not a custom tag");
    expect(
      await prisma.moodTag.findUniqueOrThrow({ where: { key: "happy" } }),
    ).toEqual(happy);
  });

  it("refuses an empty edit and an invalid field", async () => {
    const owner = await makeUser();
    const tag = await makeCustomTag(owner, "Keep");
    const auth = await makeSession(owner);

    for (const body of [{}, { label: "" }, { isActive: "no" }]) {
      const res = await callRoute(patchTag, {
        method: "PATCH",
        route: "/api/mood/tags/custom/{key}",
        params: { key: tag.key },
        body,
        auth,
      });
      expect(res.status).toBe(422);
    }
    expect(
      await prisma.moodTag.findUniqueOrThrow({ where: { id: tag.id } }),
    ).toEqual(tag);
  });
});

describe("DELETE /api/mood/tags/custom/{key}", () => {
  it("retires the tag by default and keeps the entries that picked it", async () => {
    const owner = await makeUser();
    const tag = await makeCustomTag(owner, "Migraine");
    const entry = await makeMoodEntry(owner, [tag]);

    const res = await callRoute(deleteTag, {
      method: "DELETE",
      route: "/api/mood/tags/custom/{key}",
      params: { key: tag.key },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ key: tag.key, purged: false });
    expect(
      (await prisma.moodTag.findUniqueOrThrow({ where: { id: tag.id } }))
        .isActive,
    ).toBe(false);
    expect(
      await prisma.moodEntryTagLink.count({ where: { moodEntryId: entry.id } }),
    ).toBe(1);
    expect(await auditDetails(owner.id, "mood.tag.custom.delete")).toEqual([
      { purge: false },
    ]);
  });

  it("deletes the tag and its entry links on ?purge=true, keeping the entries", async () => {
    const owner = await makeUser();
    const tag = await makeCustomTag(owner, "Migraine");
    const happy = await prisma.moodTag.findUniqueOrThrow({
      where: { key: "happy" },
    });
    const entry = await makeMoodEntry(owner, [tag, happy]);

    const res = await callRoute(deleteTag, {
      method: "DELETE",
      route: "/api/mood/tags/custom/{key}",
      params: { key: tag.key },
      query: { purge: "true" },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ key: tag.key, purged: true });
    expect(
      await prisma.moodTag.findUnique({ where: { id: tag.id } }),
    ).toBeNull();
    const links = await prisma.moodEntryTagLink.findMany({
      where: { moodEntryId: entry.id },
    });
    expect(links.map((l) => l.moodTagId)).toEqual([happy.id]);
    expect(
      await prisma.moodEntry.findUnique({ where: { id: entry.id } }),
    ).not.toBeNull();
    expect(await auditDetails(owner.id, "mood.tag.custom.delete")).toEqual([
      { purge: true },
    ]);
  });

  it("answers 404 for another account's tag, purge or not, and leaves it and its links", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const theirs = await makeCustomTag(other, "Private");
    const entry = await makeMoodEntry(other, [theirs]);
    const auth = await makeSession(owner);

    for (const query of [{}, { purge: "true" }]) {
      const res = await callRoute(deleteTag, {
        method: "DELETE",
        route: "/api/mood/tags/custom/{key}",
        params: { key: theirs.key },
        query,
        auth,
      });
      expect(res.status).toBe(404);
    }
    expect(
      await prisma.moodTag.findUniqueOrThrow({ where: { id: theirs.id } }),
    ).toEqual(theirs);
    expect(
      await prisma.moodEntryTagLink.count({ where: { moodEntryId: entry.id } }),
    ).toBe(1);
    expect(await auditDetails(owner.id, "mood.tag.custom.delete")).toEqual([]);
  });

  it("answers 404 for a catalogue key and leaves the catalogue row alone", async () => {
    const owner = await makeUser();
    const happy = await prisma.moodTag.findUniqueOrThrow({
      where: { key: "happy" },
    });

    const res = await callRoute(deleteTag, {
      method: "DELETE",
      route: "/api/mood/tags/custom/{key}",
      params: { key: "happy" },
      query: { purge: "true" },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(404);
    expect(res.error).toBe("Not a custom tag");
    expect(
      await prisma.moodTag.findUniqueOrThrow({ where: { key: "happy" } }),
    ).toEqual(happy);
  });
});

describe("POST /api/mood/tags/groups", () => {
  it("creates a group the caller owns, after the seeded categories, with its label sealed", async () => {
    const owner = await makeUser();
    await makeCustomGroup(owner, "Existing");

    const res = await callRoute<GroupOut>(createGroup, {
      method: "POST",
      route: "/api/mood/tags/groups",
      body: { label: "Therapy", icon: "Stethoscope" },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      labelKey: null,
      label: "Therapy",
      icon: "Stethoscope",
      custom: true,
    });
    expect(res.data.key.startsWith("customcat:")).toBe(true);
    const row = await prisma.moodTagCategory.findUniqueOrThrow({
      where: { key: res.data.key },
    });
    expect(row).toMatchObject({
      userId: owner.id,
      labelKey: res.data.key,
      icon: "Stethoscope",
      sortOrder: 102,
      isActive: true,
    });
    expect(row.labelEncrypted).not.toContain("Therapy");
    expect(decryptCustomLabel(row.labelEncrypted)).toBe("Therapy");
    expect(await auditDetails(owner.id, "mood.tag.group.create")).toEqual([
      { icon: "Stethoscope" },
    ]);
  });

  it("refuses a group past the cap and invalid input, writing nothing", async () => {
    const owner = await makeUser();
    const auth = await makeSession(owner);
    for (let i = 0; i < MAX_CUSTOM_GROUPS_PER_USER; i++) {
      await makeCustomGroup(owner, `Group ${i}`);
    }

    const over = await callRoute(createGroup, {
      method: "POST",
      route: "/api/mood/tags/groups",
      body: { label: "One more" },
      auth,
    });
    expect(over.status).toBe(422);
    expect(over.error).toBe(
      `Custom group limit reached (${MAX_CUSTOM_GROUPS_PER_USER})`,
    );

    const other = await makeUser();
    const invalid = await callRoute(createGroup, {
      method: "POST",
      route: "/api/mood/tags/groups",
      body: { label: "", icon: "NoSuchIcon" },
      auth: await makeSession(other),
    });
    expect(invalid.status).toBe(422);
    expect(issuePaths(invalid.body)).toEqual(
      expect.arrayContaining(["label", "icon"]),
    );

    expect(
      await prisma.moodTagCategory.count({ where: { userId: owner.id } }),
    ).toBe(MAX_CUSTOM_GROUPS_PER_USER);
    expect(
      await prisma.moodTagCategory.count({ where: { userId: other.id } }),
    ).toBe(0);
  });
});

describe("PATCH /api/mood/tags/groups/{key}", () => {
  it("renames and re-icons the caller's group", async () => {
    const owner = await makeUser();
    const group = await makeCustomGroup(owner, "Old");

    const res = await callRoute<GroupOut>(patchGroup, {
      method: "PATCH",
      route: "/api/mood/tags/groups/{key}",
      params: { key: group.key },
      body: { label: "New", icon: "Heart" },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      key: group.key,
      label: "New",
      icon: "Heart",
      isActive: true,
      custom: true,
    });
    const row = await prisma.moodTagCategory.findUniqueOrThrow({
      where: { id: group.id },
    });
    expect(decryptCustomLabel(row.labelEncrypted)).toBe("New");
    expect(await auditDetails(owner.id, "mood.tag.group.update")).toEqual([
      { fields: ["label", "icon"], isActive: true },
    ]);
  });

  it("answers 404 for a seeded category and for another account's group, changing neither", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const theirs = await makeCustomGroup(other, "Theirs");
    const feelings = await prisma.moodTagCategory.findUniqueOrThrow({
      where: { key: "feelings" },
    });
    const auth = await makeSession(owner);

    const seeded = await callRoute(patchGroup, {
      method: "PATCH",
      route: "/api/mood/tags/groups/{key}",
      params: { key: "feelings" },
      body: { label: "Mine now" },
      auth,
    });
    const foreign = await callRoute(patchGroup, {
      method: "PATCH",
      route: "/api/mood/tags/groups/{key}",
      params: { key: theirs.key },
      body: { label: "Mine now", isActive: false },
      auth,
    });

    expect(seeded.status).toBe(404);
    expect(seeded.error).toBe("Not a custom group");
    expect(foreign.status).toBe(404);
    expect(
      await prisma.moodTagCategory.findUniqueOrThrow({
        where: { key: "feelings" },
      }),
    ).toEqual(feelings);
    expect(
      await prisma.moodTagCategory.findUniqueOrThrow({
        where: { id: theirs.id },
      }),
    ).toEqual(theirs);
  });

  it("refuses an empty edit", async () => {
    const owner = await makeUser();
    const group = await makeCustomGroup(owner, "Keep");

    const res = await callRoute(patchGroup, {
      method: "PATCH",
      route: "/api/mood/tags/groups/{key}",
      params: { key: group.key },
      body: {},
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(422);
    expect(
      await prisma.moodTagCategory.findUniqueOrThrow({
        where: { id: group.id },
      }),
    ).toEqual(group);
  });
});

describe("DELETE /api/mood/tags/groups/{key}", () => {
  async function groupWithTags() {
    const owner = await makeUser();
    const group = await makeCustomGroup(owner, "Therapy");
    const kept = await makeCustomGroup(owner, "Training");
    const tags = [
      await makeCustomTag(owner, "Session", { categoryId: group.id }),
      await makeCustomTag(owner, "Homework", { categoryId: group.id }),
    ];
    const entry = await makeMoodEntry(owner, tags);
    await prisma.user.update({
      where: { id: owner.id },
      data: {
        moodTagLayoutJson: {
          groupOrder: [group.key, "feelings", kept.key],
          placements: { [group.key]: ["happy"], [kept.key]: ["tired"] },
        },
      },
    });
    return { owner, group, kept, tags, entry };
  }

  it("moves the group's tags to the custom category, drops it from the layout, and retires it", async () => {
    const { owner, group, kept, tags, entry } = await groupWithTags();

    const res = await callRoute(deleteGroup, {
      method: "DELETE",
      route: "/api/mood/tags/groups/{key}",
      params: { key: group.key },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      key: group.key,
      purged: false,
      rehomedCount: 2,
    });
    const rows = await prisma.moodTag.findMany({
      where: { id: { in: tags.map((t) => t.id) } },
    });
    expect(rows.map((t) => [t.categoryId, t.isActive])).toEqual([
      [CUSTOM_CATEGORY_ID, true],
      [CUSTOM_CATEGORY_ID, true],
    ]);
    expect(
      await prisma.moodEntryTagLink.count({ where: { moodEntryId: entry.id } }),
    ).toBe(2);
    expect(
      (
        await prisma.moodTagCategory.findUniqueOrThrow({
          where: { id: group.id },
        })
      ).isActive,
    ).toBe(false);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }))
        .moodTagLayoutJson,
    ).toEqual({
      groupOrder: ["feelings", kept.key],
      placements: { [kept.key]: ["tired"] },
    });
    expect(await auditDetails(owner.id, "mood.tag.group.delete")).toEqual([
      { purge: false, rehomedCount: 2 },
    ]);
  });

  it("deletes the emptied group row on ?purge=true and still keeps every tag", async () => {
    const { owner, group, tags, entry } = await groupWithTags();

    const res = await callRoute(deleteGroup, {
      method: "DELETE",
      route: "/api/mood/tags/groups/{key}",
      params: { key: group.key },
      query: { purge: "true" },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ key: group.key, purged: true, rehomedCount: 2 });
    expect(
      await prisma.moodTagCategory.findUnique({ where: { id: group.id } }),
    ).toBeNull();
    expect(
      await prisma.moodTag.count({
        where: {
          id: { in: tags.map((t) => t.id) },
          categoryId: CUSTOM_CATEGORY_ID,
        },
      }),
    ).toBe(2);
    expect(
      await prisma.moodEntryTagLink.count({ where: { moodEntryId: entry.id } }),
    ).toBe(2);
    expect(await auditDetails(owner.id, "mood.tag.group.delete")).toEqual([
      { purge: true, rehomedCount: 2 },
    ]);
  });

  it("answers 404 for a seeded category and another account's group, moving nothing", async () => {
    const { owner: other, group: theirs, tags } = await groupWithTags();
    const caller = await makeUser();
    const auth = await makeSession(caller);
    const custom = await prisma.moodTagCategory.findUniqueOrThrow({
      where: { id: CUSTOM_CATEGORY_ID },
    });

    const seeded = await callRoute(deleteGroup, {
      method: "DELETE",
      route: "/api/mood/tags/groups/{key}",
      params: { key: custom.key },
      query: { purge: "true" },
      auth,
    });
    const foreign = await callRoute(deleteGroup, {
      method: "DELETE",
      route: "/api/mood/tags/groups/{key}",
      params: { key: theirs.key },
      query: { purge: "true" },
      auth,
    });

    expect(seeded.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(
      await prisma.moodTagCategory.findUniqueOrThrow({
        where: { id: CUSTOM_CATEGORY_ID },
      }),
    ).toEqual(custom);
    expect(
      await prisma.moodTagCategory.findUniqueOrThrow({
        where: { id: theirs.id },
      }),
    ).toEqual(theirs);
    expect(
      await prisma.moodTag.count({
        where: { id: { in: tags.map((t) => t.id) }, categoryId: theirs.id },
      }),
    ).toBe(2);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: other.id } }))
        .moodTagLayoutJson,
    ).toMatchObject({
      groupOrder: [theirs.key, "feelings", expect.any(String)],
    });
  });
});
