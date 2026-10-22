"use client";

/**
 * The one-question-at-a-time check-in, the same pattern for every instrument.
 *
 * Each step shows the instrument's own question stem ("Over the last 2
 * weeks, how often have you been bothered by…", the WHO-5 and SCI section
 * stems) above one item, the item's exact answer options as a radio group,
 * the progress through the scored items, and Back. The PHQ-9's follow-up
 * question is one more, optional step. A review step then lists every
 * answer with a way back to each one, and only the review submits.
 *
 * Items, answers and stems come from `instrumentText`: the validated
 * translation where the language has one, the English original otherwise,
 * under an honest note. The header carries the app's own title and one
 * explanation line; the disclaimer stays on the landing.
 *
 * Keyboard: Tab reaches the selected answer (or the first), the arrow keys
 * move between answers, Space or Enter chooses, and the number keys choose
 * the answer in that position. Choosing advances; on the review step every
 * answer can be changed and the change returns to the review.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineAction } from "@/components/ui/inline-action";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { useTranslations } from "@/lib/i18n/context";
import {
  INSTRUMENTS,
  hasValidatedItems,
  optionLabelKey,
  stemKey,
} from "@/lib/mental-health/instruments";
import {
  FUNCTIONAL_TITLE_KEY,
  functionalOptionKey,
  hasFunctionalItem,
  instrumentText,
  itemKey,
} from "@/lib/mental-health/instrument-wording";

import {
  UNANSWERED,
  checkInSteps,
  firstUnanswered,
  isComplete,
  nextStep,
  prevStep,
} from "./check-in-nav";
import type { InstrumentId } from "./types";

const FUNCTIONAL_SCALE = [0, 1, 2, 3] as const;

type Wording = (key: string) => string;

export function CheckInWizard({
  instrument,
  onSubmit,
  onBack,
  isPending,
  isError,
}: {
  instrument: InstrumentId;
  /** Submit the completed check-in (+ the optional PHQ-9 follow-up). */
  onSubmit: (items: number[], functionalDifficulty?: number) => void;
  /** Return to the landing (abandons the in-progress check-in). */
  onBack: () => void;
  isPending: boolean;
  isError: boolean;
}) {
  const { t, locale } = useTranslations();
  const def = INSTRUMENTS[instrument];
  const wording: Wording = (k) => instrumentText(instrument, k, locale, t);
  const steps = checkInSteps(def.itemCount, hasFunctionalItem(instrument));

  const [step, setStep] = useState(1);
  const [items, setItems] = useState<number[]>(() =>
    Array(def.itemCount).fill(UNANSWERED),
  );
  const [functional, setFunctional] = useState<number>(UNANSWERED);
  // Set when a step was opened from the review: choosing returns there.
  const [fromReview, setFromReview] = useState(false);

  const onReview = step === steps.review;
  const onFunctional = step === steps.functionalStep;
  const questionIndex = step - 1;

  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
  }, [step]);

  function advance() {
    if (fromReview && isComplete(items)) {
      setFromReview(false);
      setStep(steps.review);
      return;
    }
    setStep((s) => nextStep(s, steps.review));
  }

  function choose(value: number) {
    if (onFunctional) {
      // Optional and unscored: choosing the chosen answer again clears it.
      setFunctional((prev) => (prev === value ? UNANSWERED : value));
      return;
    }
    const next = [...items];
    next[questionIndex] = value;
    setItems(next);
    if (fromReview && isComplete(next)) {
      setFromReview(false);
      setStep(steps.review);
      return;
    }
    setStep((s) => nextStep(s, steps.review));
  }

  function edit(target: number) {
    setFromReview(true);
    setStep(target);
  }

  const canReview = firstUnanswered(items) === null;
  const answered = items.filter((v) => v >= 0).length;

  return (
    <section
      className="flex flex-col gap-4"
      data-slot="mental-health-check-in"
      data-instrument={instrument}
      aria-busy={isPending || undefined}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit"
        onClick={onBack}
        data-slot="check-in-back-to-landing"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("mentalHealth.backToList")}
      </Button>

      <header className="flex flex-col gap-1">
        <PageHeader
          title={t(`mentalHealth.instrument.${def.i18nKey}`)}
          description={t(`mentalHealth.instrumentDescription.${def.i18nKey}`)}
        />
        {!hasValidatedItems(instrument, locale) && (
          <p
            className="text-muted-foreground text-xs"
            data-slot="check-in-validated-note"
          >
            {t("mentalHealth.validatedInEnglishNote")}
          </p>
        )}
      </header>

      <Card className="gap-0 p-0">
        <CardContent className="flex flex-col gap-4 p-4 md:p-6">
          <CheckInProgress
            answered={onReview ? def.itemCount : answered}
            current={Math.min(step, def.itemCount)}
            total={def.itemCount}
            label={
              onReview
                ? t("mentalHealth.wizard.allAnswered", {
                    total: def.itemCount,
                  })
                : onFunctional
                  ? t("mentalHealth.wizard.followUpLabel")
                  : t("mentalHealth.wizard.progressLabel", {
                      current: step,
                      total: def.itemCount,
                    })
            }
          />
          {onReview ? (
            <ReviewStep
              instrument={instrument}
              items={items}
              functional={functional}
              functionalStep={steps.functionalStep}
              wording={wording}
              headingRef={headingRef}
              onEdit={edit}
            />
          ) : (
            <QuestionStep
              key={step}
              instrument={instrument}
              step={step}
              onFunctional={onFunctional}
              selected={onFunctional ? functional : items[questionIndex]}
              wording={wording}
              headingRef={headingRef}
              disabled={isPending}
              onChoose={choose}
            />
          )}
          {isError && (
            <p className="text-destructive text-sm" role="alert">
              {t("mentalHealth.error")}
            </p>
          )}
        </CardContent>

        <div className="border-border/70 flex items-center justify-between gap-2 border-t p-4 md:p-6">
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={() => {
              setFromReview(false);
              setStep((s) => prevStep(s));
            }}
            disabled={step === 1 || isPending}
            data-slot="check-in-back"
          >
            {t("mentalHealth.back")}
          </Button>
          {onReview ? (
            <Button
              type="button"
              className="h-11"
              onClick={() =>
                onSubmit(items, functional >= 0 ? functional : undefined)
              }
              disabled={!isComplete(items) || isPending}
              aria-busy={isPending || undefined}
              data-slot="check-in-submit"
            >
              {isPending
                ? t("mentalHealth.submitting")
                : t("mentalHealth.submit")}
            </Button>
          ) : (
            <Button
              type="button"
              className="h-11"
              onClick={advance}
              disabled={
                onFunctional
                  ? !canReview
                  : items[questionIndex] < 0 || isPending
              }
              data-slot="check-in-next"
            >
              {step >= steps.questions
                ? t("mentalHealth.review.open")
                : t("mentalHealth.next")}
            </Button>
          )}
        </div>
      </Card>
    </section>
  );
}

function CheckInProgress({
  answered,
  current,
  total,
  label,
}: {
  answered: number;
  current: number;
  total: number;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-2" data-slot="check-in-progress">
      <p
        className="text-muted-foreground text-xs"
        data-current={current}
        data-total={total}
      >
        {label}
      </p>
      <Progress
        value={Math.round((answered / total) * 100)}
        aria-label={label}
        className="h-1.5"
      />
    </div>
  );
}

function QuestionStep({
  instrument,
  step,
  onFunctional,
  selected,
  wording,
  headingRef,
  disabled,
  onChoose,
}: {
  instrument: InstrumentId;
  step: number;
  onFunctional: boolean;
  selected: number;
  wording: Wording;
  headingRef: RefObject<HTMLHeadingElement | null>;
  disabled: boolean;
  onChoose: (value: number) => void;
}) {
  const { t } = useTranslations();
  const def = INSTRUMENTS[instrument];
  const index = step - 1;
  const stem = onFunctional ? null : stemKey(instrument, index);
  const question = onFunctional
    ? wording(FUNCTIONAL_TITLE_KEY)
    : wording(itemKey(instrument, index));
  const scale = onFunctional ? FUNCTIONAL_SCALE : def.optionOrder;
  const options = scale.map((value) => ({
    value,
    label: onFunctional
      ? wording(functionalOptionKey(value))
      : wording(optionLabelKey(instrument, index, value)),
  }));
  const questionId = `check-in-question-${instrument}-${step}`;

  return (
    <div
      className="flex flex-col gap-4"
      data-slot="check-in-step"
      data-step={step}
      data-functional={onFunctional || undefined}
    >
      {stem && (
        <p className="text-sm" data-slot="check-in-stem">
          {wording(`mentalHealth.stems.${stem}`)}
        </p>
      )}
      <h2
        ref={headingRef}
        id={questionId}
        tabIndex={-1}
        className="scroll-mt-4 text-base font-medium outline-none"
        data-slot="check-in-question"
      >
        {question}
      </h2>
      {onFunctional && (
        <p className="text-muted-foreground text-xs">
          {t("mentalHealth.functionalOptionalHint")}
        </p>
      )}
      <AnswerGroup
        labelledBy={questionId}
        options={options}
        selected={selected}
        disabled={disabled}
        onChoose={onChoose}
      />
      <p className="text-muted-foreground hidden text-xs md:block">
        {t("mentalHealth.wizard.keyboardHint", { count: options.length })}
      </p>
    </div>
  );
}

/**
 * The answer control every instrument shares: a radio group of full-width
 * options in the order the source form prints them.
 */
function AnswerGroup({
  labelledBy,
  options,
  selected,
  disabled,
  onChoose,
}: {
  labelledBy: string;
  options: ReadonlyArray<{ value: number; label: string }>;
  selected: number;
  disabled: boolean;
  onChoose: (value: number) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((o) => o.value === selected);
  const tabIndexAt = selectedIndex >= 0 ? selectedIndex : 0;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const focused = refs.current.findIndex(
      (el) => el === document.activeElement,
    );
    const from = focused >= 0 ? focused : tabIndexAt;
    const last = options.length - 1;
    const move: Record<string, number> = {
      ArrowDown: from === last ? 0 : from + 1,
      ArrowRight: from === last ? 0 : from + 1,
      ArrowUp: from === 0 ? last : from - 1,
      ArrowLeft: from === 0 ? last : from - 1,
      Home: 0,
      End: last,
    };
    if (event.key in move) {
      event.preventDefault();
      refs.current[move[event.key]]?.focus();
      return;
    }
    const position = Number.parseInt(event.key, 10);
    if (position >= 1 && position <= options.length && !disabled) {
      event.preventDefault();
      onChoose(options[position - 1].value);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="flex flex-col gap-2"
      data-slot="check-in-options"
      onKeyDown={onKeyDown}
    >
      {options.map((option, i) => {
        const checked = option.value === selected;
        return (
          <Button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === tabIndexAt ? 0 : -1}
            // 44px touch-target floor (WCAG 2.5.5).
            className="h-auto min-h-11 justify-start py-2 text-left whitespace-normal"
            variant={checked ? "default" : "outline"}
            onClick={() => onChoose(option.value)}
            disabled={disabled}
            data-slot="check-in-option"
            data-value={option.value}
            data-selected={checked || undefined}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

function ReviewStep({
  instrument,
  items,
  functional,
  functionalStep,
  wording,
  headingRef,
  onEdit,
}: {
  instrument: InstrumentId;
  items: readonly number[];
  functional: number;
  functionalStep: number | null;
  wording: Wording;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onEdit: (step: number) => void;
}) {
  const { t } = useTranslations();
  const rows = items.map((value, index) => ({
    step: index + 1,
    question: wording(itemKey(instrument, index)),
    answer: wording(optionLabelKey(instrument, index, value)),
    value: value as number | null,
    stem: stemKey(instrument, index),
  }));
  if (functionalStep !== null) {
    rows.push({
      step: functionalStep,
      question: wording(FUNCTIONAL_TITLE_KEY),
      answer:
        functional >= 0
          ? wording(functionalOptionKey(functional))
          : t("mentalHealth.review.notAnswered"),
      value: null,
      stem: null,
    });
  }

  return (
    <div className="flex flex-col gap-3" data-slot="check-in-review">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-base font-medium outline-none"
      >
        {t("mentalHealth.review.title")}
      </h2>
      <p className="text-sm">{t("mentalHealth.review.description")}</p>
      <ol className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <li
            key={row.step}
            className="flex flex-col gap-1 text-sm"
            data-slot="check-in-review-row"
            data-step={row.step}
            data-value={row.value ?? undefined}
          >
            {row.stem && row.stem !== rows[i - 1]?.stem && (
              <p className="text-muted-foreground text-xs">
                {wording(`mentalHealth.stems.${row.stem}`)}
              </p>
            )}
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 flex-1">{row.question}</span>
              <InlineAction
                tone="primary"
                size="sm"
                className="shrink-0"
                onClick={() => onEdit(row.step)}
                aria-label={t("mentalHealth.review.changeLabel", {
                  number: row.step,
                })}
                data-review-edit={row.step}
              >
                {t("mentalHealth.review.change")}
              </InlineAction>
            </div>
            <span className="text-foreground font-medium">
              {row.answer}
              {row.value !== null && (
                <span className="text-muted-foreground font-normal tabular-nums">
                  {" "}
                  ({row.value})
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
