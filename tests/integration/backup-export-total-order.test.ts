/**
 * Every read the backup export makes has a total order.
 *
 * A list read ordered only by a column two rows can share (a creation time,
 * a day) comes back in whatever order the rows sit on disk, so two exports of
 * one account could write two files, and the parity golden copies flapped
 * the day the fixture's rows shared their timestamps. A to-many relation read
 * with no order at all is the same thing.
 *
 *   - The guard runs both export purposes, built and streamed, through a client
 *     that records every query and every nested to-many read, and requires
 *     each to be ordered by keys that end in the model's primary key.
 *   - The behaviour test writes the same tied rows in two physical orders and
 *     requires the two exports to be identical.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { buildFullBackupPayload } from "@/lib/export/full-backup-payload";
import { streamFullBackupJson } from "@/lib/export/full-backup-stream";

import {
  createOwner,
  OWNER_ID,
  seedColumnShapes,
  seedEveryTwoEndedModel,
} from "./backup-fixture";
import { getPrismaClient, truncateAllTables } from "./setup";

const prisma = getPrismaClient();

beforeEach(() => truncateAllTables(prisma));

interface SchemaModel {
  fields: Map<string, { type: string; isList: boolean }>;
  primaryKey: string[];
  /** The scalar columns each relation to a parent model is stored in. */
  foreignKeys: Map<string, string[]>;
}

/** Every model's fields, primary key and foreign keys, from schema.prisma. */
function readSchema(): Map<string, SchemaModel> {
  const source = readFileSync(
    resolve(__dirname, "../../prisma/schema.prisma"),
    "utf8",
  );
  const models = new Map<string, SchemaModel>();
  for (const block of source.matchAll(/^model (\w+) \{([\s\S]*?)\n\}/gm)) {
    const fields = new Map<string, { type: string; isList: boolean }>();
    const foreignKeys = new Map<string, string[]>();
    let primaryKey: string[] = [];
    for (const raw of block[2].split("\n")) {
      const line = raw.trim();
      const compound = /^@@id\(\[([^\]]+)\]/.exec(line);
      if (compound) {
        primaryKey = compound[1].split(",").map((s) => s.trim());
        continue;
      }
      const m = /^(\w+)\s+(\w+)(\[\])?\??\s*(.*)$/.exec(line);
      if (!m || line.startsWith("//") || line.startsWith("@@")) continue;
      fields.set(m[1], { type: m[2], isList: Boolean(m[3]) });
      if (/(^|\s)@id\b/.test(m[4])) primaryKey = [m[1]];
      const relation = /@relation\([^)]*fields: \[([^\]]+)\]/.exec(m[4]);
      if (relation) {
        foreignKeys.set(
          m[2],
          relation[1].split(",").map((s) => s.trim()),
        );
      }
    }
    models.set(block[1], { fields, primaryKey, foreignKeys });
  }
  return models;
}

const SCHEMA = readSchema();

function orderKeys(orderBy: unknown): string[] {
  const list = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return list.flatMap((entry) =>
    entry && typeof entry === "object" ? Object.keys(entry) : [],
  );
}

/**
 * Whether an order tells every two rows of the read apart: it names every
 * primary-key column the read does not already pin, either by an equality in
 * its `where` or, for a nested read, by the foreign key to the parent row.
 */
function isTotal(model: string, args: Args, parent?: string): boolean {
  const schema = SCHEMA.get(model);
  if (!schema || schema.primaryKey.length === 0) return false;
  const keys = orderKeys(args?.orderBy);
  const where = (args?.where ?? {}) as Record<string, unknown>;
  const pinned = new Set([
    ...Object.keys(where).filter((key) => typeof where[key] === "string"),
    ...(parent ? (schema.foreignKeys.get(parent) ?? []) : []),
  ]);
  return schema.primaryKey.every(
    (key) => pinned.has(key) || keys.includes(key),
  );
}

type Args = Record<string, unknown> | undefined;

/** Walk the nested include/select of one query for to-many reads. */
function walkRelations(model: string, args: Args, path: string, out: string[]) {
  for (const key of ["include", "select"] as const) {
    const nested = args?.[key] as Record<string, unknown> | undefined;
    if (!nested || typeof nested !== "object") continue;
    for (const [field, value] of Object.entries(nested)) {
      if (!value) continue;
      const relation = SCHEMA.get(model)?.fields.get(field);
      if (!relation || !SCHEMA.has(relation.type)) continue;
      const child = typeof value === "object" ? (value as Args) : undefined;
      if (relation.isList && !isTotal(relation.type, child, model)) {
        out.push(`${path}.${field} (${relation.type})`);
      }
      walkRelations(relation.type, child, `${path}.${field}`, out);
    }
  }
}

/** A client that records every read the export makes that has no total order. */
function recordingClient(out: string[], seen: Set<string>): PrismaClient {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (operation === "findMany" && !isTotal(model, args as Args)) {
            out.push(`${model}.findMany`);
          }
          if (operation === "findMany") seen.add(model);
          if (operation.startsWith("find")) {
            walkRelations(model, args as Args, `${model}.${operation}`, out);
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}

describe("the backup export", () => {
  it("orders every read it makes totally, in both purposes", async () => {
    await createOwner(prisma);
    await seedEveryTwoEndedModel(prisma);
    await seedColumnShapes(prisma);

    const unordered: string[] = [];
    const seen = new Set<string>();
    const client = recordingClient(unordered, seen);
    for (const purpose of ["disaster-recovery", "portable-export"] as const) {
      await buildFullBackupPayload(client, OWNER_ID, { purpose });
      await streamFullBackupJson(client, OWNER_ID, () => {}, { purpose });
    }
    // The recorder saw the export's reads at all: an empty set would pass
    // the assertion below without having looked at anything.
    expect(seen.size).toBeGreaterThan(50);
    expect([...new Set(unordered)].sort()).toEqual([]);
  });

  it("writes the same file whatever order tied rows sit in on disk", async () => {
    const at = new Date("2026-05-01T08:00:00.000Z");

    async function seedTied(order: "forward" | "reverse") {
      await truncateAllTables(prisma);
      await createOwner(prisma);
      const medication = await prisma.medication.create({
        data: {
          id: "med-tied",
          userId: OWNER_ID,
          name: "Tied",
          dose: "5 mg",
          createdAt: at,
          updatedAt: at,
        },
      });
      const schedules = [
        { id: "sched-a", label: "A", windowStart: "08:00", windowEnd: "09:00" },
        { id: "sched-b", label: "B", windowStart: "08:00", windowEnd: "09:00" },
      ];
      const doseChanges = [
        { id: "dose-a", doseValue: 5 },
        { id: "dose-b", doseValue: 10 },
      ];
      const allergies = [
        { id: "allergy-a", substance: "Pollen" },
        { id: "allergy-b", substance: "Dust" },
      ];
      const pick = <T>(rows: T[]) =>
        order === "forward" ? rows : [...rows].reverse();
      for (const s of pick(schedules)) {
        await prisma.medicationSchedule.create({
          data: { ...s, medicationId: medication.id },
        });
      }
      for (const d of pick(doseChanges)) {
        await prisma.medicationDoseChange.create({
          data: {
            ...d,
            medicationId: medication.id,
            doseUnit: "mg",
            effectiveFrom: at,
            createdAt: at,
          },
        });
      }
      for (const a of pick(allergies)) {
        await prisma.allergy.create({
          data: { ...a, userId: OWNER_ID, createdAt: at, updatedAt: at },
        });
      }
    }

    const files: string[] = [];
    for (const order of ["forward", "reverse"] as const) {
      await seedTied(order);
      for (const purpose of ["disaster-recovery", "portable-export"] as const) {
        const { payload } = await buildFullBackupPayload(prisma, OWNER_ID, {
          purpose,
          exportedAt: at,
        });
        files.push(JSON.stringify(payload));
      }
    }
    // Forward and reverse, per purpose.
    expect(files[2]).toBe(files[0]);
    expect(files[3]).toBe(files[1]);
  });
});
