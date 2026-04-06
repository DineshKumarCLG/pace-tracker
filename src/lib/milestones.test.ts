import { describe, it, expect } from "vitest";
import {
  createMilestone,
  canCompleteMilestone,
  getMilestoneWarnings,
  sortMilestonesByDeadline,
} from "@/lib/milestones";
import type { Milestone, MilestoneTask, Task } from "@/types";

// --- Helpers ---

const DAY = 86400;

function utcMidnight(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

function makeMilestone(
  id: string,
  projectId: string,
  name: string,
  deadline: number,
  completedAt: number | null = null,
): Milestone {
  return {
    id,
    projectId,
    name,
    deadline,
    completedAt,
    createdBy: "user-1",
    createdAt: deadline - 30 * DAY,
  };
}

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

// --- createMilestone ---

describe("createMilestone", () => {
  it("creates a milestone with correct fields", () => {
    const deadline = utcMidnight(2025, 7, 15);
    const m = createMilestone("m-1", "Release v1", "proj-1", deadline, "user-1");

    expect(m.id).toBe("m-1");
    expect(m.name).toBe("Release v1");
    expect(m.projectId).toBe("proj-1");
    expect(m.deadline).toBe(deadline);
    expect(m.createdBy).toBe("user-1");
    expect(m.completedAt).toBeNull();
    expect(m.createdAt).toBeGreaterThan(0);
  });

  it("trims whitespace from name", () => {
    const m = createMilestone("m-1", "  Beta Launch  ", "proj-1", 1000000, "user-1");
    expect(m.name).toBe("Beta Launch");
  });

  it("throws on empty name", () => {
    expect(() => createMilestone("m-1", "", "proj-1", 1000000, "user-1")).toThrow(
      "Milestone name is required",
    );
  });

  it("throws on whitespace-only name", () => {
    expect(() => createMilestone("m-1", "   ", "proj-1", 1000000, "user-1")).toThrow(
      "Milestone name is required",
    );
  });
});

// --- canCompleteMilestone ---

describe("canCompleteMilestone", () => {
  it("returns true when all associated tasks are done", () => {
    const milestoneTasks: MilestoneTask[] = [
      { milestoneId: "m-1", taskId: "t-1" },
      { milestoneId: "m-1", taskId: "t-2" },
    ];
    const tasks = [makeTask("t-1", "done"), makeTask("t-2", "done")];

    expect(canCompleteMilestone("m-1", milestoneTasks, tasks)).toBe(true);
  });

  it("returns false when some tasks are not done", () => {
    const milestoneTasks: MilestoneTask[] = [
      { milestoneId: "m-1", taskId: "t-1" },
      { milestoneId: "m-1", taskId: "t-2" },
    ];
    const tasks = [makeTask("t-1", "done"), makeTask("t-2", "inprogress")];

    expect(canCompleteMilestone("m-1", milestoneTasks, tasks)).toBe(false);
  });

  it("returns false when no tasks are associated", () => {
    const milestoneTasks: MilestoneTask[] = [];
    const tasks = [makeTask("t-1", "done")];

    expect(canCompleteMilestone("m-1", milestoneTasks, tasks)).toBe(false);
  });

  it("returns false when associated task does not exist in tasks array", () => {
    const milestoneTasks: MilestoneTask[] = [
      { milestoneId: "m-1", taskId: "t-missing" },
    ];
    const tasks = [makeTask("t-1", "done")];

    expect(canCompleteMilestone("m-1", milestoneTasks, tasks)).toBe(false);
  });

  it("only considers tasks for the specified milestone", () => {
    const milestoneTasks: MilestoneTask[] = [
      { milestoneId: "m-1", taskId: "t-1" },
      { milestoneId: "m-2", taskId: "t-2" },
    ];
    const tasks = [makeTask("t-1", "done"), makeTask("t-2", "open")];

    // m-1 only has t-1 which is done
    expect(canCompleteMilestone("m-1", milestoneTasks, tasks)).toBe(true);
    // m-2 only has t-2 which is open
    expect(canCompleteMilestone("m-2", milestoneTasks, tasks)).toBe(false);
  });
});

// --- getMilestoneWarnings ---

describe("getMilestoneWarnings", () => {
  const now = utcMidnight(2025, 7, 10); // July 10, 2025

  it("warns for milestones within 3 days of deadline", () => {
    const milestones = [
      makeMilestone("m-1", "proj-1", "Soon", now + 2 * DAY), // 2 days away
    ];

    const warnings = getMilestoneWarnings(milestones, [], [], now);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].milestoneId).toBe("m-1");
    expect(warnings[0].daysRemaining).toBe(2);
  });

  it("warns for milestones past deadline", () => {
    const milestones = [
      makeMilestone("m-1", "proj-1", "Overdue", now - DAY), // 1 day past
    ];

    const warnings = getMilestoneWarnings(milestones, [], [], now);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].daysRemaining).toBe(0);
  });

  it("does not warn for milestones more than 3 days away", () => {
    const milestones = [
      makeMilestone("m-1", "proj-1", "Far", now + 5 * DAY), // 5 days away
    ];

    const warnings = getMilestoneWarnings(milestones, [], [], now);

    expect(warnings).toHaveLength(0);
  });

  it("does not warn for completed milestones", () => {
    const milestones = [
      makeMilestone("m-1", "proj-1", "Done", now + DAY, now - DAY), // completed
    ];

    const warnings = getMilestoneWarnings(milestones, [], [], now);

    expect(warnings).toHaveLength(0);
  });

  it("warns for exactly 3 days away", () => {
    const milestones = [
      makeMilestone("m-1", "proj-1", "Edge", now + 3 * DAY), // exactly 3 days
    ];

    const warnings = getMilestoneWarnings(milestones, [], [], now);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].daysRemaining).toBe(3);
  });
});

// --- sortMilestonesByDeadline ---

describe("sortMilestonesByDeadline", () => {
  it("sorts milestones by deadline ascending", () => {
    const milestones = [
      makeMilestone("m-3", "proj-1", "Third", 3000),
      makeMilestone("m-1", "proj-1", "First", 1000),
      makeMilestone("m-2", "proj-1", "Second", 2000),
    ];

    const sorted = sortMilestonesByDeadline(milestones);

    expect(sorted.map((m) => m.id)).toEqual(["m-1", "m-2", "m-3"]);
  });

  it("does not mutate the original array", () => {
    const milestones = [
      makeMilestone("m-2", "proj-1", "B", 2000),
      makeMilestone("m-1", "proj-1", "A", 1000),
    ];

    const sorted = sortMilestonesByDeadline(milestones);

    expect(milestones[0].id).toBe("m-2"); // original unchanged
    expect(sorted[0].id).toBe("m-1");
  });

  it("handles empty array", () => {
    expect(sortMilestonesByDeadline([])).toEqual([]);
  });

  it("handles single element", () => {
    const milestones = [makeMilestone("m-1", "proj-1", "Only", 1000)];
    const sorted = sortMilestonesByDeadline(milestones);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe("m-1");
  });
});
