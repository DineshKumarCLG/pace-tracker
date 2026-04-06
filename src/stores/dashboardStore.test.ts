import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDashboardStore } from "./dashboardStore";
import { useTeamStore } from "./teamStore";
import { useLeaveStore } from "./leaveStore";
import type { TeamMember, LeaveRequest } from "@/types";

// Mock PocketBase (needed by authStore → leaveStore)
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

// Mock leave functions (leaveStore imports them)
vi.mock("@/lib/leave", () => ({
  createLeaveRequest: vi.fn(),
  approveLeaveRequest: vi.fn(),
  declineLeaveRequest: vi.fn(),
  computeLeaveBalance: vi.fn(),
  getPublicHolidays: vi.fn(),
  isWeekend: vi.fn(() => false),
  isPublicHoliday: vi.fn(() => false),
}));

const now = Math.floor(Date.now() / 1000);

const alice: TeamMember = {
  userId: "u-alice",
  name: "Alice",
  status: "active",
  currentTask: "Build UI",
  sessionStart: now - 3600,
  breakStart: null,
  outputNote: null,
  avatarColor: "#6e6af6",
};

const bob: TeamMember = {
  userId: "u-bob",
  name: "Bob",
  status: "offline",
  currentTask: null,
  sessionStart: null,
  breakStart: null,
  outputNote: null,
  avatarColor: "#e6a030",
};

describe("dashboardStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDashboardStore.setState({ data: null, loading: false });
    useTeamStore.setState({ members: {} });
    useLeaveStore.setState({
      requests: [],
      balances: {},
      publicHolidays: [],
      loading: false,
    });
  });

  it("starts with null data and loading false", () => {
    const state = useDashboardStore.getState();
    expect(state.data).toBeNull();
    expect(state.loading).toBe(false);
  });

  it("refresh sets loading true then false", async () => {
    useTeamStore.setState({
      members: { "u-alice": alice },
    });

    await useDashboardStore.getState().refresh();

    expect(useDashboardStore.getState().loading).toBe(false);
    expect(useDashboardStore.getState().data).not.toBeNull();
  });

  it("refresh aggregates team status from teamStore members", async () => {
    useTeamStore.setState({
      members: { "u-alice": alice, "u-bob": bob },
    });

    await useDashboardStore.getState().refresh();

    const data = useDashboardStore.getState().data!;
    expect(data.teamStatus).toHaveLength(2);

    const aliceStatus = data.teamStatus.find((s) => s.userId === "u-alice");
    expect(aliceStatus?.status).toBe("Active");
    expect(aliceStatus?.currentTask).toBe("Build UI");
    expect(aliceStatus?.sessionDuration).toBeGreaterThan(0);

    const bobStatus = data.teamStatus.find((s) => s.userId === "u-bob");
    expect(bobStatus?.status).toBe("Offline");
    expect(bobStatus?.sessionDuration).toBeNull();
  });

  it("refresh marks member as On Leave when on approved annual leave", async () => {
    const leaveRequest: LeaveRequest = {
      id: "lr-1",
      requesterId: "u-bob",
      type: "annual",
      startDate: now - 86400,
      endDate: now + 86400,
      reason: "Vacation",
      status: "approved",
      reviewerId: "u-alice",
      reviewReason: null,
      createdAt: now - 86400,
      updatedAt: now - 86400,
    };

    useTeamStore.setState({ members: { "u-bob": bob } });
    useLeaveStore.setState({ requests: [leaveRequest] });

    await useDashboardStore.getState().refresh();

    const data = useDashboardStore.getState().data!;
    const bobStatus = data.teamStatus.find((s) => s.userId === "u-bob");
    expect(bobStatus?.status).toBe("On Leave");
  });

  it("refresh marks offline member as WFH when on approved WFH", async () => {
    const wfhRequest: LeaveRequest = {
      id: "lr-2",
      requesterId: "u-bob",
      type: "wfh",
      startDate: now - 86400,
      endDate: now + 86400,
      reason: "Working from home",
      status: "approved",
      reviewerId: "u-alice",
      reviewReason: null,
      createdAt: now - 86400,
      updatedAt: now - 86400,
    };

    useTeamStore.setState({ members: { "u-bob": bob } });
    useLeaveStore.setState({ requests: [wfhRequest] });

    await useDashboardStore.getState().refresh();

    const data = useDashboardStore.getState().data!;
    const bobStatus = data.teamStatus.find((s) => s.userId === "u-bob");
    expect(bobStatus?.status).toBe("WFH");
  });

  it("refresh computes today's combined team hours from active sessions", async () => {
    useTeamStore.setState({
      members: {
        "u-alice": { ...alice, sessionStart: now - 7200 }, // 2 hours
        "u-bob": { ...bob, sessionStart: now - 3600 },     // 1 hour
      },
    });

    await useDashboardStore.getState().refresh();

    const data = useDashboardStore.getState().data!;
    // Should be approximately 3 hours (some tolerance for test execution time)
    expect(data.todayTeamHours).toBeGreaterThanOrEqual(2.9);
    expect(data.todayTeamHours).toBeLessThanOrEqual(3.1);
  });

  it("refresh counts pending approvals from leaveStore", async () => {
    const pending1: LeaveRequest = {
      id: "lr-p1",
      requesterId: "u-alice",
      type: "annual",
      startDate: now + 86400,
      endDate: now + 86400 * 3,
      reason: "Trip",
      status: "pending",
      reviewerId: null,
      reviewReason: null,
      createdAt: now,
      updatedAt: now,
    };
    const pending2: LeaveRequest = {
      id: "lr-p2",
      requesterId: "u-bob",
      type: "wfh",
      startDate: now + 86400,
      endDate: now + 86400,
      reason: "Remote",
      status: "pending",
      reviewerId: null,
      reviewReason: null,
      createdAt: now,
      updatedAt: now,
    };
    const approved: LeaveRequest = {
      id: "lr-a1",
      requesterId: "u-alice",
      type: "sick",
      startDate: now - 86400,
      endDate: now,
      reason: "Sick",
      status: "approved",
      reviewerId: null,
      reviewReason: null,
      createdAt: now - 86400,
      updatedAt: now - 86400,
    };

    useTeamStore.setState({ members: { "u-alice": alice } });
    useLeaveStore.setState({ requests: [pending1, pending2, approved] });

    await useDashboardStore.getState().refresh();

    const data = useDashboardStore.getState().data!;
    expect(data.pendingApprovals).toBe(2);
  });

  it("refresh computes upcoming leave within 14-day window", async () => {
    const upcoming: LeaveRequest = {
      id: "lr-up",
      requesterId: "u-alice",
      type: "annual",
      startDate: now + 86400 * 5,
      endDate: now + 86400 * 7,
      reason: "Trip",
      status: "approved",
      reviewerId: "u-bob",
      reviewReason: null,
      createdAt: now,
      updatedAt: now,
    };
    const tooFar: LeaveRequest = {
      id: "lr-far",
      requesterId: "u-bob",
      type: "annual",
      startDate: now + 86400 * 20,
      endDate: now + 86400 * 22,
      reason: "Holiday",
      status: "approved",
      reviewerId: "u-alice",
      reviewReason: null,
      createdAt: now,
      updatedAt: now,
    };

    useTeamStore.setState({
      members: { "u-alice": alice, "u-bob": bob },
    });
    useLeaveStore.setState({ requests: [upcoming, tooFar] });

    await useDashboardStore.getState().refresh();

    const data = useDashboardStore.getState().data!;
    expect(data.upcomingLeave).toHaveLength(1);
    expect(data.upcomingLeave[0].userId).toBe("u-alice");
    expect(data.upcomingLeave[0].name).toBe("Alice");
  });

  it("refresh provides demo data for project health, velocity, and milestones", async () => {
    useTeamStore.setState({ members: { "u-alice": alice } });

    await useDashboardStore.getState().refresh();

    const data = useDashboardStore.getState().data!;
    expect(data.projectHealth.length).toBeGreaterThan(0);
    expect(data.milestoneWarnings.length).toBeGreaterThan(0);
    expect(data.weeklyVelocity.current).toBeGreaterThan(0);
  });

  it("refresh handles empty team gracefully", async () => {
    await useDashboardStore.getState().refresh();

    const data = useDashboardStore.getState().data!;
    expect(data.teamStatus).toEqual([]);
    expect(data.todayTeamHours).toBe(0);
    expect(data.pendingApprovals).toBe(0);
    expect(data.upcomingLeave).toEqual([]);
  });

  it("refresh sets loading false even on error", async () => {
    // Force an error by making teamStore throw
    vi.spyOn(useTeamStore, "getState").mockImplementationOnce(() => {
      throw new Error("Store error");
    });

    await useDashboardStore.getState().refresh();

    expect(useDashboardStore.getState().loading).toBe(false);

    // Restore
    vi.mocked(useTeamStore.getState).mockRestore();
  });
});
