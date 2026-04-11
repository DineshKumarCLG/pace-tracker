/**
 * Founder Review screen tests.
 *
 * Verifies:
 * - Cycle status display (Req 17.1)
 * - Submission form rendering when cycle is open (Req 17.2)
 * - Confirmation message after submission (Req 17.3)
 * - Results display for closed cycles (Req 17.4)
 * - Accountability warning display (Req 17.5)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReviewCycle, ReviewResult } from "@/stores/reviewStore";

/* ── Mock data ── */

const now = Math.floor(Date.now() / 1000);

const openCycle: ReviewCycle = {
  id: "cycle-1",
  startDate: now - 3600,
  endDate: now + 14 * 86400,
  submissionDeadline: now + 48 * 3600,
  status: "open",
  resolvedAt: null,
  createdAt: now - 3600,
};

const closedCycle: ReviewCycle = {
  id: "cycle-2",
  startDate: now - 14 * 86400,
  endDate: now - 86400,
  submissionDeadline: now - 12 * 86400,
  status: "resolved",
  resolvedAt: now - 86400,
  createdAt: now - 14 * 86400,
};

const mockResults: ReviewResult[] = [
  { founderId: "f-2", outputAvg: 4.0, reliabilityAvg: 3.5, initiativeAvg: 4.5, overallAvg: 4.0 },
  { founderId: "f-3", outputAvg: 3.0, reliabilityAvg: 3.0, initiativeAvg: 3.0, overallAvg: 3.0 },
];

let mockCurrentCycle: ReviewCycle | null = openCycle;
let mockResults_: ReviewResult[] = [];
let mockHistory: ReviewCycle[] = [openCycle];
let mockWarnings: Record<string, number> = {};
let mockLoading = false;
const mockRefresh = vi.fn();
const mockSubmitReview = vi.fn().mockResolvedValue(undefined);

vi.mock("@/stores/reviewStore", () => ({
  useReviewStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      currentCycle: mockCurrentCycle,
      results: mockResults_,
      history: mockHistory,
      warnings: mockWarnings,
      loading: mockLoading,
      refresh: mockRefresh,
      submitReview: mockSubmitReview,
    };
    return selector(state);
  },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      user: { id: "f-1", name: "Alice", email: "alice@test.com", role: "Co-founder", avatarColor: "#6366f1" },
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

import FounderReviewScreen from "../index";

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentCycle = openCycle;
  mockResults_ = [];
  mockHistory = [openCycle];
  mockWarnings = {};
  mockLoading = false;
});

describe("FounderReviewScreen", () => {
  it("renders the screen header", async () => {
    render(<FounderReviewScreen />);
    expect(screen.getByText("Founder Review")).toBeDefined();
    expect(screen.getByText("Biweekly peer review and accountability")).toBeDefined();
  });

  it("calls refresh on mount", () => {
    render(<FounderReviewScreen />);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("shows loading state when loading with no data", () => {
    mockCurrentCycle = null;
    mockHistory = [];
    mockLoading = true;
    render(<FounderReviewScreen />);
    expect(screen.getByText("Loading reviews…")).toBeDefined();
  });

  /* Req 17.1 — Cycle status display */
  it("displays current cycle status and deadline (Req 17.1)", async () => {
    render(<FounderReviewScreen />);
    expect(screen.getByText("Current Cycle")).toBeDefined();
    expect(screen.getByText("open")).toBeDefined();
    expect(screen.getByText(/Submission deadline/)).toBeDefined();
  });

  it("shows no active cycle message when no cycle exists", () => {
    mockCurrentCycle = null;
    render(<FounderReviewScreen />);
    expect(screen.getByText("No active review cycle")).toBeDefined();
  });

  /* Req 17.2 — Submission form when cycle is open */
  it("renders submission form for other founders when cycle is open (Req 17.2)", async () => {
    render(<FounderReviewScreen />);
    await waitFor(() => {
      expect(screen.getByText("Submit Reviews")).toBeDefined();
    });
    // Should show Bob and Carol (not Alice who is the current user)
    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeDefined();
      expect(screen.getByText("Carol")).toBeDefined();
    });
    // Should show scale inputs
    expect(screen.getAllByText("Output").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Reliability").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Initiative").length).toBeGreaterThanOrEqual(2);
  });

  it("renders submit button", async () => {
    render(<FounderReviewScreen />);
    await waitFor(() => {
      expect(screen.getByText("Submit All Reviews")).toBeDefined();
    });
  });

  it("allows clicking score buttons", async () => {
    render(<FounderReviewScreen />);
    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeDefined();
    });
    // Click a score button (there are many "5" buttons)
    const fiveButtons = screen.getAllByText("5");
    fireEvent.click(fiveButtons[0]);
    // No error means it worked
  });

  /* Req 17.3 — Confirmation after submission */
  it("shows confirmation message when submitted", async () => {
    render(<FounderReviewScreen />);
    await waitFor(() => {
      expect(screen.getByText("Submit All Reviews")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Submit All Reviews"));

    await waitFor(() => {
      expect(screen.getByText("Reviews submitted for this cycle")).toBeDefined();
    });
  });

  /* Req 17.4 — Results display for closed/resolved cycles */
  it("displays results when cycle is closed (Req 17.4)", async () => {
    mockCurrentCycle = { ...closedCycle };
    mockResults_ = [...mockResults];
    mockHistory = [closedCycle];
    render(<FounderReviewScreen />);

    await waitFor(() => {
      expect(screen.getByText("Current Cycle Results")).toBeDefined();
    });
    // Check score values are displayed (use getAllByText since values may appear multiple times)
    expect(screen.getAllByText("4.0").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("3.5").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("4.5").length).toBeGreaterThanOrEqual(1);
  });

  /* Req 17.5 — Accountability warnings */
  it("displays accountability warnings (Req 17.5)", async () => {
    mockWarnings = { "f-2": 1, "f-3": 2 };
    render(<FounderReviewScreen />);

    await waitFor(() => {
      expect(screen.getByText("Accountability Warnings")).toBeDefined();
    });
    expect(screen.getByText("1 warning")).toBeDefined();
    expect(screen.getByText("2 warnings")).toBeDefined();
    expect(screen.getByText("consecutive")).toBeDefined();
  });

  it("hides warnings section when no warnings exist", () => {
    mockWarnings = {};
    render(<FounderReviewScreen />);
    expect(screen.queryByText("Accountability Warnings")).toBeNull();
  });

  /* History display */
  it("displays past cycles in history (Req 17.4)", async () => {
    mockHistory = [openCycle, closedCycle];
    render(<FounderReviewScreen />);

    await waitFor(() => {
      expect(screen.getByText("Past Cycles")).toBeDefined();
    });
    expect(screen.getByText("resolved")).toBeDefined();
  });

  it("hides history section when only one cycle exists", () => {
    mockHistory = [openCycle];
    render(<FounderReviewScreen />);
    expect(screen.queryByText("Past Cycles")).toBeNull();
  });
});
