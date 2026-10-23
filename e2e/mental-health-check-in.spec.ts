import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./setup/test";

import { STORAGE_STATE_PATH } from "./setup/global-setup";

/**
 * One full check-in per instrument through the shared wizard: the stem is
 * on every step, the answers form one radio group in the source order, the
 * number keys answer, the review lists every answer and changes one, and
 * the result carries score, band, meaning and the next step. The PHQ-9 run
 * answers item 9 above zero, so its result must lead with the crisis card.
 *
 * The total on the result is the server's; this journey adds the chosen
 * option values itself and compares, which is the scoring contract seen
 * from the outside (`instruments.test.ts` pins it from the inside). Each
 * screen is scanned with axe on the way.
 *
 * Anchored on data attributes only, so the journey reads the same at every
 * width and in every language.
 */

type Case = {
  id: "PHQ9" | "GAD7" | "WHO5" | "SCI";
  items: number;
  options: number;
  multiplier: number;
  followUp: boolean;
};

const CASES: readonly Case[] = [
  { id: "PHQ9", items: 9, options: 4, multiplier: 1, followUp: true },
  { id: "GAD7", items: 7, options: 4, multiplier: 1, followUp: false },
  { id: "WHO5", items: 5, options: 6, multiplier: 4, followUp: false },
  { id: "SCI", items: 8, options: 5, multiplier: 1, followUp: false },
];

async function expectNoSeriousViolations(page: Page, label: string) {
  // The pointer rests where the last tap landed; a hover tint under it is
  // not what the screen shows at rest.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page })
    .include(
      '[data-slot="mental-health-check-in"], [data-slot="mental-health-result"]',
    )
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => `${n.html} ${n.failureSummary ?? ""}`).join(" | ")}`,
    );
  expect(blocking, `axe on ${label}`).toEqual([]);
}

test.describe("mental-health check-in, every instrument", () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  for (const c of CASES) {
    test(`${c.id}: steps, review, result`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto("/mental-wellbeing");
      const card = page.locator(
        `[data-slot="instrument-card"][data-instrument="${c.id}"]`,
      );
      await card.locator('[data-slot="instrument-card-start"]').click();

      const wizard = page.locator(
        `[data-slot="mental-health-check-in"][data-instrument="${c.id}"]`,
      );
      await expect(wizard).toBeVisible();

      const values: number[] = [];
      for (let step = 1; step <= c.items; step++) {
        const current = wizard.locator(
          `[data-slot="check-in-step"][data-step="${step}"]`,
        );
        await expect(current).toBeVisible();
        await expect(
          current.locator('[data-slot="check-in-stem"]'),
        ).toHaveCount(1);
        const group = current.locator('[role="radiogroup"]');
        await expect(group.locator('[role="radio"]')).toHaveCount(c.options);
        if (step === 1) await expectNoSeriousViolations(page, `${c.id} step 1`);

        // PHQ-9 item 9 answered above zero: the option in the last position
        // is "nearly every day" (value 3).
        const position =
          c.id === "PHQ9" && step === 9 ? c.options : (step % c.options) + 1;
        const answered = group.locator('[role="radio"]').nth(position - 1);
        values.push(Number(await answered.getAttribute("data-value")));
        if (step % 2 === 0) {
          // Keyboard: the number key picks the answer in that position.
          await group.locator('[role="radio"]').first().focus();
          await page.keyboard.press(String(position));
        } else {
          await group
            .locator('[role="radio"]')
            .nth(position - 1)
            .click();
        }
      }

      if (c.followUp) {
        const followUp = wizard.locator(
          '[data-slot="check-in-step"][data-functional]',
        );
        await expect(followUp).toBeVisible();
        await followUp.locator('[role="radio"]').nth(1).click();
        await wizard.locator('[data-slot="check-in-next"]').click();
      }

      const review = wizard.locator('[data-slot="check-in-review"]');
      await expect(review).toBeVisible();
      await expect(
        review.locator('[data-slot="check-in-review-row"]'),
      ).toHaveCount(c.items + (c.followUp ? 1 : 0));
      await expectNoSeriousViolations(page, `${c.id} review`);

      // Change the second answer from the review; the wizard returns there.
      await review.locator('[data-review-edit="2"]').click();
      const second = wizard.locator(
        '[data-slot="check-in-step"][data-step="2"]',
      );
      await expect(second).toBeVisible();
      const other =
        values[1] ===
        Number(
          await second
            .locator('[role="radio"]')
            .first()
            .getAttribute("data-value"),
        )
          ? 1
          : 0;
      await second.locator('[role="radio"]').nth(other).click();
      await expect(review).toBeVisible();
      values[1] = Number(
        await review
          .locator('[data-slot="check-in-review-row"][data-step="2"]')
          .getAttribute("data-value"),
      );

      await wizard.locator('[data-slot="check-in-submit"]').click();

      const result = page.locator(
        `[data-slot="mental-health-result"][data-instrument="${c.id}"]`,
      );
      await expect(result).toBeVisible();
      const total = values.reduce((sum, v) => sum + v, 0) * c.multiplier;
      await expect(result.locator('[data-slot="result-score"]')).toContainText(
        String(total),
      );
      await expect(result.locator('[data-slot="result-band"]')).toBeVisible();
      await expect(
        result.locator('[data-slot="result-meaning"]'),
      ).toBeVisible();
      await expect(
        result.locator(
          '[data-slot="result-follow-up-hint"], [data-slot="result-next-step"]',
        ),
      ).toHaveCount(1);
      if (c.id === "PHQ9") {
        await expect(
          result.locator('[data-slot="mental-health-crisis-card"]'),
        ).toBeVisible();
      }
      await expectNoSeriousViolations(page, `${c.id} result`);
    });
  }
});

/**
 * The questionnaires in the reader's language. Where a validated translation
 * exists the form shows it and nothing else; where the text is HealthLog's
 * own translation it carries the note and the one-tap switch to the English
 * original, and the result says it was answered in an unvalidated
 * translation. Which cells are unvalidated is pinned by
 * `instrument-wording.test.ts`; this journey proves the surface follows it.
 */
const UNVALIDATED: Record<string, readonly Case["id"][]> = {
  de: ["SCI"],
  nl: ["SCI"],
  ko: ["SCI"],
  "pt-BR": ["WHO5", "SCI"],
};

function caseOf(id: Case["id"]): Case {
  const found = CASES.find((c) => c.id === id);
  if (!found) throw new Error(`no case for ${id}`);
  return found;
}

async function openInLocale(page: Page, locale: string) {
  await page.context().addCookies([
    {
      name: "healthlog-locale",
      value: locale,
      url: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    },
  ]);
  await page.goto("/mental-wellbeing");
}

async function answerAll(page: Page, c: Case, position: number) {
  const wizard = page.locator(
    `[data-slot="mental-health-check-in"][data-instrument="${c.id}"]`,
  );
  for (let step = 1; step <= c.items; step++) {
    const current = wizard.locator(
      `[data-slot="check-in-step"][data-step="${step}"]`,
    );
    await expect(current).toBeVisible();
    await current
      .locator('[role="radio"]')
      .nth(position - 1)
      .click();
  }
  if (c.followUp) {
    await wizard.locator('[data-slot="check-in-next"]').click();
  }
  await expect(wizard.locator('[data-slot="check-in-review"]')).toBeVisible();
  await wizard.locator('[data-slot="check-in-submit"]').click();
  const result = page.locator(
    `[data-slot="mental-health-result"][data-instrument="${c.id}"]`,
  );
  await expect(result).toBeVisible();
  return result;
}

test.describe("mental-health check-in, in the reader's language", () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  for (const [locale, unvalidated] of Object.entries(UNVALIDATED)) {
    test(`${locale}: the note and the switch appear only on an unvalidated translation`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openInLocale(page, locale);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);

      for (const c of CASES) {
        await page
          .locator(`[data-slot="instrument-card"][data-instrument="${c.id}"]`)
          .locator('[data-slot="instrument-card-start"]')
          .click();
        const wizard = page.locator(
          `[data-slot="mental-health-check-in"][data-instrument="${c.id}"]`,
        );
        await expect(
          wizard.locator('[data-slot="check-in-step"][data-step="1"]'),
        ).toBeVisible();
        const expected = unvalidated.includes(c.id) ? 1 : 0;
        await expect(
          wizard.locator('[data-slot="check-in-unvalidated-note"]'),
        ).toHaveCount(expected);
        await expect(
          wizard.locator('[data-slot="check-in-wording-toggle"]'),
        ).toHaveCount(expected);
        await expect(
          wizard.locator('[data-slot="check-in-question"]'),
        ).toHaveAttribute("lang", locale);
        if (expected === 1) {
          // On screen together with the question, at every width: the step
          // scrolls to its top block, note and stem included.
          await expect(
            wizard.locator('[data-slot="check-in-unvalidated-note"]'),
          ).toBeInViewport();
          await expectNoSeriousViolations(page, `${locale} ${c.id}`);
        }
        await wizard.locator('[data-slot="check-in-back-to-landing"]').click();
      }

      // An unvalidated translation answered as shown: the result says so.
      const sci = caseOf("SCI");
      await page
        .locator('[data-slot="instrument-card"][data-instrument="SCI"]')
        .locator('[data-slot="instrument-card-start"]')
        .click();
      const result = await answerAll(page, sci, 2);
      await expect(
        result.locator('[data-slot="result-wording-note"]'),
      ).toBeVisible();
      await expectNoSeriousViolations(page, `${locale} SCI result`);
    });
  }

  test("nl: the switch shows the English original, and the result records it", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openInLocale(page, "nl");
    await page
      .locator('[data-slot="instrument-card"][data-instrument="SCI"]')
      .locator('[data-slot="instrument-card-start"]')
      .click();
    const wizard = page.locator(
      '[data-slot="mental-health-check-in"][data-instrument="SCI"]',
    );
    const question = wizard.locator('[data-slot="check-in-question"]');
    const translated = await question.textContent();
    // The note and its switch travel with every step, not only the first.
    for (const step of [1, 2]) {
      const current = wizard.locator(
        `[data-slot="check-in-step"][data-step="${step}"]`,
      );
      await expect(
        current.locator('[data-slot="check-in-unvalidated-note"]'),
      ).toBeInViewport();
      await current.locator('[role="radio"]').first().click();
    }
    await wizard.locator('[data-slot="check-in-back"]').click();
    await wizard.locator('[data-slot="check-in-back"]').click();
    await expect(question).toHaveText(translated ?? "");
    const toggle = wizard.locator('[data-slot="check-in-wording-toggle"]');
    await toggle.click();
    await expect(toggle).toHaveAttribute("data-showing", "original_en");
    await expect(question).toHaveAttribute("lang", "en");
    await expect(question).not.toHaveText(translated ?? "");
    const sci = caseOf("SCI");
    const result = await answerAll(page, sci, 1);
    await expect(
      result.locator('[data-slot="result-wording-note"]'),
    ).toHaveCount(0);
  });

  test("pt-BR: PHQ-9 item 9 above zero leads the result with the crisis card", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openInLocale(page, "pt-BR");
    await page
      .locator('[data-slot="instrument-card"][data-instrument="PHQ9"]')
      .locator('[data-slot="instrument-card-start"]')
      .click();
    const phq = caseOf("PHQ9");
    // Position 2 is "Vários dias" (value 1) on every item, item 9 included.
    const result = await answerAll(page, phq, 2);
    await expect(
      result.locator('[data-slot="mental-health-crisis-card"]'),
    ).toBeVisible();
    await expect(
      result.locator('[data-slot="result-wording-note"]'),
    ).toHaveCount(0);
  });
});
