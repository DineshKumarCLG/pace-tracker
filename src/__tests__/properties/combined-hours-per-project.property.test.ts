import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeHoursPerProject } from "@/lib/analytics";
import type { SessionTask, Task, Project } from "@/types";

/**
 * Property 20: Combined hours per project
 *
 * For any set of session_tasks across all team members for a time period,
 * the combined hours per project should equal the sum of
 * (endTime - startTime) / 3600 for all session_tasks grouped by the task's projectId.
 *
 * **Validates: Requirements 10.1**
 */

// --- Helpers ---

function makeProject(id: string, name: string): Project {
  return {
    id,
    name,
    color: "#000000",
    createdBy: "user-1",
    createdAt: 1000000,
    archivedAt: null,
  };
}

function makeTask(id: string, projectId: string): Task {
  return {
    id,
    projectId,
    title: `Task ${id}`,
    status: "done",
    assigneeId: "user-1",
    priority: "medium",
    dueDate: null,
    estimatedMinutes: null,
    notes: null,
    createdBy: "user-1",
    createdAt: 1000000,
    closedAt: 1000000,
  };
}

function makeSessionTask(
  id: string,
  taskId: string,
  startTime: number,
  endTime: number | null,
): SessionTask {
  return {
    id,
    sessionId: `session-${id}`,
    taskId,
    startTime,
    endTime,
  };
}

// --- Arbitraries ---

const projectCountArb = fc.integer({ min: 1, max: 5 });
const taskCountArb = fc.integer({ min: 1, max: 10 });

/** Generate a coherent set of projects, tasks, and session-tasks */
const scenarioArb = fc
  .tuple(
    projectCountArb,
    taskCountArb,
    fc.integer({ min: 0, max: 20 }), // session-task count
  )
  .chain(([projCount, taskCount, stCount]) => {
    const projects = Array.from({ length: projCount }, (_, i) =>
      makeProject(`proj-${i}`, `Project ${i}`),
    );

    // Each task assigned to a random project
    const taskProjectArb = fc
      .array(fc.integer({ min: 0, max: projCount - 1 }), {
        minLength: taskCount,
        maxLength: taskCount,
      })
      .map((projIndices) =>
        projIndices.map((pi, i) => makeTask(`task-${i}`, projects[pi].id)),
      );

    // Session-tasks: each references a random task, with a start/end time
    const sessionTasksArb = taskProjectArb.chain((tasks) => {
      if (tasks.length === 0 || stCount === 0) return fc.constant({ tasks, sessionTasks: [] as SessionTask[] });

      return fc
        .array(
          fc.tuple(
            fc.integer({ min: 0, max: tasks.length - 1 }), // task index
            fc.integer({ min: 1000000, max: 2000000 }), // start time
            fc.integer({ min: 1, max: 36000 }), // duration in seconds (up to 10h)
            fc.boolean(), // whether endTime is null (open session)
          ),
          { minLength: stCount, maxLength: stCount },
        )
        .map((entries) => ({
          tasks,
          sessionTasks: entries.map(([taskIdx, start, dur, isOpen], i) =>
            makeSessionTask(
              `st-${i}`,
              tasks[taskIdx].id,
              start,
              isOpen ? null : start + dur,
            ),
          ),
        }));
    });

    return sessionTasksArb.map(({ tasks, sessionTasks }) => ({
      projects,
      tasks,
      sessionTasks,
    }));
  });

// --- Property Tests ---

describe("Property 20: Combined hours per project", () => {
  it("total hours >= 0 per project (Req 10.1)", () => {
    fc.assert(
      fc.property(scenarioArb, ({ projects, tasks, sessionTasks }) => {
        const result = computeHoursPerProject(sessionTasks, tasks, projects);

        // INVARIANT: every project's totalHours is non-negative
        for (const entry of result) {
          expect(entry.totalHours).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("sum matches manual computation per project (Req 10.1)", () => {
    fc.assert(
      fc.property(scenarioArb, ({ projects, tasks, sessionTasks }) => {
        const result = computeHoursPerProject(sessionTasks, tasks, projects);

        // Build expected hours manually
        const taskProjectMap = new Map<string, string>();
        for (const t of tasks) {
          taskProjectMap.set(t.id, t.projectId);
        }

        const expectedByProject = new Map<string, number>();
        for (const st of sessionTasks) {
          if (st.endTime === null) continue;
          const projectId = taskProjectMap.get(st.taskId);
          if (!projectId) continue;
          const hours = (st.endTime - st.startTime) / 3600;
          expectedByProject.set(
            projectId,
            (expectedByProject.get(projectId) ?? 0) + hours,
          );
        }

        // INVARIANT: result matches manual grouping
        const resultMap = new Map<string, number>();
        for (const entry of result) {
          resultMap.set(entry.projectId, entry.totalHours);
        }

        for (const [projectId, expectedHours] of expectedByProject) {
          expect(resultMap.get(projectId) ?? 0).toBeCloseTo(expectedHours, 8);
        }

        // No extra projects in result
        for (const entry of result) {
          expect(expectedByProject.has(entry.projectId)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("open session tasks (endTime === null) are excluded (Req 10.1)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        (count) => {
          const project = makeProject("proj-0", "Project 0");
          const task = makeTask("task-0", "proj-0");

          // All session-tasks are open (endTime === null)
          const openSessionTasks = Array.from({ length: count }, (_, i) =>
            makeSessionTask(`st-${i}`, "task-0", 1000000 + i * 1000, null),
          );

          const result = computeHoursPerProject(openSessionTasks, [task], [project]);

          // INVARIANT: open session-tasks contribute zero hours → empty result
          expect(result).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("empty session tasks → empty result (Req 10.1)", () => {
    const project = makeProject("proj-0", "Project 0");
    const task = makeTask("task-0", "proj-0");

    const result = computeHoursPerProject([], [task], [project]);

    // INVARIANT: no session-tasks means no hours
    expect(result).toHaveLength(0);
  });
});
