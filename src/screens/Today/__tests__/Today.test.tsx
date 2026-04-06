import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSessionStore } from "@/stores/sessionStore";
import { useTaskStore } from "@/stores/taskStore";
import type { Session } from "@/types";

// Mock db module to prevent Tauri invoke calls
vi.mock("@/lib/db", () => ({
  endSession: vi.fn(),
  startSession: vi.fn(),
  getDeviceWakeTime: vi.fn(),
  getActiveSession: vi.fn(),
  recoverStaleSession: vi.fn(),
  initializeDb: vi.fn(),
  isSessionStale: vi.fn(),
  startBreak: vi.fn(),
  endBreak: vi.fn(),
  getActiveBreak: vi.fn(),
  getVisibleBreaks: vi.fn(),
  filterMicroBreaks: vi.fn((breaks: unknown[]) => breaks),
  MICRO_BREAK_THRESHOLD_SECS: 480,
}));

const NOW_UNIX = 1_700_010_000;

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    userId: "user-1",
    startTime: NOW_UNIX - 3600, // 1 hour ago
    endTime: null,
    startType: "manual",
    startVerified: true,
    outputNote: null,
    lastHeartbeat: NOW_UNIX,
    syncedAt: null,
    createdAt: NOW_UNIX - 3600,
    ...overrides,
  };
}

function resetStores() {
  useSessionStore.getState().clearSession();
  useTaskStore.getState().updateTaskList([]);
  useTaskStore.getState().setActiveTask(null);
}

// ─── SessionCard Tests ───────────────────────────────────────────────────────

describe("SessionCard", () => {
  beforeEach(() => {
    resetStores();
  });

  it("renders in active state (indigo) with running timer", async () => {
    const { default: SessionCard } = await import("../SessionCard");
    const session = makeSession();
    useSessionStore.getState().setSession(session);

    render(<SessionCard />);

    // Active state shows "Working" label and a pulsing dot
    expect(screen.getByText("Working")).toBeDefined();
    // Timer should be rendered (non-zero since session started 1h ago)
    expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeDefined();
    // Break and End Day buttons visible
    expect(screen.getByLabelText("Break")).toBeDefined();
    expect(screen.getByLabelText("End day")).toBeDefined();
  });

  it("renders in break state (amber) with break timer", async () => {
    const { default: SessionCard } = await import("../SessionCard");
    const session = makeSession();
    useSessionStore.getState().setSession(session);
    useSessionStore.getState().setBreakState({
      active: true,
      breakId: "b1",
      type: "lunch",
      startTime: NOW_UNIX - 300, // 5 min ago
    });

    render(<SessionCard />);

    // Break state shows "On Break" label
    expect(screen.getByText("On Break")).toBeDefined();
    // Resume button should be visible instead of Break button
    expect(screen.getByLabelText("Resume")).toBeDefined();
    expect(screen.queryByLabelText("Break")).toBeNull();
  });

  it("renders in ended state (gray) when no session", async () => {
    const { default: SessionCard } = await import("../SessionCard");
    // No session set → getSessionState returns "ended"
    // But SessionCard is only rendered when session exists in TodayScreen.
    // We can still render it directly — it will show "No Session" state.
    render(<SessionCard />);

    expect(screen.getByText("Ended")).toBeDefined();
    // Static timer placeholder
    expect(screen.getByText("00:00:00")).toBeDefined();
    // No action buttons
    expect(screen.queryByLabelText("Break")).toBeNull();
    expect(screen.queryByLabelText("End day")).toBeNull();
  });
});

// ─── Timer Tests ─────────────────────────────────────────────────────────────

describe("Timer / useElapsedTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("increments every second", async () => {
    const { default: Timer } = await import("@/components/Timer");

    // Set "now" to a known time
    const fakeNow = NOW_UNIX * 1000;
    vi.setSystemTime(fakeNow);

    const session = makeSession({ startTime: NOW_UNIX });
    useSessionStore.getState().setSession(session);

    render(<Timer />);

    // At t=0, elapsed should be 0
    expect(screen.getByText("00:00:00")).toBeDefined();

    // Advance 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText("00:00:05")).toBeDefined();

    // Advance another 55 seconds (total 60s = 1 minute)
    act(() => {
      vi.advanceTimersByTime(55000);
    });

    expect(screen.getByText("00:01:00")).toBeDefined();
  });

  it("correctly subtracts break durations", async () => {
    const { default: Timer } = await import("@/components/Timer");

    const fakeNow = NOW_UNIX * 1000;
    vi.setSystemTime(fakeNow);

    // Session started 120 seconds ago
    const session = makeSession({ startTime: NOW_UNIX - 120 });
    useSessionStore.getState().setSession(session);

    // Break started 60 seconds ago
    useSessionStore.getState().setBreakState({
      active: true,
      breakId: "b1",
      type: "short",
      startTime: NOW_UNIX - 60,
    });

    render(<Timer />);

    // Elapsed = (now - start) - (now - breakStart) = 120 - 60 = 60s
    expect(screen.getByText("00:01:00")).toBeDefined();

    // Advance 10 seconds — break is still active, so break duration grows too
    // Elapsed = (now+10 - start) - (now+10 - breakStart) = 130 - 70 = 60s still
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    // Timer should still show ~60s because break is ongoing
    expect(screen.getByText("00:01:00")).toBeDefined();
  });
});

// ─── ActivityTimeline Tests ──────────────────────────────────────────────────

describe("ActivityTimeline", () => {
  beforeEach(() => {
    resetStores();
  });

  it("renders empty muted bar when no session", async () => {
    const { default: ActivityTimeline } = await import("../ActivityTimeline");

    const { container } = render(<ActivityTimeline />);

    expect(screen.getByText("Activity")).toBeDefined();
    // Should have the muted placeholder bar — inset-well track
    const bar = container.querySelector(".inset-well");
    expect(bar).not.toBeNull();
    // Legend items are always rendered
    expect(screen.getByText("Work")).toBeDefined();
  });

  it("renders work segment (indigo) when session is active", async () => {
    const { default: ActivityTimeline } = await import("../ActivityTimeline");

    useSessionStore.getState().setSession(makeSession());

    const { container } = render(<ActivityTimeline />);

    expect(screen.getByText("Activity")).toBeDefined();
    // Legend items should be visible
    expect(screen.getByText("Work")).toBeDefined();
    expect(screen.getByText("Break")).toBeDefined();
    expect(screen.getByText("Away")).toBeDefined();
    // Work segment should exist (uses gradient classes)
    const workSegment = container.querySelector(".bg-gradient-to-r");
    expect(workSegment).not.toBeNull();
  });

  it("renders break segment (amber) when on break", async () => {
    const { default: ActivityTimeline } = await import("../ActivityTimeline");

    useSessionStore.getState().setSession(makeSession());
    useSessionStore.getState().setBreakState({
      active: true,
      breakId: "b1",
      type: "lunch",
      startTime: NOW_UNIX - 300,
    });

    const { container } = render(<ActivityTimeline />);

    // Both work and break segments should be visible (gradient classes)
    const workSegment = container.querySelector(".from-amber-400");
    const breakSegment = container.querySelector(".from-orange-400");
    expect(workSegment).not.toBeNull();
    expect(breakSegment).not.toBeNull();
  });
});

// ─── SessionLog Tests ────────────────────────────────────────────────────────

describe("SessionLog", () => {
  beforeEach(() => {
    resetStores();
  });

  it("shows 'No active session' when no session", async () => {
    const { default: SessionLog } = await import("../SessionLog");

    render(<SessionLog />);

    expect(screen.getByText("Log")).toBeDefined();
    expect(screen.getByText("No active session")).toBeDefined();
  });

  it("displays session start event with correct timestamp", async () => {
    const { default: SessionLog } = await import("../SessionLog");

    const session = makeSession({ startType: "manual" });
    useSessionStore.getState().setSession(session);

    render(<SessionLog />);

    expect(screen.getByText("Log")).toBeDefined();
    expect(screen.getByText("Started · manual")).toBeDefined();
  });

  it("displays events in chronological order with break entry", async () => {
    const { default: SessionLog } = await import("../SessionLog");

    const session = makeSession();
    useSessionStore.getState().setSession(session);
    useSessionStore.getState().setBreakState({
      active: true,
      breakId: "b1",
      type: "lunch",
      startTime: NOW_UNIX - 300,
    });

    render(<SessionLog />);

    const items = screen.getAllByRole("listitem");
    // First entry: session start, second: break start
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain("Started");
    expect(items[1].textContent).toContain("Break · lunch");
  });

  it("displays session end event when session has endTime", async () => {
    const { default: SessionLog } = await import("../SessionLog");

    const session = makeSession({ endTime: NOW_UNIX });
    useSessionStore.getState().setSession(session);

    render(<SessionLog />);

    expect(screen.getByText("Ended")).toBeDefined();
    const items = screen.getAllByRole("listitem");
    // Start + End
    expect(items.length).toBe(2);
  });
});

// ─── OutputNote Tests ────────────────────────────────────────────────────────

describe("OutputNote", () => {
  beforeEach(() => {
    resetStores();
  });

  it("is editable during active session (Req 12.1)", async () => {
    const { default: OutputNote } = await import("../OutputNote");
    const user = userEvent.setup();

    useSessionStore.getState().setSession(makeSession());

    render(<OutputNote />);

    const textarea = screen.getByLabelText("Output note") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    expect(textarea.placeholder).toContain("What did you ship today?");

    await user.click(textarea);
    await user.type(textarea, "Shipped login page");

    expect(textarea.value).toBe("Shipped login page");
    // Verify store was updated
    expect(useSessionStore.getState().session?.outputNote).toBe(
      "Shipped login page",
    );
  });

  it("pre-fills from session outputNote (Req 12.2)", async () => {
    const { default: OutputNote } = await import("../OutputNote");

    useSessionStore
      .getState()
      .setSession(makeSession({ outputNote: "Built the dashboard" }));

    render(<OutputNote />);

    const textarea = screen.getByLabelText("Output note") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Built the dashboard");
  });

  it("is read-only when no active session", async () => {
    const { default: OutputNote } = await import("../OutputNote");

    // No session set
    render(<OutputNote />);

    const textarea = screen.getByLabelText("Output note") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    expect(textarea.placeholder).toContain("Start a session");
  });

  it("is read-only when session has ended", async () => {
    const { default: OutputNote } = await import("../OutputNote");

    useSessionStore
      .getState()
      .setSession(makeSession({ endTime: NOW_UNIX }));

    render(<OutputNote />);

    const textarea = screen.getByLabelText("Output note") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });
});
