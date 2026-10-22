/**
 * #947: the test button and the dispatcher must reach the SAME sender
 * function for a webhook or ntfy target, so the private-origin decision
 * cannot differ between the button that says "works" and the reminder that
 * then does not arrive. A structural check over the sources.
 *
 * The behaviour at the routes (save-time refusals, the test routes' 422 and
 * 502 answers) is proven against the real database in
 * `tests/integration/routes/settings-channels.test.ts` and
 * `tests/integration/routes/settings-channel-tests.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("the test button and the dispatcher share one sender", () => {
  const SRC = join(process.cwd(), "src");
  const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

  it.each([
    [
      "webhook",
      "app/api/settings/webhook/test/route.ts",
      /import \{ sendViaWebhook \} from "@\/lib\/notifications\/senders\/webhook"/,
      /sendViaWebhook\(config, payload\)/,
    ],
    [
      "ntfy",
      "app/api/settings/ntfy/test/route.ts",
      /import \{ sendViaNtfy \} from "@\/lib\/notifications\/senders\/ntfy"/,
      /sendViaNtfy\(config, payload\)/,
    ],
  ])(
    "%s: the route and the dispatcher import the same sender module",
    (_channel, routeFile, importPattern, dispatcherCall) => {
      expect(read(routeFile)).toMatch(importPattern);
      const dispatcher = read("lib/notifications/dispatcher.ts");
      expect(dispatcher).toMatch(importPattern);
      expect(dispatcher).toMatch(dispatcherCall);
    },
  );

  it("neither sender decides the private-origin verdict on its own", () => {
    // The senders take the verdict from `evaluateNotificationTarget`, the
    // function the save routes use too. No sender may carry a second policy.
    for (const rel of [
      "lib/notifications/senders/webhook.ts",
      "lib/notifications/senders/ntfy.ts",
    ]) {
      const src = read(rel);
      expect(src).toMatch(/evaluateNotificationTarget\(/);
      expect(src).not.toMatch(/process\.env\.NOTIFICATION_PRIVATE_ORIGINS/);
      expect(src).not.toMatch(/isPublicUrl\(/);
    }
    for (const rel of [
      "app/api/settings/webhook/route.ts",
      "app/api/settings/ntfy/route.ts",
    ]) {
      expect(read(rel)).toMatch(/isAllowedNotificationTarget/);
    }
  });
});
