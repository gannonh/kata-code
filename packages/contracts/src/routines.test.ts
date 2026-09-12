import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { RoutineError, ScheduleTrigger, previewRoutineSchedule } from "./routines.ts";

const decodeTrigger = Schema.decodeUnknownSync(ScheduleTrigger);
const testDate = (iso: string) => DateTime.toDateUtc(DateTime.makeUnsafe(iso));

describe("scheduled routine schedules", () => {
  it("builds a five-field expression and three upcoming local occurrences", () => {
    const trigger = decodeTrigger({
      kind: "weekdays",
      time: "09:30",
      timezone: "America/Los_Angeles",
    });
    const preview = previewRoutineSchedule(trigger, testDate("2026-01-01T00:00:00.000Z"));

    expect(preview.expression).toBe("30 9 * * 1-5");
    expect(preview.dates).toHaveLength(3);
    expect(
      preview.dates.every((date) => Number.isFinite(DateTime.makeUnsafe(date).epochMilliseconds)),
    ).toBe(true);
  });

  it("uses the timezone rules when a preview crosses daylight saving time", () => {
    const trigger = decodeTrigger({
      kind: "daily",
      time: "01:30",
      timezone: "America/Los_Angeles",
    });
    const preview = previewRoutineSchedule(trigger, testDate("2026-03-07T12:00:00.000Z"));

    const utcHour = (iso: string) =>
      Math.floor(DateTime.makeUnsafe(iso).epochMilliseconds / 3_600_000) % 24;
    expect(utcHour(preview.dates[0]!)).not.toBe(utcHour(preview.dates[2]!));
  });

  it("rejects invalid zones and cron shapes at the contract boundary", () => {
    expect(() =>
      previewRoutineSchedule(
        decodeTrigger({ kind: "daily", time: "09:00", timezone: "Mars/Olympus" }),
        testDate("2026-01-01T00:00:00.000Z"),
      ),
    ).toThrow(RoutineError);
    expect(() =>
      previewRoutineSchedule(
        decodeTrigger({ kind: "cron", expression: "0 9 * * * *", timezone: "UTC" }),
        testDate("2026-01-01T00:00:00.000Z"),
      ),
    ).toThrow(RoutineError);
  });
});
