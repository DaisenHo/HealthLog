/**
 * v1.44 — screener change measured against the size studies treat as
 * meaningful, instead of the last score on its own.
 *
 * A difference between two administrations is only worth naming when it is
 * at least the instrument's minimal clinically important difference, which
 * the primary literature puts at:
 *
 *   - PHQ-9: 5 points (Löwe, Unützer, Callahan, Perkins & Kroenke 2004,
 *     Med Care 42(12):1194–1201).
 *   - GAD-7: 4 points (Toussaint, Hüsing, Gumz et al. 2020, J Affect Disord
 *     265:395–401).
 *   - WHO-5: 10 points on the 0–100 percentage scale (Topp, Østergaard,
 *     Søndergaard & Bech 2015, Psychother Psychosom 84(3):167–176).
 *
 * A change below the threshold reads as "within the threshold", not as
 * better or worse; a change at or beyond it reads in the instrument's own
 * direction (lower is better on PHQ-9 / GAD-7, higher on WHO-5). This is a
 * description of the person's own scores, never a diagnosis and never a
 * treatment response; the SCI has no published threshold of this kind and
 * gets no trend. Pure; the read lives in the assessments route.
 */
import {
  INSTRUMENTS,
  type InstrumentId,
} from "@/lib/mental-health/instruments";

export const MEANINGFUL_CHANGE: Readonly<
  Partial<Record<InstrumentId, number>>
> = {
  PHQ9: 5,
  GAD7: 4,
  WHO5: 10,
};

export const TREND_INSTRUMENTS = Object.keys(
  MEANINGFUL_CHANGE,
) as InstrumentId[];

export type ChangeVerdict = "improved" | "worsened" | "within_threshold";

export interface ScorePoint {
  score: number;
  takenAt: string;
}

export interface AssessmentTrend {
  instrument: InstrumentId;
  /** Administrations of this instrument on record. */
  n: number;
  /** The meaningful-change threshold, in the instrument's reported points. */
  threshold: number;
  higherIsBetter: boolean;
  first: ScorePoint;
  previous: ScorePoint | null;
  latest: ScorePoint;
  /** latest − previous; null with one administration. */
  changeFromPrevious: number | null;
  /** latest − first; null with one administration. */
  changeFromFirst: number | null;
  sincePrevious: ChangeVerdict | null;
  sinceFirst: ChangeVerdict | null;
}

/** Classify a signed change against the threshold in the instrument's direction. */
export function verdictForChange(
  delta: number,
  threshold: number,
  higherIsBetter: boolean,
): ChangeVerdict {
  if (Math.abs(delta) < threshold) return "within_threshold";
  return delta > 0 === higherIsBetter ? "improved" : "worsened";
}

/**
 * One trend per instrument that has a threshold and at least one
 * administration, in the instrument order. Rows may arrive in any order;
 * they are ordered by `takenAt`, then `id`.
 */
export function computeAssessmentTrends(
  rows: ReadonlyArray<{
    id: string;
    instrument: string;
    totalScore: number;
    takenAt: Date;
  }>,
): AssessmentTrend[] {
  const out: AssessmentTrend[] = [];
  for (const instrument of TREND_INSTRUMENTS) {
    const threshold = MEANINGFUL_CHANGE[instrument] as number;
    const series = rows
      .filter(
        (r) => r.instrument === instrument && Number.isFinite(r.totalScore),
      )
      .sort(
        (a, b) =>
          a.takenAt.getTime() - b.takenAt.getTime() || (a.id < b.id ? -1 : 1),
      );
    if (series.length === 0) continue;
    const { higherIsBetter } = INSTRUMENTS[instrument];
    const point = (r: (typeof series)[number]): ScorePoint => ({
      score: r.totalScore,
      takenAt: r.takenAt.toISOString(),
    });
    const latest = series[series.length - 1];
    const previous = series.length > 1 ? series[series.length - 2] : null;
    const first = series[0];
    const changeFromPrevious = previous
      ? latest.totalScore - previous.totalScore
      : null;
    const changeFromFirst =
      series.length > 1 ? latest.totalScore - first.totalScore : null;
    out.push({
      instrument,
      n: series.length,
      threshold,
      higherIsBetter,
      first: point(first),
      previous: previous ? point(previous) : null,
      latest: point(latest),
      changeFromPrevious,
      changeFromFirst,
      sincePrevious:
        changeFromPrevious === null
          ? null
          : verdictForChange(changeFromPrevious, threshold, higherIsBetter),
      sinceFirst:
        changeFromFirst === null
          ? null
          : verdictForChange(changeFromFirst, threshold, higherIsBetter),
    });
  }
  return out;
}
