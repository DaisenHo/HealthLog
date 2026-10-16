/**
 * The journal reads every episode, not the list route's first page.
 *
 * The route pages at 50 by default; one unpaged call left the oldest episodes
 * off the illness page, its settings and every picker once a record held more
 * than that, and they could then be found only through search.
 */
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);

vi.mock("@tanstack/react-query", () => ({
  // The hook's options are what is under test; return them as they are.
  useQuery: (options: unknown) => options,
  useMutation: () => ({}),
  useQueryClient: () => ({}),
}));

vi.mock("@/lib/api/api-fetch", () => ({
  apiGet: async (url: string) => {
    calls.push(url);
    // The route's own paging: 50 unless asked otherwise, from offset 0.
    const params = new URL(url, "http://x").searchParams;
    const offset = Number(params.get("offset") ?? 0);
    const limit = Number(params.get("limit") ?? 50);
    const total = 230;
    const count = Math.max(0, Math.min(limit, total - offset));
    return Array.from({ length: count }, (_, i) => ({ id: `e${offset + i}` }));
  },
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

import { useIllnessEpisodes } from "../use-illness";

describe("useIllnessEpisodes", () => {
  it("reads page after page until the whole journal is in", async () => {
    const options = useIllnessEpisodes(true) as unknown as {
      queryFn: () => Promise<{ id: string }[]>;
    };
    const episodes = await options.queryFn();
    expect(episodes).toHaveLength(230);
    expect(new Set(episodes.map((e) => e.id)).size).toBe(230);
    expect(calls).toHaveLength(3);
    expect(calls.every((url) => url.includes("includeResolved=true"))).toBe(
      true,
    );
  });
});
