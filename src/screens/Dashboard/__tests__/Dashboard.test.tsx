/**
 * Founder Dashboard screen tests.
 *
 * Verifies:
 * - Team status cards render with correct statuses (Req 13.1)
 * - Today's combined team hours displayed (Req 13.2)
 * - Pending approvals count with link to /requests (Req 13.3)
 * - Project health cards render (Req 13.4)
 * - Weekly velocity comparison (Req 14.1)
 * - Upcoming leave list (Req 14.2)
 * - Attendance alerts section (Req 14.3)
 * - Overwork signals with supportive language (Req 26.2, 26.3)
 * - Milestone deadline warnings (Req 17.3)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DashboardData } from "@/types";

/* ── Mock data ── */

const baseDashboardData: DashboardData = {
  teamStatus: [
    { userId: "u-1", name: "Arjun", status: "Active", currentTask: "Build dashboard", sessionDuration: 3600 },
    { userId: "u-2", name: "Priya", status: "On Break", currentTask: null, sessionDuration: 1800 },
    { userId: "u-3", name: "Kiran", status: "Offline", currentTask: null, sessionDuration: null },
    { userId: "u-4", name: "Meera", status: "On Leave", currentTask: null, sessionDuration: null },
    { userId: "u-5", name: "Ravi", status: "WFH", currentTask: "Code review", sessionDuration: 7200 },
  ],
  todayTeamHours: 12.5,
  pendingApprovals: 3,
  projectHealth: [
    { projectId: "p-1", name: "PACE App", openTasks: 12, overdueTasks: 2, hoursThisWeek: 24.5 },
    { projectId: "p-2", name: "Marketing", openTasks: 5, overdueTasks: 0, hoursThisWeek: 8.0 },
  ],
  weeklyVelocity: { current: 15, previous: 12 },
  upcomingLeave: [
    { userId: "u-4", name: "Meera", type: "annual", startDate: 1736928000, endDate: 1737100800 },
  ],
  attendanceAlerts: [
    { userId: "u-6", name: "Dev", label: "Not yet logged in" },
  ],
  milestoneWarnings: [
    { milestoneId: "ms-1", name: "Beta Launch", projectName: "PACE App", deadline: 1737200000, daysRemaining: 2 },
  ],
  overworkSignals: [
    { userId: "u-1", name: "Arjun", daysOver10h: 3, message: "Arjun has worked 10+ hours on 3 days this week. Consider taking a break.", severity: "warning" },
  ],
};

let mockData: DashboardData | null = baseDashboardData;
let mockLoading = false;
const mockRefresh = vi.fn();

vi.mock("@/stores/dashboardStore", () => ({
  useDashboardStore: (selector: (s: { data: DashboardData | null; loading: boolean; refresh: () => Promise<void> }) => unknown) => {
    const state = { data: mockData, loading: mockLoading, refresh: mockRefresh };
    return selector(state);
  },
}));

// Mock TanStack Router Link
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className} data-testid={`link-${to}`}>{children}</a>
  ),
}));

// Mock workspace proof store for check-in status badges (Task 18.13)
const mockSessionProofs: import("@/types").WorkspaceProof[] = [];

vi.mock("@/stores/workspaceProofStore", () => ({
  useWorkspaceProofStore: (selector: (s: { sessionProofs: import("@/types").WorkspaceProof[] }) => unknown) => {
    const state = { sessionProofs: mockSessionProofs };
    return selector(state);
  },
}));

import DashboardScreen from "../index";

beforeEach(() => {
  vi.clearAllMocks();
  mockData = { ...baseDashboardData };
  mockLoading = false;
});

describe("DashboardScreen", () => {
  it("renders the screen header", () => {
    render(<DashboardScreen />);
    expect(screen.getByText("Dashboard")).toBeDefined();
    expect(screen.getByText("Team operations at a glance")).toBeDefined();
  });

  it("calls refresh on mount", () => {
    render(<DashboardScreen />);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("shows loading state when loading with no data", () => {
    mockData = null;
    mockLoading = true;
    render(<DashboardScreen />);
    expect(screen.getByText("Loading dashboard…")).toBeDefined();
  });

  it("shows empty state when no data and not loading", () => {
    mockData = null;
    mockLoading = false;
    render(<DashboardScreen />);
    expect(screen.getByText("No dashboard data available")).toBeDefined();
  });

  /* Req 13.1 — Team status cards */
  it("renders team status cards for each member (Req 13.1)", () => {
    render(<DashboardScreen />);
    // Names may appear in multiple sections (status cards + overwork/leave)
    expect(screen.getAllByText("Arjun").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Priya").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Kiran").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Meera").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Ravi").length).toBeGreaterThanOrEqual(1);
  });

  it("displays correct status badges (Req 13.1)", () => {
    render(<DashboardScreen />);
    expect(screen.getByText("Active")).toBeDefined();
    expect(screen.getByText("On Break")).toBeDefined();
    expect(screen.getByText("Offline")).toBeDefined();
    expect(screen.getByText("On Leave")).toBeDefined();
    expect(screen.getByText("WFH")).toBeDefined();
  });

  it("shows current task for active members", () => {
    render(<DashboardScreen />);
    expect(screen.getByText("Build dashboard")).toBeDefined();
    expect(screen.getByText("Code review")).toBeDefined();
  });

  it("shows session duration for active members", () => {
    render(<DashboardScreen />);
    // Arjun: 3600s = 1h 0m
    expect(screen.getByText("1h 0m")).toBeDefined();
    // Ravi: 7200s = 2h 0m
    expect(screen.getByText("2h 0m")).toBeDefined();
  });

  /* Req 13.2 — Today's combined team hours */
  it("displays today's combined team hours (Req 13.2)", () => {
    render(<DashboardScreen />);
    expect(screen.getByText("12.5")).toBeDefined();
    expect(screen.getByText("Today's Team Hours")).toBeDefined();
  });

  /* Req 13.3 — Pending approvals with link */
  it("displays pending approvals count with link to /requests (Req 13.3)", () => {
    render(<DashboardScreen />);
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("Pending Approvals")).toBeDefined();
    const link = screen.getByTestId("link-/requests");
    expect(link).toBeDefined();
  });

  /* Req 13.4 — Project health */
  it("renders project health cards (Req 13.4)", () => {
    render(<DashboardScreen />);
    expect(screen.getByText("PACE App")).toBeDefined();
    expect(screen.getByText("Marketing")).toBeDefined();
    // Open tasks — "12" appears in both project health and velocity, use getAllByText
    expect(screen.getAllByText("12").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("5").length).toBeGreaterThanOrEqual(1);
  });

  it("hides project health section when empty", () => {
    mockData = { ...baseDashboardData, projectHealth: [] };
    render(<DashboardScreen />);
    expect(screen.queryByText("Project Health")).toBeNull();
  });

  /* Req 14.1 — Weekly velocity */
  it("displays weekly velocity comparison (Req 14.1)", () => {
    render(<DashboardScreen />);
    expect(screen.getByText("This Week")).toBeDefined();
    expect(screen.getByText("Last Week")).toBeDefined();
    // Numbers appear in both metric card and velocity section, use getAllByText
    expect(screen.getAllByText("15").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("12").length).toBeGreaterThanOrEqual(1);
    // +25% change
    expect(screen.getByText("+25%")).toBeDefined();
  });

  /* Req 14.2 — Upcoming leave */
  it("displays upcoming leave entries (Req 14.2)", () => {
    render(<DashboardScreen />);
    expect(screen.getByText("Upcoming Leave (14 days)")).toBeDefined();
    // Meera's leave entry
    const meeraElements = screen.getAllByText("Meera");
    expect(meeraElements.length).toBeGreaterThanOrEqual(2); // status card + leave entry
    expect(screen.getByText("annual")).toBeDefined();
  });

  it("shows empty message when no upcoming leave", () => {
    mockData = { ...baseDashboardData, upcomingLeave: [] };
    render(<DashboardScreen />);
    expect(screen.getByText("No upcoming leave")).toBeDefined();
  });

  /* Req 14.3 — Attendance alerts */
  it("displays attendance alerts (Req 14.3)", () => {
    render(<DashboardScreen />);
    expect(screen.getByText("Attendance Alerts")).toBeDefined();
    expect(screen.getByText("Dev")).toBeDefined();
    expect(screen.getByText("— Not yet logged in")).toBeDefined();
  });

  it("hides attendance alerts section when empty", () => {
    mockData = { ...baseDashboardData, attendanceAlerts: [] };
    render(<DashboardScreen />);
    expect(screen.queryByText("Attendance Alerts")).toBeNull();
  });

  /* Overwork signals (Req 26.2, 26.3) */
  it("displays overwork signals with supportive language (Req 26.2, 26.3)", () => {
    render(<DashboardScreen />);
    expect(screen.getByText("Wellbeing Signals")).toBeDefined();
    expect(screen.getByText(/Consider taking a break/)).toBeDefined();
  });

  it("hides overwork section when empty", () => {
    mockData = { ...baseDashboardData, overworkSignals: [] };
    render(<DashboardScreen />);
    expect(screen.queryByText("Wellbeing Signals")).toBeNull();
  });

  /* Milestone warnings (Req 17.3) */
  it("displays milestone deadline warnings", () => {
    render(<DashboardScreen />);
    expect(screen.getByText("Milestone Deadlines")).toBeDefined();
    expect(screen.getByText("Beta Launch")).toBeDefined();
    expect(screen.getByText("(PACE App)")).toBeDefined();
    expect(screen.getByText("2d left")).toBeDefined();
  });

  it("hides milestone section when empty", () => {
    mockData = { ...baseDashboardData, milestoneWarnings: [] };
    render(<DashboardScreen />);
    expect(screen.queryByText("Milestone Deadlines")).toBeNull();
  });

  /* Edge: no team members */
  it("shows empty team message when no members", () => {
    mockData = { ...baseDashboardData, teamStatus: [] };
    render(<DashboardScreen />);
    expect(screen.getByText("No team members")).toBeDefined();
  });

  /* Task 18.13 — Check-in status per member */
  it("shows check-in status badge when proof exists (Task 18.13)", () => {
    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    mockSessionProofs.length = 0;
    mockSessionProofs.push({
      id: "proof-1",
      sessionId: "s-1",
      userId: "u-1",
      type: "checkin",
      photoPath: "proofs/test.jpg",
      photoHash: "abc123",
      lat: 12.97,
      lng: 77.59,
      accuracy: 50,
      locationId: null,
      aiVerified: "yes",
      aiReason: "Workspace visible",
      exifTimestamp: null,
      createdAt: todayStart + 100,
    });

    render(<DashboardScreen />);
    expect(screen.getByText(/Verified/)).toBeDefined();
  });

  it("shows no check-in badge when no proofs exist (Task 18.13)", () => {
    mockSessionProofs.length = 0;
    render(<DashboardScreen />);
    // "Verified" should not appear as a check-in badge
    // (it may appear as part of other content, so we check specifically for the emoji pattern)
    expect(screen.queryByText("✅ Verified")).toBeNull();
  });
});
