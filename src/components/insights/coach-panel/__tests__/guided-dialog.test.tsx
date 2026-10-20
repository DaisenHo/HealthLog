import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";

import {
  GuidedQuestionBubble,
  GuidedSummaryBubble,
} from "../guided-dialog-bubbles";
import { GuidedQuestionsCard } from "../guided-questions-card";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

primeLocales("de");

/**
 * v1.16.5 — markup-level coverage for the guided clarifying-questions
 * surfaces (entry card, question bubble, summary bubble). Behavioural
 * transitions live in `guided-questions-machine.test.ts`; placement in
 * the thread lives with the `placeInterleaved` tests.
 */

function render(node: React.ReactNode, locale: "en" | "de" = "en") {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>{node}</I18nProvider>,
  );
}

const noop = () => {};

describe("<GuidedQuestionsCard>", () => {
  it("renders the plural offer with the count and all three choices", () => {
    const html = render(
      <GuidedQuestionsCard
        count={3}
        onStart={noop}
        onLater={noop}
        onDismissAll={noop}
      />,
    );
    expect(html).toContain('data-slot="coach-guided-offer"');
    expect(html).toContain("The Coach has 3 follow-up questions for you");
    expect(html).toContain('data-slot="coach-guided-offer-start"');
    expect(html).toContain('data-slot="coach-guided-offer-later"');
    expect(html).toContain('data-slot="coach-guided-offer-dismiss"');
    expect(html).toContain("Answer now");
  });

  it("uses the singular title for a single pending question", () => {
    const html = render(
      <GuidedQuestionsCard
        count={1}
        onStart={noop}
        onLater={noop}
        onDismissAll={noop}
      />,
    );
    expect(html).toContain("The Coach has a follow-up question for you");
    expect(html).not.toContain("{count}");
  });

  it("disables every action while a request is in flight", () => {
    const html = render(
      <GuidedQuestionsCard
        count={2}
        disabled
        onStart={noop}
        onLater={noop}
        onDismissAll={noop}
      />,
    );
    expect(html.match(/disabled=""/g)?.length).toBe(3);
  });
});

describe("<GuidedQuestionBubble>", () => {
  it("renders progress + question text for the current question with actions", () => {
    const html = render(
      <GuidedQuestionBubble
        question="Do you have any chronic conditions?"
        progress={{ current: 1, total: 3 }}
        current
        onSkip={noop}
        onLater={noop}
        onDismissRemaining={noop}
      />,
    );
    expect(html).toContain('data-slot="coach-guided-question"');
    expect(html).toContain('data-state="current"');
    expect(html).toContain("Question 1 of 3");
    expect(html).toContain("Do you have any chronic conditions?");
    expect(html).toContain('data-slot="coach-guided-skip"');
    expect(html).toContain('data-slot="coach-guided-later"');
    expect(html).toContain('data-slot="coach-guided-dismiss"');
  });

  it("renders answered questions static — no actions", () => {
    const html = render(
      <GuidedQuestionBubble
        question="Do you have any chronic conditions?"
        progress={{ current: 1, total: 3 }}
      />,
    );
    expect(html).toContain('data-state="answered"');
    expect(html).not.toContain('data-slot="coach-guided-actions"');
  });

  it("localises the progress label", () => {
    const html = render(
      <GuidedQuestionBubble
        question="Hast du chronische Erkrankungen?"
        progress={{ current: 2, total: 3 }}
      />,
      "de",
    );
    expect(html).toContain("Frage 2 von 3");
  });
});

describe("<GuidedSummaryBubble>", () => {
  it("recaps answered + adopted counts and links to the self-context", () => {
    const html = render(
      <GuidedSummaryBubble answered={2} adopted={1} total={3} />,
    );
    expect(html).toContain('data-slot="coach-guided-summary"');
    expect(html).toContain("2 of 3 answered");
    expect(html).toContain("1 added to your self-context");
    expect(html).toContain('href="/settings/ai"');
  });

  it("says so when nothing was adopted", () => {
    const html = render(
      <GuidedSummaryBubble answered={1} adopted={0} total={3} />,
    );
    expect(html).toContain("nothing new added to your self-context");
  });
});
