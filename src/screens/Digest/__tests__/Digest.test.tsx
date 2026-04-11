/**
 * Daily Digest screen tests.
 *
 * Verifies:
 * - End-of-day reports render with tasks, breaks, git commits (Req 11.3)
 * - Empty state when no data
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DigestScreen from "../index";
import type { DailyReport } from "@/types";

/* ── Fixtures ── */

const mockEodReports: (DailyReport & { userName: string })[] = [
  {
    id: "r-1",
    userId: "u-1",
    userName: "Arjun",
    sessionId: "s-1",
    date: "2025-01-14",
    totalMinutes: 450,
    tasksWorked: [
      { taskId: "t-1", title: "Build API", minutes: 240 },
      { taskId: "t-2", title: "Fix bug", minutes: 120 },
    ],
    breaks: [{ type: "lunch", minutes: 45 }, { type: "short", minutes: 10 }],
    outputNote: "Shipped v2 endpoint",
    gitCommits: [{ hash: "abc1234def5678", message: "feat: add digest screen" }],
    createdAt: 1736928000,
  },
];

describe("DigestScreen", () => {
  it("renders the screen header", () => {
    render(<DigestScreen />);
    expect(screen.getByText("Daily Digest")).toBeDefined();
    expect(screen.getByText("Today's team activity at a glance")).toBeDefined();
  });

  it("shows empty state when no data provided", () => {
    render(<DigestScreen />);
    expect(screen.getByText("No digest data available for today")).toBeDefined();
  });

  /* ── End-of-Day Reports (Req 11.3) ── */

  it("renders end-of-day reports with tasks (Req 11.3)", () => {
    render(<DigestScreen eodReports={mockEodReports} />);
    expect(screen.getByText("Build API")).toBeDefined();
    expect(screen.getByText("Fix bug")).toBeDefined();
    expect(screen.getByText("240m")).toBeDefined();
    expect(screen.getByText("120m")).toBeDefined();
  });

  it("renders breaks in EOD reports", () => {
    render(<DigestScreen eodReports={mockEodReports} />);
    expect(screen.getByText("lunch")).toBeDefined();
    expect(screen.getByText("45m")).toBeDefined();
  });

  it("renders git commits in EOD reports", () => {
    render(<DigestScreen eodReports={mockEodReports} />);
    expect(screen.getByText("abc1234")).toBeDefined();
    expect(screen.getByText("feat: add digest screen")).toBeDefined();
  });

  it("renders output note in EOD reports", () => {
    render(<DigestScreen eodReports={mockEodReports} />);
    const notes = screen.getAllByText("Shipped v2 endpoint");
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });

  it("displays total time badge in EOD report", () => {
    render(<DigestScreen eodReports={mockEodReports} />);
    // 450 min = 7h 30m
    expect(screen.getByText("7h 30m")).toBeDefined();
  });

  it("hides EOD section when no reports", () => {
    render(<DigestScreen eodReports={[]} />);
    expect(screen.queryByText("End-of-Day Reports")).toBeNull();
  });

  /* ── Combined rendering ── */

  it("renders EOD section when reports provided", () => {
    render(<DigestScreen eodReports={mockEodReports} />);
    expect(screen.getByText("End-of-Day Reports")).toBeDefined();
  });
});
