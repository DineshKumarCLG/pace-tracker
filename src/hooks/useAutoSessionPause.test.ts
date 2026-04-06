import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSessionStore } from "@/stores/sessionStore";
import type { Session } from "@/types";

// --- Tauri runtime mock ---
vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
}));

// --- Tauri event mock ---
type ListenCallback = (event: { payload: unknown }) => void;
const listeners: Record<string, ListenCallback> = {};
const mockUnlisten = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, cb: ListenCallback) => {
    listeners[event] = cb;
    return Promise.resolve(mockUnlisten);
  }),
}));

// --- db mock ---
const mockEndSession = vi.fn();
vi.mock("@/lib/db", () => ({
  endSession: (...args: unknown[]) => mockEndSession(...args),
}));

// --- timestamp mock ---
let fakeNow = 1_700_010_000;
vi.mock("@/lib/timestamp", () => ({
  nowUtc: () => fakeNow,
}));

import {
  useAutoSessionPause,
  shouldAutoClose,
  AUTO_CLOSE_IDLE_SECS,
} from "@/hooks/useAutoSessionPause";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    userId: "user-1",
    startTime: 1_700_000_000,
    endTime: null,
    startType: "manual",
    startVerified: true,
    outputNote: null,
    lastHeartbeat: 1_700_009_990,
    syncedAt: null,
    createdAt: 1_700_000_000,
    ...overrides,
  };
}

describe("shouldAutoClose (pure)", () => {
  it("returns false when lastHeartbeat is null", () => {
    expect(shouldAutoClose(null, 1_700_010_000)).toBe(false);
  });

  it("returns false when gap is under threshold", () => {
    const hb = 1_700_010_000;
    expect(shouldAutoClose(hb, hb + 3600)).toBe(false); // 1h < 2h
  });

  it("returns true when gap equals threshold", () => {
    const hb = 1_700_000_000;
    expect(shouldAutoClose(hb, hb + AUTO_CLOSE_IDLE_SECS)).toBe(true);
  });

  it("returns true when gap exceeds threshold", () => {
    const hb = 1_700_000_000;
    expect(shouldAutoClose(hb, hb + AUTO_CLOSE_IDLE_SECS + 600)).toBe(true);
  });

  it("respects custom threshold", () => {
    const hb = 1_700_000_000;
    expect(shouldAutoClose(hb, hb + 100, 100)).toBe(true);
    expect(shouldAutoClose(hb, hb + 99, 100)).toBe(false);
  });
});

describe("useAutoSessionPause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fakeNow = 1_700_010_000;
    // Clear listeners
    Object.keys(listeners).forEach((k) => delete listeners[k]);
    useSessionStore.setState({
      session: null,
      paused: false,
      breakState: { active: false, breakId: null, type: null, startTime: null },
      idleModalVisible: false,
      idleInfo: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers session_pause and session_resume listeners", async () => {
    useSessionStore.setState({ session: makeSession() });
    renderHook(() => useAutoSessionPause());
    await vi.advanceTimersByTimeAsync(0);

    expect(listeners["session_pause"]).toBeDefined();
    expect(listeners["session_resume"]).toBeDefined();
  });

  it("sets paused=true on session_pause when session is active (Req 4.1, 4.2)", async () => {
    useSessionStore.setState({ session: makeSession() });
    renderHook(() => useAutoSessionPause());
    await vi.advanceTimersByTimeAsync(0);

    // Simulate the Tauri event
    listeners["session_pause"]({
      payload: { type: "session_pause", reason: "screen_lock", timestamp: fakeNow },
    });

    expect(useSessionStore.getState().paused).toBe(true);
  });

  it("sets paused=false on session_resume when session is active (Req 4.1, 4.2)", async () => {
    useSessionStore.setState({ session: makeSession(), paused: true });
    renderHook(() => useAutoSessionPause());
    await vi.advanceTimersByTimeAsync(0);

    listeners["session_resume"]({
      payload: { type: "session_resume", reason: "screen_unlock", timestamp: fakeNow },
    });

    expect(useSessionStore.getState().paused).toBe(false);
  });

  it("does not set paused when no session is active", async () => {
    useSessionStore.setState({ session: null });
    renderHook(() => useAutoSessionPause());
    await vi.advanceTimersByTimeAsync(0);

    listeners["session_pause"]({
      payload: { type: "session_pause", reason: "sleep", timestamp: fakeNow },
    });

    expect(useSessionStore.getState().paused).toBe(false);
  });

  it("auto-closes session when idle for 2+ hours (Req 4.3)", async () => {
    const staleHb = fakeNow - AUTO_CLOSE_IDLE_SECS; // exactly 2h ago
    const session = makeSession({ lastHeartbeat: staleHb });
    useSessionStore.setState({ session });
    mockEndSession.mockResolvedValue(undefined);

    renderHook(() => useAutoSessionPause());

    // Advance past the check interval
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockEndSession).toHaveBeenCalledWith("sess-1", staleHb);
    expect(useSessionStore.getState().session).toBeNull();
  });

  it("does not auto-close when heartbeat is recent", async () => {
    const session = makeSession({ lastHeartbeat: fakeNow - 10 });
    useSessionStore.setState({ session });

    renderHook(() => useAutoSessionPause());

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockEndSession).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session).not.toBeNull();
  });

  it("does not auto-close when no session is active", async () => {
    useSessionStore.setState({ session: null });

    renderHook(() => useAutoSessionPause());

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockEndSession).not.toHaveBeenCalled();
  });

  it("cleans up listeners on unmount", async () => {
    useSessionStore.setState({ session: makeSession() });
    const { unmount } = renderHook(() => useAutoSessionPause());

    // Allow the listen promises to resolve so unlisten fns are captured
    await vi.advanceTimersByTimeAsync(0);

    unmount();

    // mockUnlisten should have been called for both listeners
    expect(mockUnlisten).toHaveBeenCalled();
  });
});
