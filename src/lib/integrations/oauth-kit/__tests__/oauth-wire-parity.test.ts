/**
 * What every OAuth provider client puts on the wire, and what it makes of
 * the answer, pinned in `__golden__/oauth-wire.json`.
 *
 * For each provider the authorization URL, the token exchange, the refresh
 * and (Strava) the deauthorization are driven against a scripted token
 * endpoint at the `safeFetch` seam: a good answer, an empty body, the refusal
 * shapes each provider is known to send (an OAuth `invalid_grant`, Strava's
 * `Fault`, a Withings status envelope), an unknown client, a rate limit and
 * an outage. The golden records every request (method, URL with its query
 * as a sorted map, headers, form body as a sorted map), the result or the
 * error with its classification, and the external-call line the wide event
 * received.
 *
 * The golden was written from the hand-written clients before they moved
 * onto the shared OAuth client factory, so a green run is the proof that the
 * factory speaks to each provider exactly as its own client did. Parameter
 * order is not recorded: no authorization server reads it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface RecordedRequest {
  method: string;
  url: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  form: Record<string, string> | null;
  body: string | null;
}

interface Scripted {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

const wire = vi.hoisted(() => ({
  requests: [] as RecordedRequest[],
  answers: [] as Scripted[],
  events: [] as Array<{ method: string; args: unknown[] }>,
}));

vi.mock("@/lib/safe-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/safe-fetch")>();
  return {
    ...actual,
    safeFetch: async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const body = typeof init.body === "string" ? init.body : null;
      const headers = Object.fromEntries(
        Object.entries((init.headers ?? {}) as Record<string, string>).sort(
          ([a], [b]) => a.localeCompare(b),
        ),
      );
      const isForm =
        Object.entries(headers).some(
          ([name, value]) =>
            name.toLowerCase() === "content-type" &&
            value.includes("x-www-form-urlencoded"),
        ) && body !== null;
      wire.requests.push({
        method: init.method ?? "GET",
        url: `${url.origin}${url.pathname}`,
        query: sortedParams(url.searchParams),
        headers,
        form: isForm ? sortedParams(new URLSearchParams(body)) : null,
        body: isForm ? null : body,
      });
      const answer = wire.answers.shift() ?? { status: 599, body: "" };
      return new Response(answer.body === "" ? null : answer.body, {
        status: answer.status,
        headers: answer.headers,
      });
    },
  };
});

vi.mock("@/lib/logging/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logging/context")>();
  const recorder = new Proxy(
    {},
    {
      get:
        (_target, method) =>
        (...args: unknown[]) => {
          wire.events.push({
            method: String(method),
            args: args.map((arg) =>
              arg && typeof arg === "object" && "duration_ms" in arg
                ? { ...(arg as Record<string, unknown>), duration_ms: 0 }
                : arg,
            ),
          });
        },
    },
  );
  return { ...actual, getEvent: () => recorder };
});

function sortedParams(params: URLSearchParams): Record<string, string> {
  return Object.fromEntries(
    [...params.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}

const CREDS = { clientId: "client-id-1", clientSecret: "client-secret-1" };
const STATE = "state-nonce-1";
const CHALLENGE = "pkce-challenge-1";
const VERIFIER = "pkce-verifier-1";

const json = (status: number, body: unknown, headers = {}): Scripted => ({
  status,
  body: JSON.stringify(body),
  headers: { "content-type": "application/json", ...headers },
});

const TOKEN = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 3600,
  token_type: "Bearer",
  scope: "granted",
};

/** The answers every provider's token endpoint is driven through. */
const STANDARD_ANSWERS: Record<string, Scripted[]> = {
  ok: [json(200, TOKEN)],
  empty_body: [{ status: 200, body: "" }],
  invalid_grant: [json(400, { error: "invalid_grant" })],
  strava_fault: [
    json(400, {
      message: "Bad Request",
      errors: [
        { resource: "RefreshToken", field: "refresh_token", code: "invalid" },
      ],
    }),
  ],
  invalid_client: [json(401, { error: "invalid_client" })],
  rate_limited: [json(429, { error: "rate_limited" }, { "retry-after": "30" })],
  outage: [{ status: 503, body: "<html>unavailable</html>" }],
};

/** Withings answers HTTP 200 with a status inside the body. */
const WITHINGS_ANSWERS: Record<string, Scripted[]> = {
  ok: [json(200, { status: 0, body: { userid: "4711", ...TOKEN } })],
  empty_body: [{ status: 200, body: "" }],
  invalid_grant: [json(200, { status: 503, error: "Invalid Params" })],
  revoked: [json(200, { status: 100, error: "The hash is missing" })],
  invalid_client: [json(200, { status: 401, error: "invalid_client" })],
  rate_limited: [json(200, { status: 601, error: "Too Many Requests" })],
  outage: [{ status: 503, body: "<html>unavailable</html>" }],
};

type Call = () => Promise<unknown>;

interface ProviderUnderTest {
  answers: Record<string, Scripted[]>;
  redirectUri: () => string;
  authorize: () => string;
  exchange: Call;
  refresh?: Call;
  extra?: Record<string, { answers: Scripted[]; call: Call }>;
}

/**
 * How each provider's client is called. The calls are the only part of this
 * file that follows the clients' API; the golden does not.
 */
async function providers(): Promise<Record<string, ProviderUnderTest>> {
  const withings = await import("@/lib/withings/client");
  const whoop = await import("@/lib/whoop/client");
  const strava = await import("@/lib/strava/client");
  const oura = await import("@/lib/oura/client");
  const polar = await import("@/lib/polar/client");
  const google = await import("@/lib/google-health/client");
  const fitbit = await import("@/lib/fitbit/client");
  const MOI = "https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous";
  return {
    withings: {
      answers: WITHINGS_ANSWERS,
      redirectUri: withings.getWithingsRedirectUri,
      authorize: () => withings.getAuthorizationUrl(STATE, CREDS),
      exchange: () => withings.exchangeCode("code-1", CREDS),
      refresh: () => withings.refreshAccessToken("refresh-0", CREDS),
    },
    whoop: {
      answers: STANDARD_ANSWERS,
      redirectUri: whoop.getWhoopRedirectUri,
      authorize: () => whoop.getAuthorizationUrl(STATE, CREDS),
      exchange: () => whoop.exchangeCode("code-1", CREDS),
      refresh: () => whoop.refreshAccessToken("refresh-0", CREDS),
    },
    strava: {
      answers: STANDARD_ANSWERS,
      redirectUri: strava.getStravaRedirectUri,
      authorize: () => strava.getAuthorizationUrl(STATE, CREDS),
      exchange: () => strava.exchangeCode("code-1", CREDS),
      refresh: () => strava.refreshAccessToken("refresh-0", CREDS),
      extra: {
        deauthorize_ok: {
          answers: [json(200, { access_token: "access-1" })],
          call: () => strava.deauthorize("access-1"),
        },
        deauthorize_refused: {
          answers: [json(401, { message: "Authorization Error" })],
          call: () => strava.deauthorize("access-1"),
        },
      },
    },
    oura: {
      answers: STANDARD_ANSWERS,
      redirectUri: oura.getOuraRedirectUri,
      authorize: () => oura.getAuthorizationUrl(STATE, CREDS),
      exchange: () => oura.exchangeCode("code-1", CREDS),
      refresh: () => oura.refreshAccessToken("refresh-0", CREDS),
      extra: {
        exchange_from_moi_refused: {
          answers: [json(400, { error: "invalid_grant" })],
          call: () => oura.exchangeCode("code-1", CREDS, MOI),
        },
        exchange_legacy_fallback: {
          answers: [json(400, { error: "invalid_request" }), json(200, TOKEN)],
          call: () => oura.exchangeCode("code-1", CREDS, null),
        },
        exchange_both_refused: {
          answers: [
            json(401, { error: "invalid_client" }),
            json(400, { error: "invalid_grant" }),
          ],
          call: () => oura.exchangeCode("code-1", CREDS),
        },
        refresh_legacy_fallback: {
          answers: [json(404, { error: "not_found" }), json(200, TOKEN)],
          call: () => oura.refreshAccessToken("refresh-0", CREDS),
        },
        refresh_outage_no_fallback: {
          answers: [{ status: 502, body: "" }],
          call: () => oura.refreshAccessToken("refresh-0", CREDS),
        },
      },
    },
    polar: {
      answers: STANDARD_ANSWERS,
      redirectUri: polar.getPolarRedirectUri,
      authorize: () => polar.getAuthorizationUrl(STATE, CREDS),
      exchange: () => polar.exchangeCode("code-1", CREDS),
    },
    "google-health": {
      answers: STANDARD_ANSWERS,
      redirectUri: google.getGoogleHealthRedirectUri,
      authorize: () => google.getAuthorizationUrl(STATE, CREDS, CHALLENGE),
      exchange: () => google.exchangeCode("code-1", VERIFIER, CREDS),
      refresh: () => google.refreshAccessToken("refresh-0", CREDS),
    },
    fitbit: {
      answers: {
        ...STANDARD_ANSWERS,
        fitbit_errors: [
          json(400, {
            errors: [
              { errorType: "invalid_grant", message: "Refresh token invalid" },
            ],
            success: false,
          }),
        ],
      },
      redirectUri: fitbit.getFitbitRedirectUri,
      authorize: () => fitbit.getAuthorizationUrl(STATE, CREDS, CHALLENGE),
      exchange: () => fitbit.exchangeCode("code-1", VERIFIER, CREDS),
      refresh: () => fitbit.refreshAccessToken("refresh-0", CREDS),
    },
  };
}

function describeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { thrown: String(err) };
  const fields: Record<string, unknown> = {
    name: err.name,
    message: err.message,
  };
  for (const key of [
    "classification",
    "httpStatus",
    "withingsStatus",
    "reason",
    "verb",
    "upstreamError",
    "vendor",
    "retryAfterSeconds",
  ]) {
    const value = (err as unknown as Record<string, unknown>)[key];
    if (value !== undefined) fields[key] = value;
  }
  return fields;
}

async function drive(answers: Scripted[], call: Call) {
  wire.requests.length = 0;
  wire.events.length = 0;
  wire.answers = answers.map((a) => ({ ...a }));
  let outcome: Record<string, unknown>;
  try {
    outcome = { result: (await call()) ?? null };
  } catch (err) {
    outcome = { error: describeError(err) };
  }
  return {
    ...outcome,
    requests: [...wire.requests],
    events: [...wire.events],
    unansweredScript: wire.answers.length,
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://healthlog.example");
  for (const name of [
    "WITHINGS_REDIRECT_URI",
    "WHOOP_REDIRECT_URI",
    "STRAVA_REDIRECT_URI",
    "OURA_REDIRECT_URI",
    "POLAR_REDIRECT_URI",
    "GOOGLE_HEALTH_REDIRECT_URI",
    "FITBIT_REDIRECT_URI",
  ]) {
    vi.stubEnv(name, "");
  }
});

describe("OAuth wire parity", () => {
  it("speaks to every provider exactly as the golden records", async () => {
    const transcript: Record<string, unknown> = {};
    for (const [name, provider] of Object.entries(await providers())) {
      const authorizeUrl = new URL(provider.authorize());
      const entry: Record<string, unknown> = {
        redirectUri: provider.redirectUri(),
        authorize: {
          url: `${authorizeUrl.origin}${authorizeUrl.pathname}`,
          query: sortedParams(authorizeUrl.searchParams),
        },
      };
      const calls: Array<[string, Call | undefined]> = [
        ["exchange", provider.exchange],
        ["refresh", provider.refresh],
      ];
      for (const [verb, call] of calls) {
        if (!call) continue;
        const outcomes: Record<string, unknown> = {};
        for (const [scenario, answers] of Object.entries(provider.answers)) {
          outcomes[scenario] = await drive(answers, call);
        }
        entry[verb] = outcomes;
      }
      for (const [scenario, extra] of Object.entries(provider.extra ?? {})) {
        entry[scenario] = await drive(extra.answers, extra.call);
      }
      transcript[name] = entry;
    }

    // The run must have reached every provider's token endpoint; an empty
    // transcript would match an empty golden.
    expect(Object.keys(transcript)).toHaveLength(7);

    await expect(
      JSON.stringify(transcript, null, 2) + "\n",
    ).toMatchFileSnapshot("./__golden__/oauth-wire.json");
  });

  it("honours an explicit redirect URI from the environment", async () => {
    vi.stubEnv(
      "WHOOP_REDIRECT_URI",
      "https://elsewhere.example/api/whoop/callback",
    );
    vi.stubEnv(
      "GOOGLE_HEALTH_REDIRECT_URI",
      "https://healthlog.example/api/google-health/callback",
    );
    const all = await providers();
    expect(all.whoop!.redirectUri()).toBe(
      "https://elsewhere.example/api/whoop/callback",
    );
    expect(all["google-health"]!.redirectUri()).toBe(
      "https://healthlog.example/api/google-health/callback",
    );
    vi.stubEnv(
      "GOOGLE_HEALTH_REDIRECT_URI",
      "https://elsewhere.example/api/google-health/callback",
    );
    expect(() => all["google-health"]!.redirectUri()).toThrow(
      /does not match NEXT_PUBLIC_APP_URL origin/,
    );
    vi.stubEnv(
      "FITBIT_REDIRECT_URI",
      "http://healthlog.example/api/fitbit/callback",
    );
    expect(() => all.fitbit!.redirectUri()).toThrow(/must be https/);
  });
});
