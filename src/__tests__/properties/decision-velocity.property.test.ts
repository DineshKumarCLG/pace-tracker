import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeDecisionVelocity, type Decision } from "@/lib/startupHealth";

/**
 * Property 13: Decision velocity computation
 *
 * For any set of decisions with createdAt and resolvedAt timestamps within the past
 * 30 days, the decision velocity should equal the arithmetic mean of
 * (resolvedAt - createdAt) in days across all resolved decisions. When no resolved
 * decisions exist, velocity should be 0.
 *
 * **Validates: Requirements 14.1**
 */

// --- Constants ---

const DAY = 86400;
const BASE_TIME = 1700000000; // fixed reference point

// --- Helpers ---

function roundTo1(n: number): number {
  return Math.round(n * 10) / 10;
}

// --- Arbitraries ---

// Generate a resolved decision within the 30-day window
const resolvedDecisionArb = fc
  .tuple(
    fc.uuid(),
    // createdAt: up to 60 days before base (can be before window)
    fc.integer({ min: 1, max: 60 }),
    // resolution time in days (1-30)
    fc.integer({ min: 1, max: 30 }),
  )
  .map(([id, daysBeforeBase, resolutionDays]) => {
    const createdAt = BASE_TIME - daysBeforeBase * DAY;
    const resolvedAt = createdAt + resolutionDays * DAY;
    return {
      id,
      title: `Decision ${id.slice(0, 4)}`,
      description: "",
      createdAt,
      resolvedAt,
    } as Decision;
  });

// Generate an unresolved decision
const unresolvedDecisionArb = fc
  .tuple(fc.uuid(), fc.integer({ min: 1, max: 30 }))
  .map(([id, daysAgo]) => ({
    id,
    title: `Open ${id.slice(0, 4)}`,
    description: "",
    createdAt: BASE_TIME - daysAgo * DAY,
    resolvedAt: null,
  })) as fc.Arbitrary<Decision>;

// --- Property Tests ---

describe("Property 13: Decision velocity computation", () => {
  it("velocity equals mean of (resolvedAt - createdAt) in days for resolved decisions in window (Req 14.1)", () => {
    fc.assert(
      fc.property(
        fc.array(resolvedDecisionArb, { minLength: 1, maxLength: 10 }),
        (decisions) => {
          const windowDays = 30;
          const cutoff = BASE_TIME - windowDays * DAY;

          // Filter to those resolved within window
          const inWindow = decisions.filter(
            (d) => d.resolvedAt != null && d.resolvedAt >= cutoff,
          );

          const result = computeDecisionVelocity(decisions, windowDays, BASE_TIME);

          if (inWindow.length === 0) {
            expect(result).toBe(0);
          } else {
            const totalDays = inWindow.reduce(
              (sum, d) => sum + (d.resolvedAt! - d.createdAt) / DAY,
              0,
            );
            const expected = roundTo1(totalDays / inWindow.length);
            expect(result).toBeCloseTo(expected, 1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("velocity is 0 when no resolved decisions exist (Req 14.1)", () => {
    fc.assert(
      fc.property(
        fc.array(unresolvedDecisionArb, { minLength: 0, maxLength: 10 }),
        (decisions) => {
          const result = computeDecisionVelocity(decisions, 30, BASE_TIME);
          expect(result).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("velocity is always >= 0 (Req 14.1)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(resolvedDecisionArb, unresolvedDecisionArb),
          { minLength: 0, maxLength: 10 },
        ),
        (decisions) => {
          const result = computeDecisionVelocity(decisions, 30, BASE_TIME);
          expect(result).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("only considers decisions resolved within the window (Req 14.1)", () => {
    fc.assert(
      fc.property(
        // Decision resolved well outside the window (> 60 days ago)
        fc.tuple(fc.uuid(), fc.integer({ min: 61, max: 120 })),
        // Decision resolved within window
        fc.tuple(fc.uuid(), fc.integer({ min: 1, max: 5 })),
        ([oldId, oldDaysAgo], [newId, newResolutionDays]) => {
          const oldDecision: Decision = {
            id: oldId,
            title: "Old",
            description: "",
            createdAt: BASE_TIME - oldDaysAgo * DAY - 5 * DAY,
            resolvedAt: BASE_TIME - oldDaysAgo * DAY,
          };
          const newDecision: Decision = {
            id: newId,
            title: "New",
            description: "",
            createdAt: BASE_TIME - 10 * DAY,
            resolvedAt: BASE_TIME - 10 * DAY + newResolutionDays * DAY,
          };

          // Only include new decision if it's resolved within window
          const cutoff = BASE_TIME - 30 * DAY;
          const newInWindow = newDecision.resolvedAt! >= cutoff;

          const resultBoth = computeDecisionVelocity(
            [oldDecision, newDecision],
            30,
            BASE_TIME,
          );
          const resultNewOnly = computeDecisionVelocity(
            [newDecision],
            30,
            BASE_TIME,
          );

          if (newInWindow) {
            // Old decision is outside window, so both should give same result
            expect(resultBoth).toBeCloseTo(resultNewOnly, 1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
