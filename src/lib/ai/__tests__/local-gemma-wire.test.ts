/**
 * The local provider against an OpenAI-compatible server that answers the way
 * Ollama serves Gemma 4 on `/v1/chat/completions`, driven through the real
 * client, the real `safeFetch`, the pinned operator-approved dispatcher and a
 * real HTTP server on loopback. Nothing on the request path is mocked; only
 * the chain's health ledger and the signal sink are swapped for in-memory
 * stand-ins, because they write to Postgres and to the log transport.
 *
 * Ollama routes a thinking model's output into a separate `reasoning` field.
 * When Gemma 4 thinks (any `reasoning_effort` other than `none`) a long
 * generation can come back with `content: ""` — the thought used the whole
 * token budget (`finish_reason: "length"`), or the answer itself landed in
 * `reasoning` (`finish_reason: "stop"`). Asked with `reasoning_effort: "none"`
 * the same model answers in `content`. The background briefing always asks to
 * reason, so before the fix every briefing on such a model failed with a
 * sentinel status 0 that the chain logged as `cause: "network"` and the
 * read path showed as a timeout — in the very second the server logged 200.
 *
 * The transport block at the top rules the transport out: a slow, chunked,
 * large, multi-byte, kept-alive response arrives intact through the same
 * pinned path, so the failure is not in the bytes but in what the body says.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const emitSignal = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logging/signal", () => ({
  emitSignal: (...a: unknown[]) => emitSignal(...a),
}));

vi.mock("../provider-health-ledger", async () => {
  const actual = await vi.importActual<
    typeof import("../provider-health-ledger")
  >("../provider-health-ledger");
  return {
    ...actual,
    postgresProviderHealthLedger: {
      async getSkipHints() {
        return new Map();
      },
      async recordSuccess() {},
      async recordFailure() {},
    },
  };
});

import {
  LocalOpenAICompatibleClient,
  resetLocalJsonDialectCache,
} from "../local-client";
import { OpenAIClient } from "../openai-client";
import { resetReasoningDialectCache } from "../reasoning/dialect-cache";
import {
  AllProvidersFailedError,
  clearLastWorkingProviderCache,
  runRawCompletionWithFallback,
  runStreamingRawCompletionWithFallback,
} from "../provider-runner";
import { singleUserTurn, type CompletionParams } from "../types";
import { _resetPinnedDispatcherForTests } from "@/lib/safe-fetch-dispatcher";

const BRIEFING_JSON = JSON.stringify({
  dailyBriefing: { headline: "Steady week", body: "Nothing stood out." },
});

type GemmaMode =
  /** Thinking spends the whole budget: empty content, `length`. */
  | "budget"
  /** The answer lands in `reasoning`, content empty, `stop`. */
  | "misrouted"
  /** Empty content however it is asked. */
  | "always-empty";

interface SeenRequest {
  reasoningEffort: unknown;
  stream: boolean;
  responseFormat: unknown;
}

let server: http.Server;
let origin: string;
let mode: GemmaMode = "budget";
let headerDelayMs = 0;
let seen: SeenRequest[] = [];
/** When set, the answer `content` carries this instead of the briefing. */
let bigAnswer: string | null = null;

/** A long thought, with multi-byte characters, the way Gemma writes one. */
const THOUGHT =
  "Let me look at the week's readings — Blutdruck, Gewicht… ".repeat(3200);

function ollamaEnvelope(message: Record<string, unknown>, finish: string) {
  return {
    id: "chatcmpl-417",
    object: "chat.completion",
    created: 1_760_000_000,
    model: "gemma4:12b",
    system_fingerprint: "fp_ollama",
    choices: [{ index: 0, message, finish_reason: finish }],
    usage: {
      prompt_tokens: 5200,
      completion_tokens: 6120,
      total_tokens: 11320,
    },
  };
}

function gemmaReply(reasoningEffort: unknown) {
  const thinks = reasoningEffort !== "none";
  if (mode === "always-empty" || (thinks && mode === "budget")) {
    return ollamaEnvelope(
      { role: "assistant", content: "", reasoning: THOUGHT },
      "length",
    );
  }
  if (thinks && mode === "misrouted") {
    return ollamaEnvelope(
      {
        role: "assistant",
        content: "",
        reasoning: `${THOUGHT}\n${BRIEFING_JSON}`,
      },
      "stop",
    );
  }
  return ollamaEnvelope(
    { role: "assistant", content: bigAnswer ?? BRIEFING_JSON },
    "stop",
  );
}

/** Write `text` as several chunks, splitting inside multi-byte characters. */
async function writeChunked(res: http.ServerResponse, text: string) {
  const bytes = Buffer.from(text, "utf8");
  const step = 4093; // odd on purpose: cuts through multi-byte sequences
  for (let i = 0; i < bytes.length; i += step) {
    res.write(bytes.subarray(i, i + step));
    await new Promise((r) => setTimeout(r, 2));
  }
  res.end();
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      seen.push({
        reasoningEffort: body.reasoning_effort,
        stream: body.stream === true,
        responseFormat: body.response_format,
      });
      await new Promise((r) => setTimeout(r, headerDelayMs));
      const reply = gemmaReply(body.reasoning_effort);
      if (body.stream === true) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const message = reply.choices[0].message as {
          content: string;
          reasoning?: string;
        };
        const frames: string[] = [];
        if (message.reasoning) {
          frames.push(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "", reasoning: message.reasoning } }] })}\n\n`,
          );
        }
        if (message.content) {
          frames.push(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: message.content } }] })}\n\n`,
          );
        }
        frames.push(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reply.choices[0].finish_reason }] })}\n\n`,
          "data: [DONE]\n\n",
        );
        await writeChunked(res, frames.join(""));
        return;
      }
      // Go's net/http answers a body this size chunked, without a length.
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      await writeChunked(res, JSON.stringify(reply));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  _resetPinnedDispatcherForTests();
  await new Promise<void>((r) => server.close(() => r()));
});

const savedOrigins = process.env.AI_PRIVATE_ORIGINS;

beforeEach(() => {
  process.env.AI_PRIVATE_ORIGINS = origin;
  mode = "budget";
  headerDelayMs = 0;
  bigAnswer = null;
  seen = [];
  emitSignal.mockClear();
  clearLastWorkingProviderCache();
  resetLocalJsonDialectCache();
  resetReasoningDialectCache();
});

afterEach(() => {
  if (savedOrigins === undefined) delete process.env.AI_PRIVATE_ORIGINS;
  else process.env.AI_PRIVATE_ORIGINS = savedOrigins;
});

function client() {
  return new LocalOpenAICompatibleClient({
    baseUrl: `${origin}/v1`,
    model: "gemma4:12b",
  });
}

/** The briefing call exactly as `runBriefingCompletion` shapes it. */
function briefingParams(effort: "low" | "medium" = "medium"): CompletionParams {
  return {
    ...singleUserTurn({
      system: "You write the daily briefing.",
      user: "Snapshot: …",
      temperature: 0.3,
      maxTokens: 2500,
      timeoutMs: 30_000,
      responseFormat: "json",
    }),
    reasoning: { effort, summaries: false },
  };
}

function runChain(params: CompletionParams) {
  return runRawCompletionWithFallback({
    userId: "user-1",
    surface: "job",
    providers: [{ providerType: "local", instance: client() }],
    params,
  });
}

function linkFailedMeta(): Array<Record<string, unknown>> {
  return emitSignal.mock.calls
    .map((c) => c[0] as { action: string; meta: Record<string, unknown> })
    .filter((s) => s.action === "ai.chain.link_failed")
    .map((s) => s.meta);
}

describe("transport: the pinned path delivers a slow, large, chunked reply intact", () => {
  it("returns a delayed 180 KB multi-byte answer whole, twice in a row", async () => {
    bigAnswer = JSON.stringify({ text: THOUGHT });
    headerDelayMs = 300;
    const c = client();
    // The entry's own reasoning setting at "Off": the server answers in
    // `content`, which is what this block wants to read back byte for byte.
    c.reasoningEffort = "none";
    const params = singleUserTurn({
      system: "s",
      user: "u",
      maxTokens: 50,
      timeoutMs: 30_000,
    });
    const first = await c.generateCompletion(params);
    const second = await c.generateCompletion(params);
    expect(Buffer.byteLength(bigAnswer, "utf8")).toBeGreaterThan(90_000);
    expect(first.content).toBe(bigAnswer);
    expect(second.content).toBe(bigAnswer);
    expect(seen).toHaveLength(2);
  });
});

describe("Gemma 4 on Ollama: a reply with reasoning and no answer", () => {
  it("answers the briefing when thinking spent the budget (finish_reason length)", async () => {
    mode = "budget";
    const outcome = await runChain(briefingParams("medium"));
    expect(outcome.result.content).toBe(BRIEFING_JSON);
    // The first ask reasons; the repeat asks the model not to.
    expect(seen.map((s) => s.reasoningEffort)).toEqual(["medium", "none"]);
    // The JSON mode stays on for the repeat.
    expect(seen[1].responseFormat).toEqual({ type: "json_object" });
    expect(linkFailedMeta()).toEqual([]);
  });

  it("answers the briefing when the answer landed in `reasoning` (finish_reason stop)", async () => {
    mode = "misrouted";
    const outcome = await runChain(briefingParams("low"));
    expect(outcome.result.content).toBe(BRIEFING_JSON);
    expect(seen.map((s) => s.reasoningEffort)).toEqual(["low", "none"]);
  });

  it("remembers the model answers only without reasoning, so the next call asks once", async () => {
    mode = "budget";
    await runChain(briefingParams("medium"));
    seen = [];
    const again = await runChain(briefingParams("medium"));
    expect(again.result.content).toBe(BRIEFING_JSON);
    expect(seen.map((s) => s.reasoningEffort)).toEqual(["none"]);
  });

  it("does the same on the streaming path the Coach uses", async () => {
    mode = "budget";
    const deltas: string[] = [];
    const outcome = await runStreamingRawCompletionWithFallback({
      userId: "user-1",
      surface: "coach",
      providers: [{ providerType: "local", instance: client() }],
      params: briefingParams("medium"),
      onDelta: (d: string) => deltas.push(d),
    });
    expect(outcome.result.content).toBe(BRIEFING_JSON);
    expect(deltas.join("")).toBe(BRIEFING_JSON);
    expect(seen.map((s) => [s.stream, s.reasoningEffort])).toEqual([
      [true, "medium"],
      [true, "none"],
    ]);
  });

  it("names an empty answer as one, not as a network failure, when the repeat is empty too", async () => {
    mode = "always-empty";
    const err = await runChain(briefingParams("medium")).catch((e) => e);
    expect(err).toBeInstanceOf(AllProvidersFailedError);
    const [meta] = linkFailedMeta();
    expect(meta).toMatchObject({
      provider: "local",
      status: 0,
      cause: "empty_response",
      failure: "reasoning_only",
      code: null,
      surface: "job",
    });
    expect((err as AllProvidersFailedError).attempts[0].failureKind).toBe(
      "reasoning_only",
    );
  });

  it("does the same through the OpenAI-compatible gateway provider", async () => {
    mode = "misrouted";
    const gateway = new OpenAIClient({
      apiKey: "",
      model: "gemma4:12b",
      baseUrl: `${origin}/v1`,
      providerType: "openai-compatible",
    });
    const outcome = await runRawCompletionWithFallback({
      userId: "user-1",
      surface: "job",
      providers: [{ providerType: "openai-compatible", instance: gateway }],
      params: briefingParams("medium"),
    });
    expect(outcome.result.content).toBe(BRIEFING_JSON);
    expect(seen.map((s) => s.reasoningEffort)).toEqual(["medium", "none"]);
  });
});
