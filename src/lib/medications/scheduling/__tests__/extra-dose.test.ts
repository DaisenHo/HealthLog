/**
 * An extra dose next to a slot that already carries one.
 *
 * Two ends: the write path keeps a different external dose record off a slot
 * that is already taken (`isAnotherDose`), and the read ledger lets the dose
 * stored on the slot claim it before an extra one stored on its own instant,
 * whatever order the rows were read in.
 */
import { describe, expect, it } from "vitest";

import { buildSlotBands, type SlotWindowInput } from "../attribution";
import { reconstructDoseHistory, type HistoryIntake } from "../dose-history";
import { SAME_DOSE_TOLERANCE_MS, isAnotherDose } from "../slot-upsert";

const MIN = 60_000;
const t0 = new Date("2026-06-09T20:00:00Z");
const plus = (minutes: number) => new Date(t0.getTime() + minutes * MIN);

describe("isAnotherDose", () => {
  it("a slot with nothing taken is never held by another dose", () => {
    expect(
      isAnotherDose(
        { takenAt: null, externalId: null },
        { takenAt: plus(600), externalId: "hk-2" },
      ),
    ).toBe(false);
  });

  it("the same external record is the same dose", () => {
    expect(
      isAnotherDose(
        { takenAt: t0, externalId: "hk-1" },
        { takenAt: plus(600), externalId: "hk-1" },
      ),
    ).toBe(false);
  });

  it("two external records a day apart are two doses", () => {
    expect(
      isAnotherDose(
        { takenAt: t0, externalId: "hk-1" },
        { takenAt: plus(24 * 60 + 22), externalId: "hk-2" },
      ),
    ).toBe(true);
  });

  it("two external records within a minute are one dose entered twice", () => {
    expect(
      isAnotherDose(
        { takenAt: t0, externalId: "hk-1" },
        { takenAt: new Date(t0.getTime() + 30_000), externalId: "hk-2" },
      ),
    ).toBe(false);
  });

  it("a take with no external record merges within the tolerance only", () => {
    const held = { takenAt: t0, externalId: null };
    expect(
      isAnotherDose(held, {
        takenAt: new Date(t0.getTime() + SAME_DOSE_TOLERANCE_MS),
        externalId: "hk-2",
      }),
    ).toBe(false);
    expect(isAnotherDose(held, { takenAt: plus(30), externalId: "hk-2" })).toBe(
      true,
    );
  });
});

describe("reconstructDoseHistory: the slot's own dose claims the slot", () => {
  const slot: SlotWindowInput = {
    at: t0,
    timeOfDay: "22:00",
    onTimeStart: plus(-60),
    onTimeEnd: plus(60),
    lateGraceMs: 180 * MIN,
  };
  const bands = buildSlotBands([slot]);
  const onSlot: HistoryIntake = {
    id: "on-slot",
    scheduledFor: t0,
    takenAt: plus(5),
    skipped: false,
  };
  const extra: HistoryIntake = {
    id: "extra",
    scheduledFor: plus(30),
    takenAt: plus(30),
    skipped: false,
  };

  it.each([
    ["slot row first", [onSlot, extra]],
    ["extra row first (newest scheduledFor first)", [extra, onSlot]],
  ])("%s", (_label, intakes) => {
    const rows = reconstructDoseHistory(bands, intakes, plus(600), null);
    const slotRow = rows.find((row) => row.kind === "slot");
    const adHoc = rows.filter((row) => row.kind === "ad_hoc");
    expect(slotRow?.intake?.id).toBe("on-slot");
    expect(adHoc.map((row) => row.intake?.id)).toEqual(["extra"]);
  });

  it("among takes not stored on the slot, the nearer one claims it", () => {
    const far: HistoryIntake = { ...extra, id: "far" };
    const near: HistoryIntake = {
      id: "near",
      scheduledFor: plus(10),
      takenAt: plus(10),
      skipped: false,
    };
    const rows = reconstructDoseHistory(bands, [far, near], plus(600), null);
    expect(rows.find((row) => row.kind === "slot")?.intake?.id).toBe("near");
  });
});
