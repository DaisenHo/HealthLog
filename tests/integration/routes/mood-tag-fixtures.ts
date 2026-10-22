/**
 * Fixtures for the mood-tag route tests: an account's own custom tags and
 * groups, stored the way the routes store them (key minted with its prefix,
 * label sealed with the custom-label cipher), and mood entries that pick
 * tags. Overrides are the Prisma create input, so the compiler checks them.
 */
import type {
  MoodEntry,
  MoodTag,
  MoodTagCategory,
  Prisma,
  User,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  CUSTOM_CATEGORY_ID,
  encryptCustomLabel,
  mintCustomCategoryKey,
  mintCustomTagKey,
} from "@/lib/mood/custom-tags";

export async function makeCustomTag(
  user: Pick<User, "id">,
  label: string,
  overrides: Partial<
    Omit<Prisma.MoodTagUncheckedCreateInput, "userId" | "key" | "labelKey">
  > = {},
): Promise<MoodTag> {
  const key = mintCustomTagKey();
  return prisma.moodTag.create({
    data: {
      key,
      labelKey: key,
      labelEncrypted: encryptCustomLabel(label),
      categoryId: CUSTOM_CATEGORY_ID,
      kind: "BINARY",
      userId: user.id,
      ...overrides,
    },
  });
}

export async function makeCustomGroup(
  user: Pick<User, "id">,
  label: string,
  overrides: Partial<
    Omit<
      Prisma.MoodTagCategoryUncheckedCreateInput,
      "userId" | "key" | "labelKey"
    >
  > = {},
): Promise<MoodTagCategory> {
  const key = mintCustomCategoryKey();
  return prisma.moodTagCategory.create({
    data: {
      key,
      labelKey: key,
      labelEncrypted: encryptCustomLabel(label),
      sortOrder: 101,
      userId: user.id,
      ...overrides,
    },
  });
}

let entryMinute = 0;

/** A mood entry that picked `tags`. */
export async function makeMoodEntry(
  user: Pick<User, "id">,
  tags: ReadonlyArray<Pick<MoodTag, "id">>,
  overrides: Partial<
    Omit<Prisma.MoodEntryUncheckedCreateInput, "userId" | "tagLinks">
  > = {},
): Promise<MoodEntry> {
  entryMinute += 1;
  return prisma.moodEntry.create({
    data: {
      userId: user.id,
      date: "2026-09-01",
      mood: "GUT",
      score: 4,
      moodLoggedAt: new Date(Date.UTC(2026, 8, 1, 8, entryMinute)),
      ...overrides,
      tagLinks: { create: tags.map((t) => ({ moodTagId: t.id })) },
    },
  });
}

/** The audit rows filed under `userId` for `action`, details parsed. */
export async function auditDetails(
  userId: string,
  action: string,
): Promise<unknown[]> {
  const rows = await prisma.auditLog.findMany({
    where: { userId, action },
    orderBy: { createdAt: "asc" },
    select: { details: true },
  });
  return rows.map((r) => (r.details ? JSON.parse(r.details) : null));
}
