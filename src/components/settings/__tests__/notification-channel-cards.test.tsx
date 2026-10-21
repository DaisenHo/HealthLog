import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutationOptions: [] as Array<{
    mutationFn: (enabled: boolean) => Promise<void>;
    onMutate?: (enabled: boolean) => Promise<unknown>;
    onError?: (error: Error, enabled: boolean, previous: unknown) => void;
  }>,
  apiFetchRaw: vi.fn(),
  testButtonProps: [] as Array<{ endpoint: string; unsavedChanges?: boolean }>,
  queryClient: {
    cancelQueries: vi.fn(),
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly string[] }) => {
    const key = queryKey.join("/");
    if (key === "settings/webhook") {
      return {
        data: {
          enabled: false,
          url: "https://saved.example/hook",
          headerName: "Authorization",
          hasHeaderValue: true,
        },
      };
    }
    if (key === "settings/ntfy") {
      return {
        data: {
          enabled: false,
          serverUrl: "https://ntfy.sh",
          topic: "saved-topic",
          hasAuthToken: true,
        },
      };
    }
    if (key === "settings/email") {
      return {
        data: {
          enabled: false,
          recipient: "saved@example.com",
          smtpConfigured: true,
        },
      };
    }
    return {
      data: { enabled: false, hasBotToken: true, chatId: "saved-chat" },
    };
  },
  useMutation: (options: {
    mutationFn: (enabled: boolean) => Promise<void>;
    onMutate?: (enabled: boolean) => Promise<unknown>;
    onError?: (error: Error, enabled: boolean, previous: unknown) => void;
  }) => {
    mocks.mutationOptions.push(options);
    return { mutate: vi.fn(), isPending: false };
  },
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("@/lib/api/api-fetch", () => ({
  apiFetchRaw: mocks.apiFetchRaw,
  apiGet: vi.fn(),
}));

vi.mock("../test-connection-button", () => ({
  TestConnectionButton: (props: {
    endpoint: string;
    unsavedChanges?: boolean;
  }) => {
    mocks.testButtonProps.push(props);
    return null;
  },
}));

import { I18nProvider } from "@/lib/i18n/context";
import { WebhookCard } from "../webhook-card";
import { NtfyCard } from "../ntfy-card";
import { EmailCard } from "../email-card";
import { TelegramCard } from "../telegram-card";

function render(card: ReactElement) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">{card}</I18nProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mutationOptions.length = 0;
  mocks.testButtonProps.length = 0;
  mocks.queryClient.cancelQueries.mockResolvedValue(undefined);
  mocks.apiFetchRaw.mockResolvedValue(
    new Response(JSON.stringify({ data: { saved: true }, error: null }), {
      status: 200,
    }),
  );
});

describe("notification channel cards", () => {
  it.each([
    ["webhook", <WebhookCard key="webhook" isAuthenticated />],
    ["ntfy", <NtfyCard key="ntfy" isAuthenticated />],
    ["email", <EmailCard key="email" isAuthenticated />],
    ["telegram", <TelegramCard key="telegram" isAuthenticated />],
  ] as const)(
    "%s hands its unsaved-change state to the test button, clean once seeded from the server",
    (channel, card) => {
      render(card);
      const props = mocks.testButtonProps.at(-1);
      expect(props?.endpoint).toBe(`/api/settings/${channel}/test`);
      expect(props?.unsavedChanges).toBe(false);
    },
  );

  it.each([
    ["webhook", <WebhookCard key="webhook" isAuthenticated />],
    ["ntfy", <NtfyCard key="ntfy" isAuthenticated />],
    ["email", <EmailCard key="email" isAuthenticated />],
    ["telegram", <TelegramCard key="telegram" isAuthenticated />],
  ] as const)(
    "%s enable switch is a form field: it writes nothing on its own",
    async (_channel, card) => {
      const html = render(card);
      // Rendering the switch writes nothing, and the card mounts no
      // switch-only mutation: every write it can make is the full form.
      expect(html).toContain('role="switch"');
      expect(mocks.apiFetchRaw).not.toHaveBeenCalled();
      for (const mutation of mocks.mutationOptions) {
        await mutation.mutationFn(true);
      }
      for (const [, init] of mocks.apiFetchRaw.mock.calls as Array<
        [string, { body: string }]
      >) {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        expect(Object.keys(body).length).toBeGreaterThan(1);
      }
    },
  );

  it("webhook card offers the payload format and sends it with the full save (#947)", async () => {
    const html = render(<WebhookCard isAuthenticated />);

    expect(html).toContain('id="webhook-format"');
    expect(html).toMatch(/<option value="generic" selected="">/);
    expect(html).toContain('<option value="gotify">');

    // The full save is the mutation of the last render, whose closure holds
    // the values seeded from the server, the enable switch included.
    const save = mocks.mutationOptions.at(-1)!;
    await save.mutationFn(false);

    const [, init] = mocks.apiFetchRaw.mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(JSON.parse(init.body)).toMatchObject({
      url: "https://saved.example/hook",
      format: "generic",
      enabled: false,
    });
  });
});
