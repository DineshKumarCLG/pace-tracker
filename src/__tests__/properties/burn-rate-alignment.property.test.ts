import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeBurnRateAlignment } from "@/lib/startupHealth";

/**
 * Property 14: Burn rate alignment and thresholds
 *
 * For any actual monthly spend and planned monthly budget (both positive), the burn
 * rate alignment should equal (actual / planned) × 100. The status should be "red"
 * when alignment > 130, "amber" when 110 < alignment ≤ 130, and "normal" when
 * alignment ≤ 110.
 *
 * **Validates: Requirements 14.3, 14.4, 14.5**
 */

// --- Helpers ---

function roundTo1(n: number): number {
  return Math.round(n * 10) / 10;
}

// --- Arbitraries ---

const positiveAmountArb = fc.double({
  min: 0.01,
  max: 10_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

// --- Property Tests ---

describe("Property 14: Burn rate alignment and thresholds", () => {
  it("pct equals (actual / planned) × 100 for positive values (Req 14.3)", () => {
    fc.assert(
      fc.property(
        positiveAmountArb,
        positiveAmountArb,
        (actualSpend, plannedBudget) => {
          const result = computeBurnRateAlignment(actualSpend, plannedBudget);
          const expected = roundTo1((actualSpend / plannedBudget) * 100);

          expect(result.pct).toBeCloseTo(expected, 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("status is 'red' when alignment > 130% (Req 14.5)", () => {
    fc.assert(
      fc.property(
        positiveAmountArb,
        (plannedBudget) => {
          // Set actual to > 130% of planned
          const actualSpend = plannedBudget * 1.35;
          const result = computeBurnRateAlignment(actualSpend, plannedBudget);

          expect(result.pct).toBeGreaterThan(130);
          expect(result.status).toBe("red");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("status is 'amber' when 110% < alignment ≤ 130% (Req 14.4)", () => {
    fc.assert(
      fc.property(
        positiveAmountArb,
        (plannedBudget) => {
          // Set actual to 120% of planned (between 110 and 130)
          const actualSpend = plannedBudget * 1.2;
          const result = computeBurnRateAlignment(actualSpend, plannedBudget);

          expect(result.pct).toBeGreaterThan(110);
          expect(result.pct).toBeLessThanOrEqual(130);
          expect(result.status).toBe("amber");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("status is 'normal' when alignment ≤ 110% (Req 14.3)", () => {
    fc.assert(
      fc.property(
        positiveAmountArb,
        (plannedBudget) => {
          // Set actual to 100% of planned
          const actualSpend = plannedBudget * 1.0;
          const result = computeBurnRateAlignment(actualSpend, plannedBudget);

          expect(result.pct).toBeLessThanOrEqual(110);
          expect(result.status).toBe("normal");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("threshold classification is consistent with pct value (Req 14.3, 14.4, 14.5)", () => {
    fc.assert(
      fc.property(
        positiveAmountArb,
        positiveAmountArb,
        (actualSpend, plannedBudget) => {
          const result = computeBurnRateAlignment(actualSpend, plannedBudget);

          if (result.pct > 130) {
            expect(result.status).toBe("red");
          } else if (result.pct > 110) {
            expect(result.status).toBe("amber");
          } else {
            expect(result.status).toBe("normal");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("pct is always >= 0 for non-negative inputs (Req 14.3)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10_000_000, noNaN: true, noDefaultInfinity: true }),
        positiveAmountArb,
        (actualSpend, plannedBudget) => {
          const result = computeBurnRateAlignment(actualSpend, plannedBudget);
          expect(result.pct).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("exactly 110% is 'normal', not 'amber' (Req 14.4 boundary)", () => {
    fc.assert(
      fc.property(
        positiveAmountArb,
        (plannedBudget) => {
          const actualSpend = plannedBudget * 1.1;
          const result = computeBurnRateAlignment(actualSpend, plannedBudget);

          // 110% should be normal (amber is > 110)
          expect(result.status).toBe("normal");
        },
      ),
      { numRuns: 100 },
    );
  });
});
