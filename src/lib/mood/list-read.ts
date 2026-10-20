/**
 * The one mood-entry list read, shared by `GET /api/mood-entries` and the
 * `/mood` RSC prefetch wrapper so the two cannot drift in filter, order, or
 * wire shape — the SSR-seeded cell must be byte-compatible with what the
 * client `queryFn` gets from the wire. Ciphertext never leaves this module:
 * the note is decrypted onto `note` and the context rides `contextForWire`.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { shapeMoodNote } from "@/lib/crypto/note-cipher";
import { shapeLevelA } from "@/lib/mood/level-a";
import { contextForWire } from "@/lib/mood/context";

export interface MoodEntryListParams {
  mood?: string;
  source?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
  sortBy: string;
  sortDir: "asc" | "desc";
}

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    return JSON.parse(tags) as string[];
  } catch {
    return [];
  }
}

/**
 * What a read of one entry joins: the structured-tag links with their rating
 * and kind, and the day context.
 *
 * v1.8.5 — the link keys pre-populate the taxonomy picker; v1.12.0 — the
 * per-link `rating` + tag `kind` split binary tags from rated factors on
 * hydrate; v1.38 — the day context, sparse by design: most rows carry none
 * and the join costs nothing on those.
 */
export const MOOD_ENTRY_WIRE_INCLUDE = {
  tagLinks: {
    select: {
      rating: true,
      moodTag: { select: { key: true, kind: true } },
    },
  },
  context: true,
} satisfies Prisma.MoodEntryInclude;

type MoodEntryWithWireJoins = Prisma.MoodEntryGetPayload<{
  include: typeof MOOD_ENTRY_WIRE_INCLUDE;
}>;

/**
 * The one wire shape of a mood entry, for the list and the single-entry
 * read alike, so an entry opened on its own carries the same fields as the
 * same entry in the list.
 */
export function toMoodEntryWire({
  tagLinks,
  context,
  ...e
}: MoodEntryWithWireJoins) {
  return {
    // v1.23 — decrypt `noteEncrypted` onto `note`, strip the ciphertext.
    // v1.37 — the five level-A values under the keys the create path takes,
    // so the edit form reads back what it wrote instead of mapping column
    // names to wire names by hand. The column spelling is stripped, not
    // joined: one number under two names is a choice nobody made.
    ...shapeLevelA(shapeMoodNote(e)),
    tags: parseTags(e.tags),
    // v1.8.5 — flat list of binary structured-tag keys attached to the
    // entry (rated factors are surfaced separately below).
    tagKeys: tagLinks
      .filter((link) => link.moodTag.kind !== "RATED")
      .map((link) => link.moodTag.key),
    // v1.12.0 — rated factors with their per-entry score, so the edit
    // form re-renders the sliders without a refetch.
    ratedFactors: tagLinks
      .filter((link) => link.moodTag.kind === "RATED" && link.rating !== null)
      .map((link) => ({
        key: link.moodTag.key,
        rating: link.rating as number,
      })),
    // v1.38 — the day context, or null. The ciphertext never leaves the
    // server: `contextForWire` reads the note and drops the column.
    context: context ? contextForWire(context) : null,
  };
}

export async function listMoodEntriesPage(
  userId: string,
  params: MoodEntryListParams,
) {
  const { mood, source, from, to, limit, offset, sortBy, sortDir } = params;

  const where = {
    userId,
    // v1.7.0 sync — hide soft-deleted (tombstoned) rows from the list.
    deletedAt: null,
    ...(mood && { mood }),
    // v1.15.13 — management-list source filter.
    ...(source && { source }),
    ...(from || to
      ? {
          date: {
            ...(from && { gte: from }),
            ...(to && { lte: to }),
          },
        }
      : {}),
  };

  const [entries, total] = await Promise.all([
    prisma.moodEntry.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      take: limit,
      skip: offset,
      include: MOOD_ENTRY_WIRE_INCLUDE,
    }),
    prisma.moodEntry.count({ where }),
  ]);

  const entriesWithParsedTags = entries.map(toMoodEntryWire);

  return {
    entries: entriesWithParsedTags,
    meta: { total, limit, offset },
  };
}
