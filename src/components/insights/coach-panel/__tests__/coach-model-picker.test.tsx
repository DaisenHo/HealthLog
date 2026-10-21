import { describe, expect, it } from "vitest";

import type { UserAIProvider } from "@/components/settings/ai/shared";

import { modelControlFor } from "../coach-model-picker";

function userProvider(over: Partial<UserAIProvider> = {}): UserAIProvider {
  return {
    provider: "OPENAI",
    model: "gpt-4o",
    baseUrl: null,
    hasAnthropicKey: false,
    anthropicKeyPreview: null,
    hasLocalKey: false,
    hasOpenaiKey: true,
    openaiKeyPreview: "sk-…abcd",
    compatBaseUrl: null,
    compatModel: null,
    hasCompatKey: false,
    responseTimeoutSeconds: null,
    localReasoningEffort: null,
    compatReasoningEffort: null,
    ...over,
  };
}

describe("modelControlFor", () => {
  it("offers the presets for the provider whose key the person saved", () => {
    const control = modelControlFor("openai", userProvider());
    expect(control.kind).toBe("preset");
    if (control.kind === "preset") expect(control.value).toBe("gpt-4o");
  });

  it("does not offer a model for a provider the shared model column is not set up for", () => {
    // The column belongs to OpenAI here; a Claude model name written for the
    // Anthropic entry would be sent to OpenAI.
    expect(modelControlFor("anthropic", userProvider()).kind).toBe("managed");
  });

  it("keeps the operator's provider and Codex read-only", () => {
    expect(modelControlFor("admin-openai", userProvider()).kind).toBe(
      "managed",
    );
    expect(modelControlFor("codex", userProvider()).kind).toBe("managed");
    expect(modelControlFor(null, userProvider()).kind).toBe("managed");
  });

  it("gives the gateway its own free-text model", () => {
    expect(
      modelControlFor(
        "openai-compatible",
        userProvider({ compatModel: "qwen3:32b" }),
      ),
    ).toEqual({ kind: "gateway", value: "qwen3:32b" });
  });
});
