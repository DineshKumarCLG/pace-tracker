import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { canCompleteMilestone } from "@/lib/milestones";
import type { MilestoneTask, Task } from "@/types";

/**
 * Property 28: Milestone completion gate
 *
 * For any milestone, it can only be marked as complete (completedAt set) when
 * every task in the milestone_tasks junction table has status "done". If any
 * associated task has a status other than "done", the completion should be rejected.
 *
 * **Validates: Requirements 17.4**
 */

// --- Helpers ---

const taskStatusArb = fc.constantFrom(
  "open" as const,
  "inprogress" as const,
  "done" as const,
  "blocked" as const,
);

function makeTask(id: string, status: Task["status"]): Task {
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
    closedAt: status === "done" ? 1000000 + 3600 : null,
  };
}

// --- Property Tests ---

describe("Property 28: Milestone completion gate", () => {
  it("canCompleteMilestone returns true only when ALL associated tasks are done (Req 17.4)", () => {
    fc.assert(
      fc.property(
        // Generate 1-10 tasks with random statuses
        fc.array(taskStatusArb, { minLength: 1, maxLength: 10 }),
        (taskStatuses) => {
          const milestoneId = "m-1";

          // Create tasks and milestone_tasks associations
          const tasks: Task[] = taskStatuses.map((status, i) =>
            makeTask(`t-${i}`, status),
          );
          const milestoneTasks: MilestoneTask[] = tasks.map((t) => ({
            milestoneId,
            taskId: t.id,
          }));

          const result = canCompleteMilestone(milestoneId, milestoneTasks, tasks);
          const allDone = taskStatuses.every((s) => s === "done");

          // INVARIANT: canCompleteMilestone returns true iff ALL tasks are "done"
          expect(result).toBe(allDone);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("returns false when milestone has no associated tasks (Req 17.4)", () => {
    fc.assert(
      fc.property(
        // Generate some tasks that exist but are NOT associated with the milestone
        fc.array(taskStatusArb, { minLength: 0, maxLength: 5 }),
        (taskStatuses) => {
          const milestoneId = "m-1";
          const tasks: Task[] = taskStatuses.map((status, i) =>
            makeTask(`t-${i}`, status),
          );
          // No milestone_tasks entries for this milestone
          const milestoneTasks: MilestoneTask[] = [];

          const result = canCompleteMilestone(milestoneId, milestoneTasks, tasks);

          // INVARIANT: no associated tasks → cannot complete
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("only considers tasks for the specific milestone (Req 17.4)", () => {
    fc.assert(
      fc.property(
        fc.array(taskStatusArb, { minLength: 1, maxLength: 5 }),
        fc.array(taskStatusArb, { minLength: 1, maxLength: 5 }),
        (statusesM1, statusesM2) => {
          // Create tasks for milestone m-1
          const tasksM1: Task[] = statusesM1.map((status, i) =>
            makeTask(`m1-t-${i}`, status),
          );
          // Create tasks for milestone m-2
          const tasksM2: Task[] = statusesM2.map((status, i) =>
            makeTask(`m2-t-${i}`, status),
          );

          const allTasks = [...tasksM1, ...tasksM2];

          const milestoneTasks: MilestoneTask[] = [
            ...tasksM1.map((t) => ({ milestoneId: "m-1", taskId: t.id })),
            ...tasksM2.map((t) => ({ milestoneId: "m-2", taskId: t.id })),
          ];

          const resultM1 = canCompleteMilestone("m-1", milestoneTasks, allTasks);
          const resultM2 = canCompleteMilestone("m-2", milestoneTasks, allTasks);

          const allM1Done = statusesM1.every((s) => s === "done");
          const allM2Done = statusesM2.every((s) => s === "done");

          // INVARIANT: each milestone's completion depends only on its own tasks
          expect(resultM1).toBe(allM1Done);
          expect(resultM2).toBe(allM2Done);
        },
      ),
      { numRuns: 200 },
    );
  });
});
