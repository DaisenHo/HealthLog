/**
 * A saved API key can be removed from every provider form that holds one.
 *
 * The forms showed "saved" beside the key field and nothing to take the key
 * back: an empty field on Save keeps the stored key by design, so a key once
 * entered stayed. The remove control renders on each of the four personal-key
 * forms exactly when that form's key is stored, and the body it sends clears
 * that one key and nothing beside it. The route's side (the column is cleared,
 * the other keys and the provider choice survive) is pinned against Postgres
 * in `tests/integration/ai-provider-key-removal.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType } from "react";

import { I18nProvider } from "@/lib/i18n/context";
import { aiProviderPatchSchema } from "@/lib/validations/ai-provider";

import { AnthropicProviderForm } from "../anthropic-provider-form";
import { CompatProviderForm } from "../compat-provider-form";
import { LocalProviderForm } from "../local-provider-form";
import { OpenAIProviderForm } from "../openai-provider-form";
import {
  removeSavedKeyBody,
  type SavedKeyField,
} from "../remove-saved-key-button";
import type { UserAIProvider } from "../shared";

function provider(overrides: Partial<UserAIProvider> = {}): UserAIProvider {
  return {
    provider: null,
    model: null,
    baseUrl: null,
    hasAnthropicKey: false,
    anthropicKeyPreview: null,
    hasLocalKey: false,
    hasOpenaiKey: false,
    openaiKeyPreview: null,
    compatBaseUrl: null,
    compatModel: null,
    hasCompatKey: false,
    responseTimeoutSeconds: null,
    ...overrides,
  };
}

type Form = ComponentType<{ userProvider: UserAIProvider | null | undefined }>;

const FORMS: {
  name: string;
  Form: Form;
  field: SavedKeyField;
  saved: Partial<UserAIProvider>;
}[] = [
  {
    name: "OpenAI",
    Form: OpenAIProviderForm,
    field: "openaiKey",
    saved: { hasOpenaiKey: true, openaiKeyPreview: "...abcd" },
  },
  {
    name: "Anthropic",
    Form: AnthropicProviderForm,
    field: "anthropicKey",
    saved: { hasAnthropicKey: true, anthropicKeyPreview: "...abcd" },
  },
  {
    name: "Local",
    Form: LocalProviderForm,
    field: "localKey",
    saved: { hasLocalKey: true },
  },
  {
    name: "OpenAI-compatible gateway",
    Form: CompatProviderForm,
    field: "compatKey",
    saved: { hasCompatKey: true },
  },
];

function render(Form: Form, userProvider: UserAIProvider) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="en">
        <Form userProvider={userProvider} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("remove a saved API key", () => {
  for (const { name, Form, field, saved } of FORMS) {
    describe(name, () => {
      const slot = `data-slot="settings-ai-remove-key-${field}"`;

      it("offers the remove control while a key is stored", () => {
        const html = render(Form, provider(saved));
        expect(html).toContain(slot);
        expect(html).toContain("Remove API key");
      });

      it("offers nothing to remove when no key is stored", () => {
        expect(render(Form, provider())).not.toContain(slot);
      });

      it("sends a body that clears that key and nothing else", () => {
        const body = removeSavedKeyBody(field);
        expect(body).toEqual({ [field]: null });
        // The route reads the body through this schema; a field it did not
        // know would be dropped and the request answered "No valid fields".
        const parsed = aiProviderPatchSchema.safeParse(body);
        expect(parsed.success).toBe(true);
        expect(parsed.data).toEqual({ [field]: null });
      });
    });
  }
});
