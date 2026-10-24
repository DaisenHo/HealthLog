import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The page surface reads `useRouter` (Conversations routes via the app router).
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: pushMock }),
}));

import { I18nProvider } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";
import { CoachConversation } from "../coach-conversation";

/**
 * v1.29.x (S7) — the fenced-conversation banner.
 *
 * When the Coach is fenced — here seeded via the `/coach?doc=<id>` hand-off,
 * which stages ONE document as a pending first-turn attachment before any
 * thread exists — the shared `<CoachConversation>` surface paints the
 * `coach-doc-scope` banner: a paperclip + the attached document name(s) and the
 * honest fencing line (the coach runs WITHOUT access to health data and reads
 * only the attached documents). While a staged attachment is still being
 * content-indexed the banner adds the "still being indexed" hint. On a normal
 * health thread the banner is absent. The fenced-send routing guarantee itself
 * is pinned by `coach-send-target.test.ts`.
 *
 * `pendingAttachmentIds` seeds from the `initialDocumentId` prop via a
 * `useState` initializer, so the banner resolves in a single static-markup
 * pass. The document detail (`/api/documents/inbound/<id>`) is seeded into the
 * cache so the staged pill's title + indexed status render without a network
 * call.
 */

const DOC_ID = "e2edocscopedoc0000000001";
const TITLE = "Chest X-ray report";

const FENCING_LINE = "without access to your health data";
const INDEXING_HINT = "still being indexed";

function makeClient(hasContentIndex: boolean): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // A fresh fenced chat has no thread yet — keep the rail empty so the surface
  // stays on the new-chat hero and the banner is the thing under test.
  client.setQueryData(queryKeys.coachConversations(), {
    conversations: [],
    nextCursor: null,
  });
  client.setQueryData(queryKeys.coachAboutMeQuestions(), { questions: [] });
  client.setQueryData(queryKeys.inboundDocument(DOC_ID), {
    id: DOC_ID,
    title: TITLE,
    filename: "xray.pdf",
    hasContentIndex,
  });
  return client;
}

function render(node: React.ReactNode, client: QueryClient): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </I18nProvider>,
  );
}

describe("<CoachConversation> fenced banner (S7)", () => {
  it("shows the paperclip count + honest fencing line for a staged attachment", () => {
    const html = render(
      <CoachConversation surface="page" initialDocumentId={DOC_ID} />,
      makeClient(true),
    );
    expect(html).toContain('data-slot="coach-doc-scope"');
    // Exactly one document staged → the banner names it, not a generic count.
    expect(html).toContain(`Chatting about: ${TITLE}`);
    // The honest fencing line is always present on a fenced conversation.
    expect(html).toContain(FENCING_LINE);
    // Indexed → no "still being indexed" hint.
    expect(html).not.toContain(INDEXING_HINT);
  });

  it("shows the still-indexing hint when the staged document has no content index", () => {
    const html = render(
      <CoachConversation surface="page" initialDocumentId={DOC_ID} />,
      makeClient(false),
    );
    expect(html).toContain('data-slot="coach-doc-scope"');
    expect(html).toContain(INDEXING_HINT);
  });

  it("paints no banner on a normal health thread (no attachments, not fenced)", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(queryKeys.coachConversations(), {
      conversations: [],
      nextCursor: null,
    });
    client.setQueryData(queryKeys.coachAboutMeQuestions(), { questions: [] });
    const html = render(<CoachConversation surface="page" />, client);
    expect(html).not.toContain('data-slot="coach-doc-scope"');
  });
});
