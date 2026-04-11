import { describe, it, expect } from "vitest";
import {
  shouldCreateNewCycle,
  getSubmissionDeadline,
  isCycleExpired,
  CYCLE_INTERVAL_DAYS,
  SUBMISSION_WINDOW_HOURS,
} from "@/lib/reviewScheduler";

const DAY = 24 * 3600;
const HOUR = 3600;

describe("shouldCreateNewCycle", () => {
  const featureEnabled = 1_700_000_000; // arbitrary UTC timestamp

  it("returns true when no previous cycle and 14+ days since feature enabled", () => {
    const now = featureEnabled + CYCLE_INTERVAL_DAYS * DAY;
    expect(shouldCreateNewCycle(null, featureEnabled, now)).toBe(true);
  });

  it("returns false when no previous cycle and less than 14 days since feature enabled", () => {
    const now = featureEnabled + 13 * DAY;
    expect(shouldCreateNewCycle(null, featureEnabled, now)).toBe(false);
  });

  it("returns true when 14+ days since last cycle start", () => {
    const lastCycle = featureEnabled + 14 * DAY;
    const now = lastCycle + 14 * DAY;
    expect(shouldCreateNewCycle(lastCycle, featureEnabled, now)).toBe(true);
  });

  it("returns false when less than 14 days since last cycle start", () => {
    const lastCycle = featureEnabled + 14 * DAY;
    const now = lastCycle + 13 * DAY + 23 * HOUR;
    expect(shouldCreateNewCycle(lastCycle, featureEnabled, now)).toBe(false);
  });

  it("uses lastCycleStartDate over featureEnabledDate when both provided", () => {
    const lastCycle = featureEnabled + 100 * DAY;
    // 14 days from lastCycle but way past featureEnabled
    const now = lastCycle + 14 * DAY;
    expect(shouldCreateNewCycle(lastCycle, featureEnabled, now)).toBe(true);

    // Less than 14 days from lastCycle
    const nowEarly = lastCycle + 10 * DAY;
    expect(shouldCreateNewCycle(lastCycle, featureEnabled, nowEarly)).toBe(false);
  });

  it("returns true at exactly 14 days boundary", () => {
    const now = featureEnabled + 14 * DAY;
    expect(shouldCreateNewCycle(null, featureEnabled, now)).toBe(true);
  });

  it("returns false one second before 14 days", () => {
    const now = featureEnabled + 14 * DAY - 1;
    expect(shouldCreateNewCycle(null, featureEnabled, now)).toBe(false);
  });
});

describe("getSubmissionDeadline", () => {
  it("returns startDate + 48 hours", () => {
    const start = 1_700_000_000;
    expect(getSubmissionDeadline(start)).toBe(start + SUBMISSION_WINDOW_HOURS * HOUR);
  });

  it("returns correct value for different start dates", () => {
    const start = 1_600_000_000;
    expect(getSubmissionDeadline(start)).toBe(start + 48 * HOUR);
  });
});

describe("isCycleExpired", () => {
  const deadline = 1_700_000_000;

  it("returns true when past deadline and status is open", () => {
    expect(isCycleExpired({ submissionDeadline: deadline, status: "open" }, deadline + 1)).toBe(true);
  });

  it("returns false when before deadline and status is open", () => {
    expect(isCycleExpired({ submissionDeadline: deadline, status: "open" }, deadline - 1)).toBe(false);
  });

  it("returns false at exactly the deadline", () => {
    expect(isCycleExpired({ submissionDeadline: deadline, status: "open" }, deadline)).toBe(false);
  });

  it("returns false when past deadline but status is closed", () => {
    expect(isCycleExpired({ submissionDeadline: deadline, status: "closed" }, deadline + 1)).toBe(false);
  });

  it("returns false when past deadline but status is resolved", () => {
    expect(isCycleExpired({ submissionDeadline: deadline, status: "resolved" }, deadline + 1)).toBe(false);
  });

  it("returns false when before deadline and status is closed", () => {
    expect(isCycleExpired({ submissionDeadline: deadline, status: "closed" }, deadline - 1)).toBe(false);
  });
});
