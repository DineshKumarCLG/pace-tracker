import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeTaskCompletionRate } from "@/lib/analytics";
import type { Task } from "@/types";

/**
 * Property 18: Task completion rate computation
 *
 * For any user and 4-week window, the task completion rate should equal
 * (count of tasks with status "done") / (total tasks), expressed as a value
 * between 0.0 and 1.0.
 *
 * **Validates: Requirements 9.4**
 */

// --- Helpers ---

function makeTask(
  id: string,
  status: "open" | "inprogress" | "done" | "blocked",
): Task {
  return {
    id,
    projectId: "proj-1",
    title: `Task ${id}`,
    status,
    assigneeId: "user-1",
    priority: "medium",
    dueDate: null,
    estimatedMinutes: null,
    notes: null,
    createdBy: "user-1",
    createdAt: Date.now(),
    closedAt: status === "done" ? Date.now() : null,
  };
}

// --- Arbitraries ---

const statusArb = fc.constantFrom<Task["status"]>(
  "open",
  "inprogress",
  "done",
  "blocked",
);

const tasksArb = fc
  .array(statusArb, { minLength: 1, maxLength: 50 })
  .map((statuses) => statuses.map((s, i) => makeTask(`task-${i}`, s)));

// --- Property Tests ---

describe("Property 18: Task completion rate computation", () => {
  it("rate equals done / total (Req 9.4)", () => {
    fc.assert(
      fc.property(tasksArb, (tasks) => {
        const result = computeTaskCompletionRate(tasks);
        const doneCount = tasks.filter((t) => t.status === "done").length;
        const expected = doneCount / tasks.length;

        // INVARIANT: rate equals done count divided by total count
        expect(result).toBeCloseTo(expected, 10);
      }),
      { numRuns: 300 },
    );
  });

  it("0 <= rate <= 1 (Req 9.4)", () => {
    fc.assert(
      fc.property(tasksArb, (tasks) => {
        const result = computeTaskCompletionRate(tasks);

        // INVARIANT: rate is bounded between 0 and 1
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });

  it("empty tasks → 0 (Req 9.4)", () => {
    const result = computeTaskCompletionRate([]);

    // INVARIANT: no tasks means zero rate
    expect(result).toBe(0);
  });

  it("all done → 1 (Req 9.4)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (count) => {
          const tasks = Array.from({ length: count }, (_, i) =>
            makeTask(`task-${i}`, "done"),
          );
          const result = computeTaskCompletionRate(tasks);

          // INVARIANT: all tasks done means rate is 1
          expect(result).toBe(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("no done tasks → 0 (Req 9.4)", () => {
    const nonDoneStatusArb = fc.constantFrom<Task["status"]>(
      "open",
      "inprogress",
      "blocked",
    );

    fc.assert(
      fc.property(
        fc.array(nonDoneStatusArb, { minLength: 1, maxLength: 50 }).map(
          (statuses) => statuses.map((s, i) => makeTask(`task-${i}`, s)),
        ),
        (tasks) => {
          const result = computeTaskCompletionRate(tasks);

          // INVARIANT: no done tasks means rate is 0
          expect(result).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
