import { describe, it, expect } from "vitest";
import {
  shiftDateLabel,
  getPreviousDateLabel,
  getTimeZoneDateLabel,
  getDayRangeForTimeZone,
  getScheduledTimeForDate,
} from "./timezone.js";

describe("shiftDateLabel", () => {
  it("shifts forward across a month boundary", () => {
    expect(shiftDateLabel("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("shifts backward across a year boundary", () => {
    expect(shiftDateLabel("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("is a no-op for a zero offset", () => {
    expect(shiftDateLabel("2026-05-15", 0)).toBe("2026-05-15");
  });
});

describe("getPreviousDateLabel", () => {
  it("returns the previous day (non-leap February)", () => {
    expect(getPreviousDateLabel("2026-03-01")).toBe("2026-02-28");
  });
});

describe("getTimeZoneDateLabel", () => {
  it("maps a UTC instant to the local date in Asia/Shanghai (UTC+8)", () => {
    // 2026-05-31T20:00Z -> 2026-06-01 04:00 local
    expect(getTimeZoneDateLabel(new Date("2026-05-31T20:00:00Z"), "Asia/Shanghai")).toBe("2026-06-01");
  });

  it("maps to the previous local date in a negative-offset zone", () => {
    // 2026-05-31T02:00Z -> 2026-05-30 22:00 in America/New_York (EDT, UTC-4)
    expect(getTimeZoneDateLabel(new Date("2026-05-31T02:00:00Z"), "America/New_York")).toBe("2026-05-30");
  });
});

describe("getDayRangeForTimeZone", () => {
  it("returns the 24h UTC range covering one Asia/Shanghai calendar day", () => {
    const { startIso, endIso } = getDayRangeForTimeZone("2026-05-31", "Asia/Shanghai");
    // Local midnight is 16:00Z the previous day (UTC+8).
    expect(startIso).toBe("2026-05-30T16:00:00.000Z");
    expect(endIso).toBe("2026-05-31T16:00:00.000Z");
  });

  it("returns the DST-adjusted UTC range for an America/New_York calendar day", () => {
    const { startIso, endIso } = getDayRangeForTimeZone("2026-03-08", "America/New_York");
    expect(startIso).toBe("2026-03-08T05:00:00.000Z");
    expect(endIso).toBe("2026-03-09T04:00:00.000Z");
  });
});

describe("getScheduledTimeForDate", () => {
  it("computes the UTC instant for a local HH:mm in Asia/Shanghai", () => {
    // 08:00 local on 2026-05-31 == 00:00Z the same day.
    expect(getScheduledTimeForDate("2026-05-31", "08:00", "Asia/Shanghai")).toBe("2026-05-31T00:00:00.000Z");
  });
});
