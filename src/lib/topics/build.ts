/**
 * Assemble the topic overview and a topic page from what `read.ts` returned.
 * Pure: every input arrives as an argument, so a fixture covers every state.
 *
 * The summary sentence is a rule, never model text: the first signal outside
 * its usual range names itself; otherwise the lab panel or the cycle day
 * speaks for its topic; otherwise the count of signals inside their range;
 * otherwise "still learning". The client words the code; the server only
 * decides which one applies.
 */
import { insightsHrefForMetric } from "@/lib/insights/metric-deep-link";
import type { AssessmentTrend } from "@/lib/mental-health/assessment-trend";
import type { TrainingLoad } from "@/lib/insights/training-load";
import { shiftDateKey } from "@/lib/tz/format";

import type { TopicLabPanel } from "./labs";
import type { TopicCycleSummary, TopicInputs } from "./read";
import {
  MOOD_SIGNAL,
  SPARKLINE_POINTS,
  TOPIC_BASE_WINDOW_DAYS,
  TOPIC_RANGE_DAYS,
  TOPICS,
  type TopicDefinition,
  type TopicKey,
  type TopicRange,
  type TopicSignalKey,
} from "./registry";
import {
  computeRelationship,
  computeTrend,
  latestValue,
  stateAgainstRange,
  usualRange,
  windowValues,
  type DayValue,
  type SignalState,
  type TopicRelationship,
  type TopicTrend,
  type UsualRange,
} from "./stats";
import {
  isExtraVisible,
  isSignalVisible,
  visibleSignals,
  type TopicVisibility,
} from "./visibility";

export interface TopicSignal {
  key: TopicSignalKey;
  latest: DayValue | null;
  usual: UsualRange | null;
  state: SignalState;
  /** The single-metric page this signal opens, when it has one. */
  href: string | null;
}

export type TopicSummaryCode =
  "outside" | "labs" | "cycleDay" | "steady" | "learning" | "empty";

export interface TopicSummary {
  code: TopicSummaryCode;
  signal: TopicSignalKey | null;
  direction: "above" | "below" | null;
  count: number | null;
  total: number | null;
}

export type TopicHeadline =
  | { kind: "signal"; key: TopicSignalKey; value: number; day: string }
  | { kind: "labs"; inRange: number; total: number }
  | { kind: "cycleDay"; dayOfCycle: number }
  | { kind: "screener"; instrument: string; score: number };

export type TopicTone = "steady" | "watch" | "learning";

export interface TopicOverviewEntry {
  key: TopicKey;
  headline: TopicHeadline | null;
  summary: TopicSummary;
  tone: TopicTone;
  /** The headline signal's last values, oldest first (empty for a block headline). */
  sparkline: number[];
  /** Signals of the topic's list that hold a value. */
  recorded: number;
  /** Signals of the topic's list the record could hold. */
  total: number;
}

export interface TopicOverview {
  topics: TopicOverviewEntry[];
  /** Offered topics with nothing recorded yet. */
  empty: TopicKey[];
  /** Topics whose every module is switched off. */
  hiddenByModule: TopicKey[];
}

export interface TopicSeries {
  key: TopicSignalKey;
  usual: UsualRange | null;
  points: DayValue[];
}

export interface TopicDetail {
  key: TopicKey;
  range: TopicRange;
  from: string;
  to: string;
  status: "ready" | "partial" | "empty";
  summary: TopicSummary;
  signals: TopicSignal[];
  series: TopicSeries[];
  relationships: TopicRelationship[];
  trends: TopicTrend[];
  /** Signals the topic could show that hold no value yet. */
  missing: TopicSignalKey[];
  labs: TopicLabPanel | null;
  training: TrainingLoad | null;
  screeners: AssessmentTrend[] | null;
  cycle: TopicCycleSummary | null;
}

function signalHref(key: TopicSignalKey): string | null {
  if (key === MOOD_SIGNAL) return "/insights/mood";
  return insightsHrefForMetric(key);
}

export function buildSignals(
  keys: readonly TopicSignalKey[],
  inputs: TopicInputs,
  todayKey: string,
): TopicSignal[] {
  return keys.map((key) => {
    const series = inputs.series.get(key);
    const latest = latestValue(series, todayKey);
    const usual = usualRange(key, series, todayKey);
    return {
      key,
      latest,
      usual,
      state: stateAgainstRange(latest, usual),
      href: signalHref(key),
    };
  });
}

function hasBlockData(inputs: TopicInputs): boolean {
  return (
    inputs.labs !== null ||
    (inputs.screeners !== null && inputs.screeners.length > 0) ||
    inputs.cycle !== null ||
    (inputs.training !== null && inputs.training.status === "ok")
  );
}

/** The rule that picks the topic's one sentence. */
export function summarise(
  signals: readonly TopicSignal[],
  inputs: TopicInputs,
): TopicSummary {
  const none: TopicSummary = {
    code: "empty",
    signal: null,
    direction: null,
    count: null,
    total: null,
  };
  const recorded = signals.filter((s) => s.latest !== null);
  if (recorded.length === 0 && !hasBlockData(inputs)) return none;

  const outside = recorded.find(
    (s) => s.state === "above" || s.state === "below",
  );
  if (outside) {
    return {
      ...none,
      code: "outside",
      signal: outside.key,
      direction: outside.state === "above" ? "above" : "below",
    };
  }
  if (inputs.labs && inputs.labs.withRange > 0) {
    return {
      ...none,
      code: "labs",
      count: inputs.labs.inRange,
      total: inputs.labs.withRange,
    };
  }
  if (inputs.cycle?.today) {
    return { ...none, code: "cycleDay", count: inputs.cycle.today.dayOfCycle };
  }
  const within = recorded.filter((s) => s.state === "within");
  if (within.length > 0) {
    return {
      ...none,
      code: "steady",
      count: within.length,
      total: recorded.length,
    };
  }
  return { ...none, code: "learning" };
}

function toneOf(summary: TopicSummary, labs: TopicLabPanel | null): TopicTone {
  if (summary.code === "outside") return "watch";
  if (summary.code === "labs") {
    return labs && labs.inRange < labs.withRange ? "watch" : "steady";
  }
  if (summary.code === "steady" || summary.code === "cycleDay") return "steady";
  return "learning";
}

function headlineOf(
  signals: readonly TopicSignal[],
  inputs: TopicInputs,
): TopicHeadline | null {
  const first = signals.find((s) => s.latest !== null);
  if (first?.latest) {
    return {
      kind: "signal",
      key: first.key,
      value: first.latest.value,
      day: first.latest.day,
    };
  }
  if (inputs.labs) {
    return {
      kind: "labs",
      inRange: inputs.labs.inRange,
      total: inputs.labs.withRange,
    };
  }
  if (inputs.cycle?.today) {
    return { kind: "cycleDay", dayOfCycle: inputs.cycle.today.dayOfCycle };
  }
  const screener = inputs.screeners?.[0];
  if (screener) {
    return {
      kind: "screener",
      instrument: screener.instrument,
      score: screener.latest.score,
    };
  }
  return null;
}

/** The topic's slice of the shared read, with blocks it may not show removed. */
export function inputsForTopic(
  def: TopicDefinition,
  inputs: TopicInputs,
  ctx: TopicVisibility,
): TopicInputs {
  const allowed = (extra: "labs" | "training" | "screeners" | "cycle") =>
    def.extras.includes(extra) && isExtraVisible(extra, ctx);
  return {
    series: inputs.series,
    labs: allowed("labs") ? inputs.labs : null,
    training: allowed("training") ? inputs.training : null,
    screeners: allowed("screeners") ? inputs.screeners : null,
    cycle: allowed("cycle") ? inputs.cycle : null,
  };
}

export function buildOverviewEntry(
  def: TopicDefinition,
  inputs: TopicInputs,
  ctx: TopicVisibility,
  todayKey: string,
): TopicOverviewEntry | null {
  const own = inputsForTopic(def, inputs, ctx);
  const signals = buildSignals(visibleSignals(def, ctx), own, todayKey);
  const summary = summarise(signals, own);
  if (summary.code === "empty") return null;
  const headline = headlineOf(signals, own);
  const sparkline =
    headline?.kind === "signal"
      ? windowValues(
          own.series.get(headline.key),
          shiftDateKey(todayKey, -(SPARKLINE_POINTS - 1)),
          todayKey,
        ).map((p) => p.value)
      : [];
  return {
    key: def.key,
    headline,
    summary,
    tone: toneOf(summary, own.labs),
    sparkline,
    recorded: signals.filter((s) => s.latest !== null).length,
    total: signals.length,
  };
}

export function buildOverview(
  offered: readonly TopicKey[],
  hiddenByModule: readonly TopicKey[],
  inputs: TopicInputs,
  ctx: TopicVisibility,
  todayKey: string,
): TopicOverview {
  const topics: TopicOverviewEntry[] = [];
  const empty: TopicKey[] = [];
  for (const key of offered) {
    const entry = buildOverviewEntry(TOPICS[key], inputs, ctx, todayKey);
    if (entry) topics.push(entry);
    else empty.push(key);
  }
  return { topics, empty, hiddenByModule: [...hiddenByModule] };
}

/** First day of the read a topic page needs for its range. */
export function detailReadStart(range: TopicRange, todayKey: string): string {
  const days = Math.max(TOPIC_RANGE_DAYS[range], TOPIC_BASE_WINDOW_DAYS);
  return shiftDateKey(todayKey, -days);
}

export function buildDetail(
  def: TopicDefinition,
  range: TopicRange,
  inputs: TopicInputs,
  ctx: TopicVisibility,
  todayKey: string,
): TopicDetail {
  const own = inputsForTopic(def, inputs, ctx);
  const signalKeys = visibleSignals(def, ctx);
  const signals = buildSignals(signalKeys, own, todayKey);
  const summary = summarise(signals, own);
  const from = shiftDateKey(todayKey, -(TOPIC_RANGE_DAYS[range] - 1));
  const pairFrom = detailReadStart(range, todayKey);

  const series: TopicSeries[] = [];
  for (const key of def.chart) {
    if (!isSignalVisible(key, ctx)) continue;
    const values = own.series.get(key);
    const points = windowValues(values, from, todayKey);
    if (points.length === 0) continue;
    series.push({ key, usual: usualRange(key, values, todayKey), points });
  }

  // A pair shows when both sides may be shown and both hold values: that is
  // when "needs 14 paired days, you have n" tells the reader something. A
  // pair with a switched-off or never-recorded side is not named.
  const relationships = def.relationships
    .filter((rel) => isSignalVisible(rel.x, ctx) && isSignalVisible(rel.y, ctx))
    .filter((rel) => own.series.has(rel.x) && own.series.has(rel.y))
    .map((rel) =>
      computeRelationship(
        rel,
        own.series.get(rel.x),
        own.series.get(rel.y),
        pairFrom,
        todayKey,
      ),
    );

  const trends = signals
    .filter((s) => s.latest !== null)
    .map((s) => computeTrend(s.key, own.series.get(s.key), todayKey));

  const missing = signals.filter((s) => s.latest === null).map((s) => s.key);
  const status =
    summary.code === "empty"
      ? "empty"
      : missing.length > 0
        ? "partial"
        : "ready";

  return {
    key: def.key,
    range,
    from,
    to: todayKey,
    status,
    summary,
    signals,
    series,
    relationships,
    trends,
    missing,
    labs: own.labs,
    training: own.training,
    screeners: own.screeners,
    cycle: own.cycle,
  };
}
