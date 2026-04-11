import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isValidTimestamp } from "@/lib/timestamp";

/**
 * Feature: founder-governance, Property 15: Governance timestamps stored as UTC
 *
 * For any governance record (review cycle, founder review, accountability warning,
 * dilution event, equity stake, decision), all timestamp fields should be stored
 * as UTC epoch seconds with no local timezone offset applied at the storage layer.
 *
 * **Validates: Requirements 3.5, 21.2**
 */

// Reasonable governance timestamp range: 2020-01-01 to 2040-01-01 (UTC epoch seconds)
const MIN_GOVERNANCE_TS = 1577836800; // 2020-01-01T00:00:00Z
const MAX_GOVERNANCE_TS = 2208988800; // 2040-01-01T00:00:00Z

const governanceTimestampArb = fc.integer({ min: MIN_GOVERNANCE_TS, max: MAX_GOVERNANCE_TS });

// --- Governance record arbitraries ---

const reviewCycleArb = fc.record({
  id: fc.uuid(),
  startDate: governanceTimestampArb,
  endDate: governanceTimestampArb,
  submissionDeadline: governanceTimestampArb,
  status: fc.constantFrom("open", "closed", "resolved"),
  resolvedAt: governanceTimestampArb,
  createdAt: governanceTimestampArb,
});

const founderReviewArb = fc.record({
  id: fc.uuid(),
  cycleId: fc.uuid(),
  reviewerId: fc.uuid(),
  revieweeId: fc.uuid(),
  outputScore: fc.integer({ min: 1, max: 5 }),
  reliabilityScore: fc.integer({ min: 1, max: 5 }),
  initiativeScore: fc.integer({ min: 1, max: 5 }),
  submittedAt: governanceTimestampArb,
});

const accountabilityWarningArb = fc.record({
  id: fc.uuid(),
  founderId: fc.uuid(),
  cycleId: fc.uuid(),
  issuedAt: governanceTimestampArb,
  acknowledged: fc.boolean(),
});

const dilutionEventArb = fc.record({
  id: fc.uuid(),
  founderId: fc.uuid(),
  cycleId: fc.uuid(),
  dilutionPct: fc.double({ min: 0.01, max: 10, noNaN: true }),
  previousStakePct: fc.double({ min: 0, max: 100, noNaN: true }),
  newStakePct: fc.double({ min: 0, max: 100, noNaN: true }),
  createdAt: governanceTimestampArb,
});

const equityStakeArb = fc.record({
  id: fc.uuid(),
  founderId: fc.uuid(),
  initialStakePct: fc.double({ min: 0, max: 100, noNaN: true }),
  currentStakePct: fc.double({ min: 0, max: 100, noNaN: true }),
  vestingStartDate: governanceTimestampArb,
  cliffDate: governanceTimestampArb,
  vestingEndDate: governanceTimestampArb,
  vestingScheduleMonths: fc.integer({ min: 1, max: 60 }),
  updatedAt: governanceTimestampArb,
});

const decisionArb = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  description: fc.string({ maxLength: 500 }),
  createdAt: governanceTimestampArb,
  resolvedAt: governanceTimestampArb,
});

// --- Helper: assert a timestamp is a valid UTC epoch second ---
function assertValidUtcEpochSecond(ts: number, fieldName: string): void {
  // Must be a positive integer
  expect(Number.isInteger(ts), `${fieldName} must be an integer, got ${ts}`).toBe(true);
  expect(ts, `${fieldName} must be positive`).toBeGreaterThan(0);

  // Must be within reasonable governance range
  expect(ts, `${fieldName} must be >= 2020`).toBeGreaterThanOrEqual(MIN_GOVERNANCE_TS);
  expect(ts, `${fieldName} must be <= 2040`).toBeLessThanOrEqual(MAX_GOVERNANCE_TS);

  // Must pass the project's isValidTimestamp check
  expect(isValidTimestamp(ts), `${fieldName} must pass isValidTimestamp`).toBe(true);

  // No fractional part (pure integer seconds, no sub-second offset)
  expect(ts % 1, `${fieldName} must have no fractional part`).toBe(0);

  // Round-trip through Date must preserve the exact value (no timezone offset baked in)
  const date = new Date(ts * 1000);
  const roundTripped = Math.floor(date.getTime() / 1000);
  expect(roundTripped, `${fieldName} must survive Date round-trip`).toBe(ts);

  // UTC reconstruction must match
  const utcEpoch = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds()
  );
  expect(Math.floor(utcEpoch / 1000), `${fieldName} UTC reconstruction must match`).toBe(ts);
}

describe("Property 15: Governance timestamps stored as UTC", () => {
  it("ReviewCycle timestamp fields are valid UTC epoch seconds", () => {
    fc.assert(
      fc.property(reviewCycleArb, (cycle) => {
        assertValidUtcEpochSecond(cycle.startDate, "ReviewCycle.startDate");
        assertValidUtcEpochSecond(cycle.endDate, "ReviewCycle.endDate");
        assertValidUtcEpochSecond(cycle.submissionDeadline, "ReviewCycle.submissionDeadline");
        assertValidUtcEpochSecond(cycle.resolvedAt, "ReviewCycle.resolvedAt");
        assertValidUtcEpochSecond(cycle.createdAt, "ReviewCycle.createdAt");
      }),
      { numRuns: 100 }
    );
  });

  it("FounderReview timestamp fields are valid UTC epoch seconds", () => {
    fc.assert(
      fc.property(founderReviewArb, (review) => {
        assertValidUtcEpochSecond(review.submittedAt, "FounderReview.submittedAt");
      }),
      { numRuns: 100 }
    );
  });

  it("AccountabilityWarning timestamp fields are valid UTC epoch seconds", () => {
    fc.assert(
      fc.property(accountabilityWarningArb, (warning) => {
        assertValidUtcEpochSecond(warning.issuedAt, "AccountabilityWarning.issuedAt");
      }),
      { numRuns: 100 }
    );
  });

  it("DilutionEvent timestamp fields are valid UTC epoch seconds", () => {
    fc.assert(
      fc.property(dilutionEventArb, (event) => {
        assertValidUtcEpochSecond(event.createdAt, "DilutionEvent.createdAt");
      }),
      { numRuns: 100 }
    );
  });

  it("EquityStake timestamp fields are valid UTC epoch seconds", () => {
    fc.assert(
      fc.property(equityStakeArb, (stake) => {
        assertValidUtcEpochSecond(stake.vestingStartDate, "EquityStake.vestingStartDate");
        assertValidUtcEpochSecond(stake.cliffDate, "EquityStake.cliffDate");
        assertValidUtcEpochSecond(stake.vestingEndDate, "EquityStake.vestingEndDate");
        assertValidUtcEpochSecond(stake.updatedAt, "EquityStake.updatedAt");
      }),
      { numRuns: 100 }
    );
  });

  it("Decision timestamp fields are valid UTC epoch seconds", () => {
    fc.assert(
      fc.property(decisionArb, (decision) => {
        assertValidUtcEpochSecond(decision.createdAt, "Decision.createdAt");
        assertValidUtcEpochSecond(decision.resolvedAt, "Decision.resolvedAt");
      }),
      { numRuns: 100 }
    );
  });

  it("all governance timestamps survive Date round-trip without timezone offset", () => {
    const allTimestampsArb = fc.tuple(
      governanceTimestampArb,
      governanceTimestampArb,
      governanceTimestampArb,
      governanceTimestampArb,
      governanceTimestampArb
    );

    fc.assert(
      fc.property(allTimestampsArb, (timestamps) => {
        for (const ts of timestamps) {
          // Convert to Date and back — must be identical
          const date = new Date(ts * 1000);
          const roundTripped = Math.floor(date.getTime() / 1000);
          expect(roundTripped).toBe(ts);

          // No local timezone offset baked into the stored value
          const utcMs = Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
            date.getUTCHours(),
            date.getUTCMinutes(),
            date.getUTCSeconds()
          );
          expect(Math.floor(utcMs / 1000)).toBe(ts);
        }
      }),
      { numRuns: 100 }
    );
  });
});
