import { describe, it, expect, beforeEach } from "vitest";
import { useTaskStore } from "./taskStore";
import type { Task } from "@/types";

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  projectId: "p1",
  title: "Test task",
  status: "open",
  assigneeId: null,
  priority: "medium",
  dueDate: null,
  estimatedMinutes: null,
  notes: null,
  createdBy: "u1",
  createdAt: 1700000000,
  closedAt: null,
  ...overrides,
});

describe("taskStore", () => {
  beforeEach(() => {
    useTaskStore.setState({ activeTaskId: null, tasks: [] });
  });

  it("setActiveTask sets the active task id", () => {
    useTaskStore.getState().setActiveTask("t1");
    expect(useTaskStore.getState().activeTaskId).toBe("t1");
  });

  it("setActiveTask to null clears active task", () => {
    useTaskStore.getState().setActiveTask("t1");
    useTaskStore.getState().setActiveTask(null);
    expect(useTaskStore.getState().activeTaskId).toBeNull();
  });

  it("updateTaskList replaces the full task list", () => {
    const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2" })];
    useTaskStore.getState().updateTaskList(tasks);
    expect(useTaskStore.getState().tasks).toHaveLength(2);
  });

  it("addTask appends a task", () => {
    useTaskStore.getState().addTask(makeTask({ id: "t1" }));
    useTaskStore.getState().addTask(makeTask({ id: "t2" }));
    expect(useTaskStore.getState().tasks).toHaveLength(2);
  });

  it("updateTask modifies an existing task", () => {
    useTaskStore.getState().addTask(makeTask({ id: "t1", title: "Old" }));
    useTaskStore.getState().updateTask("t1", { title: "New" });
    expect(useTaskStore.getState().tasks[0].title).toBe("New");
  });

  it("removeTask removes a task and clears activeTaskId if it matches", () => {
    useTaskStore.getState().addTask(makeTask({ id: "t1" }));
    useTaskStore.getState().setActiveTask("t1");
    useTaskStore.getState().removeTask("t1");
    expect(useTaskStore.getState().tasks).toHaveLength(0);
    expect(useTaskStore.getState().activeTaskId).toBeNull();
  });

  it("removeTask preserves activeTaskId when removing a different task", () => {
    useTaskStore.getState().addTask(makeTask({ id: "t1" }));
    useTaskStore.getState().addTask(makeTask({ id: "t2" }));
    useTaskStore.getState().setActiveTask("t1");
    useTaskStore.getState().removeTask("t2");
    expect(useTaskStore.getState().activeTaskId).toBe("t1");
  });

  it("active task is always singular", () => {
    useTaskStore.getState().setActiveTask("t1");
    useTaskStore.getState().setActiveTask("t2");
    expect(useTaskStore.getState().activeTaskId).toBe("t2");
  });

  it("updateTaskList replaces rather than merges the task list", () => {
    useTaskStore.getState().addTask(makeTask({ id: "t1" }));
    useTaskStore.getState().addTask(makeTask({ id: "t2" }));
    expect(useTaskStore.getState().tasks).toHaveLength(2);

    useTaskStore.getState().updateTaskList([makeTask({ id: "t3" })]);
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(useTaskStore.getState().tasks[0].id).toBe("t3");
  });

  it("updateTaskList with empty array clears all tasks", () => {
    useTaskStore.getState().addTask(makeTask({ id: "t1" }));
    useTaskStore.getState().updateTaskList([]);
    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });
});
