/**
 * The other spellings of a marker (D1223), stored per account in
 * `biomarker_aliases`.
 *
 * `nameFolded` is `foldForMatch(name)` and unique per account, so one spelling
 * resolves to one marker. An alias equal to its own marker's name (folded) is
 * never stored: the name already resolves.
 *
 * Sources: `MERGE` (a merged marker's name), `IMPORT_CHOICE` (a name mapped to
 * a marker on a scan or document review), `MANUAL` (typed on the marker).
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { foldForMatch } from "@/lib/i18n/fold-for-match";

type AliasClient = Pick<PrismaClient, "biomarkerAlias" | "biomarker">;
type AliasTx = Prisma.TransactionClient;

/** Longest alias, matching the column. */
export const BIOMARKER_ALIAS_MAX_LENGTH = 120;

/**
 * The aliases of each marker, sorted, without the marker's own name. One read
 * for the whole set, so a list of markers costs one query.
 */
export async function aliasNamesByMarker(
  client: Pick<PrismaClient, "biomarkerAlias">,
  userId: string,
  markers: ReadonlyArray<{ id: string; name: string }>,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (markers.length === 0) return out;
  const rows = await client.biomarkerAlias.findMany({
    where: { userId, biomarkerId: { in: markers.map((m) => m.id) } },
    select: { biomarkerId: true, name: true, nameFolded: true },
  });
  const ownFold = new Map(markers.map((m) => [m.id, foldForMatch(m.name)]));
  for (const row of rows) {
    if (row.nameFolded === ownFold.get(row.biomarkerId)) continue;
    const list = out.get(row.biomarkerId) ?? [];
    list.push(row.name);
    out.set(row.biomarkerId, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  }
  return out;
}

/** What blocks an alias: another marker's name or another marker's alias. */
export interface AliasConflict {
  alias: string;
  biomarkerId: string;
}

/**
 * The first alias in `names` that another marker of the account already
 * answers to, by name or alias; null when none does.
 */
export async function findAliasConflict(
  client: AliasClient | AliasTx,
  userId: string,
  biomarkerId: string,
  names: readonly string[],
): Promise<AliasConflict | null> {
  if (names.length === 0) return null;
  const folds = new Map(names.map((n) => [foldForMatch(n), n]));
  const [markers, aliases] = await Promise.all([
    client.biomarker.findMany({
      where: { userId, id: { not: biomarkerId } },
      select: { id: true, name: true },
    }),
    client.biomarkerAlias.findMany({
      where: {
        userId,
        biomarkerId: { not: biomarkerId },
        nameFolded: { in: [...folds.keys()] },
      },
      select: { biomarkerId: true, nameFolded: true },
    }),
  ]);
  for (const marker of markers) {
    const hit = folds.get(foldForMatch(marker.name));
    if (hit !== undefined) return { alias: hit, biomarkerId: marker.id };
  }
  const alias = aliases[0];
  if (alias) {
    return {
      alias: folds.get(alias.nameFolded) ?? alias.nameFolded,
      biomarkerId: alias.biomarkerId,
    };
  }
  return null;
}

/**
 * Make `names` the marker's aliases: what is listed stays (keeping where it
 * came from) or is added as `MANUAL`, what is not listed is removed. The list
 * is the whole set the marker answers to, as `aliases` on the marker reads it;
 * the caller has already checked it for conflicts.
 */
export async function replaceAliases(
  tx: AliasTx,
  userId: string,
  marker: { id: string; name: string },
  names: readonly string[],
): Promise<void> {
  const ownFold = foldForMatch(marker.name);
  const wanted = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    const folded = foldForMatch(name);
    if (!folded || folded === ownFold || wanted.has(folded)) continue;
    wanted.set(folded, name);
  }
  const existing = await tx.biomarkerAlias.findMany({
    where: { userId, biomarkerId: marker.id },
    select: { id: true, nameFolded: true },
  });
  const stale = existing
    .filter((row) => !wanted.has(row.nameFolded))
    .map((row) => row.id);
  if (stale.length > 0) {
    await tx.biomarkerAlias.deleteMany({
      where: { userId, id: { in: stale } },
    });
  }
  const kept = new Set(existing.map((row) => row.nameFolded));
  const fresh = [...wanted].filter(([folded]) => !kept.has(folded));
  if (fresh.length > 0) {
    await tx.biomarkerAlias.createMany({
      data: fresh.map(([nameFolded, name]) => ({
        userId,
        biomarkerId: marker.id,
        name: name.slice(0, BIOMARKER_ALIAS_MAX_LENGTH),
        nameFolded: nameFolded.slice(0, BIOMARKER_ALIAS_MAX_LENGTH),
        source: "MANUAL",
      })),
    });
  }
}

/**
 * Remember a name the person mapped to a marker on a review screen, so the
 * next report with the same spelling resolves without asking. A spelling
 * already attached to another marker moves to this one: the choice is the
 * person's latest word on it. The marker's own name is not stored.
 * Returns whether an alias was written.
 */
export async function rememberImportAlias(
  client: Pick<PrismaClient, "biomarkerAlias">,
  userId: string,
  marker: { id: string; name: string },
  printedName: string,
): Promise<boolean> {
  const name = printedName.trim().slice(0, BIOMARKER_ALIAS_MAX_LENGTH);
  const nameFolded = foldForMatch(name).slice(0, BIOMARKER_ALIAS_MAX_LENGTH);
  if (!nameFolded || nameFolded === foldForMatch(marker.name)) return false;
  await client.biomarkerAlias.upsert({
    where: { userId_nameFolded: { userId, nameFolded } },
    create: {
      userId,
      biomarkerId: marker.id,
      name,
      nameFolded,
      source: "IMPORT_CHOICE",
    },
    update: { biomarkerId: marker.id, name, source: "IMPORT_CHOICE" },
  });
  return true;
}
