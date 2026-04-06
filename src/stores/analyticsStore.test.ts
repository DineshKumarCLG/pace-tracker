/**
 * Analytics store tests.
 *
 * Verifies:
 * - Initial state is null/empty
 * - refreshIndividual populates individual analytics
 * - refreshTeam populates team analytics
 * - refreshFocusScore populates focus score (private)
 * - refreshOverwork populates overwork signals
 * - clearFocusScore resets focus score to null
 * - Error handling sets loading false
 *
 * Requirements: 9.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 16.2, 25.1
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAnalyticsStore } from "./analyticsStore";
import type { AttendanceRecord, Session, Task } from "@/types";

// Mock PocketBase (needed by transitive imports)
vi.mock("@/lib/pocketbase", () => ({
  pb: {
    authStore: { isValid: false, record: null, token: "", clear: vi.fn(), save: vi.fn() },
    collection: vi.fn(() => ({
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      getFullList: vi.fn(async () => []),
    })),
  },
}));

vi.mock("@/lib/leave", () => ({
  createLeaveRequest: vi.fn(),
  approveLeaveRequest: vi.fn(),
  declineLeaveRequest: vi.fn(),
  computeLeaveBalance: vi.fn(),
  getPublicHolidays: vi.fn(),
  isWeekend: vi.fn(() => false),
  isPublicHoliday: vi.fn(() => false),
}));

function utc(y: number, m: number, d: number, h = 0, min = 0): number {
  return Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000);
}

function makeAttendance(date: string, totalHours: number, userId = "user-1"): AttendanceRecord {
  return { userId, date, loginTime: null, logoutTime: null, totalHours, breakMinutes: 0, outputNote: null };
}

function makeSession(id: string, startTime: number, endTime: number | null = null): Session {
  return {
    id, userId: "user-1", startTime, endTime, startType: "manual",
    startVerified: true, outputNote: null, lastHeartbeat: null, syncedAt: null, createdAt: startTime,
  };
}

function makeTask(id: string, status: "open" | "done" | "inprogress" | "blocked"): Task {
  return {
    id, projectId: "p1", title: "Task", status, assigneeId: "user-1",
    priority: "medium", dueDate: null, estimatedMinutes: null, notes: null,
    createdBy: "user-1", createdAt: utc(2025, 3, 1), closedAt: status === "done" ? utc(2025, 3, 10) : null,
  };
}

describe("analyticsStore", () => {
  beforeEach(() => {
    useAnalyticsStore.setState({
      individual: null,
      team: null,
      focusScore: null,
      overworkSignals: [],
      loading: false,
    });
  });

  it("starts with null state and loading false", () => {
    const state = useAnalyticsStore.getState();
    expect(state.individual).toBeNull();
    expect(state.team).toBeNull();
    expect(state.focusScore).toBeNull();
    expect(state.overworkSignals).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("refreshIndividual populates individual analytics", () => {
    const records = [
      makeAttendance("2025-03-10", 8),
      makeAttendance("2025-03-11", 6),
    ];
    const sessions = [
      makeSession("s1", utc(2025, 3, 10, 9), utc(2025, 3, 10, 11)),
    ];
    const tasks = [makeTask("t1", "done"), makeTask("t2", "open")];

    useAnalyticsStore.getState().refreshIndividual("user-1", records, sessions, tasks);

    const state = useAnalyticsStore.getState();
    expect(state.individual).not.toBeNull();
    expect(state.individual!.userId).toBe("user-1");
    expect(state.individual!.avgDailyHours).toBeCloseTo(7, 1);
    expect(state.individual!.taskCompletionRate).toBeCloseTo(0.5, 2);
    expect(state.loading).toBe(false);
  });

  it("refreshTeam populates team analytics", () => {
    const members = [{ userId: "u1", name: "Alice" }];

    useAnalyticsStore.getState().refreshTeam(
      [], // sessionTasks
      [], // tasks
      [], // projects
      [], // attendanceRecords
      members,
      [], // leaveRequests
      utc(2025, 3, 12),
    );

    const state = useAnalyticsStore.getState();
    expect(state.team).not.toBeNull();
    expect(state.team!.velocityTrend).toHaveLength(8);
    expect(state.team!.availabilityHeatmap).toHaveLength(1);
    expect(state.loading).toBe(false);
  });

  it("refreshFocusScore populates focus score (Req 16.2, 25.1)", () => {
    const sessions = [
      makeSession("s1", utc(2025, 3, 10, 9), utc(2025, 3, 10, 11)),
    ];
    const tasks = [makeTask("t1", "done")];

    useAnalyticsStore.getState().refreshFocusScore(
      sessions,
      new Map(),
      new Map(),
      tasks,
    );

    const state = useAnalyticsStore.getState();
    expect(state.focusScore).not.toBeNull();
    expect(state.focusScore!.compositeScore).toBeGreaterThanOrEqual(0);
    expect(state.focusScore!.compositeScore).toBeLessThanOrEqual(100);
  });

  it("clearFocusScore resets focus score to null", () => {
    // First set a focus score
    const sessions = [
      makeSession("s1", utc(2025, 3, 10, 9), utc(2025, 3, 10, 11)),
    ];
    useAnalyticsStore.getState().refreshFocusScore(sessions, new Map(), new Map(), []);
    expect(useAnalyticsStore.getState().focusScore).not.toBeNull();

    // Clear it
    useAnalyticsStore.getState().clearFocusScore();
    expect(useAnalyticsStore.getState().focusScore).toBeNull();
  });

  it("refreshOverwork populates overwork signals with supportive language (Req 10.5)", () => {
    const members = [
      { userId: "u1", name: "Alice", status: "active", currentTask: null, sessionStart: null, breakStart: null, outputNote: null, avatarColor: "#000" },
    ];
    const records = [
      makeAttendance("2025-03-10", 11, "u1"),
      makeAttendance("2025-03-11", 12, "u1"),
      makeAttendance("2025-03-12", 10.5, "u1"),
    ];

    useAnalyticsStore.getState().refreshOverwork(members, records);

    const state = useAnalyticsStore.getState();
    expect(state.overworkSignals).toHaveLength(1);
    expect(state.overworkSignals[0].name).toBe("Alice");
    expect(state.overworkSignals[0].message).toContain("Consider taking a break");
  });

  it("refreshOverwork returns empty when no overwork detected", () => {
    const members = [
      { userId: "u1", name: "Alice", status: "active", currentTask: null, sessionStart: null, breakStart: null, outputNote: null, avatarColor: "#000" },
    ];
    const records = [
      makeAttendance("2025-03-10", 8, "u1"),
      makeAttendance("2025-03-11", 7, "u1"),
    ];

    useAnalyticsStore.getState().refreshOverwork(members, records);
    expect(useAnalyticsStore.getState().overworkSignals).toEqual([]);
  });

  it("refreshIndividual handles empty inputs gracefully", () => {
    useAnalyticsStore.getState().refreshIndividual("user-1", [], [], []);

    const state = useAnalyticsStore.getState();
    expect(state.individual).not.toBeNull();
    expect(state.individual!.avgDailyHours).toBe(0);
    expect(state.individual!.taskCompletionRate).toBe(0);
  });
});
