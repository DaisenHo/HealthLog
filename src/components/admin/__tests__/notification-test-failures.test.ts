import { getServerTranslator } from "@/lib/i18n/server-translator";
/**
 * The admin notification test toast names each failing channel's cause
 * (review L5): the code the route sends is translated and the status is
 * shown, so the per-channel fields in the response have a reader.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  describeChannelTestFailures,
  notificationTestMessage,
} from "../notification-test-failures";

const MESSAGES: Record<string, string> = {
  "settings.testConnection.errors.upstream_rejected":
    "The other end refused the message",
  "settings.testConnection.errors.credentials_rejected": "Credentials rejected",
  "admin.notificationTestFailed": "Failed to send test notification",
};
const t = (key: string) => MESSAGES[key] ?? key;

describe("describeChannelTestFailures", () => {
  it("lists only failing channels, with the translated cause and the status", () => {
    expect(
      describeChannelTestFailures(
        [
          { channel: "APNS", success: true },
          {
            channel: "WEBHOOK",
            success: false,
            error: "The webhook answered HTTP 400.",
            errorCode: "upstream_rejected",
            upstreamStatus: 400,
          },
          {
            channel: "EMAIL",
            success: false,
            error: "The mail server rejected the credentials (SMTP 535).",
            errorCode: "credentials_rejected",
            smtpCode: 535,
          },
        ],
        t,
      ),
    ).toEqual([
      "Webhook: The other end refused the message (HTTP 400)",
      "Email: Credentials rejected (SMTP 535)",
    ]);
  });

  it("falls back to the route's sentence when there is no known code", () => {
    expect(
      describeChannelTestFailures(
        [
          {
            channel: "NTFY",
            success: false,
            error: "SYSTEM_ALERT disabled in settings",
          },
          { channel: "MYSTERY", success: false, errorCode: "unlisted" },
        ],
        t,
      ),
    ).toEqual([
      "ntfy: SYSTEM_ALERT disabled in settings",
      "MYSTERY: Failed to send test notification",
    ]);
  });

  it("is what the admin toast renders", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/admin/reminders-section.tsx"),
      "utf8",
    );
    expect(src).toMatch(/describeChannelTestFailures\(\s*data\?\.results/);
    expect(src).toMatch(/description:/);
  });
});

it("uses a Chinese fallback for unknown diagnostics while preserving status codes", () => {
  const zh = getServerTranslator("zh-CN").t;
  expect(
    describeChannelTestFailures(
      [
        {
          channel: "WEBHOOK",
          success: false,
          error: "English transport diagnostic",
          upstreamStatus: 503,
        },
      ],
      zh,
      "zh-CN",
    ),
  ).toEqual(["Webhook: 发送测试通知失败 (HTTP 503)"]);
});

it("distinguishes successful delivery from no configured channels in Chinese", () => {
  const zh = getServerTranslator("zh-CN").t;
  expect(
    notificationTestMessage(
      { sent: true, message: "All 1 channels successful" },
      zh,
      "zh-CN",
    ),
  ).toBe("测试通知已发送");
  expect(
    notificationTestMessage(
      { sent: false, message: "No enabled notification channels found" },
      zh,
      "zh-CN",
    ),
  ).toBe("未找到已启用的通知渠道");
});
