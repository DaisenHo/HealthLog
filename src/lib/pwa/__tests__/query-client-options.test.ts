/**
 * Offline mutations must FAIL fast (surfacing state) rather than
 * pause forever and lose the write on reload.
 *
 * The library default network mode (`online`) pauses a mutation fired offline:
 * it never rejects, `onError` never fires, and the paused mutation is dropped on
 * reload — a silent health-data loss. This pins that the app config sets
 * `networkMode: "always"` on mutations AND that, under that config, an offline
 * mutation actually reaches the `error` state instead of `pending`/paused.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  QueryClient,
  MutationObserver,
  onlineManager,
} from "@tanstack/react-query";

import { QUERY_CLIENT_DEFAULT_OPTIONS } from "../query-client-options";

afterEach(() => {
  // Restore the online flag for any following test in the same worker.
  onlineManager.setOnline(true);
});

describe("QUERY_CLIENT_DEFAULT_OPTIONS", () => {
  it("runs mutations in 'always' network mode", () => {
    expect(QUERY_CLIENT_DEFAULT_OPTIONS.mutations?.networkMode).toBe("always");
  });

  it("an offline mutation errors instead of pausing (no silent write loss)", async () => {
    const client = new QueryClient({
      defaultOptions: QUERY_CLIENT_DEFAULT_OPTIONS,
    });

    // Simulate the browser going offline.
    onlineManager.setOnline(false);

    const observer = new MutationObserver(client, {
      mutationFn: async () => {
        // A real fetch would reject with a TypeError while offline.
        throw new Error("Failed to fetch");
      },
      retry: 0,
    });

    let settled: "error" | "paused-timeout" = "paused-timeout";
    await Promise.race([
      observer
        .mutate()
        .then(() => {})
        .catch(() => {
          settled = "error";
        }),
      // If the mutation paused (the old default), it would never settle — cap
      // the wait so the test fails as a timeout rather than hanging.
      new Promise((resolve) => setTimeout(resolve, 200)),
    ]);

    // In `always` mode the mutation ran and rejected — an honest error the UI
    // can surface, not a paused mutation lost on reload.
    expect(settled).toBe("error");
    expect(observer.getCurrentResult().status).toBe("error");
    expect(observer.getCurrentResult().isPaused).toBe(false);

    client.clear();
  });
});
