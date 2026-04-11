import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  computeVestingProgress,
  computeCliffStatus,
  type EquityStake,
} from "@/lib/equity";

/**
 * Property 8: Vesting progress and cliff status
 *
 * For any equity stake and current timestamp:
 *   - Vesting progress = max(0, min(1, (now - vestingStartDate) / (vestingEndDate - vestingStartDate)))
 *   - Cliff status:
 *     - "pre_cliff" with correct daysRemaining when now < cliffDate
 *     - "cliff_passed" when cliffDate ≤ now < vestingEndDate
 *     - "fully_vested" when now ≥ vestingEndDate
 *
 * **Validates: Requirements 6.2, 6.3**
 */

const DAY = 86400;

/**
 * Generate a valid EquityStake with consistent date ordering:
 *   vestingStartDate < cliffDate < vestingEndDate
 */
const stakeArb = fc
  .record({
    vestingStartDate: fc.integer({ min: 1_000_000, max: 2_000_000_000 }),
    cliffOffset: fc.integer({ min: 1 * DAY, max: 730 * DAY }),   // 1 day to 2 years
    vestingOffset: fc.integer({ min: 1 * DAY, max: 1460 * DAY }), // 1 day to 4 years after cliff
  })
  .map(({ vestingStartDate, cliffOffset, vestingOffset }) => {
    const cliffDate = vestingStartDate + cliffOffset;
    const vestingEndDate = cliffDate + vestingOffset;
    return {
      id: "stake-test",
      founderId: "f1",
      initialStakePct: 25.0,
      currentStakePct: 25.0,
      vestingStartDate,
      cliffDate,
      vestingEndDate,
      vestingScheduleMonths: 48,
      updatedAt: vestingStartDate,
    } as EquityStake;
  });

/** Generate a timestamp that can be before, during, or after vesting */
const timestampArb = fc.integer({ min: 0, max: 2_200_000_000 });

describe("Property 8: Vesting progress and cliff status", () => {
  it("vesting progress is clamped to [0.0, 1.0] (Req 6.2)", () => {
    fc.assert(
      fc.property(stakeArb, timestampArb, (stake, now) => {
        const progress = computeVestingProgress(stake, now);
        expect(progress).toBeGreaterThanOrEqual(0.0);
        expect(progress).toBeLessThanOrEqual(1.0);
      }),
      { numRuns: 100 },
    );
  });

  it("vesting progress equals linear formula (Req 6.2)", () => {
    fc.assert(
      fc.property(stakeArb, timestampArb, (stake, now) => {
        const progress = computeVestingProgress(stake, now);
        const totalDuration = stake.vestingEndDate - stake.vestingStartDate;
        const elapsed = now - stake.vestingStartDate;
        const expected = Math.max(0, Math.min(1, elapsed / totalDuration));

        expect(progress).toBeCloseTo(expected, 10);
      }),
      { numRuns: 100 },
    );
  });

  it("progress is 0.0 before vestingStartDate", () => {
    fc.assert(
      fc.property(stakeArb, (stake) => {
        const beforeStart = stake.vestingStartDate - fc.sample(fc.integer({ min: 1, max: 1_000_000 }), 1)[0];
        const progress = computeVestingProgress(stake, beforeStart);
        expect(progress).toBe(0.0);
      }),
      { numRuns: 100 },
    );
  });

  it("progress is 1.0 at or after vestingEndDate", () => {
    fc.assert(
      fc.property(stakeArb, (stake) => {
        const afterEnd = stake.vestingEndDate + fc.sample(fc.integer({ min: 0, max: 1_000_000 }), 1)[0];
        const progress = computeVestingProgress(stake, afterEnd);
        expect(progress).toBe(1.0);
      }),
      { numRuns: 100 },
    );
  });

  it("cliff status is pre_cliff when now < cliffDate (Req 6.3)", () => {
    fc.assert(
      fc.property(stakeArb, (stake) => {
        // Generate a time before cliff
        const beforeCliff = stake.vestingStartDate +
          Math.floor((stake.cliffDate - stake.vestingStartDate) * 0.5);

        if (beforeCliff >= stake.cliffDate) return; // skip edge case

        const result = computeCliffStatus(stake, beforeCliff);
        expect(result.status).toBe("pre_cliff");

        if (result.status === "pre_cliff") {
          const expectedDays = Math.ceil((stake.cliffDate - beforeCliff) / DAY);
          expect(result.daysRemaining).toBe(expectedDays);
          expect(result.daysRemaining).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("cliff status is cliff_passed when cliffDate ≤ now < vestingEndDate (Req 6.3)", () => {
    fc.assert(
      fc.property(stakeArb, (stake) => {
        // Generate a time between cliff and vesting end
        const midpoint = stake.cliffDate +
          Math.floor((stake.vestingEndDate - stake.cliffDate) * 0.5);

        if (midpoint >= stake.vestingEndDate) return; // skip edge case

        const result = computeCliffStatus(stake, midpoint);
        expect(result.status).toBe("cliff_passed");

        if (result.status === "cliff_passed") {
          expect(result.cliffDate).toBe(stake.cliffDate);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("cliff status is fully_vested when now ≥ vestingEndDate (Req 6.3)", () => {
    fc.assert(
      fc.property(stakeArb, (stake) => {
        const afterEnd = stake.vestingEndDate + fc.sample(fc.integer({ min: 0, max: 1_000_000 }), 1)[0];
        const result = computeCliffStatus(stake, afterEnd);
        expect(result.status).toBe("fully_vested");
      }),
      { numRuns: 100 },
    );
  });

  it("daysRemaining in pre_cliff is always positive and uses ceiling", () => {
    fc.assert(
      fc.property(
        stakeArb,
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        (stake, fraction) => {
          // Place now at a fraction of the way from start to cliff
          const now = stake.vestingStartDate +
            Math.floor((stake.cliffDate - stake.vestingStartDate) * fraction);

          if (now >= stake.cliffDate) return;

          const result = computeCliffStatus(stake, now);
          expect(result.status).toBe("pre_cliff");

          if (result.status === "pre_cliff") {
            expect(result.daysRemaining).toBeGreaterThan(0);
            // Verify ceiling: daysRemaining >= actual days remaining
            const exactDays = (stake.cliffDate - now) / DAY;
            expect(result.daysRemaining).toBe(Math.ceil(exactDays));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
