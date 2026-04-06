import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeVelocityTrend } from "@/lib/analytics";
import type { Task } from "@/types";

/**
 * Property 21: Velocity trend computation
 *
 * For any sequence of 8 consecutive weeks, the velocity trend should show
 * the correct count of tasks moved to "done" status per week, and the
 * week-over-week delta should equal current_week_count - previous_week_count.
 *
 * **Validates: Requirements 10.2, 14.1**
 */

// --- Helpers ---

function makeTask(
  id: string,
  status: Task["status"],
  closedAt: number | null,
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
    createdAt: 1000000,
    closedAt,
  };
}

/**
 * Get the Monday of the week containing the given UTC timestamp (seconds).
 */
function getMondayOfWeek(ts: number): Date {
  const d = new Date(ts * 1000);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const daysToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysToMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// --- Arbitraries ---

/** Reference date: a random timestamp within a reasonable range */
const refDateArb = fc.integer({
  min: Math.floor(new Date("2025-03-01").getTime() / 1000),
  max: Math.floor(new Date("2025-09-01").getTime() / 1000),
});

/** Generate tasks with various statuses and closedAt timestamps spread across the 8-week window */
const tasksForRefArb = (refDate: number) => {
  // Compute the 8-week window boundaries
  const monday = getMondayOfWeek(refDate);
  const windowStart = new Date(monday);
  windowStart.setUTCDate(monday.getUTCDate() - 7 * 7); // 7 weeks back from current Monday
  const startTs = Math.floor(windowStart.getTime() / 1000);
  const endTs = Math.floor(monday.getTime() / 1000) + 7 * 86400; // end of current week

  return fc
    .array(
      fc.tuple(
        fc.constantFrom<Task["status"]>("open", "inprogress", "done", "blocked"),
        fc.boolean(), // whether closedAt is within window
        fc.integer({ min: startTs, max: endTs }), // closedAt timestamp
      ),
      { minLength: 0, maxLength: 40 },
    )
    .map((entries) =>
      entries.map(([status, hasClosedAt, closedTs], i) =>
        makeTask(
          `task-${i}`,
          status,
          status === "done" && hasClosedAt ? closedTs : null,
        ),
      ),
    );
};

// --- Property Tests ---

describe("Property 21: Velocity trend computation", () => {
  it("always returns exactly 8 weeks (Req 10.2)", () => {
    fc.assert(
      fc.property(
        refDateArb.chain((ref) =>
          tasksForRefArb(ref).map((tasks) => ({ ref, tasks })),
        ),
        ({ ref, tasks }) => {
          const result = computeVelocityTrend(tasks, ref);

          // INVARIANT: always 8 weeks
          expect(result).toHaveLength(8);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("weeks are chronologically ordered (Req 10.2)", () => {
    fc.assert(
      fc.property(
        refDateArb.chain((ref) =>
          tasksForRefArb(ref).map((tasks) => ({ ref, tasks })),
        ),
        ({ ref, tasks }) => {
          const result = computeVelocityTrend(tasks, ref);

          // INVARIANT: weekStart dates are in ascending order
          for (let i = 1; i < result.length; i++) {
            expect(result[i].weekStart > result[i - 1].weekStart).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("counts match done tasks with closedAt in each week (Req 10.2, 14.1)", () => {
    fc.assert(
      fc.property(
        refDateArb.chain((ref) =>
          tasksForRefArb(ref).map((tasks) => ({ ref, tasks })),
        ),
        ({ ref, tasks }) => {
          const result = computeVelocityTrend(tasks, ref);

          // Manually count done tasks per week
          for (const week of result) {
            const weekStartDate = new Date(week.weekStart + "T00:00:00Z");
            const weekStartTs = Math.floor(weekStartDate.getTime() / 1000);
            const weekEndTs = weekStartTs + 7 * 86400;

            const expectedCount = tasks.filter(
              (t) =>
                t.status === "done" &&
                t.closedAt !== null &&
                t.closedAt >= weekStartTs &&
                t.closedAt < weekEndTs,
            ).length;

            // INVARIANT: count matches manual computation
            expect(week.tasksCompleted).toBe(expectedCount);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("tasks without closedAt are not counted (Req 10.2)", () => {
    fc.assert(
      fc.property(refDateArb, (ref) => {
        // All tasks are "done" but with closedAt = null
        const tasks = Array.from({ length: 10 }, (_, i) =>
          makeTask(`task-${i}`, "done", null),
        );

        const result = computeVelocityTrend(tasks, ref);

        // INVARIANT: no tasks counted when closedAt is null
        for (const week of result) {
          expect(week.tasksCompleted).toBe(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("non-done tasks are not counted (Req 10.2)", () => {
    fc.assert(
      fc.property(refDateArb, (ref) => {
        const now = ref;
        // Tasks with closedAt set but status is not "done"
        const tasks: Task[] = [
          makeTask("t-1", "open", now),
          makeTask("t-2", "inprogress", now),
          makeTask("t-3", "blocked", now),
        ];

        const result = computeVelocityTrend(tasks, ref);

        // INVARIANT: non-done tasks are never counted
        for (const week of result) {
          expect(week.tasksCompleted).toBe(0);
        }
      }),
      { numRuns: 200 },
    );
  });
});
