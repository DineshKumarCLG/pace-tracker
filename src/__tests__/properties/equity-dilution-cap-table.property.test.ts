import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  applyDilution,
  validateCapTableSum,
  type EquityStake,
} from "@/lib/equity";

/**
 * Property 7: Equity dilution preserves cap table sum
 *
 * For any set of equity stakes summing to 100% and any dilution event reducing
 * one founder's stake by a given percentage, after applying the dilution with
 * proportional redistribution among remaining founders:
 *   - The sum of all stakes should remain within 0.01% of 100%
 *   - The target founder's stake should decrease by exactly the dilution percentage
 *   - Each other founder's increase should be proportional to their share of remaining equity
 *
 * **Validates: Requirements 6.5, 21.4**
 */

const DAY = 86400;
const BASE_TIME = 1700000000;

/** Generate a valid EquityStake */
function makeStake(founderId: string, currentStakePct: number): EquityStake {
  return {
    id: `stake-${founderId}`,
    founderId,
    initialStakePct: currentStakePct,
    currentStakePct,
    vestingStartDate: BASE_TIME,
    cliffDate: BASE_TIME + 365 * DAY,
    vestingEndDate: BASE_TIME + 4 * 365 * DAY,
    vestingScheduleMonths: 48,
    updatedAt: BASE_TIME,
  };
}

/**
 * Generate 2–5 founders with stakes that sum to exactly 100%.
 * We generate N-1 random percentages and compute the last one as the remainder.
 */
const stakesArb = fc
  .integer({ min: 2, max: 5 })
  .chain((count) =>
    fc
      .array(fc.double({ min: 1, max: 90, noNaN: true }), {
        minLength: count - 1,
        maxLength: count - 1,
      })
      .map((pcts) => {
        // Normalize so they sum to less than 100, then compute last
        const total = pcts.reduce((a, b) => a + b, 0);
        const scale = total > 99 ? 98 / total : 1;
        const scaled = pcts.map((p) => p * scale);
        const last = 100 - scaled.reduce((a, b) => a + b, 0);
        const allPcts = [...scaled, last];
        return allPcts.map((pct, i) => makeStake(`f${i}`, pct));
      })
      .filter((stakes) => {
        // Ensure all stakes are positive and sum is valid
        return stakes.every((s) => s.currentStakePct > 0.5) && validateCapTableSum(stakes);
      }),
  );

/** Generate a dilution percentage between 0.1 and 5.0 */
const dilutionPctArb = fc.double({ min: 0.1, max: 5.0, noNaN: true });

describe("Property 7: Equity dilution preserves cap table sum", () => {
  it("cap table sum remains within 0.01% of 100% after dilution (Req 6.5, 21.4)", () => {
    fc.assert(
      fc.property(stakesArb, dilutionPctArb, (stakes, dilutionPct) => {
        // Pick a random target (first founder)
        const targetId = stakes[0].founderId;

        // Only dilute if target has enough stake
        if (stakes[0].currentStakePct <= dilutionPct) return;

        const { updatedStakes } = applyDilution(stakes, targetId, dilutionPct);
        const sum = updatedStakes.reduce((acc, s) => acc + s.currentStakePct, 0);

        expect(Math.abs(sum - 100.0)).toBeLessThanOrEqual(0.01);
        expect(validateCapTableSum(updatedStakes)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("target founder's stake decreases by exactly dilutionPct (Req 6.5)", () => {
    fc.assert(
      fc.property(stakesArb, dilutionPctArb, (stakes, dilutionPct) => {
        const targetId = stakes[0].founderId;
        const originalPct = stakes[0].currentStakePct;

        if (originalPct <= dilutionPct) return;

        const { updatedStakes } = applyDilution(stakes, targetId, dilutionPct);
        const target = updatedStakes.find((s) => s.founderId === targetId)!;

        expect(target.currentStakePct).toBeCloseTo(originalPct - dilutionPct, 10);
      }),
      { numRuns: 100 },
    );
  });

  it("redistribution among others is proportional to their share (Req 6.5)", () => {
    fc.assert(
      fc.property(stakesArb, dilutionPctArb, (stakes, dilutionPct) => {
        const targetId = stakes[0].founderId;

        if (stakes[0].currentStakePct <= dilutionPct) return;

        const others = stakes.filter((s) => s.founderId !== targetId);
        const othersTotal = others.reduce((sum, s) => sum + s.currentStakePct, 0);

        const { updatedStakes } = applyDilution(stakes, targetId, dilutionPct);

        for (const original of others) {
          const updated = updatedStakes.find((s) => s.founderId === original.founderId)!;
          const expectedShare = (original.currentStakePct / othersTotal) * dilutionPct;
          const actualIncrease = updated.currentStakePct - original.currentStakePct;

          expect(actualIncrease).toBeCloseTo(expectedShare, 8);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("all stakes remain non-negative after dilution", () => {
    fc.assert(
      fc.property(stakesArb, dilutionPctArb, (stakes, dilutionPct) => {
        const targetId = stakes[0].founderId;

        if (stakes[0].currentStakePct <= dilutionPct) return;

        const { updatedStakes } = applyDilution(stakes, targetId, dilutionPct);

        for (const s of updatedStakes) {
          expect(s.currentStakePct).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("DilutionEvent records correct previous and new stakes", () => {
    fc.assert(
      fc.property(stakesArb, dilutionPctArb, (stakes, dilutionPct) => {
        const targetId = stakes[0].founderId;
        const originalPct = stakes[0].currentStakePct;

        if (originalPct <= dilutionPct) return;

        const { event } = applyDilution(stakes, targetId, dilutionPct);

        expect(event.founderId).toBe(targetId);
        expect(event.dilutionPct).toBe(dilutionPct);
        expect(event.previousStakePct).toBe(originalPct);
        expect(event.newStakePct).toBeCloseTo(originalPct - dilutionPct, 10);
      }),
      { numRuns: 100 },
    );
  });
});
