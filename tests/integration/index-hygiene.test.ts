/**
 * Index hygiene, read from the catalog of the migrated database.
 *
 * Two rules, each with its counter-check:
 *
 * 1. Every foreign key whose delete action does work in the child table
 *    (CASCADE, SET NULL, SET DEFAULT) has an index leading with its columns.
 *    Without one, deleting a parent row scans the child table once per
 *    deleted parent; an account delete runs hundreds of them.
 * 2. No btree index is a prefix of another btree index on the same table
 *    (same leading columns, operator classes, collations and directions,
 *    same predicate). The longer index answers every lookup the shorter one
 *    did, so the shorter one only costs writes and space. A unique index is
 *    never counted as the redundant one: it enforces something.
 *
 * And the evidence for migration 0416: on a seeded `measurements` table of
 * production size, every query shape that used
 * `measurements_user_id_type_measured_at_idx` plans the same way without it,
 * on an index, at a cost within a few percent.
 */
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPrismaClient, truncateAllTables } from "./setup";

/**
 * Foreign keys allowed to go without a leading index, with the reason.
 * Empty: every one has its index.
 */
const FK_EXCEPTIONS: Record<string, string> = {};

/** Prefix indexes allowed to stay, with the reason. Empty. */
const PREFIX_EXCEPTIONS: Record<string, string> = {};

async function connect(): Promise<Client> {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set for the integration run");
  const url = new URL(raw);
  url.searchParams.delete("schema");
  url.searchParams.delete("pgbouncer");
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

const FK_WITHOUT_LEADING_INDEX = `
  SELECT c.conrelid::regclass::text AS tbl, c.conname AS name
    FROM pg_constraint c
   WHERE c.contype = 'f'
     AND c.connamespace = 'public'::regnamespace
     AND c.confdeltype IN ('c', 'n', 'd')
     AND NOT EXISTS (
       SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND i.indpred IS NULL
          AND i.indexprs IS NULL
          AND (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(c.conkey, 1)] @> c.conkey
          AND (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(c.conkey, 1)] <@ c.conkey
     )
   ORDER BY 1, 2`;

const ACTING_FK_COUNT = `
  SELECT count(*)::int AS n FROM pg_constraint
   WHERE contype = 'f' AND connamespace = 'public'::regnamespace
     AND confdeltype IN ('c', 'n', 'd')`;

/*
 * `indkey`, `indclass`, `indcollation` and `indoption` are vectors whose array
 * casts start at index 0; going through text gives ordinary 1-based arrays.
 */
const PREFIX_INDEXES = `
  WITH idx AS (
    SELECT i.indexrelid, i.indrelid, c.relname AS index_name,
           t.relname AS table_name, i.indisunique, i.indisprimary,
           string_to_array(i.indkey::text, ' ')::int[] AS cols,
           string_to_array(i.indclass::text, ' ')::oid[] AS opc,
           string_to_array(i.indcollation::text, ' ')::oid[] AS coll,
           string_to_array(i.indoption::text, ' ')::int[] AS opt,
           pg_get_expr(i.indpred, i.indrelid) AS pred,
           i.indexprs IS NOT NULL AS has_exprs, am.amname
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_am am ON am.oid = c.relam
     WHERE t.relnamespace = 'public'::regnamespace
  )
  SELECT a.table_name AS tbl, a.index_name AS redundant, b.index_name AS covered_by
    FROM idx a
    JOIN idx b ON a.indrelid = b.indrelid AND a.indexrelid <> b.indexrelid
   WHERE a.amname = 'btree' AND b.amname = 'btree'
     AND NOT a.indisprimary AND NOT a.has_exprs AND NOT b.has_exprs
     AND a.pred IS NOT DISTINCT FROM b.pred
     AND cardinality(a.cols) <= cardinality(b.cols)
     AND a.cols = b.cols[1:cardinality(a.cols)]
     AND a.opc = b.opc[1:cardinality(a.cols)]
     AND a.coll = b.coll[1:cardinality(a.cols)]
     AND a.opt = b.opt[1:cardinality(a.cols)]
     AND (NOT a.indisunique OR (b.indisunique AND a.cols = b.cols))
     AND (cardinality(a.cols) < cardinality(b.cols)
          OR (NOT a.indisunique AND b.indisunique)
          OR (a.indisunique = b.indisunique AND a.indexrelid > b.indexrelid))
   ORDER BY 1, 2`;

const BTREE_INDEX_COUNT = `
  SELECT count(*)::int AS n FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_am am ON am.oid = c.relam
   WHERE c.relnamespace = 'public'::regnamespace AND am.amname = 'btree'`;

describe("index hygiene", () => {
  let db: Client;
  beforeAll(async () => {
    db = await connect();
  });
  afterAll(async () => {
    await db.end();
  });

  it("gives every acting foreign key a leading index", async () => {
    const examined = (await db.query(ACTING_FK_COUNT)).rows[0].n as number;
    // The matcher has to have something to match: the schema has well over a
    // hundred cascading foreign keys.
    expect(examined).toBeGreaterThan(100);
    const { rows } = await db.query(FK_WITHOUT_LEADING_INDEX);
    const offenders = rows
      .map((r) => `${r.tbl}.${r.name}`)
      .filter((key) => !(key in FK_EXCEPTIONS));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("counter-check: flags a cascading foreign key without an index", async () => {
    await db.query("BEGIN");
    try {
      await db.query(
        `CREATE TABLE "zz_fk_probe" ("id" text PRIMARY KEY,
           "user_id" text REFERENCES "users"("id") ON DELETE CASCADE)`,
      );
      const flagged = (await db.query(FK_WITHOUT_LEADING_INDEX)).rows.map(
        (r) => r.tbl,
      );
      expect(flagged).toContain("zz_fk_probe");
      await db.query(`CREATE INDEX ON "zz_fk_probe" ("user_id", "id")`);
      const after = (await db.query(FK_WITHOUT_LEADING_INDEX)).rows.map(
        (r) => r.tbl,
      );
      expect(after).not.toContain("zz_fk_probe");
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("keeps no btree index that is a prefix of another", async () => {
    const examined = (await db.query(BTREE_INDEX_COUNT)).rows[0].n as number;
    expect(examined).toBeGreaterThan(300);
    const { rows } = await db.query(PREFIX_INDEXES);
    const offenders = rows
      .filter((r) => !(r.redundant in PREFIX_EXCEPTIONS))
      .map((r) => `${r.tbl}: ${r.redundant} is a prefix of ${r.covered_by}`);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("counter-check: flags a prefix and a duplicate, but not a reversed direction", async () => {
    await db.query("BEGIN");
    try {
      await db.query(
        `CREATE INDEX "zz_prefix_probe" ON "measurements" ("user_id", "type")`,
      );
      await db.query(
        `CREATE INDEX "zz_duplicate_probe" ON "users" ("username")`,
      );
      await db.query(
        `CREATE INDEX "zz_direction_probe" ON "measurements" ("user_id", "type", "measured_at" DESC, "source")`,
      );
      const flagged = (await db.query(PREFIX_INDEXES)).rows.map(
        (r) => r.redundant,
      );
      expect(flagged).toContain("zz_prefix_probe");
      expect(flagged).toContain("zz_duplicate_probe");
      // `users_username_key` is unique: it enforces something, so it is
      // never the one reported, even beside a plain twin.
      expect(flagged).not.toContain("users_username_key");
      // The live-covering index runs `measured_at DESC` too, but carries a
      // predicate, so it is not a prefix of the probe either way.
      expect(flagged).not.toContain("zz_direction_probe");
    } finally {
      await db.query("ROLLBACK");
    }
  });
});

describe("measurements without (user_id, type, measured_at)", () => {
  const DROPPED = "measurements_user_id_type_measured_at_idx";
  const USERS = 5;
  const ROWS = 130_000;
  let db: Client;
  let userId: string;

  beforeAll(async () => {
    const prisma = getPrismaClient();
    await truncateAllTables(prisma);
    const ids: string[] = [];
    for (let i = 0; i < USERS; i++) {
      const user = await prisma.user.create({
        data: {
          username: `plan-probe-${i}`,
          email: `plan-probe-${i}@example.test`,
          role: "USER",
        },
      });
      ids.push(user.id);
    }
    userId = ids[2];
    db = await connect();
    // Production's mix: dense pulse and steps, a long tail of manual types,
    // three sources, one row in twenty a tombstone, a year of history.
    await db.query(
      `WITH t(type, unit, weight) AS (VALUES
         ('PULSE'::measurement_type, 'bpm', 50), ('ACTIVITY_STEPS', 'count', 10),
         ('HEART_RATE_VARIABILITY', 'ms', 10), ('SLEEP_DURATION', 'h', 8),
         ('BLOOD_GLUCOSE', 'mg/dL', 5), ('OXYGEN_SATURATION', '%', 4),
         ('WEIGHT', 'kg', 3), ('BLOOD_PRESSURE_SYS', 'mmHg', 3),
         ('BLOOD_PRESSURE_DIA', 'mmHg', 3), ('RESTING_HEART_RATE', 'bpm', 2),
         ('BODY_FAT', '%', 2)),
       slots AS (SELECT row_number() OVER () AS n, type, unit
                   FROM t, generate_series(1, t.weight))
       INSERT INTO "measurements"
         ("id", "user_id", "type", "value", "unit", "source", "measured_at",
          "updated_at", "deleted_at")
       SELECT 'plan-' || g, ($1::text[])[1 + g % $2], s.type, random() * 100, s.unit,
              (ARRAY['APPLE_HEALTH', 'MANUAL', 'WITHINGS']::measurement_source[])[1 + g % 3],
              timestamp '2026-10-20' - (g * interval '241 seconds'),
              now(), CASE WHEN g % 20 = 0 THEN now() END
         FROM generate_series(1, $3) g
         JOIN slots s ON s.n = 1 + (g * 7 % 100)`,
      [ids, USERS, ROWS],
    );
    await db.query(`ANALYZE "measurements"`);
  }, 120_000);

  afterAll(async () => {
    await db.end();
    await truncateAllTables(getPrismaClient());
  });

  /** The query shapes the read and write paths send with a user and a type. */
  const QUERIES: Array<[string, string]> = [
    [
      "live range, newest first",
      `SELECT * FROM measurements WHERE user_id = $1 AND type = 'WEIGHT'
         AND measured_at >= '2026-07-20' AND deleted_at IS NULL
       ORDER BY measured_at DESC`,
    ],
    [
      "range including tombstones",
      `SELECT * FROM measurements WHERE user_id = $1 AND type = 'WEIGHT'
         AND measured_at >= '2026-07-20' ORDER BY measured_at DESC`,
    ],
    [
      "latest of a type",
      `SELECT max(measured_at) FROM measurements WHERE user_id = $1 AND type = 'PULSE'`,
    ],
    [
      "count of a type",
      `SELECT count(*) FROM measurements WHERE user_id = $1 AND type = 'BLOOD_GLUCOSE'`,
    ],
    [
      "point lookup without source",
      `SELECT id FROM measurements WHERE user_id = $1 AND type = 'PULSE'
         AND measured_at = '2026-10-01 10:00'`,
    ],
    [
      "day aggregate",
      `SELECT date_trunc('day', measured_at), avg(value) FROM measurements
        WHERE user_id = $1 AND type = 'PULSE' AND measured_at >= '2026-10-01'
          AND measured_at < '2026-10-08' AND deleted_at IS NULL GROUP BY 1`,
    ],
    [
      "two types over a month",
      `SELECT * FROM measurements WHERE user_id = $1
         AND type IN ('BLOOD_PRESSURE_SYS', 'BLOOD_PRESSURE_DIA')
         AND measured_at BETWEEN '2026-09-01' AND '2026-10-01'`,
    ],
    [
      "last before a date",
      `SELECT * FROM measurements WHERE user_id = $1 AND type = 'SLEEP_DURATION'
         AND measured_at < '2026-10-01' ORDER BY measured_at DESC LIMIT 1`,
    ],
    [
      "tombstone a day",
      `UPDATE measurements SET deleted_at = now() WHERE user_id = $1
         AND type = 'HEART_RATE_VARIABILITY' AND measured_at >= '2026-10-10'
         AND measured_at < '2026-10-11'`,
    ],
  ];

  interface PlanNode {
    "Node Type": string;
    "Relation Name"?: string;
    "Index Name"?: string;
    "Total Cost": number;
    Plans?: PlanNode[];
  }

  function walk(node: PlanNode, out: PlanNode[] = []): PlanNode[] {
    out.push(node);
    for (const child of node.Plans ?? []) walk(child, out);
    return out;
  }

  async function plans(): Promise<Array<{ cost: number; nodes: PlanNode[] }>> {
    const result = [];
    for (const [, sql] of QUERIES) {
      const { rows } = await db.query(`EXPLAIN (FORMAT JSON) ${sql}`, [userId]);
      const root = rows[0]["QUERY PLAN"][0].Plan as PlanNode;
      result.push({ cost: root["Total Cost"], nodes: walk(root) });
    }
    return result;
  }

  it("is gone after the migrations", async () => {
    const { rowCount } = await db.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = $1`,
      [DROPPED],
    );
    expect(rowCount).toBe(0);
  });

  it("plans every user-and-type query on an index, at the cost it had with it", async () => {
    // The state before migration 0416, rebuilt inside a transaction.
    await db.query("BEGIN");
    let before;
    try {
      await db.query(
        `CREATE INDEX "${DROPPED}" ON "measurements" ("user_id", "type", "measured_at")`,
      );
      before = await plans();
    } finally {
      await db.query("ROLLBACK");
    }
    const after = await plans();

    // The comparison means something only if the old index was in use.
    const usedBefore = before.filter((p) =>
      p.nodes.some((n) => n["Index Name"] === DROPPED),
    ).length;
    expect(usedBefore).toBeGreaterThanOrEqual(3);

    QUERIES.forEach(([label], i) => {
      const seqScan = after[i].nodes.find(
        (n) =>
          n["Node Type"] === "Seq Scan" &&
          n["Relation Name"] === "measurements",
      );
      expect(seqScan, `${label}: sequential scan`).toBeUndefined();
      expect(
        after[i].cost,
        `${label}: cost ${after[i].cost} against ${before[i].cost}`,
      ).toBeLessThanOrEqual(before[i].cost * 1.05 + 1);
    });
  }, 60_000);
});
