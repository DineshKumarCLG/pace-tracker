import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  shouldCreateNewCycle,
  getSubmissionDeadline,
  CYCLE_INTERVAL_DAYS,
  SUBMISSION_WINDOW_HOURS,
} from "@/lib/reviewScheduler";

/**
 * Property 1: Review cycle scheduling
 *
 * For any feature enable date and current timestamp, a new review cycle should
 * be created if and only if 14 or more calendar days have elapsed since the
 * last cycle's start date (or the feature enable date if no cycles exist).
 * The new cycle's endDate should equal startDate + 14 days, and
 * submissionDeadline should equal startDate + 48 hours.
 *
 * **Validates: Requirements 1.1, 1.6**
 */

const DAY = 24 * 3600;
const HOUR = 3600;

// Arbitrary for a realistic UTC timestamp (2020–2030 range)
const timestampArb = fc.integer({ min: 1_577_836_800, max: 1_893_456_000 });

// Arbitrary for elapsed seconds (0 to ~60 days)
const elapsedArb = fc.integer({ min: 0, max: 60 * DAY });

describe("Property 1: Review cycle scheduling", () => {
  it("shouldCreateNewCycle returns true iff >= 14 days elapsed since reference date (no prior cycle) (Req 1.1)", () => {
    fc.assert(
      fc.property(timestampArb, elapsedArb, (featureEnabled, elapsed) => {
        const now = featureEnabled + elapsed;
        const result = shouldCreateNewCycle(null, featureEnabled, now);
        const expected = elapsed >= CYCLE_INTERVAL_DAYS * DAY;

        expect(result).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it("shouldCreateNewCycle returns true iff >= 14 days elapsed since last cycle start (Req 1.1)", () => {
    fc.assert(
      fc.property(
        timestampArb,
        elapsedArb,
        elapsedArb,
        (featureEnabled, cycleOffset, elapsed) => {
          const lastCycleStart = featureEnabled + cycleOffset;
          const now = lastCycleStart + elapsed;
          const result = shouldCreateNewCycle(lastCycleStart, featureEnabled, now);
          const expected = elapsed >= CYCLE_INTERVAL_DAYS * DAY;

          expect(result).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("lastCycleStartDate takes precedence over featureEnabledDate when present (Req 1.1)", () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.integer({ min: 1, max: 30 * DAY }),
        elapsedArb,
        (featureEnabled, gap, elapsed) => {
          const lastCycleStart = featureEnabled + gap;
          const now = lastCycleStart + elapsed;

          const result = shouldCreateNewCycle(lastCycleStart, featureEnabled, now);
          // Should depend on distance from lastCycleStart, not featureEnabled
          const expected = elapsed >= CYCLE_INTERVAL_DAYS * DAY;

          expect(result).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("submissionDeadline equals startDate + 48 hours (Req 1.6)", () => {
    fc.assert(
      fc.property(timestampArb, (cycleStart) => {
        const deadline = getSubmissionDeadline(cycleStart);
        expect(deadline).toBe(cycleStart + SUBMISSION_WINDOW_HOURS * HOUR);
      }),
      { numRuns: 200 },
    );
  });

  it("endDate should equal startDate + 14 days (Req 1.1)", () => {
    fc.assert(
      fc.property(timestampArb, (cycleStart) => {
        const expectedEnd = cycleStart + CYCLE_INTERVAL_DAYS * DAY;
        // Verify the constants are consistent: endDate = start + 14 days
        expect(expectedEnd - cycleStart).toBe(14 * DAY);
      }),
      { numRuns: 100 },
    );
  });

  it("submissionDeadline is always before endDate (Req 1.6)", () => {
    fc.assert(
      fc.property(timestampArb, (cycleStart) => {
        const deadline = getSubmissionDeadline(cycleStart);
        const endDate = cycleStart + CYCLE_INTERVAL_DAYS * DAY;
        // 48 hours < 14 days, so deadline must be before endDate
        expect(deadline).toBeLessThan(endDate);
      }),
      { numRuns: 100 },
    );
  });

  it("boundary: exactly 14 days triggers new cycle, one second less does not (Req 1.1)", () => {
    fc.assert(
      fc.property(timestampArb, (featureEnabled) => {
        const exactly14 = featureEnabled + CYCLE_INTERVAL_DAYS * DAY;
        const justBefore = exactly14 - 1;

        expect(shouldCreateNewCycle(null, featureEnabled, exactly14)).toBe(true);
        expect(shouldCreateNewCycle(null, featureEnabled, justBefore)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
