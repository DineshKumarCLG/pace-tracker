import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { getMilestoneWarnings } from "@/lib/milestones";
import type { Milestone } from "@/types";

/**
 * Property 29: Milestone deadline warning
 *
 * For any milestone where the deadline is within 3 calendar days of the current
 * date and completedAt is null, a warning indicator should be present in the
 * dashboard and tasks screen data.
 *
 * **Validates: Requirements 17.3**
 */

// --- Helpers ---

const DAY = 86400;

function makeMilestone(
  id: string,
  deadline: number,
  completedAt: number | null = null,
): Milestone {
  return {
    id,
    projectId: "proj-1",
    name: `Milestone ${id}`,
    deadline,
    completedAt,
    createdBy: "user-1",
    createdAt: deadline - 30 * DAY,
  };
}

// --- Arbitraries ---

/** Generate a "now" timestamp in a reasonable range */
const nowArb = fc.integer({ min: 1700000000, max: 1800000000 });

// --- Property Tests ---

describe("Property 29: Milestone deadline warning", () => {
  it("warns only for incomplete milestones within 3 days of deadline (Req 17.3)", () => {
    fc.assert(
      fc.property(
        nowArb,
        // Generate milestones with various deadlines relative to now
        fc.array(
          fc.record({
            daysFromNow: fc.integer({ min: -5, max: 10 }),
            completed: fc.boolean(),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (now, milestoneSpecs) => {
          const milestones: Milestone[] = milestoneSpecs.map((spec, i) =>
            makeMilestone(
              `m-${i}`,
              now + spec.daysFromNow * DAY,
              spec.completed ? now - DAY : null,
            ),
          );

          const warnings = getMilestoneWarnings(milestones, [], [], now);
          const warningIds = new Set(warnings.map((w) => w.milestoneId));

          for (let i = 0; i < milestoneSpecs.length; i++) {
            const spec = milestoneSpecs[i];
            const id = `m-${i}`;
            const withinThreeDays = spec.daysFromNow <= 3;
            const isIncomplete = !spec.completed;

            if (withinThreeDays && isIncomplete) {
              // INVARIANT: should have a warning
              expect(warningIds.has(id)).toBe(true);
            } else {
              // INVARIANT: should NOT have a warning
              expect(warningIds.has(id)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("daysRemaining is non-negative (Req 17.3)", () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.integer({ min: -10, max: 3 }),
        (now, daysFromNow) => {
          const milestone = makeMilestone("m-1", now + daysFromNow * DAY);
          const warnings = getMilestoneWarnings([milestone], [], [], now);

          // All warnings should have daysRemaining >= 0
          for (const w of warnings) {
            expect(w.daysRemaining).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("completed milestones never produce warnings regardless of deadline (Req 17.3)", () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.integer({ min: -10, max: 10 }),
        (now, daysFromNow) => {
          // Milestone is completed
          const milestone = makeMilestone(
            "m-1",
            now + daysFromNow * DAY,
            now - DAY, // completedAt is set
          );

          const warnings = getMilestoneWarnings([milestone], [], [], now);

          // INVARIANT: completed milestones never produce warnings
          expect(warnings).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
