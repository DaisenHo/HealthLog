/**
 * v1.28.46 — ChatBubble is wrapped in React.memo so a streamed
 * token (which grows the live turn's content and re-runs the thread's
 * messages.map) does not re-render every settled bubble. These tests pin the
 * memo comparator contract:
 *   - a per-render `onRegenerate` closure identity change alone does NOT force
 *     a re-render (the thread rebuilds that closure every render),
 *   - a `content` or `streaming` change DOES,
 *   - every other render-affecting prop is compared,
 * and that the exported component is actually memoized.
 */
import { describe, it, expect } from "vitest";

// Importing the module pulls the bubble's hook deps; stub them so the import
// is side-effect free (mirrors the sibling coach-charts harness).
import { vi } from "vitest";
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: null, isAuthenticated: true, isLoading: false }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

import { ChatBubble, areChatBubblePropsEqual } from "../chat-bubble";

type Props = Parameters<typeof areChatBubblePropsEqual>[0];

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    role: "assistant",
    content: "hello",
    metricSource: null,
    providerType: "openai",
    messageId: "m1",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("areChatBubblePropsEqual", () => {
  it("treats a fresh onRegenerate closure as equal (skips re-render)", () => {
    const prev = baseProps({ onRegenerate: () => {} });
    const next = baseProps({ onRegenerate: () => {} });
    expect(areChatBubblePropsEqual(prev, next)).toBe(true);
  });

  it("re-renders when the streamed content changes", () => {
    const prev = baseProps({ content: "hel", streaming: true });
    const next = baseProps({ content: "hell", streaming: true });
    expect(areChatBubblePropsEqual(prev, next)).toBe(false);
  });

  it("re-renders when the streaming flag flips", () => {
    const prev = baseProps({ content: "done", streaming: true });
    const next = baseProps({ content: "done", streaming: false });
    expect(areChatBubblePropsEqual(prev, next)).toBe(false);
  });

  it("re-renders when onRegenerate presence changes (undefined -> defined)", () => {
    const prev = baseProps({ onRegenerate: undefined });
    const next = baseProps({ onRegenerate: () => {} });
    expect(areChatBubblePropsEqual(prev, next)).toBe(false);
  });

  it("re-renders when a grounding / identity prop changes by reference", () => {
    const prev = baseProps({ metricSource: null });
    const next = baseProps({ metricSource: { metrics: ["weight"] } as never });
    expect(areChatBubblePropsEqual(prev, next)).toBe(false);

    expect(
      areChatBubblePropsEqual(
        baseProps({ messageId: "m1" }),
        baseProps({ messageId: "m2" }),
      ),
    ).toBe(false);
  });

  it("is stable for identical settled props", () => {
    expect(areChatBubblePropsEqual(baseProps(), baseProps())).toBe(true);
  });
});

describe("ChatBubble memoization", () => {
  it("is wrapped in React.memo", () => {
    const typeTag = (ChatBubble as unknown as { $$typeof?: symbol }).$$typeof;
    expect(String(typeTag)).toContain("memo");
  });
});
