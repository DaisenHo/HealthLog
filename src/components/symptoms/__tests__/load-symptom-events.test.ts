import { describe, expect, it } from "vitest";

import type { SymptomEventDTO } from "@/lib/symptoms/shared";
import { loadSymptomEvents, type SymptomEventList } from "../use-symptoms";

/**
 * A fake of `GET /api/symptoms/events`: newest first, `to` inclusive, at most
 * `limit` rows, `hasMore` when the page is full.
 */
function fakeRoute(all: SymptomEventDTO[]) {
  const urls: string[] = [];
  const fetchPage = async (url: string): Promise<SymptomEventList> => {
    urls.push(url);
    const params = new URL(url, "http://localhost").searchParams;
    const to = params.get("to")!;
    const limit = Number(params.get("limit"));
    const rows = all
      .filter((e) => e.occurredAt <= to)
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
      .slice(0, limit);
    return { events: rows, limit, hasMore: rows.length === limit };
  };
  return { urls, fetchPage };
}

function event(i: number, occurredAt: string): SymptomEventDTO {
  return { id: `e-${i}`, occurredAt } as SymptomEventDTO;
}

describe("loadSymptomEvents", () => {
  it("reads past the first page until the window is exhausted", async () => {
    const base = Date.parse("2026-06-01T00:00:00.000Z");
    // 1,200 occurrences an hour apart, two of them sharing a page boundary.
    const all = Array.from({ length: 1_200 }, (_, i) =>
      event(i, new Date(base - i * 3_600_000).toISOString()),
    );
    all.push(event(9_999, all[499].occurredAt));
    const { urls, fetchPage } = fakeRoute(all);

    const out = await loadSymptomEvents(
      "1900-01-01T00:00:00.000Z",
      "2026-06-02T00:00:00.000Z",
      "ep-1",
      fetchPage,
    );

    expect(out.events).toHaveLength(1_201);
    expect(new Set(out.events.map((e) => e.id)).size).toBe(1_201);
    expect(out.hasMore).toBe(false);
    expect(urls.length).toBeGreaterThan(2);
    expect(urls.every((u) => u.includes("episodeId=ep-1"))).toBe(true);
  });

  it("stops after one request when the first page is not full", async () => {
    const { urls, fetchPage } = fakeRoute([
      event(1, "2026-05-01T00:00:00.000Z"),
    ]);
    const out = await loadSymptomEvents(
      "2026-04-01T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
      null,
      fetchPage,
    );
    expect(out.events).toHaveLength(1);
    expect(urls).toHaveLength(1);
  });
});
