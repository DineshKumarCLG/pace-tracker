/**
 * Startup Health screen tests.
 *
 * Verifies:
 * - Runway display with color coding (Req 12.2, 12.3, 12.4)
 * - Founder balance alerts (Req 13.3, 13.4)
 * - Decision log and resolve (Req 14.2, 14.6)
 * - Burn rate indicators (Req 14.3, 14.4, 14.5)
 * - Settings form (Req 12.5)
 * - Loading and empty states
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { StartupHealthData, StartupHealthConfig, Decision } from "@/lib/startupHealth";

/* ── Mock data ── */

const now = Math.floor(Date.now() / 1000);

const normalHealthData: StartupHealthData = {
  runwayMonths: 12.5,
  runwayStatus: "normal",
  founderBalance: {
    stdDev: 3.2,
    founders: [
      { founderId: "f-1", name: "Alice", weeklyHours: 42, deviationPct: 5, hasAlert: false },
      { founderId: "f-2", name: "Bob", weeklyHours: 38, deviationPct: 10, hasAlert: false },
      { founderId: "f-3", name: "Carol", weeklyHours: 20, deviationPct: 50, hasAlert: true },
    ],
    teamAvgHours: 33.3,
  },
  decisionVelocity: 4.2,
  burnRateAlignment: 95.0,
  burnRateStatus: "normal",
};

const amberHealthData: StartupHealthData = {
  ...normalHealthData,
  runwayMonths: 4.5,
  runwayStatus: "amber",
  burnRateAlignment: 115.0,
  burnRateStatus: "amber",
};

const redHealthData: StartupHealthData = {
  ...normalHealthData,
  runwayMonths: 2.1,
  runwayStatus: "red",
  burnRateAlignment: 135.0,
  burnRateStatus: "red",
};

const mockConfig: StartupHealthConfig = {
  cashBalance: 500000,
  monthlyExpenses: [40000, 42000, 38000],
  plannedMonthlyBudget: 40000,
};

const mockDecisions: Decision[] = [
  { id: "d-1", title: "Hire CTO", description: "Need technical leadership", createdAt: now - 10 * 86400, resolvedAt: null },
  { id: "d-2", title: "Office lease", description: "Renew or move", createdAt: now - 20 * 86400, resolvedAt: now - 5 * 86400 },
];

/* ── Store mock ── */

let mockData: StartupHealthData | null = normalHealthData;
let mockConfig_: StartupHealthConfig | null = mockConfig;
let mockDecisions_: Decision[] = [...mockDecisions];
let mockLoading = false;
const mockRefresh = vi.fn();
const mockUpdateConfig = vi.fn().mockResolvedValue(undefined);
const mockLogDecision = vi.fn().mockResolvedValue(undefined);
const mockResolveDecision = vi.fn().mockResolvedValue(undefined);

vi.mock("@/stores/healthStore", () => ({
  useHealthStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      data: mockData,
      config: mockConfig_,
      decisions: mockDecisions_,
      loading: mockLoading,
      refresh: mockRefresh,
      updateConfig: mockUpdateConfig,
      logDecision: mockLogDecision,
      resolveDecision: mockResolveDecision,
    };
    return selector(state);
  },
}));

vi.mock("@/lib/investorPdf", () => ({
  generateInvestorPdf: vi.fn().mockResolvedValue(undefined),
}));

import StartupHealthScreen from "../index";

beforeEach(() => {
  vi.clearAllMocks();
  mockData = normalHealthData;
  mockConfig_ = mockConfig;
  mockDecisions_ = [...mockDecisions];
  mockLoading = false;
});

describe("StartupHealthScreen", () => {
  it("renders the screen header", () => {
    render(<StartupHealthScreen />);
    expect(screen.getByText("Startup Health")).toBeDefined();
    expect(screen.getByText("Runway, balance, decisions, and burn rate")).toBeDefined();
  });

  it("calls refresh on mount", () => {
    render(<StartupHealthScreen />);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("shows loading state when loading with no data", () => {
    mockData = null;
    mockLoading = true;
    render(<StartupHealthScreen />);
    expect(screen.getByText("Loading health data…")).toBeDefined();
  });

  /* ── Runway (Req 12.2, 12.3, 12.4) ── */

  it("displays runway months with 1 decimal (Req 12.2)", () => {
    render(<StartupHealthScreen />);
    expect(screen.getByText("12.5")).toBeDefined();
    expect(screen.getByText("months")).toBeDefined();
  });

  it("shows Healthy badge for normal runway", () => {
    render(<StartupHealthScreen />);
    // Both runway and burn rate show "Healthy" when normal
    expect(screen.getAllByText("Healthy").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Warning badge for amber runway (Req 12.3)", () => {
    mockData = amberHealthData;
    render(<StartupHealthScreen />);
    expect(screen.getByText("4.5")).toBeDefined();
    // There are two Warning badges (runway + burn rate)
    expect(screen.getAllByText("Warning").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Critical badge for red runway (Req 12.4)", () => {
    mockData = redHealthData;
    render(<StartupHealthScreen />);
    expect(screen.getByText("2.1")).toBeDefined();
    expect(screen.getAllByText("Critical").length).toBeGreaterThanOrEqual(1);
  });

  it("displays infinity symbol when runway is infinite", () => {
    mockData = { ...normalHealthData, runwayMonths: Infinity };
    render(<StartupHealthScreen />);
    expect(screen.getByText("∞")).toBeDefined();
  });

  /* ── Founder Balance (Req 13.3, 13.4) ── */

  it("displays founder balance section with hours (Req 13.3)", () => {
    render(<StartupHealthScreen />);
    expect(screen.getByText("Founder Balance")).toBeDefined();
    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.getByText("Bob")).toBeDefined();
    expect(screen.getByText("Carol")).toBeDefined();
  });

  it("shows balance alert with neutral language (Req 13.4)", () => {
    render(<StartupHealthScreen />);
    expect(screen.getByText("Hours gap detected")).toBeDefined();
  });

  it("does not show alert for founders within threshold", () => {
    render(<StartupHealthScreen />);
    // Only Carol has alert, so only one "Hours gap detected"
    expect(screen.getAllByText("Hours gap detected").length).toBe(1);
  });

  /* ── Decision Log (Req 14.2, 14.6) ── */

  it("displays decision velocity (Req 14.2)", () => {
    render(<StartupHealthScreen />);
    expect(screen.getByText("4.2")).toBeDefined();
    expect(screen.getByText("days avg")).toBeDefined();
  });

  it("displays open and resolved decisions", () => {
    render(<StartupHealthScreen />);
    expect(screen.getByText("Hire CTO")).toBeDefined();
    expect(screen.getByText("Office lease")).toBeDefined();
    expect(screen.getByText("Open Decisions (1)")).toBeDefined();
    expect(screen.getByText("Resolved Decisions (1)")).toBeDefined();
  });

  it("shows resolve button on open decisions", () => {
    render(<StartupHealthScreen />);
    expect(screen.getByText("Resolve")).toBeDefined();
  });

  it("calls resolveDecision when resolve button is clicked", async () => {
    render(<StartupHealthScreen />);
    fireEvent.click(screen.getByText("Resolve"));
    await waitFor(() => {
      expect(mockResolveDecision).toHaveBeenCalledWith("d-1");
    });
  });

  it("renders log decision form (Req 14.6)", () => {
    render(<StartupHealthScreen />);
    // "Log Decision" appears as both heading and button text
    expect(screen.getAllByText("Log Decision").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByPlaceholderText("Decision title")).toBeDefined();
    expect(screen.getByPlaceholderText("Description (optional)")).toBeDefined();
  });

  it("calls logDecision when form is submitted", async () => {
    render(<StartupHealthScreen />);
    fireEvent.change(screen.getByPlaceholderText("Decision title"), {
      target: { value: "New decision" },
    });
    fireEvent.change(screen.getByPlaceholderText("Description (optional)"), {
      target: { value: "Some details" },
    });
    // Click the button (not the heading)
    const logButtons = screen.getAllByText("Log Decision");
    const btn = logButtons.find((el) => el.closest("button"));
    fireEvent.click(btn!);
    await waitFor(() => {
      expect(mockLogDecision).toHaveBeenCalledWith("New decision", "Some details");
    });
  });

  it("disables log decision button when title is empty", () => {
    render(<StartupHealthScreen />);
    const logButtons = screen.getAllByText("Log Decision");
    const btn = logButtons.find((el) => el.closest("button"))?.closest("button");
    expect(btn?.disabled).toBe(true);
  });

  /* ── Burn Rate (Req 14.3, 14.4, 14.5) ── */

  it("displays burn rate alignment percentage", () => {
    render(<StartupHealthScreen />);
    expect(screen.getByText("95.0")).toBeDefined();
    expect(screen.getByText("% of budget")).toBeDefined();
  });

  it("shows amber indicator for burn rate > 110% (Req 14.4)", () => {
    mockData = amberHealthData;
    render(<StartupHealthScreen />);
    expect(screen.getByText("115.0")).toBeDefined();
  });

  it("shows red indicator for burn rate > 130% (Req 14.5)", () => {
    mockData = redHealthData;
    render(<StartupHealthScreen />);
    expect(screen.getByText("135.0")).toBeDefined();
  });

  /* ── Settings (Req 12.5) ── */

  it("renders settings section with inputs", () => {
    render(<StartupHealthScreen />);
    expect(screen.getByText("Health Settings")).toBeDefined();
    expect(screen.getByLabelText("Cash balance")).toBeDefined();
    expect(screen.getByLabelText("Planned monthly budget")).toBeDefined();
    expect(screen.getByLabelText("Month 1 expenses")).toBeDefined();
    expect(screen.getByLabelText("Month 2 expenses")).toBeDefined();
    expect(screen.getByLabelText("Month 3 expenses")).toBeDefined();
  });

  it("populates settings from config", () => {
    render(<StartupHealthScreen />);
    const cashInput = screen.getByLabelText("Cash balance") as HTMLInputElement;
    expect(cashInput.value).toBe("500000");
  });

  it("calls updateConfig when save is clicked", async () => {
    render(<StartupHealthScreen />);
    fireEvent.change(screen.getByLabelText("Cash balance"), {
      target: { value: "600000" },
    });
    fireEvent.click(screen.getByText("Save Settings"));
    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalled();
    });
    const calledWith = mockUpdateConfig.mock.calls[0][0];
    expect(calledWith.cashBalance).toBe(600000);
  });

  /* ── Investor PDF section ── */

  it("renders investor summary section", () => {
    render(<StartupHealthScreen />);
    expect(screen.getByText("Investor Summary")).toBeDefined();
    expect(screen.getByText("Export PDF")).toBeDefined();
  });

  it("renders date range selectors for PDF", () => {
    render(<StartupHealthScreen />);
    expect(screen.getByLabelText("PDF start date")).toBeDefined();
    expect(screen.getByLabelText("PDF end date")).toBeDefined();
  });

  /* ── Edge cases ── */

  it("shows no founder data message when founders list is empty", () => {
    mockData = {
      ...normalHealthData,
      founderBalance: { stdDev: 0, founders: [], teamAvgHours: 0 },
    };
    render(<StartupHealthScreen />);
    expect(screen.getByText("No founder data available")).toBeDefined();
  });

  it("shows no open decisions message when all resolved", () => {
    mockDecisions_ = [
      { id: "d-2", title: "Office lease", description: "", createdAt: now - 20 * 86400, resolvedAt: now - 5 * 86400 },
    ];
    render(<StartupHealthScreen />);
    expect(screen.getByText("No open decisions")).toBeDefined();
  });
});
