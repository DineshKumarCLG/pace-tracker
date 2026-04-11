import { describe, it, expect } from "vitest";
import { generateEndOfDayReport } from "@/lib/reports";
import type { Session, SessionTask, Break, GitEvent, Task } from "@/types";

// Helper: UTC timestamp for a given date and time
function utc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  min = 0,
  sec = 0,
): number {
  return Math.floor(Date.UTC(year, month - 1, day, hour, min, sec) / 1000);
}

function makeSession(
  overrides: Partial<Session> & Pick<Session, "id" | "userId" | "startTime">,
): Session {
  return {
    endTime: null,
    startType: "manual",
    startVerified: true,
    outputNote: null,
    lastHeartbeat: null,
    syncedAt: null,
    createdAt: overrides.startTime,
    ...overrides,
  };
}

function makeSessionTask(
  overrides: Partial<SessionTask> & Pick<SessionTask, "id" | "sessionId" | "taskId" | "startTime">,
): SessionTask {
  return {
    endTime: null,
    ...overrides,
  };
}

function makeBreak(
  overrides: Partial<Break> & Pick<Break, "id" | "sessionId" | "startTime">,
): Break {
  return {
    endTime: null,
    type: "short",
    autoDetected: false,
    ...overrides,
  };
}

function makeGitEvent(
  overrides: Partial<GitEvent> & Pick<GitEvent, "id" | "userId" | "commitHash">,
): GitEvent {
  return {
    sessionId: null,
    repoPath: "/repo",
    message: null,
    commitTime: utc(2025, 3, 15, 14, 0),
    ...overrides,
  };
}

function makeTask(
  overrides: Partial<Task> & Pick<Task, "id" | "title">,
): Task {
  return {
    projectId: "proj-1",
    status: "done",
    assigneeId: null,
    priority: "medium",
    dueDate: null,
    estimatedMinutes: null,
    notes: null,
    createdBy: "user-1",
    createdAt: utc(2025, 1, 1),
    closedAt: null,
    ...overrides,
  };
}

describe("generateEndOfDayReport", () => {
  const session = makeSession({
    id: "session-1",
    userId: "user-1",
    startTime: utc(2025, 3, 15, 9, 0),
    endTime: utc(2025, 3, 15, 17, 0),
    outputNote: "Shipped the new dashboard",
  });

  it("computes totalMinutes as session duration minus break durations (Req 11.1)", () => {
    const breaks: Break[] = [
      makeBreak({
        id: "b1",
        sessionId: "session-1",
        startTime: utc(2025, 3, 15, 12, 0),
        endTime: utc(2025, 3, 15, 13, 0), // 60 min
        type: "lunch",
      }),
    ];

    const report = generateEndOfDayReport(
      "report-1",
      session,
      [],
      breaks,
      [],
      {},
    );

    // 8h session - 1h break = 7h = 420 min
    expect(report.totalMinutes).toBe(420);
  });

  it("includes tasks worked with time per task (Req 11.1)", () => {
    const sessionTasks: SessionTask[] = [
      makeSessionTask({
        id: "st1",
        sessionId: "session-1",
        taskId: "task-1",
        startTime: utc(2025, 3, 15, 9, 0),
        endTime: utc(2025, 3, 15, 11, 0), // 120 min
      }),
      makeSessionTask({
        id: "st2",
        sessionId: "session-1",
        taskId: "task-2",
        startTime: utc(2025, 3, 15, 13, 0),
        endTime: utc(2025, 3, 15, 15, 30), // 150 min
      }),
    ];

    const tasksById: Record<string, Task> = {
      "task-1": makeTask({ id: "task-1", title: "Fix login bug" }),
      "task-2": makeTask({ id: "task-2", title: "Add dashboard charts" }),
    };

    const report = generateEndOfDayReport(
      "report-1",
      session,
      sessionTasks,
      [],
      [],
      tasksById,
    );

    expect(report.tasksWorked).toHaveLength(2);
    expect(report.tasksWorked[0]).toEqual({
      taskId: "task-1",
      title: "Fix login bug",
      minutes: 120,
    });
    expect(report.tasksWorked[1]).toEqual({
      taskId: "task-2",
      title: "Add dashboard charts",
      minutes: 150,
    });
  });

  it("includes breaks with type and duration (Req 11.1)", () => {
    const breaks: Break[] = [
      makeBreak({
        id: "b1",
        sessionId: "session-1",
        startTime: utc(2025, 3, 15, 10, 30),
        endTime: utc(2025, 3, 15, 10, 45),
        type: "short",
      }),
      makeBreak({
        id: "b2",
        sessionId: "session-1",
        startTime: utc(2025, 3, 15, 12, 0),
        endTime: utc(2025, 3, 15, 13, 0),
        type: "lunch",
      }),
    ];

    const report = generateEndOfDayReport(
      "report-1",
      session,
      [],
      breaks,
      [],
      {},
    );

    expect(report.breaks).toHaveLength(2);
    expect(report.breaks[0]).toEqual({ type: "short", minutes: 15 });
    expect(report.breaks[1]).toEqual({ type: "lunch", minutes: 60 });
  });

  it("includes output note from session (Req 11.1)", () => {
    const report = generateEndOfDayReport(
      "report-1",
      session,
      [],
      [],
      [],
      {},
    );

    expect(report.outputNote).toBe("Shipped the new dashboard");
  });

  it("includes git commits (Req 11.1)", () => {
    const gitEvents: GitEvent[] = [
      makeGitEvent({
        id: "g1",
        userId: "user-1",
        sessionId: "session-1",
        commitHash: "abc123",
        message: "fix: resolve login redirect",
      }),
      makeGitEvent({
        id: "g2",
        userId: "user-1",
        sessionId: "session-1",
        commitHash: "def456",
        message: "feat: add dashboard charts",
      }),
    ];

    const report = generateEndOfDayReport(
      "report-1",
      session,
      [],
      [],
      gitEvents,
      {},
    );

    expect(report.gitCommits).toHaveLength(2);
    expect(report.gitCommits[0]).toEqual({
      hash: "abc123",
      message: "fix: resolve login redirect",
    });
    expect(report.gitCommits[1]).toEqual({
      hash: "def456",
      message: "feat: add dashboard charts",
    });
  });

  it("stores report linked to session (Req 11.2)", () => {
    const report = generateEndOfDayReport(
      "report-1",
      session,
      [],
      [],
      [],
      {},
    );

    expect(report.id).toBe("report-1");
    expect(report.userId).toBe("user-1");
    expect(report.sessionId).toBe("session-1");
    expect(report.date).toBe("2025-03-15");
    expect(report.createdAt).toBeGreaterThan(0);
  });

  it("includes 'No tasks logged' placeholder when no tasks (Req 11.4)", () => {
    const report = generateEndOfDayReport(
      "report-1",
      session,
      [],
      [],
      [],
      {},
    );

    expect(report.tasksWorked).toHaveLength(1);
    expect(report.tasksWorked[0].title).toBe("No tasks logged");
    expect(report.tasksWorked[0].taskId).toBe("");
    expect(report.tasksWorked[0].minutes).toBe(0);
  });

  it("ignores open session tasks (endTime === null)", () => {
    const sessionTasks: SessionTask[] = [
      makeSessionTask({
        id: "st1",
        sessionId: "session-1",
        taskId: "task-1",
        startTime: utc(2025, 3, 15, 9, 0),
        // endTime is null — still active
      }),
    ];

    const tasksById: Record<string, Task> = {
      "task-1": makeTask({ id: "task-1", title: "Active task" }),
    };

    const report = generateEndOfDayReport(
      "report-1",
      session,
      sessionTasks,
      [],
      [],
      tasksById,
    );

    // Open task ignored, so "No tasks logged" placeholder
    expect(report.tasksWorked).toHaveLength(1);
    expect(report.tasksWorked[0].title).toBe("No tasks logged");
  });

  it("ignores open breaks (endTime === null)", () => {
    const breaks: Break[] = [
      makeBreak({
        id: "b1",
        sessionId: "session-1",
        startTime: utc(2025, 3, 15, 15, 0),
        // endTime is null — still active
      }),
    ];

    const report = generateEndOfDayReport(
      "report-1",
      session,
      [],
      breaks,
      [],
      {},
    );

    expect(report.breaks).toHaveLength(0);
    // 8h session, no closed breaks deducted
    expect(report.totalMinutes).toBe(480);
  });

  it("handles null output note", () => {
    const noNoteSession = makeSession({
      id: "session-1",
      userId: "user-1",
      startTime: utc(2025, 3, 15, 9, 0),
      endTime: utc(2025, 3, 15, 17, 0),
      outputNote: null,
    });

    const report = generateEndOfDayReport(
      "report-1",
      noNoteSession,
      [],
      [],
      [],
      {},
    );

    expect(report.outputNote).toBeNull();
  });

  it("handles null git commit message", () => {
    const gitEvents: GitEvent[] = [
      makeGitEvent({
        id: "g1",
        userId: "user-1",
        commitHash: "abc123",
        message: null,
      }),
    ];

    const report = generateEndOfDayReport(
      "report-1",
      session,
      [],
      [],
      gitEvents,
      {},
    );

    expect(report.gitCommits[0].message).toBe("");
  });

  it("handles unknown task (missing from tasksById)", () => {
    const sessionTasks: SessionTask[] = [
      makeSessionTask({
        id: "st1",
        sessionId: "session-1",
        taskId: "missing-task",
        startTime: utc(2025, 3, 15, 9, 0),
        endTime: utc(2025, 3, 15, 10, 0),
      }),
    ];

    const report = generateEndOfDayReport(
      "report-1",
      session,
      sessionTasks,
      [],
      [],
      {}, // no tasks
    );

    expect(report.tasksWorked).toHaveLength(1);
    expect(report.tasksWorked[0].title).toBe("Unknown task");
    expect(report.tasksWorked[0].minutes).toBe(60);
  });

  it("ensures totalMinutes is never negative", () => {
    // Edge case: breaks exceed session duration (shouldn't happen, but be safe)
    const shortSession = makeSession({
      id: "session-1",
      userId: "user-1",
      startTime: utc(2025, 3, 15, 9, 0),
      endTime: utc(2025, 3, 15, 9, 30), // 30 min session
    });

    const breaks: Break[] = [
      makeBreak({
        id: "b1",
        sessionId: "session-1",
        startTime: utc(2025, 3, 15, 9, 0),
        endTime: utc(2025, 3, 15, 9, 45), // 45 min break (exceeds session)
      }),
    ];

    const report = generateEndOfDayReport(
      "report-1",
      shortSession,
      [],
      breaks,
      [],
      {},
    );

    expect(report.totalMinutes).toBeGreaterThanOrEqual(0);
  });

  it("full report with all data populated", () => {
    const sessionTasks: SessionTask[] = [
      makeSessionTask({
        id: "st1",
        sessionId: "session-1",
        taskId: "task-1",
        startTime: utc(2025, 3, 15, 9, 0),
        endTime: utc(2025, 3, 15, 11, 0),
      }),
    ];

    const breaks: Break[] = [
      makeBreak({
        id: "b1",
        sessionId: "session-1",
        startTime: utc(2025, 3, 15, 12, 0),
        endTime: utc(2025, 3, 15, 12, 30),
        type: "lunch",
      }),
    ];

    const gitEvents: GitEvent[] = [
      makeGitEvent({
        id: "g1",
        userId: "user-1",
        commitHash: "abc123",
        message: "feat: add reports",
      }),
    ];

    const tasksById: Record<string, Task> = {
      "task-1": makeTask({ id: "task-1", title: "Build reports" }),
    };

    const report = generateEndOfDayReport(
      "report-1",
      session,
      sessionTasks,
      breaks,
      gitEvents,
      tasksById,
    );

    expect(report.id).toBe("report-1");
    expect(report.userId).toBe("user-1");
    expect(report.sessionId).toBe("session-1");
    expect(report.date).toBe("2025-03-15");
    // 8h - 30min lunch = 450 min
    expect(report.totalMinutes).toBe(450);
    expect(report.tasksWorked).toHaveLength(1);
    expect(report.tasksWorked[0].title).toBe("Build reports");
    expect(report.breaks).toHaveLength(1);
    expect(report.outputNote).toBe("Shipped the new dashboard");
    expect(report.gitCommits).toHaveLength(1);
    expect(report.gitCommits[0].hash).toBe("abc123");
  });
});

