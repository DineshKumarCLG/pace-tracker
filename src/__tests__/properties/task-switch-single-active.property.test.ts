import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 7: Task Switch Maintains Single Active Task
 *
 * For any sequence of task switches within a session, after each switch exactly
 * one session_task has `endTime = null`. The previous session_task's `endTime`
 * is set to the switch timestamp, and a new session_task is created with
 * `startTime` equal to the same timestamp. If the target task had status "open,"
 * its status transitions to "inprogress."
 *
 * **Validates: Requirements 9.2, 9.3, 20.2**
 */

// --- In-memory model mirroring the task switch logic ---

type TaskStatus = "open" | "inprogress" | "done" | "blocked";

interface SessionTask {
  id: string;
  sessionId: string;
  taskId: string;
  startTime: number;
  endTime: number | null;
}

interface Task {
  id: string;
  status: TaskStatus;
}

class TaskSwitchManager {
  private sessionTasks: SessionTask[] = [];
  private tasks: Map<string, Task> = new Map();
  private nextId = 1;
  private sessionId: string;

  constructor(sessionId: string, tasks: Task[]) {
    this.sessionId = sessionId;
    for (const t of tasks) {
      this.tasks.set(t.id, { ...t });
    }
  }

  /** Start the first task in the session */
  startTask(taskId: string, timestamp: number): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const st: SessionTask = {
      id: `st-${this.nextId++}`,
      sessionId: this.sessionId,
      taskId,
      startTime: timestamp,
      endTime: null,
    };
    this.sessionTasks.push(st);

    // Transition open → inprogress (Req 9.3)
    if (task.status === "open") {
      task.status = "inprogress";
    }
    return true;
  }

  /** Switch to a new task — mirrors design doc switchTask algorithm */
  switchTask(newTaskId: string, timestamp: number): boolean {
    const task = this.tasks.get(newTaskId);
    if (!task) return false;

    // Close current active session_task (Req 9.2)
    const current = this.sessionTasks.find(
      (st) => st.sessionId === this.sessionId && st.endTime === null
    );
    if (current) {
      // No self-switch
      if (current.taskId === newTaskId) return false;
      current.endTime = timestamp;
    }

    // Create new session_task with same timestamp (Req 9.2)
    const newSt: SessionTask = {
      id: `st-${this.nextId++}`,
      sessionId: this.sessionId,
      taskId: newTaskId,
      startTime: timestamp,
      endTime: null,
    };
    this.sessionTasks.push(newSt);

    // Transition open → inprogress (Req 9.3)
    if (task.status === "open") {
      task.status = "inprogress";
    }

    return true;
  }

  getActiveSessionTasks(): SessionTask[] {
    return this.sessionTasks.filter(
      (st) => st.sessionId === this.sessionId && st.endTime === null
    );
  }

  getAllSessionTasks(): SessionTask[] {
    return [...this.sessionTasks];
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }
}

// --- Arbitraries ---

const timestampArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });
const taskIdArb = fc.constantFrom("task-1", "task-2", "task-3", "task-4", "task-5");
const taskStatusArb = fc.constantFrom<TaskStatus>("open", "inprogress", "done", "blocked");

describe("Property 7: Task Switch Maintains Single Active Task", () => {
  it("after each switch, exactly one session_task has endTime=null", () => {
    fc.assert(
      fc.property(
        fc.array(taskStatusArb, { minLength: 5, maxLength: 5 }),
        timestampArb,
        fc.array(
          fc.record({
            taskId: taskIdArb,
            timeOffset: fc.integer({ min: 1, max: 3600 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (statuses, sessionStart, switches) => {
          const tasks: Task[] = statuses.map((status, i) => ({
            id: `task-${i + 1}`,
            status,
          }));

          const manager = new TaskSwitchManager("session-1", tasks);

          // Start with the first switch target
          let currentTime = sessionStart;
          const firstSwitch = switches[0];
          manager.startTask(firstSwitch.taskId, currentTime);

          // INVARIANT: exactly one active session_task after start
          expect(manager.getActiveSessionTasks().length).toBe(1);

          // Apply remaining switches
          for (let i = 1; i < switches.length; i++) {
            currentTime += switches[i].timeOffset;
            const result = manager.switchTask(switches[i].taskId, currentTime);

            // After every operation (successful or not), at most one active
            const active = manager.getActiveSessionTasks();
            expect(active.length).toBe(1);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("previous task's endTime equals the switch timestamp", () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.integer({ min: 1, max: 7200 }),
        (sessionStart, offset) => {
          const tasks: Task[] = [
            { id: "task-1", status: "open" },
            { id: "task-2", status: "open" },
          ];
          const manager = new TaskSwitchManager("session-1", tasks);

          manager.startTask("task-1", sessionStart);
          const switchTime = sessionStart + offset;
          manager.switchTask("task-2", switchTime);

          const allTasks = manager.getAllSessionTasks();
          const previousTask = allTasks.find(
            (st) => st.taskId === "task-1" && st.endTime !== null
          );

          // Previous task's endTime = switch timestamp (Req 9.2)
          expect(previousTask).toBeDefined();
          expect(previousTask!.endTime).toBe(switchTime);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("new task's startTime equals the switch timestamp", () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.integer({ min: 1, max: 7200 }),
        (sessionStart, offset) => {
          const tasks: Task[] = [
            { id: "task-1", status: "open" },
            { id: "task-2", status: "open" },
          ];
          const manager = new TaskSwitchManager("session-1", tasks);

          manager.startTask("task-1", sessionStart);
          const switchTime = sessionStart + offset;
          manager.switchTask("task-2", switchTime);

          const active = manager.getActiveSessionTasks();
          expect(active.length).toBe(1);

          // New task's startTime = switch timestamp (Req 9.2)
          expect(active[0].startTime).toBe(switchTime);
          expect(active[0].taskId).toBe("task-2");
        }
      ),
      { numRuns: 200 }
    );
  });

  it("target task transitions from open to inprogress on switch", () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.integer({ min: 1, max: 7200 }),
        (sessionStart, offset) => {
          const tasks: Task[] = [
            { id: "task-1", status: "inprogress" },
            { id: "task-2", status: "open" },
          ];
          const manager = new TaskSwitchManager("session-1", tasks);

          manager.startTask("task-1", sessionStart);

          // task-2 is "open" before switch
          expect(manager.getTask("task-2")!.status).toBe("open");

          manager.switchTask("task-2", sessionStart + offset);

          // After switch, task-2 transitions to "inprogress" (Req 9.3)
          expect(manager.getTask("task-2")!.status).toBe("inprogress");
        }
      ),
      { numRuns: 200 }
    );
  });

  it("non-open task statuses are preserved on switch", () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.integer({ min: 1, max: 7200 }),
        fc.constantFrom<TaskStatus>("inprogress", "blocked"),
        (sessionStart, offset, status) => {
          const tasks: Task[] = [
            { id: "task-1", status: "open" },
            { id: "task-2", status },
          ];
          const manager = new TaskSwitchManager("session-1", tasks);

          manager.startTask("task-1", sessionStart);
          manager.switchTask("task-2", sessionStart + offset);

          // Non-open statuses are preserved (only open → inprogress)
          expect(manager.getTask("task-2")!.status).toBe(status);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("rapid sequence of switches maintains invariant at every step", () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.array(fc.integer({ min: 1, max: 60 }), { minLength: 5, maxLength: 30 }),
        (sessionStart, offsets) => {
          const taskIds = ["task-1", "task-2", "task-3"];
          const tasks: Task[] = taskIds.map((id) => ({ id, status: "open" as TaskStatus }));
          const manager = new TaskSwitchManager("session-1", tasks);

          let currentTime = sessionStart;
          let currentTaskIdx = 0;
          manager.startTask(taskIds[currentTaskIdx], currentTime);

          for (const offset of offsets) {
            currentTime += offset;
            // Cycle through tasks to avoid self-switch
            const nextIdx = (currentTaskIdx + 1) % taskIds.length;
            manager.switchTask(taskIds[nextIdx], currentTime);
            currentTaskIdx = nextIdx;

            // INVARIANT: exactly one active session_task (Req 20.2)
            const active = manager.getActiveSessionTasks();
            expect(active.length).toBe(1);
            expect(active[0].taskId).toBe(taskIds[nextIdx]);
          }

          // All closed session_tasks should have non-null endTime
          const all = manager.getAllSessionTasks();
          const closed = all.filter((st) => st.endTime !== null);
          for (const st of closed) {
            expect(st.endTime).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
