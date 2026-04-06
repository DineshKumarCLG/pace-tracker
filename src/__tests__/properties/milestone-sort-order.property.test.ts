import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { sortMilestonesByDeadline } from "@/lib/milestones";
import type { Milestone } from "@/types";

/**
 * Property 30: Milestone sort order
 *
 * For any set of milestones for a project, the display order should be sorted
 * by deadline ascending.
 *
 * **Validates: Requirements 17.2**
 */

// --- Helpers ---

function makeMilestone(id: string, deadline: number): Milestone {
  return {
    id,
    projectId: "proj-1",
    name: `Milestone ${id}`,
    deadline,
    completedAt: null,
    createdBy: "user-1",
    createdAt: deadline - 86400 * 30,
  };
}

// --- Arbitraries ---

const milestoneArrayArb = fc.array(
  fc.record({
    id: fc.stringMatching(/^m-[a-z0-9]{1,6}$/),
    deadline: fc.integer({ min: 1600000000, max: 1900000000 }),
  }),
  { minLength: 0, maxLength: 20 },
);

// --- Property Tests ---

describe("Property 30: Milestone sort order", () => {
  it("sorted milestones are in deadline ascending order (Req 17.2)", () => {
    fc.assert(
      fc.property(milestoneArrayArb, (specs) => {
        const milestones = specs.map((s) => makeMilestone(s.id, s.deadline));
        const sorted = sortMilestonesByDeadline(milestones);

        // INVARIANT: each consecutive pair has deadline[i] <= deadline[i+1]
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i].deadline).toBeGreaterThanOrEqual(sorted[i - 1].deadline);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("sort preserves all elements (Req 17.2)", () => {
    fc.assert(
      fc.property(milestoneArrayArb, (specs) => {
        const milestones = specs.map((s) => makeMilestone(s.id, s.deadline));
        const sorted = sortMilestonesByDeadline(milestones);

        // INVARIANT: same length
        expect(sorted.length).toBe(milestones.length);

        // INVARIANT: same set of deadlines (as multiset)
        const originalDeadlines = milestones.map((m) => m.deadline).sort((a, b) => a - b);
        const sortedDeadlines = sorted.map((m) => m.deadline);
        expect(sortedDeadlines).toEqual(originalDeadlines);
      }),
      { numRuns: 200 },
    );
  });

  it("sort does not mutate the original array (Req 17.2)", () => {
    fc.assert(
      fc.property(milestoneArrayArb, (specs) => {
        const milestones = specs.map((s) => makeMilestone(s.id, s.deadline));
        const originalOrder = milestones.map((m) => m.id);

        sortMilestonesByDeadline(milestones);

        // INVARIANT: original array order unchanged
        const afterOrder = milestones.map((m) => m.id);
        expect(afterOrder).toEqual(originalOrder);
      }),
      { numRuns: 200 },
    );
  });
});
