import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeProjectedPayout } from "@/lib/equity";

/**
 * Property 9: Projected payout computation
 *
 * For any equity stake percentage and hypothetical company valuation
 * (both non-negative), the projected payout should equal:
 *   valuation × currentStakePct / 100
 *
 * **Validates: Requirements 7.3**
 */

/** Non-negative stake percentage (0–100) */
const stakePctArb = fc.double({ min: 0, max: 100, noNaN: true });

/** Non-negative valuation (0 to 10 billion) */
const valuationArb = fc.double({ min: 0, max: 10_000_000_000, noNaN: true });

describe("Property 9: Projected payout computation", () => {
  it("payout equals valuation × stakePct / 100 (Req 7.3)", () => {
    fc.assert(
      fc.property(stakePctArb, valuationArb, (stakePct, valuation) => {
        const payout = computeProjectedPayout(stakePct, valuation);
        const expected = valuation * stakePct / 100;
        expect(payout).toBeCloseTo(expected, 5);
      }),
      { numRuns: 100 },
    );
  });

  it("payout is 0 when stake is 0%", () => {
    fc.assert(
      fc.property(valuationArb, (valuation) => {
        const payout = computeProjectedPayout(0, valuation);
        expect(payout).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it("payout is 0 when valuation is 0", () => {
    fc.assert(
      fc.property(stakePctArb, (stakePct) => {
        const payout = computeProjectedPayout(stakePct, 0);
        expect(payout).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it("payout equals valuation when stake is 100%", () => {
    fc.assert(
      fc.property(valuationArb, (valuation) => {
        const payout = computeProjectedPayout(100, valuation);
        expect(payout).toBeCloseTo(valuation, 5);
      }),
      { numRuns: 100 },
    );
  });

  it("payout is non-negative for non-negative inputs", () => {
    fc.assert(
      fc.property(stakePctArb, valuationArb, (stakePct, valuation) => {
        const payout = computeProjectedPayout(stakePct, valuation);
        expect(payout).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });

  it("payout scales linearly with valuation", () => {
    fc.assert(
      fc.property(
        stakePctArb.filter((p) => p > 0),
        valuationArb.filter((v) => v > 0),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        (stakePct, valuation, multiplier) => {
          const payout1 = computeProjectedPayout(stakePct, valuation);
          const payout2 = computeProjectedPayout(stakePct, valuation * multiplier);
          expect(payout2).toBeCloseTo(payout1 * multiplier, 2);
        },
      ),
      { numRuns: 100 },
    );
  });
});
