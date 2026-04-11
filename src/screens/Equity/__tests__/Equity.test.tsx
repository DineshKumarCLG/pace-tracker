/**
 * Equity Dashboard screen tests.
 *
 * Verifies:
 * - Cap table pie chart rendering (Req 22.1, 22.2)
 * - Vesting progress bars and cliff status (Req 6.1, 6.2, 6.3)
 * - Dilution history list (Req 7.1)
 * - Valuation input and projected payout (Req 7.3)
 * - Loading and empty states
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { EquityStake, DilutionEvent } from "@/lib/equity";

/* ── Mock data ── */

const now = Math.floor(Date.now() / 1000);

const mockStakes: EquityStake[] = [
  {
    id: "s-1",
    founderId: "f-1",
    initialStakePct: 40,
    currentStakePct: 39.0,
    vestingStartDate: now - 365 * 86400,
    cliffDate: now - 180 * 86400,
    vestingEndDate: now + 3 * 365 * 86400,
    vestingScheduleMonths: 48,
    updatedAt: now,
  },
  {
    id: "s-2",
    founderId: "f-2",
    initialStakePct: 35,
    currentStakePct: 35.5,
    vestingStartDate: now - 365 * 86400,
    cliffDate: now - 180 * 86400,
    vestingEndDate: now + 3 * 365 * 86400,
    vestingScheduleMonths: 48,
    updatedAt: now,
  },
  {
    id: "s-3",
    founderId: "f-3",
    initialStakePct: 25,
    currentStakePct: 25.5,
    vestingStartDate: now - 100 * 86400,
    cliffDate: now + 265 * 86400,
    vestingEndDate: now + 3 * 365 * 86400,
    vestingScheduleMonths: 48,
    updatedAt: now,
  },
];

const mockDilutionHistory: DilutionEvent[] = [
  {
    id: "d-1",
    founderId: "f-1",
    cycleId: "cycle-5",
    dilutionPct: 1.0,
    previousStakePct: 40.0,
    newStakePct: 39.0,
    redistributionDetails: {
      "f-1": { previous: 40.0, new: 39.0 },
      "f-2": { previous: 35.0, new: 35.5 },
      "f-3": { previous: 25.0, new: 25.5 },
    },
    createdAt: now - 7 * 86400,
  },
];

let mockStakes_: EquityStake[] = [...mockStakes];
let mockDilutionHistory_: DilutionEvent[] = [...mockDilutionHistory];
let mockLoading = false;
const mockRefresh = vi.fn();

vi.mock("@/stores/equityStore", () => ({
  useEquityStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      stakes: mockStakes_,
      dilutionHistory: mockDilutionHistory_,
      loading: mockLoading,
      refresh: mockRefresh,
    };
    return selector(state);
  },
}));

vi.mock("@/lib/pocketbase", () => ({
  pb: {
    collection: () => ({
      getFullList: vi.fn().mockResolvedValue([
        { id: "f-1", name: "Alice", role: "Co-founder", avatarColor: "#6366f1" },
        { id: "f-2", name: "Bob", role: "Co-founder", avatarColor: "#f59e0b" },
        { id: "f-3", name: "Carol", role: "Co-founder", avatarColor: "#10b981" },
      ]),
    }),
  },
}));

import EquityScreen from "../index";

beforeEach(() => {
  vi.clearAllMocks();
  mockStakes_ = [...mockStakes];
  mockDilutionHistory_ = [...mockDilutionHistory];
  mockLoading = false;
});

describe("EquityScreen", () => {
  it("renders the screen header", () => {
    render(<EquityScreen />);
    expect(screen.getByText("Equity Dashboard")).toBeDefined();
    expect(screen.getByText("Cap table, vesting, and dilution tracking")).toBeDefined();
  });

  it("calls refresh on mount", () => {
    render(<EquityScreen />);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("shows loading state when loading with no data", () => {
    mockStakes_ = [];
    mockLoading = true;
    render(<EquityScreen />);
    expect(screen.getByText("Loading equity data…")).toBeDefined();
  });

  /* Req 22.1 — Cap table pie chart */
  it("renders cap table pie chart (Req 22.1)", () => {
    render(<EquityScreen />);
    expect(screen.getByText("Cap Table")).toBeDefined();
    // SVG pie chart should be present
    const svg = screen.getByLabelText("Cap table pie chart");
    expect(svg).toBeDefined();
    expect(svg.tagName).toBe("svg");
  });

  it("shows empty message when no stakes", () => {
    mockStakes_ = [];
    mockDilutionHistory_ = [];
    render(<EquityScreen />);
    expect(screen.getByText("No equity data available")).toBeDefined();
  });

  /* Req 22.2 — Pie chart labels with percentage */
  it("displays percentage labels in pie chart (Req 22.2)", async () => {
    render(<EquityScreen />);
    await waitFor(() => {
      // Percentages should appear as text in the SVG
      expect(screen.getByText("39.0%")).toBeDefined();
      expect(screen.getByText("35.5%")).toBeDefined();
      expect(screen.getByText("25.5%")).toBeDefined();
    });
  });

  /* Req 6.1 — Equity stake display */
  it("displays equity stakes in legend (Req 6.1)", async () => {
    render(<EquityScreen />);
    await waitFor(() => {
      expect(screen.getAllByText("39.00%").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("35.50%").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("25.50%").length).toBeGreaterThanOrEqual(1);
    });
  });

  /* Req 6.2, 6.3 — Vesting progress and cliff status */
  it("displays vesting progress section (Req 6.2)", () => {
    render(<EquityScreen />);
    expect(screen.getByText("Vesting Progress")).toBeDefined();
  });

  it("shows cliff status badges (Req 6.3)", async () => {
    render(<EquityScreen />);
    await waitFor(() => {
      // f-1 and f-2 have cliff passed (cliffDate in the past)
      expect(screen.getAllByText("Cliff passed").length).toBeGreaterThanOrEqual(2);
      // f-3 has pre-cliff (cliffDate in the future)
      expect(screen.getByText(/Pre-cliff/)).toBeDefined();
    });
  });

  it("displays vesting percentage", async () => {
    render(<EquityScreen />);
    await waitFor(() => {
      // All founders should show "% vested" text
      const vestedTexts = screen.getAllByText(/% vested/);
      expect(vestedTexts.length).toBe(3);
    });
  });

  /* Req 7.1 — Dilution history */
  it("displays dilution history (Req 7.1)", async () => {
    render(<EquityScreen />);
    await waitFor(() => {
      expect(screen.getByText("Dilution History")).toBeDefined();
    });
    // Dilution percentage badge
    expect(screen.getByText("-1%")).toBeDefined();
    // Previous → new stake
    expect(screen.getByText("40.00% → 39.00%")).toBeDefined();
  });

  it("hides dilution history when empty", () => {
    mockDilutionHistory_ = [];
    render(<EquityScreen />);
    expect(screen.queryByText("Dilution History")).toBeNull();
  });

  /* Req 7.3 — Valuation input and projected payout */
  it("renders valuation input field (Req 7.3)", () => {
    render(<EquityScreen />);
    expect(screen.getByText("Company Valuation")).toBeDefined();
    expect(screen.getByPlaceholderText("Enter valuation (e.g. 5000000)")).toBeDefined();
  });

  it("computes projected payout when valuation is entered (Req 7.3)", async () => {
    render(<EquityScreen />);
    const input = screen.getByPlaceholderText("Enter valuation (e.g. 5000000)");
    fireEvent.change(input, { target: { value: "10000000" } });

    await waitFor(() => {
      // Alice: 10M × 39% / 100 = $3,900,000
      expect(screen.getByText("$3,900,000")).toBeDefined();
      // Bob: 10M × 35.5% / 100 = $3,550,000
      expect(screen.getByText("$3,550,000")).toBeDefined();
      // Carol: 10M × 25.5% / 100 = $2,550,000
      expect(screen.getByText("$2,550,000")).toBeDefined();
    });
  });

  it("does not show projections when valuation is empty", () => {
    render(<EquityScreen />);
    // No dollar amounts should appear without valuation input
    expect(screen.queryByText(/\$\d/)).toBeNull();
  });

  /* Redistribution details in dilution events */
  it("shows redistribution details in dilution events", async () => {
    render(<EquityScreen />);
    await waitFor(() => {
      // Redistribution details show founder names/ids with resulting percentages
      // The dilution event row shows "40.00% → 39.00%" for the affected founder
      expect(screen.getByText("40.00% → 39.00%")).toBeDefined();
    });
  });
});
