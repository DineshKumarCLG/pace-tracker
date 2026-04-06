/**
 * Daily Digest screen tests.
 *
 * Verifies:
 * - Morning digest member summaries render (Req 12.2)
 * - On-leave and WFH status lists display (Req 12.3)
 * - Standup responses display for all members (Req 18.3)
 * - End-of-day reports render with tasks, breaks, meetings, git commits (Req 11.3)
 * - Empty state when no data
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DigestScreen from "../index";
import type { MorningDigest, DailyReport } from "@/types";
import type { StandupEntry } from "../index";

/* ── Fixtures ── */

const mockDigest: MorningDigest = {
  id: "d-1",
  date: "2025-01-15",
  memberSummaries: [
    { userId: "u-1", name: "Arjun", totalHours: 7.5, tasksCompleted: ["Build API", "Fix bug"], outputNote: "Shipped v2 endpoint" },
    { userId: "u-2", name: "Priya", totalHours: 6.0, tasksCompleted: [], outputNote: null },
  ],
  onLeaveToday: ["Kiran"],
  onWfhToday: ["Meera"],
  createdAt: 1736928000,
};

const mockStandups: StandupEntry[] = [
  { userId: "u-1", name: "Arjun", response: "Working on the digest screen today" },
  { userId: "u-2", name: "Priya", response: "Code review and testing" },
];

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
    meetings: [{ title: "Sprint planning", minutes: 30 }],
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

  /* ── Morning Digest (Req 12.2, 12.3) ── */

  it("renders morning digest member summaries (Req 12.2)", () => {
    render(<DigestScreen digest={mockDigest} />);
    expect(screen.getByText("Arjun")).toBeDefined();
    expect(screen.getByText("Priya")).toBeDefined();
    expect(screen.getByText("7.5h logged")).toBeDefined();
    expect(screen.getByText("6.0h logged")).toBeDefined();
  });

  it("displays completed tasks in member summaries (Req 12.2)", () => {
    render(<DigestScreen digest={mockDigest} />);
    expect(screen.getByText("Build API, Fix bug")).toBeDefined();
  });

  it("displays output notes in member summaries (Req 12.2)", () => {
    render(<DigestScreen digest={mockDigest} />);
    expect(screen.getByText("Shipped v2 endpoint")).toBeDefined();
  });

  it("displays on-leave members (Req 12.3)", () => {
    render(<DigestScreen digest={mockDigest} />);
    expect(screen.getByText("On Leave:")).toBeDefined();
    expect(screen.getByText("Kiran")).toBeDefined();
  });

  it("displays WFH members (Req 12.3)", () => {
    render(<DigestScreen digest={mockDigest} />);
    expect(screen.getByText("WFH:")).toBeDefined();
    expect(screen.getByText("Meera")).toBeDefined();
  });

  it("hides leave/WFH section when no one is on leave or WFH", () => {
    const noLeaveDigest: MorningDigest = {
      ...mockDigest,
      onLeaveToday: [],
      onWfhToday: [],
    };
    render(<DigestScreen digest={noLeaveDigest} />);
    expect(screen.queryByText("On Leave:")).toBeNull();
    expect(screen.queryByText("WFH:")).toBeNull();
  });

  it("shows 'No member summaries' when digest has empty summaries", () => {
    const emptyDigest: MorningDigest = {
      ...mockDigest,
      memberSummaries: [],
    };
    render(<DigestScreen digest={emptyDigest} />);
    expect(screen.getByText("No member summaries")).toBeDefined();
  });

  /* ── Standup Responses (Req 18.3) ── */

  it("renders standup responses for all members (Req 18.3)", () => {
    render(<DigestScreen standupResponses={mockStandups} />);
    expect(screen.getByText("Arjun")).toBeDefined();
    expect(screen.getByText("Working on the digest screen today")).toBeDefined();
    expect(screen.getByText("Priya")).toBeDefined();
    expect(screen.getByText("Code review and testing")).toBeDefined();
  });

  it("hides standup section when no responses", () => {
    render(<DigestScreen digest={mockDigest} standupResponses={[]} />);
    expect(screen.queryByText("Standup Responses")).toBeNull();
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

  it("renders meetings in EOD reports", () => {
    render(<DigestScreen eodReports={mockEodReports} />);
    expect(screen.getByText("Sprint planning")).toBeDefined();
    expect(screen.getByText("30m")).toBeDefined();
  });

  it("renders git commits in EOD reports", () => {
    render(<DigestScreen eodReports={mockEodReports} />);
    expect(screen.getByText("abc1234")).toBeDefined();
    expect(screen.getByText("feat: add digest screen")).toBeDefined();
  });

  it("renders output note in EOD reports", () => {
    render(<DigestScreen eodReports={mockEodReports} />);
    // Output note appears in both digest summary and EOD report
    const notes = screen.getAllByText("Shipped v2 endpoint");
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });

  it("displays total time badge in EOD report", () => {
    render(<DigestScreen eodReports={mockEodReports} />);
    // 450 min = 7h 30m
    expect(screen.getByText("7h 30m")).toBeDefined();
  });

  it("hides EOD section when no reports", () => {
    render(<DigestScreen digest={mockDigest} eodReports={[]} />);
    expect(screen.queryByText("End-of-Day Reports")).toBeNull();
  });

  /* ── Combined rendering ── */

  it("renders all three sections together", () => {
    render(
      <DigestScreen
        digest={mockDigest}
        standupResponses={mockStandups}
        eodReports={mockEodReports}
      />,
    );
    expect(screen.getByText("Morning Digest")).toBeDefined();
    expect(screen.getByText("Standup Responses")).toBeDefined();
    expect(screen.getByText("End-of-Day Reports")).toBeDefined();
  });
});
