/**
 * Team Analytics screen tests.
 *
 * Verifies:
 * - Screen header renders (Req 9.6)
 * - Tab switching between Individual and Team
 * - Individual tab: labeled metrics displayed (Req 9.6)
 * - Focus score displayed only on individual view (Req 16.2, 25.1)
 * - Team tab: project hours, velocity, heatmap, leave impact (Req 10.1-10.4)
 * - Overwork signals with supportive language (Req 10.5)
 * - No comparative rankings (Req 10.6)
 * - Empty states handled gracefully
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IndividualAnalytics, TeamAnalytics, FocusScore, OverworkSignal } from "@/types";

/* ── Mock data ── */

const mockIndividual: IndividualAnalytics = {
  userId: "user-1",
  avgDailyHours: 7.5,
  mostProductiveDay: "Wednesday",
  peakFocusRange: "10:00-12:00",
  taskCompletionRate: 0.75,
  outputConsistency: 0.82,
};

const mockTeam: TeamAnalytics = {
  hoursPerProject: [
    { projectId: "p1", projectName: "PACE App", totalHours: 45.5 },
    { projectId: "p2", projectName: "Marketing", totalHours: 12.0 },
  ],
  velocityTrend: [
    { weekStart: "2025-02-17", tasksCompleted: 8 },
    { weekStart: "2025-02-24", tasksCompleted: 12 },
    { weekStart: "2025-03-03", tasksCompleted: 10 },
    { weekStart: "2025-03-10", tasksCompleted: 15 },
    { weekStart: "2025-03-17", tasksCompleted: 11 },
    { weekStart: "2025-03-24", tasksCompleted: 14 },
    { weekStart: "2025-03-31", tasksCompleted: 9 },
    { weekStart: "2025-04-07", tasksCompleted: 13 },
  ],
  availabilityHeatmap: [
    {
      userId: "u1",
      name: "Alice",
      dailyHours: [
        { date: "2025-03-10", hours: 8 },
        { date: "2025-03-11", hours: 7 },
      ],
    },
    {
      userId: "u2",
      name: "Bob",
      dailyHours: [
        { date: "2025-03-10", hours: 6 },
        { date: "2025-03-11", hours: 9 },
      ],
    },
  ],
  leaveImpactPct: 14.3,
};

const mockFocusScore: FocusScore = {
  sessionContinuity: 0.85,
  avgUninterruptedMin: 45,
  taskCompletionRate: 0.75,
  compositeScore: 72,
};

const mockOverwork: OverworkSignal[] = [
  {
    userId: "u1",
    name: "Alice",
    daysOver10h: 3,
    message: "Alice has worked 10+ hours on 3 days this week. Consider taking a break.",
    severity: "warning",
  },
];

/* ── Store mock ── */

let storeState: {
  individual: IndividualAnalytics | null;
  team: TeamAnalytics | null;
  focusScore: FocusScore | null;
  overworkSignals: OverworkSignal[];
  loading: boolean;
};

vi.mock("@/stores/analyticsStore", () => ({
  useAnalyticsStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

import AnalyticsScreen from "../index";

beforeEach(() => {
  vi.clearAllMocks();
  storeState = {
    individual: mockIndividual,
    team: mockTeam,
    focusScore: mockFocusScore,
    overworkSignals: [],
    loading: false,
  };
});

describe("AnalyticsScreen", () => {
  it("renders the screen header", () => {
    render(<AnalyticsScreen />);
    expect(screen.getByText("Analytics")).toBeDefined();
    expect(screen.getByText("Personal and team performance insights")).toBeDefined();
  });

  it("shows loading state when loading with no data", () => {
    storeState = { ...storeState, individual: null, team: null, loading: true };
    render(<AnalyticsScreen />);
    expect(screen.getByText("Loading analytics…")).toBeDefined();
  });

  it("defaults to Individual tab", () => {
    render(<AnalyticsScreen />);
    const individualTab = screen.getByRole("tab", { name: /Individual/i });
    expect(individualTab.getAttribute("aria-selected")).toBe("true");
  });

  /* ── Individual Tab (Req 9.6) ── */

  it("displays individual metrics with labels (Req 9.6)", () => {
    render(<AnalyticsScreen />);
    expect(screen.getByText("Avg Daily Hours")).toBeDefined();
    expect(screen.getByText("7.5")).toBeDefined();
    expect(screen.getByText("Most Productive Day")).toBeDefined();
    expect(screen.getByText("Wednesday")).toBeDefined();
    expect(screen.getByText("Peak Focus Range")).toBeDefined();
    expect(screen.getByText("10:00-12:00")).toBeDefined();
    expect(screen.getByText("Task Completion Rate")).toBeDefined();
    expect(screen.getAllByText("75%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Output Consistency")).toBeDefined();
    expect(screen.getByText("0.82")).toBeDefined();
  });

  it("shows empty state when no individual data", () => {
    storeState = { ...storeState, individual: null };
    render(<AnalyticsScreen />);
    expect(screen.getByText("No individual analytics data available")).toBeDefined();
  });

  /* ── Focus Score (Req 16.2, 25.1) ── */

  it("displays focus score on individual tab with private label (Req 16.2, 25.1)", () => {
    render(<AnalyticsScreen />);
    expect(screen.getByText(/Focus Score/)).toBeDefined();
    expect(screen.getByText("Private")).toBeDefined();
    expect(screen.getByText("Never shared with your team")).toBeDefined();
    expect(screen.getByText("72")).toBeDefined(); // composite score
    expect(screen.getByText("85%")).toBeDefined(); // continuity
  });

  it("hides focus score when not available", () => {
    storeState = { ...storeState, focusScore: null };
    render(<AnalyticsScreen />);
    expect(screen.queryByText(/Focus Score/)).toBeNull();
  });

  it("does NOT show focus score on team tab (Req 16.2)", () => {
    render(<AnalyticsScreen />);
    // Switch to team tab
    fireEvent.click(screen.getByRole("tab", { name: /Team/i }));
    expect(screen.queryByText("Private")).toBeNull();
    expect(screen.queryByText("Never shared with your team")).toBeNull();
  });

  /* ── Tab Switching ── */

  it("switches to Team tab on click", () => {
    render(<AnalyticsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /Team/i }));
    const teamTab = screen.getByRole("tab", { name: /Team/i });
    expect(teamTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Hours per Project")).toBeDefined();
  });

  it("switches back to Individual tab", () => {
    render(<AnalyticsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /Team/i }));
    fireEvent.click(screen.getByRole("tab", { name: /Individual/i }));
    expect(screen.getByText("Avg Daily Hours")).toBeDefined();
  });

  /* ── Team Tab (Req 10.1-10.4) ── */

  it("displays hours per project (Req 10.1)", () => {
    render(<AnalyticsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /Team/i }));
    expect(screen.getByText("PACE App")).toBeDefined();
    expect(screen.getByText("45.5h")).toBeDefined();
    expect(screen.getByText("Marketing")).toBeDefined();
    expect(screen.getByText("12.0h")).toBeDefined();
  });

  it("displays velocity trend (Req 10.2)", () => {
    render(<AnalyticsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /Team/i }));
    expect(screen.getByText("Velocity Trend (8 weeks)")).toBeDefined();
  });

  it("displays availability heatmap with member names (Req 10.3)", () => {
    render(<AnalyticsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /Team/i }));
    expect(screen.getByText("Availability Heatmap")).toBeDefined();
    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.getByText("Bob")).toBeDefined();
  });

  it("displays leave impact percentage (Req 10.4)", () => {
    render(<AnalyticsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /Team/i }));
    expect(screen.getByText("Leave Impact")).toBeDefined();
    expect(screen.getByText("14.3%")).toBeDefined();
    expect(screen.getByText("reduction in team hours during leave weeks")).toBeDefined();
  });

  it("shows empty state when no team data", () => {
    storeState = { ...storeState, team: null };
    render(<AnalyticsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /Team/i }));
    expect(screen.getByText("No team analytics data available")).toBeDefined();
  });

  it("shows empty project hours message when none", () => {
    storeState = { ...storeState, team: { ...mockTeam, hoursPerProject: [] } };
    render(<AnalyticsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /Team/i }));
    expect(screen.getByText("No project hours recorded")).toBeDefined();
  });

  /* ── Overwork Signals (Req 10.5) ── */

  it("displays overwork signals with supportive language on individual tab (Req 10.5)", () => {
    storeState = { ...storeState, overworkSignals: mockOverwork };
    render(<AnalyticsScreen />);
    expect(screen.getByText("Wellbeing Signals")).toBeDefined();
    expect(screen.getByText(/Consider taking a break/)).toBeDefined();
  });

  it("displays overwork signals on team tab (Req 10.5)", () => {
    storeState = { ...storeState, overworkSignals: mockOverwork };
    render(<AnalyticsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /Team/i }));
    expect(screen.getByText("Wellbeing Signals")).toBeDefined();
    expect(screen.getByText(/Consider taking a break/)).toBeDefined();
  });

  it("hides overwork section when no signals", () => {
    storeState = { ...storeState, overworkSignals: [] };
    render(<AnalyticsScreen />);
    expect(screen.queryByText("Wellbeing Signals")).toBeNull();
  });

  /* ── No Comparative Rankings (Req 10.6) ── */

  it("does not display any ranking or scoring between members (Req 10.6)", () => {
    render(<AnalyticsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /Team/i }));
    // The heatmap shows individual hours but no rankings
    const html = document.body.innerHTML.toLowerCase();
    expect(html).not.toContain("rank");
    expect(html).not.toContain("leaderboard");
    expect(html).not.toContain("percentile");
  });
});
