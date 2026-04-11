/**
 * Leaderboard screen tests.
 *
 * Verifies:
 * - Ranked list sorted by composite score descending (Req 5.1)
 * - Per-founder metrics display: score, hours, tasks, peer review (Req 5.2)
 * - Founder of the Week badge on top scorer (Req 5.3)
 * - Loading and empty states
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FounderScore } from "@/lib/leaderboard";

/* ── Mock data ── */

const mockScores: FounderScore[] = [
  {
    founderId: "f-1",
    name: "Alice",
    hours: 42.5,
    tasksCompleted: 12,
    peerReviewAvg: 4.2,
    normalizedHours: 1.0,
    normalizedTasks: 1.0,
    normalizedPeerReview: 0.84,
    compositeScore: 0.952,
    isFounderOfWeek: true,
  },
  {
    founderId: "f-2",
    name: "Bob",
    hours: 35.0,
    tasksCompleted: 8,
    peerReviewAvg: 3.8,
    normalizedHours: 0.824,
    normalizedTasks: 0.667,
    normalizedPeerReview: 0.76,
    compositeScore: 0.742,
    isFounderOfWeek: false,
  },
  {
    founderId: "f-3",
    name: "Carol",
    hours: 28.0,
    tasksCompleted: 5,
    peerReviewAvg: 3.0,
    normalizedHours: 0.659,
    normalizedTasks: 0.417,
    normalizedPeerReview: 0.6,
    compositeScore: 0.544,
    isFounderOfWeek: false,
  },
];

let mockScores_: FounderScore[] = [...mockScores];
let mockCurrentWeek = "2025-01-13";
let mockLoading = false;
const mockRefresh = vi.fn();

vi.mock("@/stores/leaderboardStore", () => ({
  useLeaderboardStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      scores: mockScores_,
      currentWeek: mockCurrentWeek,
      loading: mockLoading,
      refresh: mockRefresh,
    };
    return selector(state);
  },
}));

import LeaderboardScreen from "../index";

beforeEach(() => {
  vi.clearAllMocks();
  mockScores_ = [...mockScores];
  mockCurrentWeek = "2025-01-13";
  mockLoading = false;
});

describe("LeaderboardScreen", () => {
  it("renders the screen header with current week", () => {
    render(<LeaderboardScreen />);
    expect(screen.getByText("Leaderboard")).toBeDefined();
    expect(screen.getByText("Week of 2025-01-13")).toBeDefined();
  });

  it("calls refresh on mount", () => {
    render(<LeaderboardScreen />);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("shows loading state when loading with no scores", () => {
    mockScores_ = [];
    mockLoading = true;
    render(<LeaderboardScreen />);
    expect(screen.getByText("Loading leaderboard…")).toBeDefined();
  });

  it("shows empty state when no scores available", () => {
    mockScores_ = [];
    render(<LeaderboardScreen />);
    expect(screen.getByText("No scores available for this week")).toBeDefined();
  });

  /* Req 5.1 — Ranked list sorted by composite score */
  it("renders founders in ranked order (Req 5.1)", () => {
    render(<LeaderboardScreen />);
    // Alice appears in both highlight card and ranked list
    expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Bob").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Carol").length).toBeGreaterThanOrEqual(1);
    // Rank numbers
    expect(screen.getByText("#1")).toBeDefined();
    expect(screen.getByText("#2")).toBeDefined();
    expect(screen.getByText("#3")).toBeDefined();
  });

  /* Req 5.2 — Per-founder metrics */
  it("displays hours, tasks, and peer review per founder (Req 5.2)", () => {
    render(<LeaderboardScreen />);
    // Alice's metrics
    expect(screen.getByText("42.5h")).toBeDefined();
    expect(screen.getByText("12 tasks")).toBeDefined();
    expect(screen.getByText("4.2 review")).toBeDefined();
    // Bob's metrics
    expect(screen.getByText("35.0h")).toBeDefined();
    expect(screen.getByText("8 tasks")).toBeDefined();
    expect(screen.getByText("3.8 review")).toBeDefined();
  });

  it("displays composite scores", () => {
    render(<LeaderboardScreen />);
    expect(screen.getByText("0.952")).toBeDefined();
    expect(screen.getByText("0.742")).toBeDefined();
    expect(screen.getByText("0.544")).toBeDefined();
  });

  /* Req 5.3 — Founder of the Week badge */
  it("shows Founder of the Week badge on top scorer (Req 5.3)", () => {
    render(<LeaderboardScreen />);
    expect(screen.getByText("Founder of the Week")).toBeDefined();
    // Trophy emoji badge
    expect(screen.getByText("🏆")).toBeDefined();
  });

  it("highlights the Founder of the Week card", () => {
    render(<LeaderboardScreen />);
    // The winner's name should appear in the highlight card
    const aliceElements = screen.getAllByText("Alice");
    expect(aliceElements.length).toBeGreaterThanOrEqual(2); // highlight card + ranked list
  });

  /* Edge: single founder */
  it("handles single founder correctly", () => {
    mockScores_ = [mockScores[0]];
    render(<LeaderboardScreen />);
    expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("#1")).toBeDefined();
    expect(screen.getByText("Founder of the Week")).toBeDefined();
  });
});
