import { describe, it, expect } from "vitest";
import { generateEndOfDayReport } from "@/lib/reports";
import type { Session, SessionTask, Break, Meeting, GitEvent, Task } from "@/types";

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

function makeMeeting(
  overrides: Partial<Meeting> & Pick<Meeting, "id" | "breakId" | "sessionId" | "title">,
): Meeting {
  return {
    attendees: null,
    createdAt: utc(2025, 3, 15),
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
      [],
      {},
    );

    expect(report.breaks).toHaveLength(2);
    expect(report.breaks[0]).toEqual({ type: "short", minutes: 15 });
    expect(report.breaks[1]).toEqual({ type: "lunch", minutes: 60 });
  });

  it("includes meetings with title and duration (Req 20.4)", () => {
    const breaks: Break[] = [
      makeBreak({
        id: "b1",
        sessionId: "session-1",
        startTime: utc(2025, 3, 15, 14, 0),
        endTime: utc(2025, 3, 15, 14, 45),
        type: "meeting",
      }),
    ];

    const meetings: Meeting[] = [
      makeMeeting({
        id: "m1",
        breakId: "b1",
        sessionId: "session-1",
        title: "Sprint planning",
      }),
    ];

    const report = generateEndOfDayReport(
      "report-1",
      session,
      [],
      breaks,
      meetings,
      [],
      {},
    );

    expect(report.meetings).toHaveLength(1);
    expect(report.meetings[0]).toEqual({ title: "Sprint planning", minutes: 45 });
  });

  it("includes output note from session (Req 11.1)", () => {
    const report = generateEndOfDayReport(
      "report-1",
      session,
      [],
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
      [],
      {},
    );

    expect(report.totalMinutes).toBeGreaterThanOrEqual(0);
  });

  it("computes meeting duration from linked break", () => {
    const breaks: Break[] = [
      makeBreak({
        id: "b1",
        sessionId: "session-1",
        startTime: utc(2025, 3, 15, 14, 0),
        endTime: utc(2025, 3, 15, 15, 0),
        type: "meeting",
      }),
      makeBreak({
        id: "b2",
        sessionId: "session-1",
        startTime: utc(2025, 3, 15, 16, 0),
        endTime: utc(2025, 3, 15, 16, 30),
        type: "meeting",
      }),
    ];

    const meetings: Meeting[] = [
      makeMeeting({
        id: "m1",
        breakId: "b1",
        sessionId: "session-1",
        title: "Standup",
      }),
      makeMeeting({
        id: "m2",
        breakId: "b2",
        sessionId: "session-1",
        title: "Design review",
      }),
    ];

    const report = generateEndOfDayReport(
      "report-1",
      session,
      [],
      breaks,
      meetings,
      [],
      {},
    );

    expect(report.meetings).toHaveLength(2);
    expect(report.meetings[0]).toEqual({ title: "Standup", minutes: 60 });
    expect(report.meetings[1]).toEqual({ title: "Design review", minutes: 30 });
  });

  it("handles meeting with no linked break (0 minutes)", () => {
    const meetings: Meeting[] = [
      makeMeeting({
        id: "m1",
        breakId: "nonexistent-break",
        sessionId: "session-1",
        title: "Orphan meeting",
      }),
    ];

    const report = generateEndOfDayReport(
      "report-1",
      session,
      [],
      [],
      meetings,
      [],
      {},
    );

    expect(report.meetings).toHaveLength(1);
    expect(report.meetings[0]).toEqual({ title: "Orphan meeting", minutes: 0 });
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
      makeBreak({
        id: "b2",
        sessionId: "session-1",
        startTime: utc(2025, 3, 15, 14, 0),
        endTime: utc(2025, 3, 15, 14, 30),
        type: "meeting",
      }),
    ];

    const meetings: Meeting[] = [
      makeMeeting({
        id: "m1",
        breakId: "b2",
        sessionId: "session-1",
        title: "Sprint planning",
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
      meetings,
      gitEvents,
      tasksById,
    );

    expect(report.id).toBe("report-1");
    expect(report.userId).toBe("user-1");
    expect(report.sessionId).toBe("session-1");
    expect(report.date).toBe("2025-03-15");
    // 8h - 30min lunch - 30min meeting = 420 min
    expect(report.totalMinutes).toBe(420);
    expect(report.tasksWorked).toHaveLength(1);
    expect(report.tasksWorked[0].title).toBe("Build reports");
    expect(report.breaks).toHaveLength(2);
    expect(report.meetings).toHaveLength(1);
    expect(report.meetings[0].title).toBe("Sprint planning");
    expect(report.outputNote).toBe("Shipped the new dashboard");
    expect(report.gitCommits).toHaveLength(1);
    expect(report.gitCommits[0].hash).toBe("abc123");
  });
});


import { generateMorningDigest } from "@/lib/reports";
import type { AttendanceRecord, LeaveRequest, User } from "@/types";

function makeUser(overrides: Partial<User> & Pick<User, "id" | "name">): User {
  return {
    role: null,
    email: `${overrides.id}@test.com`,
    avatarColor: "#000",
    createdAt: utc(2025, 1, 1),
    ...overrides,
  };
}

function makeAttendanceRecord(
  overrides: Partial<AttendanceRecord> & Pick<AttendanceRecord, "userId" | "date">,
): AttendanceRecord {
  return {
    loginTime: null,
    logoutTime: null,
    totalHours: 0,
    breakMinutes: 0,
    outputNote: null,
    ...overrides,
  };
}

function makeLeaveRequest(
  overrides: Partial<LeaveRequest> & Pick<LeaveRequest, "id" | "requesterId" | "type" | "startDate" | "endDate">,
): LeaveRequest {
  return {
    reason: "",
    status: "approved",
    reviewerId: null,
    reviewReason: null,
    createdAt: utc(2025, 1, 1),
    updatedAt: utc(2025, 1, 1),
    ...overrides,
  };
}

describe("generateMorningDigest", () => {
  const members: User[] = [
    makeUser({ id: "user-1", name: "Alice" }),
    makeUser({ id: "user-2", name: "Bob" }),
    makeUser({ id: "user-3", name: "Charlie" }),
  ];

  const today = "2025-03-18"; // Tuesday
  const previousWorkday = "2025-03-17"; // Monday

  it("includes per-member hours, tasks, and output notes from previous workday (Req 12.2)", () => {
    const attendance: AttendanceRecord[] = [
      makeAttendanceRecord({
        userId: "user-1",
        date: "2025-03-17",
        totalHours: 7.5,
        outputNote: "Finished auth module",
      }),
      makeAttendanceRecord({
        userId: "user-2",
        date: "2025-03-17",
        totalHours: 6.0,
        outputNote: null,
      }),
    ];

    const completedTasks: Task[] = [
      makeTask({ id: "t1", title: "Fix login bug", assigneeId: "user-1", status: "done" }),
      makeTask({ id: "t2", title: "Add tests", assigneeId: "user-1", status: "done" }),
      makeTask({ id: "t3", title: "Update docs", assigneeId: "user-2", status: "done" }),
    ];

    const digest = generateMorningDigest(
      "digest-1",
      today,
      previousWorkday,
      attendance,
      completedTasks,
      [],
      members,
    );

    expect(digest.memberSummaries).toHaveLength(3);

    const alice = digest.memberSummaries.find((m) => m.userId === "user-1")!;
    expect(alice.totalHours).toBe(7.5);
    expect(alice.tasksCompleted).toEqual(["Fix login bug", "Add tests"]);
    expect(alice.outputNote).toBe("Finished auth module");

    const bob = digest.memberSummaries.find((m) => m.userId === "user-2")!;
    expect(bob.totalHours).toBe(6.0);
    expect(bob.tasksCompleted).toEqual(["Update docs"]);
    expect(bob.outputNote).toBeNull();

    // Charlie had no activity
    const charlie = digest.memberSummaries.find((m) => m.userId === "user-3")!;
    expect(charlie.totalHours).toBe(0);
    expect(charlie.tasksCompleted).toEqual([]);
    expect(charlie.outputNote).toBeNull();
  });

  it("lists members on leave today (Req 12.3)", () => {
    const todayTs = Date.UTC(2025, 2, 18) / 1000; // March 18

    const leaveRequests: LeaveRequest[] = [
      makeLeaveRequest({
        id: "lr-1",
        requesterId: "user-2",
        type: "annual",
        startDate: todayTs,
        endDate: todayTs + 86400,
        status: "approved",
      }),
    ];

    const digest = generateMorningDigest(
      "digest-1",
      today,
      previousWorkday,
      [],
      [],
      leaveRequests,
      members,
    );

    expect(digest.onLeaveToday).toEqual(["Bob"]);
    expect(digest.onWfhToday).toEqual([]);
  });

  it("lists members on WFH today (Req 12.3)", () => {
    const todayTs = Date.UTC(2025, 2, 18) / 1000;

    const leaveRequests: LeaveRequest[] = [
      makeLeaveRequest({
        id: "lr-1",
        requesterId: "user-3",
        type: "wfh",
        startDate: todayTs,
        endDate: todayTs + 86400,
        status: "approved",
      }),
    ];

    const digest = generateMorningDigest(
      "digest-1",
      today,
      previousWorkday,
      [],
      [],
      leaveRequests,
      members,
    );

    expect(digest.onLeaveToday).toEqual([]);
    expect(digest.onWfhToday).toEqual(["Charlie"]);
  });

  it("separates leave and WFH members correctly", () => {
    const todayTs = Date.UTC(2025, 2, 18) / 1000;

    const leaveRequests: LeaveRequest[] = [
      makeLeaveRequest({
        id: "lr-1",
        requesterId: "user-1",
        type: "sick",
        startDate: todayTs,
        endDate: todayTs + 86400,
        status: "approved",
      }),
      makeLeaveRequest({
        id: "lr-2",
        requesterId: "user-3",
        type: "wfh",
        startDate: todayTs,
        endDate: todayTs + 86400,
        status: "approved",
      }),
    ];

    const digest = generateMorningDigest(
      "digest-1",
      today,
      previousWorkday,
      [],
      [],
      leaveRequests,
      members,
    );

    expect(digest.onLeaveToday).toEqual(["Alice"]);
    expect(digest.onWfhToday).toEqual(["Charlie"]);
  });

  it("ignores pending/declined leave requests", () => {
    const todayTs = Date.UTC(2025, 2, 18) / 1000;

    const leaveRequests: LeaveRequest[] = [
      makeLeaveRequest({
        id: "lr-1",
        requesterId: "user-1",
        type: "annual",
        startDate: todayTs,
        endDate: todayTs + 86400,
        status: "pending",
      }),
      makeLeaveRequest({
        id: "lr-2",
        requesterId: "user-2",
        type: "annual",
        startDate: todayTs,
        endDate: todayTs + 86400,
        status: "declined",
      }),
    ];

    const digest = generateMorningDigest(
      "digest-1",
      today,
      previousWorkday,
      [],
      [],
      leaveRequests,
      members,
    );

    expect(digest.onLeaveToday).toEqual([]);
    expect(digest.onWfhToday).toEqual([]);
  });

  it("handles empty team (no members)", () => {
    const digest = generateMorningDigest(
      "digest-1",
      today,
      previousWorkday,
      [],
      [],
      [],
      [],
    );

    expect(digest.memberSummaries).toEqual([]);
    expect(digest.onLeaveToday).toEqual([]);
    expect(digest.onWfhToday).toEqual([]);
  });

  it("only uses attendance from the previous workday, not other dates", () => {
    const attendance: AttendanceRecord[] = [
      makeAttendanceRecord({
        userId: "user-1",
        date: "2025-03-17",
        totalHours: 8.0,
        outputNote: "Correct day",
      }),
      makeAttendanceRecord({
        userId: "user-1",
        date: "2025-03-16",
        totalHours: 5.0,
        outputNote: "Wrong day",
      }),
    ];

    const digest = generateMorningDigest(
      "digest-1",
      today,
      previousWorkday,
      attendance,
      [],
      [],
      members,
    );

    const alice = digest.memberSummaries.find((m) => m.userId === "user-1")!;
    expect(alice.totalHours).toBe(8.0);
    expect(alice.outputNote).toBe("Correct day");
  });

  it("sets correct metadata fields", () => {
    const digest = generateMorningDigest(
      "digest-42",
      today,
      previousWorkday,
      [],
      [],
      [],
      members,
    );

    expect(digest.id).toBe("digest-42");
    expect(digest.date).toBe("2025-03-18");
    expect(digest.createdAt).toBeGreaterThan(0);
  });

  it("only includes tasks with status 'done' and an assignee", () => {
    const completedTasks: Task[] = [
      makeTask({ id: "t1", title: "Done task", assigneeId: "user-1", status: "done" }),
      makeTask({ id: "t2", title: "Open task", assigneeId: "user-1", status: "open" }),
      makeTask({ id: "t3", title: "Unassigned task", assigneeId: null, status: "done" }),
    ];

    const digest = generateMorningDigest(
      "digest-1",
      today,
      previousWorkday,
      [],
      completedTasks,
      [],
      members,
    );

    const alice = digest.memberSummaries.find((m) => m.userId === "user-1")!;
    expect(alice.tasksCompleted).toEqual(["Done task"]);
  });
});
