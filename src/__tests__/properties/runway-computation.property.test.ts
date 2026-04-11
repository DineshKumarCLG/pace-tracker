import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeRunway, type StartupHealthConfig } from "@/lib/startupHealth";

/**
 * Property 11: Runway computation and thresholds
 *
 * For any cash balance and array of 1–3 monthly expense values, the runway in months
 * should equal cashBalance / mean(monthlyExpenses). The status should be "red" when
 * runway < 3, "amber" when 3 ≤ runway < 6, and "normal" when runway ≥ 6. When all
 * expenses are 0, runway should be treated as infinite with "normal" status.
 *
 * **Validates: Requirements 12.1, 12.3, 12.4**
 */

// --- Helpers ---

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function roundTo1(n: number): number {
  return Math.round(n * 10) / 10;
}

// --- Arbitraries ---

const cashBalanceArb = fc.double({ min: 0, max: 10_000_000, noNaN: true, noDefaultInfinity: true });
const positiveExpenseArb = fc.double({ min: 0.01, max: 1_000_000, noNaN: true, noDefaultInfinity: true });
const expenseArb = fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true });

// 1-3 monthly expenses with at least one positive value
const positiveExpensesArb = fc
  .array(positiveExpenseArb, { minLength: 1, maxLength: 3 })
  .chain((arr) =>
    // Ensure at least one positive expense
    fc.constant(arr),
  );

// --- Property Tests ---

describe("Property 11: Runway computation and thresholds", () => {
  it("runway equals cashBalance / mean(monthlyExpenses) when expenses are positive (Req 12.1)", () => {
    fc.assert(
      fc.property(
        cashBalanceArb,
        positiveExpensesArb,
        (cashBalance, monthlyExpenses) => {
          const config: StartupHealthConfig = {
            cashBalance,
            monthlyExpenses,
            plannedMonthlyBudget: 0,
          };
          const result = computeRunway(config);
          const expected = roundTo1(cashBalance / mean(monthlyExpenses));

          expect(result.months).toBeCloseTo(expected, 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("status is 'red' when runway < 3 months (Req 12.4)", () => {
    fc.assert(
      fc.property(
        // Generate cash and expenses such that runway < 3
        fc.double({ min: 0.01, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        (cashBalance, expense) => {
          // Ensure runway < 3: cashBalance / expense < 3 → cashBalance < 3 * expense
          const adjustedCash = Math.min(cashBalance, expense * 2.9);
          if (adjustedCash <= 0) return; // skip degenerate

          const config: StartupHealthConfig = {
            cashBalance: adjustedCash,
            monthlyExpenses: [expense],
            plannedMonthlyBudget: expense,
          };
          const result = computeRunway(config);

          if (result.months < 3) {
            expect(result.status).toBe("red");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("status is 'amber' when 3 ≤ runway < 6 months (Req 12.3)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        (expense) => {
          // Set cash so runway is between 3 and 6: e.g. 4.5 * expense
          const cashBalance = expense * 4.5;
          const config: StartupHealthConfig = {
            cashBalance,
            monthlyExpenses: [expense],
            plannedMonthlyBudget: expense,
          };
          const result = computeRunway(config);

          expect(result.months).toBeGreaterThanOrEqual(3);
          expect(result.months).toBeLessThan(6);
          expect(result.status).toBe("amber");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("status is 'normal' when runway ≥ 6 months (Req 12.3)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        (expense) => {
          // Set cash so runway ≥ 6: e.g. 10 * expense
          const cashBalance = expense * 10;
          const config: StartupHealthConfig = {
            cashBalance,
            monthlyExpenses: [expense],
            plannedMonthlyBudget: expense,
          };
          const result = computeRunway(config);

          expect(result.months).toBeGreaterThanOrEqual(6);
          expect(result.status).toBe("normal");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns Infinity with 'normal' status when all expenses are 0 (Req 12.1)", () => {
    fc.assert(
      fc.property(
        cashBalanceArb,
        fc.integer({ min: 1, max: 3 }),
        (cashBalance, count) => {
          const config: StartupHealthConfig = {
            cashBalance,
            monthlyExpenses: Array(count).fill(0),
            plannedMonthlyBudget: 0,
          };
          const result = computeRunway(config);

          expect(result.months).toBe(Infinity);
          expect(result.status).toBe("normal");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("runway months is always >= 0 when expenses are positive (Req 12.1)", () => {
    fc.assert(
      fc.property(
        cashBalanceArb,
        positiveExpensesArb,
        (cashBalance, monthlyExpenses) => {
          const config: StartupHealthConfig = {
            cashBalance,
            monthlyExpenses,
            plannedMonthlyBudget: 0,
          };
          const result = computeRunway(config);

          expect(result.months).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("threshold classification is consistent with months value", () => {
    fc.assert(
      fc.property(
        cashBalanceArb,
        fc.array(expenseArb, { minLength: 1, maxLength: 3 }),
        (cashBalance, monthlyExpenses) => {
          const config: StartupHealthConfig = {
            cashBalance,
            monthlyExpenses,
            plannedMonthlyBudget: 0,
          };
          const result = computeRunway(config);

          if (result.months === Infinity) {
            expect(result.status).toBe("normal");
          } else if (result.months < 3) {
            expect(result.status).toBe("red");
          } else if (result.months < 6) {
            expect(result.status).toBe("amber");
          } else {
            expect(result.status).toBe("normal");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
