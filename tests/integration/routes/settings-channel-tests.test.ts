/**
 * The channel self-tests, `POST /api/settings/{webhook,ntfy,email,telegram}
 * /test`, against the real database, through the real API kit and the real
 * senders. Only the far ends are replaced: outbound HTTP at the `safeFetch`
 * seam (the relay, the ntfy server, Telegram's Bot API) and the SMTP
 * transport at `nodemailer.createTransport`. What a test press sends is read
 * off what those seams received.
 *
 * Pinned here:
 *   - a delivered test is 200 `{ sent: true }`, and the far end received the
 *     message for the caller's own stored config: the Discord-compatible
 *     generic webhook body, the ntfy JSON publish, the mail to the stored
 *     recipient, the Telegram text in the account's language (German,
 *     French, English for a missing or unknown locale);
 *   - a private target the operator has not listed is 422
 *     `private_origin_not_approved`, one no grant can open is 422
 *     `private_origin_not_grantable`, and in both cases nothing is dialled;
 *   - a relay that answered an error status is 502 with the status mapped to
 *     the card's code, the status itself, and what the relay said when it
 *     said anything; a timeout is 502 `timeout`; an SMTP rejection is 502
 *     with the code and the SMTP reply code; only a failure the sender could
 *     not name is 500 `http.internal`;
 *   - Telegram: no saved credentials is 422 and nothing is sent, a refused
 *     send is 422, and the sixth test inside five minutes is 429.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { SafeFetchError, type SafeFetchOptions } from "@/lib/safe-fetch";
import { encrypt } from "@/lib/crypto";
import { resetEmailConfigForTesting } from "@/lib/notifications/senders/email-config";
import { resetEmailTransporterForTesting } from "@/lib/notifications/senders/email";
import { POST as testWebhook } from "@/app/api/settings/webhook/test/route";
import { POST as testNtfy } from "@/app/api/settings/ntfy/test/route";
import { POST as testEmail } from "@/app/api/settings/email/test/route";
import { POST as testTelegram } from "@/app/api/settings/telegram/test/route";

import { callRoute } from "../../kit/call-route";
import { makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

interface SentRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

interface SentMail {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
}

const far = vi.hoisted(() => ({
  requests: [] as SentRequest[],
  /** The far end's answer; a thrown value stands for the network failing. */
  answer: null as null | ((request: SentRequest) => Response),
  mails: [] as SentMail[],
  smtpFailure: null as null | Error,
}));

vi.mock("@/lib/safe-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/safe-fetch")>();
  return {
    ...actual,
    safeFetch: async (
      url: string | URL,
      init: RequestInit = {},
      _options?: SafeFetchOptions,
    ) => {
      const request: SentRequest = {
        url: String(url),
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        body: typeof init.body === "string" ? init.body : "",
      };
      far.requests.push(request);
      if (far.answer) return far.answer(request);
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
});

vi.mock("nodemailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nodemailer")>();
  const createTransport = () => ({
    sendMail: async (mail: SentMail) => {
      far.mails.push(mail);
      if (far.smtpFailure) throw far.smtpFailure;
      return { messageId: "<kit@example.test>" };
    },
  });
  return {
    ...actual,
    createTransport,
    default: { ...actual.default, createTransport },
  };
});

const prisma = getPrismaClient();

const ENV_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_FROM",
  "NOTIFICATION_PRIVATE_ORIGINS",
] as const;
const savedEnv = new Map<string, string | undefined>();

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_FROM = "healthlog@example.test";
  resetEmailConfigForTesting();
  resetEmailTransporterForTesting();
});

afterAll(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEmailConfigForTesting();
  resetEmailTransporterForTesting();
});

beforeEach(async () => {
  await truncateAllTables(prisma);
  far.requests.length = 0;
  far.answer = null;
  far.mails.length = 0;
  far.smtpFailure = null;
  delete process.env.NOTIFICATION_PRIVATE_ORIGINS;
});

async function withChannel(
  type: "WEBHOOK" | "NTFY" | "EMAIL",
  config: Record<string, unknown>,
) {
  const user = await makeUser();
  await prisma.notificationChannel.create({
    data: {
      userId: user.id,
      type,
      enabled: true,
      config: encrypt(JSON.stringify(config)),
    },
  });
  return user;
}

const TEST_ROUTES = {
  webhook: { handler: testWebhook, route: "/api/settings/webhook/test" },
  ntfy: { handler: testNtfy, route: "/api/settings/ntfy/test" },
  email: { handler: testEmail, route: "/api/settings/email/test" },
  telegram: { handler: testTelegram, route: "/api/settings/telegram/test" },
} as const;

async function press(name: keyof typeof TEST_ROUTES, userId: string) {
  const { handler, route } = TEST_ROUTES[name];
  return callRoute<{ sent: boolean }>(handler, {
    method: "POST",
    route,
    auth: await makeSession({ id: userId }),
  });
}

function answerWith(status: number, body: string | null): void {
  far.answer = () =>
    new Response(body, {
      status,
      headers: body ? { "content-type": "application/json" } : {},
    });
}

const PUBLIC_TARGETS = {
  webhook: {
    type: "WEBHOOK",
    config: { url: "https://relay.example.com/hook" },
  },
  ntfy: {
    type: "NTFY",
    config: { serverUrl: "https://ntfy.example.com", topic: "health" },
  },
} as const;

const PRIVATE_TARGETS = {
  webhook: { type: "WEBHOOK", config: { url: "http://10.0.0.5:8080/message" } },
  ntfy: {
    type: "NTFY",
    config: { serverUrl: "http://192.168.1.20:8080", topic: "health" },
  },
} as const;

const UNGRANTABLE_TARGETS = {
  webhook: {
    type: "WEBHOOK",
    config: { url: "http://169.254.169.254/latest" },
  },
  ntfy: {
    type: "NTFY",
    config: { serverUrl: "http://169.254.169.254", topic: "health" },
  },
} as const;

const RELAYS = ["webhook", "ntfy"] as const;

describe("POST /api/settings/webhook/test", () => {
  const DISCORD_URL =
    "https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

  it("delivers to a Discord webhook URL: the generic body carries the content Discord requires", async () => {
    const user = await withChannel("WEBHOOK", { url: DISCORD_URL });
    // Answers the way Discord's execute-webhook endpoint does: 400 50006 for
    // a body without `content` or `embeds`, 204 otherwise.
    far.answer = (request) => {
      const body = JSON.parse(request.body) as Record<string, unknown>;
      const content = typeof body.content === "string" ? body.content : "";
      if (content.trim().length === 0 && body.embeds === undefined) {
        return new Response(
          JSON.stringify({
            message: "Cannot send an empty message",
            code: 50006,
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(null, { status: 204 });
    };

    const res = await press("webhook", user.id);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ sent: true });
    expect(far.requests).toHaveLength(1);
    expect(far.requests[0].url).toBe(DISCORD_URL);
    expect(far.requests[0].method).toBe("POST");
    const sent = JSON.parse(far.requests[0].body) as Record<string, unknown>;
    expect(sent.content).toBe(
      "HealthLog Test\nHealthLog: Connection successful! Webhook notifications are active.",
    );
    expect(sent.allowed_mentions).toEqual({ parse: [] });
  });

  it("passes Discord's own error through when the target refuses", async () => {
    const user = await withChannel("WEBHOOK", { url: DISCORD_URL });
    answerWith(
      404,
      JSON.stringify({ message: "Unknown Webhook", code: 10015 }),
    );

    const res = await press("webhook", user.id);

    expect(res.status).toBe(502);
    expect(res.meta?.errorCode).toBe("endpoint_not_found");
    expect(res.meta?.upstreamStatus).toBe(404);
    expect(String(res.meta?.upstreamBody)).toContain("Unknown Webhook");
  });

  it.each([
    [401, "credentials_rejected"],
    [403, "credentials_rejected"],
    [404, "endpoint_not_found"],
    [410, "endpoint_not_found"],
    [415, "upstream_rejected"],
    [422, "upstream_rejected"],
    [429, "rate_limited"],
    [503, "upstream_error"],
    [307, "redirected"],
  ])(
    "maps an upstream %i to %s, without a body when the relay sent none",
    async (status, code) => {
      const user = await withChannel("WEBHOOK", PUBLIC_TARGETS.webhook.config);
      answerWith(status, null);

      const res = await press("webhook", user.id);

      expect(res.status).toBe(502);
      expect(res.meta).toEqual({
        requestId: expect.any(String),
        errorCode: code,
        upstreamStatus: status,
      });
    },
  );
});

describe("POST /api/settings/{webhook,ntfy}/test", () => {
  it.each(RELAYS)(
    "%s: refuses a private target the operator has not listed with 422 and the code, and dials nothing",
    async (name) => {
      const { type, config } = PRIVATE_TARGETS[name];
      const user = await withChannel(type, config);

      const res = await press(name, user.id);

      expect(res.status).toBe(422);
      expect(res.meta).toEqual({
        requestId: expect.any(String),
        errorCode: "private_origin_not_approved",
      });
      expect(res.error).toContain("NOTIFICATION_PRIVATE_ORIGINS");
      expect(far.requests).toEqual([]);
    },
  );

  it.each(RELAYS)(
    "%s: refuses a target no grant can open with its own code and a message that does not say list it",
    async (name) => {
      const { type, config } = UNGRANTABLE_TARGETS[name];
      const user = await withChannel(type, config);

      const res = await press(name, user.id);

      expect(res.status).toBe(422);
      expect(res.meta).toEqual({
        requestId: expect.any(String),
        errorCode: "private_origin_not_grantable",
      });
      expect(res.error).toMatch(/no operator grant can open/);
      expect(res.error).not.toContain("NOTIFICATION_PRIVATE_ORIGINS");
      expect(far.requests).toEqual([]);
    },
  );

  it.each(RELAYS)(
    "%s: a relay that answered 400 is a 502 naming the status and what it said",
    async (name) => {
      const { type, config } = PUBLIC_TARGETS[name];
      const user = await withChannel(type, config);
      answerWith(400, '{"error":"Bad Request","errorCode":400}');

      const res = await press(name, user.id);

      expect(res.status).toBe(502);
      expect(res.meta).toEqual({
        requestId: expect.any(String),
        errorCode: "upstream_rejected",
        upstreamStatus: 400,
        upstreamBody: '{"error":"Bad Request","errorCode":400}',
      });
      expect(res.error).toContain("HTTP 400");
    },
  );

  it.each(RELAYS)(
    "%s: a timeout without a status is a 502 with the timeout code",
    async (name) => {
      const { type, config } = PUBLIC_TARGETS[name];
      const user = await withChannel(type, config);
      far.answer = () => {
        throw new SafeFetchError("The operation timed out", "timeout");
      };

      const res = await press(name, user.id);

      expect(res.status).toBe(502);
      expect(res.meta?.errorCode).toBe("timeout");
    },
  );

  it.each(RELAYS)(
    "%s: only a failure the sender could not name stays a 500",
    async (name) => {
      const { type, config } = PUBLIC_TARGETS[name];
      const user = await withChannel(type, config);
      far.answer = () => {
        throw new TypeError("something unexpected");
      };

      const res = await press(name, user.id);

      expect(res.status).toBe(500);
      expect(res.meta).toEqual({
        requestId: expect.any(String),
        errorCode: "http.internal",
      });
    },
  );

  it("webhook: a delivered test is a 200 and the relay received the generic body", async () => {
    const user = await withChannel("WEBHOOK", {
      url: "https://relay.example.com/hook",
      headerName: "X-Relay-Key",
      headerValue: "relay-secret",
    });

    const res = await press("webhook", user.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { sent: true }, error: null });
    expect(far.requests).toHaveLength(1);
    expect(far.requests[0].url).toBe("https://relay.example.com/hook");
    expect(far.requests[0].headers["x-relay-key"]).toBe("relay-secret");
    expect(JSON.parse(far.requests[0].body)).toMatchObject({
      title: "HealthLog Test",
      message:
        "HealthLog: Connection successful! Webhook notifications are active.",
      eventType: "SYSTEM_ALERT",
    });
  });

  it("ntfy: a delivered test is a 200 and the server received the JSON publish for the stored topic", async () => {
    const user = await withChannel("NTFY", {
      serverUrl: "https://ntfy.example.com",
      topic: "health",
      authToken: "tk_ntfy",
    });

    const res = await press("ntfy", user.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { sent: true }, error: null });
    expect(far.requests).toHaveLength(1);
    expect(far.requests[0].url).toBe("https://ntfy.example.com/");
    expect(far.requests[0].headers.authorization).toBe("Bearer tk_ntfy");
    expect(JSON.parse(far.requests[0].body)).toMatchObject({
      topic: "health",
      title: "HealthLog Test",
      message:
        "HealthLog: Connection successful! ntfy notifications are active.",
    });
  });
});

describe("POST /api/settings/email/test", () => {
  async function emailUser() {
    return withChannel("EMAIL", { recipient: "you@example.com" });
  }

  it.each([
    [
      "credentials_rejected",
      Object.assign(new Error("Invalid login: 535 Authentication failed"), {
        code: "EAUTH",
        responseCode: 535,
      }),
      535,
      "rejected the credentials (SMTP 535)",
    ],
    [
      "upstream_rejected",
      Object.assign(new Error("Mailbox unavailable"), {
        code: "EENVELOPE",
        responseCode: 550,
      }),
      550,
      "refused the message (SMTP 550)",
    ],
  ])(
    "answers an SMTP rejection with 502, %s and the reply code",
    async (code, failure, smtpCode, sentence) => {
      const user = await emailUser();
      far.smtpFailure = failure;

      const res = await press("email", user.id);

      expect(res.status).toBe(502);
      expect(res.meta).toEqual({
        requestId: expect.any(String),
        errorCode: code,
        smtpCode,
      });
      expect(res.error).toContain(sentence);
    },
  );

  it("answers a timeout with 502 and the timeout code", async () => {
    const user = await emailUser();
    far.smtpFailure = Object.assign(new Error("Connection timeout"), {
      code: "ETIMEDOUT",
    });

    const res = await press("email", user.id);

    expect(res.status).toBe(502);
    expect(res.meta?.errorCode).toBe("timeout");
  });

  it("keeps a 500 for a failure the sender could not name", async () => {
    const user = await emailUser();
    far.smtpFailure = new Error("something unexpected");

    const res = await press("email", user.id);

    expect(res.status).toBe(500);
    expect(res.meta).toEqual({
      requestId: expect.any(String),
      errorCode: "http.internal",
    });
  });

  it("answers a delivered test with 200, and the mail went to the stored recipient", async () => {
    const user = await emailUser();

    const res = await press("email", user.id);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ sent: true });
    expect(far.mails).toEqual([
      {
        from: "healthlog@example.test",
        to: "you@example.com",
        subject: "HealthLog Test",
        text: "HealthLog: Connection successful! Email notifications are active.",
      },
    ]);
  });
});

describe("POST /api/settings/telegram/test", () => {
  async function telegramUser(locale: string | null) {
    return makeUser({
      telegramBotToken: encrypt("123:bot-token"),
      telegramChatId: "chat-1",
      locale,
    });
  }

  function sentText(): unknown {
    expect(far.requests).toHaveLength(1);
    expect(far.requests[0].url).toBe(
      "https://api.telegram.org/bot123:bot-token/sendMessage",
    );
    const body = JSON.parse(far.requests[0].body) as {
      chat_id: string;
      text: string;
    };
    expect(body.chat_id).toBe("chat-1");
    return body.text;
  }

  it.each([
    [
      "de",
      "HealthLog: Verbindung hergestellt. Telegram-Benachrichtigungen sind aktiv.",
    ],
    [
      "fr",
      "HealthLog: connexion réussie. Les notifications Telegram sont actives.",
    ],
    [
      null,
      "HealthLog: connection successful. Telegram notifications are active.",
    ],
    [
      "klingon",
      "HealthLog: connection successful. Telegram notifications are active.",
    ],
  ])(
    "sends the body in the account's language (locale %s)",
    async (locale, text) => {
      const user = await telegramUser(locale);

      const res = await press("telegram", user.id);

      expect(res.status).toBe(200);
      expect(res.data).toEqual({ sent: true });
      expect(sentText()).toBe(text);
    },
  );

  it("answers 422 and sends nothing when no bot token is saved", async () => {
    const user = await makeUser({ locale: "de" });

    const res = await press("telegram", user.id);

    expect(res.status).toBe(422);
    expect(far.requests).toEqual([]);
  });

  it("answers 422 when Telegram refuses the send", async () => {
    const user = await telegramUser("en");
    far.answer = () =>
      new Response(
        JSON.stringify({
          ok: false,
          description: "Bad Request: chat not found",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );

    const res = await press("telegram", user.id);

    expect(res.status).toBe(422);
  });

  it("answers the sixth test inside five minutes with 429 and sends nothing for it", async () => {
    const user = await telegramUser("en");
    for (let i = 0; i < 5; i++) {
      expect((await press("telegram", user.id)).status).toBe(200);
    }

    const res = await press("telegram", user.id);

    expect(res.status).toBe(429);
    expect(far.requests).toHaveLength(5);
  });
});
