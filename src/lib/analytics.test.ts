import { describe, it, expect } from "vitest";
import {
  computeAvgDailyHours,
  computeMostProductiveDay,
  computePeakFocusRange,
  computeTaskCompletionRate,
  computeOutputConsistency,
  getIndividualAnalytics,
} from "@/lib/analytics";
import type { AttendanceRecord, Session, Task } from "@/types";

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

function makeAttendance(
  overrides: Partial<AttendanceRecord> & Pick<AttendanceRecord, "date" | "totalHours">,
): AttendanceRecord {
  return {
    userId: "user-1",
    loginTime: null,
    logoutTime: null,
    breakMinutes: 0,
    outputNote: null,
    ...overrides,
  };
}

function makeSession(
  overrides: Partial<Session> & Pick<Session, "id" | "startTime">,
): Session {
  return {
    userId: "user-1",
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

function makeTask(
  overrides: Partial<Task> & Pick<Task, "id" | "status">,
): Task {
  return {
    projectId: "proj-1",
    title: "Test task",
    assigneeId: "user-1",
    priority: "medium",
    dueDate: null,
    estimatedMinutes: null,
    notes: null,
    createdBy: "user-1",
    createdAt: utc(2025, 3, 1),
    closedAt: null,
    ...overrides,
  };
}

describe("computeAvgDailyHours (Req 9.1)", () => {
  it("returns 0 for empty records", () => {
    expect(computeAvgDailyHours([])).toBe(0);
  });

  it("computes mean of totalHours across all days", () => {
    const records = [
      makeAttendance({ date: "2025-03-10", totalHours: 8 }),
      makeAttendance({ date: "2025-03-11", totalHours: 6 }),
      makeAttendance({ date: "2025-03-12", totalHours: 7 }),
    ];
    expect(computeAvgDailyHours(records)).toBeCloseTo(7, 4);
  });

  it("handles a single day", () => {
    const records = [makeAttendance({ date: "2025-03-10", totalHours: 5.5 })];
    expect(computeAvgDailyHours(records)).toBeCloseTo(5.5, 4);
  });

  it("handles days with zero hours", () => {
    const records = [
      makeAttendance({ date: "2025-03-10", totalHours: 8 }),
      makeAttendance({ date: "2025-03-11", totalHours: 0 }),
    ];
    expect(computeAvgDailyHours(records)).toBeCloseTo(4, 4);
  });
});

describe("computeMostProductiveDay (Req 9.2)", () => {
  it("returns Monday as default for empty records", () => {
    expect(computeMostProductiveDay([])).toBe("Monday");
  });

  it("returns the weekday with highest average hours", () => {
    // 2025-03-10 = Monday, 2025-03-11 = Tuesday, 2025-03-17 = Monday
    const records = [
      makeAttendance({ date: "2025-03-10", totalHours: 6 }),  // Monday
      makeAttendance({ date: "2025-03-11", totalHours: 9 }),  // Tuesday
      makeAttendance({ date: "2025-03-17", totalHours: 4 }),  // Monday
    ];
    // Monday avg = (6+4)/2 = 5, Tuesday avg = 9/1 = 9
    expect(computeMostProductiveDay(records)).toBe("Tuesday");
  });

  it("handles a single record", () => {
    // 2025-03-14 = Friday
    const records = [makeAttendance({ date: "2025-03-14", totalHours: 8 })];
    expect(computeMostProductiveDay(records)).toBe("Friday");
  });

  it("picks the first weekday when tied", () => {
    // 2025-03-10 = Monday, 2025-03-12 = Wednesday — both 8h, Monday comes first in iteration
    const records = [
      makeAttendance({ date: "2025-03-10", totalHours: 8 }),  // Monday
      makeAttendance({ date: "2025-03-12", totalHours: 8 }),  // Wednesday
    ];
    // Sunday(0) is checked first, then Monday(1) — Monday wins since it's encountered first with 8h
    const result = computeMostProductiveDay(records);
    expect(result).toBe("Monday");
  });
});

describe("computePeakFocusRange (Req 9.3)", () => {
  it("returns default 09:00-11:00 for empty sessions", () => {
    expect(computePeakFocusRange([])).toBe("09:00-11:00");
  });

  it("ignores open sessions", () => {
    const sessions = [
      makeSession({ id: "s1", startTime: utc(2025, 3, 10, 10, 0) }), // no endTime
    ];
    expect(computePeakFocusRange(sessions)).toBe("09:00-11:00");
  });

  it("finds the peak hour from a single session", () => {
    // Session from 10:00 to 12:00 UTC — 2 hours in hour 10 and 11
    const sessions = [
      makeSession({
        id: "s1",
        startTime: utc(2025, 3, 10, 10, 0),
        endTime: utc(2025, 3, 10, 12, 0),
      }),
    ];
    const result = computePeakFocusRange(sessions);
    // Hour 10 has 1h, hour 11 has 1h — peak is hour 10 (first encountered)
    expect(result).toBe("10:00-12:00");
  });

  it("finds peak hour across multiple sessions", () => {
    const sessions = [
      // Session 1: 09:00-10:00 (1h in hour 9)
      makeSession({
        id: "s1",
        startTime: utc(2025, 3, 10, 9, 0),
        endTime: utc(2025, 3, 10, 10, 0),
      }),
      // Session 2: 14:00-17:00 (1h each in hours 14, 15, 16)
      makeSession({
        id: "s2",
        startTime: utc(2025, 3, 10, 14, 0),
        endTime: utc(2025, 3, 10, 17, 0),
      }),
      // Session 3: 14:00-16:00 (1h each in hours 14, 15)
      makeSession({
        id: "s3",
        startTime: utc(2025, 3, 11, 14, 0),
        endTime: utc(2025, 3, 11, 16, 0),
      }),
    ];
    // Hour 14 has 2h total (most), so peak starts at 14
    expect(computePeakFocusRange(sessions)).toBe("14:00-16:00");
  });

  it("handles sessions spanning partial hours", () => {
    // Session from 10:30 to 11:30 — 30min in hour 10, 30min in hour 11
    const sessions = [
      makeSession({
        id: "s1",
        startTime: utc(2025, 3, 10, 10, 30),
        endTime: utc(2025, 3, 10, 11, 30),
      }),
      // Another session 10:00-10:45 — 45min in hour 10
      makeSession({
        id: "s2",
        startTime: utc(2025, 3, 11, 10, 0),
        endTime: utc(2025, 3, 11, 10, 45),
      }),
    ];
    // Hour 10: 30min + 45min = 75min, Hour 11: 30min
    expect(computePeakFocusRange(sessions)).toBe("10:00-12:00");
  });
});

describe("computeTaskCompletionRate (Req 9.4)", () => {
  it("returns 0 for empty tasks", () => {
    expect(computeTaskCompletionRate([])).toBe(0);
  });

  it("computes done / total", () => {
    const tasks = [
      makeTask({ id: "t1", status: "done" }),
      makeTask({ id: "t2", status: "done" }),
      makeTask({ id: "t3", status: "open" }),
      makeTask({ id: "t4", status: "inprogress" }),
    ];
    expect(computeTaskCompletionRate(tasks)).toBeCloseTo(0.5, 4);
  });

  it("returns 1.0 when all tasks are done", () => {
    const tasks = [
      makeTask({ id: "t1", status: "done" }),
      makeTask({ id: "t2", status: "done" }),
    ];
    expect(computeTaskCompletionRate(tasks)).toBe(1);
  });

  it("returns 0 when no tasks are done", () => {
    const tasks = [
      makeTask({ id: "t1", status: "open" }),
      makeTask({ id: "t2", status: "blocked" }),
    ];
    expect(computeTaskCompletionRate(tasks)).toBe(0);
  });
});

describe("computeOutputConsistency (Req 9.5)", () => {
  it("returns 0 for fewer than 2 records", () => {
    expect(computeOutputConsistency([])).toBe(0);
    expect(
      computeOutputConsistency([makeAttendance({ date: "2025-03-10", totalHours: 8 })]),
    ).toBe(0);
  });

  it("returns 0 when all days have the same hours (perfectly consistent)", () => {
    const records = [
      makeAttendance({ date: "2025-03-10", totalHours: 8 }),
      makeAttendance({ date: "2025-03-11", totalHours: 8 }),
      makeAttendance({ date: "2025-03-12", totalHours: 8 }),
    ];
    expect(computeOutputConsistency(records)).toBeCloseTo(0, 4);
  });

  it("computes population std dev of daily hours", () => {
    // Hours: [6, 8, 10] → mean=8, variance=((4+0+4)/3)=2.667, stddev≈1.633
    const records = [
      makeAttendance({ date: "2025-03-10", totalHours: 6 }),
      makeAttendance({ date: "2025-03-11", totalHours: 8 }),
      makeAttendance({ date: "2025-03-12", totalHours: 10 }),
    ];
    expect(computeOutputConsistency(records)).toBeCloseTo(Math.sqrt(8 / 3), 4);
  });

  it("higher variance means higher inconsistency", () => {
    const consistent = [
      makeAttendance({ date: "2025-03-10", totalHours: 7.5 }),
      makeAttendance({ date: "2025-03-11", totalHours: 8 }),
      makeAttendance({ date: "2025-03-12", totalHours: 8.5 }),
    ];
    const inconsistent = [
      makeAttendance({ date: "2025-03-10", totalHours: 2 }),
      makeAttendance({ date: "2025-03-11", totalHours: 8 }),
      makeAttendance({ date: "2025-03-12", totalHours: 14 }),
    ];
    expect(computeOutputConsistency(consistent)).toBeLessThan(
      computeOutputConsistency(inconsistent),
    );
  });
});

describe("getIndividualAnalytics", () => {
  it("returns complete analytics object with all fields", () => {
    const records = [
      makeAttendance({ date: "2025-03-10", totalHours: 8 }),  // Monday
      makeAttendance({ date: "2025-03-11", totalHours: 7 }),  // Tuesday
      makeAttendance({ date: "2025-03-12", totalHours: 9 }),  // Wednesday
    ];
    const sessions = [
      makeSession({
        id: "s1",
        startTime: utc(2025, 3, 10, 10, 0),
        endTime: utc(2025, 3, 10, 12, 0),
      }),
    ];
    const tasks = [
      makeTask({ id: "t1", status: "done" }),
      makeTask({ id: "t2", status: "open" }),
    ];

    const result = getIndividualAnalytics("user-1", records, sessions, tasks);

    expect(result.userId).toBe("user-1");
    expect(result.avgDailyHours).toBeCloseTo(8, 4);
    expect(result.mostProductiveDay).toBe("Wednesday");
    expect(result.peakFocusRange).toBe("10:00-12:00");
    expect(result.taskCompletionRate).toBeCloseTo(0.5, 4);
    expect(result.outputConsistency).toBeGreaterThanOrEqual(0);
  });

  it("handles empty inputs gracefully", () => {
    const result = getIndividualAnalytics("user-1", [], [], []);

    expect(result.userId).toBe("user-1");
    expect(result.avgDailyHours).toBe(0);
    expect(result.mostProductiveDay).toBe("Monday");
    expect(result.peakFocusRange).toBe("09:00-11:00");
    expect(result.taskCompletionRate).toBe(0);
    expect(result.outputConsistency).toBe(0);
  });

  it("taskCompletionRate is between 0 and 1", () => {
    const tasks = [
      makeTask({ id: "t1", status: "done" }),
      makeTask({ id: "t2", status: "done" }),
      makeTask({ id: "t3", status: "inprogress" }),
    ];
    const result = getIndividualAnalytics("user-1", [], [], tasks);
    expect(result.taskCompletionRate).toBeGreaterThanOrEqual(0);
    expect(result.taskCompletionRate).toBeLessThanOrEqual(1);
  });

  it("outputConsistency is non-negative", () => {
    const records = [
      makeAttendance({ date: "2025-03-10", totalHours: 2 }),
      makeAttendance({ date: "2025-03-11", totalHours: 12 }),
    ];
    const result = getIndividualAnalytics("user-1", records, [], []);
    expect(result.outputConsistency).toBeGreaterThanOrEqual(0);
  });
});


// ── Team Analytics Tests (Req 10.1, 10.2, 10.3, 10.4, 10.6) ──

import {
  computeHoursPerProject,
  computeVelocityTrend,
  computeAvailabilityHeatmap,
  computeLeaveImpactPct,
  getTeamAnalytics,
} from "@/lib/analytics";
import type { SessionTask, Project, LeaveRequest } from "@/types";

function makeSessionTask(
  overrides: Partial<SessionTask> & Pick<SessionTask, "id" | "sessionId" | "taskId" | "startTime">,
): SessionTask {
  return {
    endTime: null,
    ...overrides,
  };
}

function makeProject(
  overrides: Partial<Project> & Pick<Project, "id" | "name">,
): Project {
  return {
    color: "#000",
    createdBy: "user-1",
    createdAt: utc(2025, 1, 1),
    archivedAt: null,
    ...overrides,
  };
}

function makeLeaveRequest(
  overrides: Partial<LeaveRequest> & Pick<LeaveRequest, "id" | "requesterId" | "startDate" | "endDate">,
): LeaveRequest {
  return {
    type: "annual",
    reason: "vacation",
    status: "approved",
    reviewerId: "reviewer-1",
    reviewReason: null,
    createdAt: utc(2025, 1, 1),
    updatedAt: utc(2025, 1, 1),
    ...overrides,
  };
}

describe("computeHoursPerProject (Req 10.1)", () => {
  const projects = [
    makeProject({ id: "p1", name: "Alpha" }),
    makeProject({ id: "p2", name: "Beta" }),
  ];
  const tasks = [
    makeTask({ id: "t1", status: "done", projectId: "p1" }),
    makeTask({ id: "t2", status: "inprogress", projectId: "p2" }),
    makeTask({ id: "t3", status: "open", projectId: "p1" }),
  ];

  it("returns empty array when no session tasks", () => {
    expect(computeHoursPerProject([], tasks, projects)).toEqual([]);
  });

  it("groups hours by project from session tasks", () => {
    const sessionTasks = [
      makeSessionTask({ id: "st1", sessionId: "s1", taskId: "t1", startTime: utc(2025, 3, 10, 9, 0), endTime: utc(2025, 3, 10, 11, 0) }), // 2h on p1
      makeSessionTask({ id: "st2", sessionId: "s1", taskId: "t2", startTime: utc(2025, 3, 10, 11, 0), endTime: utc(2025, 3, 10, 13, 0) }), // 2h on p2
      makeSessionTask({ id: "st3", sessionId: "s2", taskId: "t3", startTime: utc(2025, 3, 11, 9, 0), endTime: utc(2025, 3, 11, 12, 0) }), // 3h on p1
    ];

    const result = computeHoursPerProject(sessionTasks, tasks, projects);
    expect(result).toHaveLength(2);

    const alpha = result.find((r) => r.projectId === "p1");
    const beta = result.find((r) => r.projectId === "p2");
    expect(alpha?.totalHours).toBeCloseTo(5, 4);
    expect(alpha?.projectName).toBe("Alpha");
    expect(beta?.totalHours).toBeCloseTo(2, 4);
    expect(beta?.projectName).toBe("Beta");
  });

  it("ignores open session tasks (endTime null)", () => {
    const sessionTasks = [
      makeSessionTask({ id: "st1", sessionId: "s1", taskId: "t1", startTime: utc(2025, 3, 10, 9, 0) }), // no endTime
    ];
    expect(computeHoursPerProject(sessionTasks, tasks, projects)).toEqual([]);
  });

  it("ignores session tasks with unknown task IDs", () => {
    const sessionTasks = [
      makeSessionTask({ id: "st1", sessionId: "s1", taskId: "unknown", startTime: utc(2025, 3, 10, 9, 0), endTime: utc(2025, 3, 10, 11, 0) }),
    ];
    expect(computeHoursPerProject(sessionTasks, tasks, projects)).toEqual([]);
  });

  it("sorts results by totalHours descending", () => {
    const sessionTasks = [
      makeSessionTask({ id: "st1", sessionId: "s1", taskId: "t1", startTime: utc(2025, 3, 10, 9, 0), endTime: utc(2025, 3, 10, 10, 0) }), // 1h on p1
      makeSessionTask({ id: "st2", sessionId: "s1", taskId: "t2", startTime: utc(2025, 3, 10, 10, 0), endTime: utc(2025, 3, 10, 15, 0) }), // 5h on p2
    ];
    const result = computeHoursPerProject(sessionTasks, tasks, projects);
    expect(result[0].projectId).toBe("p2");
    expect(result[1].projectId).toBe("p1");
  });
});

describe("computeVelocityTrend (Req 10.2)", () => {
  it("returns 8 weeks of data", () => {
    const result = computeVelocityTrend([], utc(2025, 3, 12));
    expect(result).toHaveLength(8);
  });

  it("each entry has a weekStart string and tasksCompleted count", () => {
    const result = computeVelocityTrend([], utc(2025, 3, 12));
    for (const entry of result) {
      expect(entry.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.tasksCompleted).toBe(0);
    }
  });

  it("counts done tasks by closedAt within each week", () => {
    // 2025-03-10 is a Monday
    const refDate = utc(2025, 3, 14); // Friday of that week
    const tasks = [
      makeTask({ id: "t1", status: "done", closedAt: utc(2025, 3, 10, 12, 0) }), // Mon of current week
      makeTask({ id: "t2", status: "done", closedAt: utc(2025, 3, 11, 12, 0) }), // Tue of current week
      makeTask({ id: "t3", status: "done", closedAt: utc(2025, 3, 3, 12, 0) }),  // Mon of previous week
      makeTask({ id: "t4", status: "open" }), // not done
    ];

    const result = computeVelocityTrend(tasks, refDate);
    const currentWeek = result.find((w) => w.weekStart === "2025-03-10");
    const prevWeek = result.find((w) => w.weekStart === "2025-03-03");

    expect(currentWeek?.tasksCompleted).toBe(2);
    expect(prevWeek?.tasksCompleted).toBe(1);
  });

  it("does not count tasks without closedAt", () => {
    const tasks = [
      makeTask({ id: "t1", status: "done", closedAt: null }),
    ];
    const result = computeVelocityTrend(tasks, utc(2025, 3, 12));
    const total = result.reduce((s, w) => s + w.tasksCompleted, 0);
    expect(total).toBe(0);
  });

  it("weeks are ordered chronologically", () => {
    const result = computeVelocityTrend([], utc(2025, 3, 12));
    for (let i = 1; i < result.length; i++) {
      expect(result[i].weekStart > result[i - 1].weekStart).toBe(true);
    }
  });
});

describe("computeAvailabilityHeatmap (Req 10.3)", () => {
  const members = [
    { userId: "u1", name: "Alice" },
    { userId: "u2", name: "Bob" },
  ];

  it("returns one row per team member", () => {
    const result = computeAvailabilityHeatmap([], members);
    expect(result).toHaveLength(2);
    expect(result[0].userId).toBe("u1");
    expect(result[1].userId).toBe("u2");
  });

  it("fills in hours from attendance records", () => {
    const records = [
      makeAttendance({ userId: "u1", date: "2025-03-10", totalHours: 8 }),
      makeAttendance({ userId: "u1", date: "2025-03-11", totalHours: 7 }),
      makeAttendance({ userId: "u2", date: "2025-03-10", totalHours: 6 }),
    ];

    const result = computeAvailabilityHeatmap(records, members);
    const alice = result.find((r) => r.userId === "u1")!;
    const bob = result.find((r) => r.userId === "u2")!;

    expect(alice.dailyHours).toHaveLength(2); // 2 unique dates
    expect(alice.dailyHours.find((d) => d.date === "2025-03-10")?.hours).toBe(8);
    expect(alice.dailyHours.find((d) => d.date === "2025-03-11")?.hours).toBe(7);
    expect(bob.dailyHours.find((d) => d.date === "2025-03-10")?.hours).toBe(6);
    expect(bob.dailyHours.find((d) => d.date === "2025-03-11")?.hours).toBe(0); // no record
  });

  it("returns empty dailyHours when no records exist", () => {
    const result = computeAvailabilityHeatmap([], members);
    expect(result[0].dailyHours).toEqual([]);
    expect(result[1].dailyHours).toEqual([]);
  });

  it("dates are sorted chronologically", () => {
    const records = [
      makeAttendance({ userId: "u1", date: "2025-03-12", totalHours: 5 }),
      makeAttendance({ userId: "u1", date: "2025-03-10", totalHours: 8 }),
      makeAttendance({ userId: "u1", date: "2025-03-11", totalHours: 7 }),
    ];
    const result = computeAvailabilityHeatmap(records, members);
    const dates = result[0].dailyHours.map((d) => d.date);
    expect(dates).toEqual(["2025-03-10", "2025-03-11", "2025-03-12"]);
  });
});

describe("computeLeaveImpactPct (Req 10.4)", () => {
  it("returns 0 for empty records", () => {
    expect(computeLeaveImpactPct([], [])).toBe(0);
  });

  it("returns 0 when no leave requests", () => {
    const records = [
      makeAttendance({ date: "2025-03-10", totalHours: 8 }),
      makeAttendance({ date: "2025-03-11", totalHours: 8 }),
    ];
    expect(computeLeaveImpactPct(records, [])).toBe(0);
  });

  it("computes percentage reduction during leave weeks", () => {
    // Week 1 (2025-03-03 Mon): 40h total (no leave)
    // Week 2 (2025-03-10 Mon): 30h total (has leave)
    const records = [
      makeAttendance({ userId: "u1", date: "2025-03-03", totalHours: 8 }),
      makeAttendance({ userId: "u1", date: "2025-03-04", totalHours: 8 }),
      makeAttendance({ userId: "u1", date: "2025-03-05", totalHours: 8 }),
      makeAttendance({ userId: "u1", date: "2025-03-06", totalHours: 8 }),
      makeAttendance({ userId: "u1", date: "2025-03-07", totalHours: 8 }),
      makeAttendance({ userId: "u1", date: "2025-03-10", totalHours: 6 }),
      makeAttendance({ userId: "u1", date: "2025-03-11", totalHours: 6 }),
      makeAttendance({ userId: "u1", date: "2025-03-12", totalHours: 6 }),
      makeAttendance({ userId: "u1", date: "2025-03-13", totalHours: 6 }),
      makeAttendance({ userId: "u1", date: "2025-03-14", totalHours: 6 }),
    ];

    const leaveRequests = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: "u1",
        type: "annual",
        startDate: utc(2025, 3, 10),
        endDate: utc(2025, 3, 11),
      }),
    ];

    const result = computeLeaveImpactPct(records, leaveRequests);
    // avg weekly hours = (40 + 30) / 2 = 35
    // leave week hours = 30
    // impact = (35 - 30) / 35 * 100 ≈ 14.29%
    expect(result).toBeCloseTo(14.29, 1);
  });

  it("ignores WFH requests (only annual/sick count)", () => {
    const records = [
      makeAttendance({ date: "2025-03-10", totalHours: 8 }),
      makeAttendance({ date: "2025-03-11", totalHours: 8 }),
    ];
    const leaveRequests = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: "u1",
        type: "wfh",
        startDate: utc(2025, 3, 10),
        endDate: utc(2025, 3, 11),
      }),
    ];
    expect(computeLeaveImpactPct(records, leaveRequests)).toBe(0);
  });

  it("ignores pending leave requests", () => {
    const records = [
      makeAttendance({ date: "2025-03-10", totalHours: 8 }),
    ];
    const leaveRequests = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: "u1",
        startDate: utc(2025, 3, 10),
        endDate: utc(2025, 3, 11),
        status: "pending",
      }),
    ];
    expect(computeLeaveImpactPct(records, leaveRequests)).toBe(0);
  });

  it("clamps negative impact to 0", () => {
    // Leave week has MORE hours than average — impact should be 0, not negative
    const records = [
      makeAttendance({ date: "2025-03-03", totalHours: 4 }), // week 1: 4h
      makeAttendance({ date: "2025-03-10", totalHours: 10 }), // week 2: 10h (leave week but more hours)
    ];
    const leaveRequests = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: "u1",
        startDate: utc(2025, 3, 10),
        endDate: utc(2025, 3, 10),
      }),
    ];
    expect(computeLeaveImpactPct(records, leaveRequests)).toBe(0);
  });
});

describe("getTeamAnalytics (Req 10.1, 10.2, 10.3, 10.4, 10.6)", () => {
  it("returns complete team analytics object", () => {
    const result = getTeamAnalytics(
      [], // sessionTasks
      [], // tasks
      [], // projects
      [], // attendanceRecords
      [{ userId: "u1", name: "Alice" }], // teamMembers
      [], // leaveRequests
      utc(2025, 3, 12), // referenceDate
    );

    expect(result.hoursPerProject).toEqual([]);
    expect(result.velocityTrend).toHaveLength(8);
    expect(result.availabilityHeatmap).toHaveLength(1);
    expect(result.leaveImpactPct).toBe(0);
  });

  it("does not contain any ranking or scoring fields (Req 10.6)", () => {
    const result = getTeamAnalytics(
      [],
      [],
      [],
      [],
      [{ userId: "u1", name: "Alice" }, { userId: "u2", name: "Bob" }],
      [],
      utc(2025, 3, 12),
    );

    // Verify no ranking/scoring fields exist
    const json = JSON.stringify(result);
    expect(json).not.toContain("rank");
    expect(json).not.toContain("score");
    expect(json).not.toContain("rating");

    // Heatmap entries don't compare members
    for (const row of result.availabilityHeatmap) {
      expect(row).not.toHaveProperty("rank");
      expect(row).not.toHaveProperty("score");
      expect(row).not.toHaveProperty("percentile");
    }
  });
});


// ── Focus Score Tests (Req 16.1, 16.2, 16.3, 16.4) ──

import { computeFocusScore } from "@/lib/analytics";
import type { Break, IdleEvent } from "@/types";

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

function makeIdleEvent(
  overrides: Partial<IdleEvent> & Pick<IdleEvent, "id" | "sessionId" | "startTime">,
): IdleEvent {
  return {
    endTime: null,
    resolution: "pending",
    ...overrides,
  };
}

describe("computeFocusScore (Req 16.1, 16.2)", () => {
  it("returns all zeros for empty inputs", () => {
    const result = computeFocusScore([], new Map(), new Map(), []);
    expect(result.sessionContinuity).toBe(0);
    expect(result.avgUninterruptedMin).toBe(0);
    expect(result.taskCompletionRate).toBe(0);
    expect(result.compositeScore).toBe(0);
  });

  it("returns all zeros when only open sessions exist", () => {
    const sessions = [
      makeSession({ id: "s1", startTime: utc(2025, 3, 10, 9, 0) }), // no endTime
    ];
    const result = computeFocusScore(sessions, new Map(), new Map(), []);
    expect(result.sessionContinuity).toBe(0);
    expect(result.compositeScore).toBe(0);
  });

  it("computes perfect continuity when no breaks or idle", () => {
    // 2h session, no interruptions
    const sessions = [
      makeSession({
        id: "s1",
        startTime: utc(2025, 3, 10, 9, 0),
        endTime: utc(2025, 3, 10, 11, 0),
      }),
    ];
    const result = computeFocusScore(sessions, new Map(), new Map(), []);
    expect(result.sessionContinuity).toBe(1.0);
    // avg uninterrupted = 120 min (the whole session)
    expect(result.avgUninterruptedMin).toBeCloseTo(120, 4);
  });

  it("computes session continuity accounting for breaks", () => {
    // 2h session with a 30min break → continuity = (7200 - 1800) / 7200 = 0.75
    const sessions = [
      makeSession({
        id: "s1",
        startTime: utc(2025, 3, 10, 9, 0),
        endTime: utc(2025, 3, 10, 11, 0),
      }),
    ];
    const breaks = new Map([
      [
        "s1",
        [
          makeBreak({
            id: "b1",
            sessionId: "s1",
            startTime: utc(2025, 3, 10, 10, 0),
            endTime: utc(2025, 3, 10, 10, 30),
          }),
        ],
      ],
    ]);
    const result = computeFocusScore(sessions, breaks, new Map(), []);
    expect(result.sessionContinuity).toBeCloseTo(0.75, 4);
  });

  it("computes session continuity accounting for idle events", () => {
    // 1h session with 15min idle → continuity = (3600 - 900) / 3600 = 0.75
    const sessions = [
      makeSession({
        id: "s1",
        startTime: utc(2025, 3, 10, 9, 0),
        endTime: utc(2025, 3, 10, 10, 0),
      }),
    ];
    const idleEvents = new Map([
      [
        "s1",
        [
          makeIdleEvent({
            id: "ie1",
            sessionId: "s1",
            startTime: utc(2025, 3, 10, 9, 30),
            endTime: utc(2025, 3, 10, 9, 45),
          }),
        ],
      ],
    ]);
    const result = computeFocusScore(sessions, new Map(), idleEvents, []);
    expect(result.sessionContinuity).toBeCloseTo(0.75, 4);
  });

  it("computes uninterrupted segments correctly", () => {
    // 2h session (9:00-11:00) with break at 10:00-10:30
    // Segments: 9:00-10:00 (60min), 10:30-11:00 (30min)
    // avg = (60 + 30) / 2 = 45 min
    const sessions = [
      makeSession({
        id: "s1",
        startTime: utc(2025, 3, 10, 9, 0),
        endTime: utc(2025, 3, 10, 11, 0),
      }),
    ];
    const breaks = new Map([
      [
        "s1",
        [
          makeBreak({
            id: "b1",
            sessionId: "s1",
            startTime: utc(2025, 3, 10, 10, 0),
            endTime: utc(2025, 3, 10, 10, 30),
          }),
        ],
      ],
    ]);
    const result = computeFocusScore(sessions, breaks, new Map(), []);
    expect(result.avgUninterruptedMin).toBeCloseTo(45, 4);
  });

  it("computes task completion rate", () => {
    const tasks = [
      makeTask({ id: "t1", status: "done" }),
      makeTask({ id: "t2", status: "done" }),
      makeTask({ id: "t3", status: "open" }),
      makeTask({ id: "t4", status: "inprogress" }),
    ];
    const result = computeFocusScore([], new Map(), new Map(), tasks);
    expect(result.taskCompletionRate).toBeCloseTo(0.5, 4);
  });

  it("computes weighted composite score correctly", () => {
    // Perfect session: 1h, no breaks → continuity=1.0, avg_uninterrupted=60min
    // All tasks done → completion=1.0
    // composite = (1.0 * 0.4 + min(60/60, 1.0) * 0.3 + 1.0 * 0.3) * 100 = 100
    const sessions = [
      makeSession({
        id: "s1",
        startTime: utc(2025, 3, 10, 9, 0),
        endTime: utc(2025, 3, 10, 10, 0),
      }),
    ];
    const tasks = [makeTask({ id: "t1", status: "done" })];
    const result = computeFocusScore(sessions, new Map(), new Map(), tasks);
    expect(result.compositeScore).toBeCloseTo(100, 1);
  });

  it("caps avg_uninterrupted/60 at 1.0 in composite", () => {
    // 3h session, no breaks → avg_uninterrupted = 180min, 180/60 = 3.0, capped at 1.0
    // No tasks → completion = 0
    // composite = (1.0 * 0.4 + 1.0 * 0.3 + 0 * 0.3) * 100 = 70
    const sessions = [
      makeSession({
        id: "s1",
        startTime: utc(2025, 3, 10, 9, 0),
        endTime: utc(2025, 3, 10, 12, 0),
      }),
    ];
    const result = computeFocusScore(sessions, new Map(), new Map(), []);
    expect(result.compositeScore).toBeCloseTo(70, 1);
  });

  it("composite score is between 0 and 100", () => {
    // Partial scenario: 50% continuity, 30min avg uninterrupted, 50% tasks
    const sessions = [
      makeSession({
        id: "s1",
        startTime: utc(2025, 3, 10, 9, 0),
        endTime: utc(2025, 3, 10, 11, 0), // 2h
      }),
    ];
    const breaks = new Map([
      [
        "s1",
        [
          makeBreak({
            id: "b1",
            sessionId: "s1",
            startTime: utc(2025, 3, 10, 9, 0),
            endTime: utc(2025, 3, 10, 10, 0), // 1h break → 50% continuity
          }),
        ],
      ],
    ]);
    const tasks = [
      makeTask({ id: "t1", status: "done" }),
      makeTask({ id: "t2", status: "open" }),
    ];
    const result = computeFocusScore(sessions, breaks, new Map(), tasks);
    expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore).toBeLessThanOrEqual(100);
  });

  it("ignores open breaks and idle events", () => {
    const sessions = [
      makeSession({
        id: "s1",
        startTime: utc(2025, 3, 10, 9, 0),
        endTime: utc(2025, 3, 10, 10, 0),
      }),
    ];
    // Break with no endTime should be ignored
    const breaks = new Map([
      [
        "s1",
        [
          makeBreak({
            id: "b1",
            sessionId: "s1",
            startTime: utc(2025, 3, 10, 9, 30),
            // no endTime
          }),
        ],
      ],
    ]);
    const idleEvents = new Map([
      [
        "s1",
        [
          makeIdleEvent({
            id: "ie1",
            sessionId: "s1",
            startTime: utc(2025, 3, 10, 9, 45),
            // no endTime
          }),
        ],
      ],
    ]);
    const result = computeFocusScore(sessions, breaks, idleEvents, []);
    // No resolved interruptions → perfect continuity
    expect(result.sessionContinuity).toBe(1.0);
  });

  it("handles multiple sessions with mixed breaks and idle", () => {
    // Session 1: 9:00-11:00 (2h) with 30min break at 10:00-10:30
    // Session 2: 13:00-15:00 (2h) with 15min idle at 14:00-14:15
    // Total session secs = 7200 + 7200 = 14400
    // Total break secs = 1800 + 900 = 2700
    // Continuity = (14400 - 2700) / 14400 ≈ 0.8125
    const sessions = [
      makeSession({
        id: "s1",
        startTime: utc(2025, 3, 10, 9, 0),
        endTime: utc(2025, 3, 10, 11, 0),
      }),
      makeSession({
        id: "s2",
        startTime: utc(2025, 3, 10, 13, 0),
        endTime: utc(2025, 3, 10, 15, 0),
      }),
    ];
    const breaks = new Map([
      [
        "s1",
        [
          makeBreak({
            id: "b1",
            sessionId: "s1",
            startTime: utc(2025, 3, 10, 10, 0),
            endTime: utc(2025, 3, 10, 10, 30),
          }),
        ],
      ],
    ]);
    const idleEvents = new Map([
      [
        "s2",
        [
          makeIdleEvent({
            id: "ie1",
            sessionId: "s2",
            startTime: utc(2025, 3, 10, 14, 0),
            endTime: utc(2025, 3, 10, 14, 15),
          }),
        ],
      ],
    ]);
    const result = computeFocusScore(sessions, breaks, idleEvents, []);
    expect(result.sessionContinuity).toBeCloseTo(0.8125, 4);
    // Segments: s1: 60min, 30min; s2: 60min, 45min → avg = (60+30+60+45)/4 = 48.75 min
    expect(result.avgUninterruptedMin).toBeCloseTo(48.75, 4);
  });
});
