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

// --- Notification mock ---
const mockSendNotification = vi.fn();
const mockIsPermissionGranted = vi.fn().mockResolvedValue(true);
const mockRequestPermission = vi.fn().mockResolvedValue("granted");

vi.mock("@tauri-apps/plugin-notification", () => ({
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  isPermissionGranted: () => mockIsPermissionGranted(),
  requestPermission: () => mockRequestPermission(),
}));

import {
  useSoftNudge,
  buildNudgeMessage,
  NUDGE_TIMEOUT_MS,
} from "@/hooks/useSoftNudge";

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

describe("buildNudgeMessage (pure)", () => {
  it("includes task name when provided", () => {
    expect(buildNudgeMessage("Design review")).toBe(
      "Still working on Design review?",
    );
  });

  it("uses generic message when task is empty", () => {
    expect(buildNudgeMessage("")).toBe("Still working?");
  });

  it("trims whitespace from task name", () => {
    expect(buildNudgeMessage("  Code review  ")).toBe(
      "Still working on Code review?",
    );
  });
});

describe("useSoftNudge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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

  it("registers soft_nudge listener when session is active", async () => {
    useSessionStore.setState({ session: makeSession() });
    renderHook(() => useSoftNudge());
    await vi.advanceTimersByTimeAsync(0);

    expect(listeners["soft_nudge"]).toBeDefined();
  });

  it("does not register listener when no session is active", async () => {
    useSessionStore.setState({ session: null });
    renderHook(() => useSoftNudge());
    await vi.advanceTimersByTimeAsync(0);

    expect(listeners["soft_nudge"]).toBeUndefined();
  });

  it("sends OS notification on soft_nudge event (Req 6.1)", async () => {
    useSessionStore.setState({ session: makeSession() });
    renderHook(() => useSoftNudge());
    await vi.advanceTimersByTimeAsync(0);

    // Simulate the Tauri event
    await listeners["soft_nudge"]({
      payload: {
        type: "soft_nudge",
        active_duration_secs: 5400,
        current_task: "Design review",
      },
    });

    expect(mockSendNotification).toHaveBeenCalledWith({
      title: "PACE",
      body: "Still working on Design review?",
    });
  });

  it("pauses session after 5 minutes with no interaction (Req 6.2)", async () => {
    useSessionStore.setState({ session: makeSession() });
    renderHook(() => useSoftNudge());
    await vi.advanceTimersByTimeAsync(0);

    await listeners["soft_nudge"]({
      payload: {
        type: "soft_nudge",
        active_duration_secs: 5400,
        current_task: "Design review",
      },
    });

    // Not paused yet
    expect(useSessionStore.getState().paused).toBe(false);

    // Advance past the 5-minute timeout
    vi.advanceTimersByTime(NUDGE_TIMEOUT_MS);

    expect(useSessionStore.getState().paused).toBe(true);
  });

  it("cancels pause timer on user mouse activity", async () => {
    useSessionStore.setState({ session: makeSession() });
    renderHook(() => useSoftNudge());
    await vi.advanceTimersByTimeAsync(0);

    await listeners["soft_nudge"]({
      payload: {
        type: "soft_nudge",
        active_duration_secs: 5400,
        current_task: "Code review",
      },
    });

    // Simulate user activity before timeout
    window.dispatchEvent(new Event("mousemove"));

    // Advance past the timeout
    vi.advanceTimersByTime(NUDGE_TIMEOUT_MS);

    // Should NOT be paused because user interacted
    expect(useSessionStore.getState().paused).toBe(false);
  });

  it("cancels pause timer on user keyboard activity", async () => {
    useSessionStore.setState({ session: makeSession() });
    renderHook(() => useSoftNudge());
    await vi.advanceTimersByTimeAsync(0);

    await listeners["soft_nudge"]({
      payload: {
        type: "soft_nudge",
        active_duration_secs: 5400,
        current_task: "Code review",
      },
    });

    // Simulate keyboard activity before timeout
    window.dispatchEvent(new Event("keydown"));

    vi.advanceTimersByTime(NUDGE_TIMEOUT_MS);

    expect(useSessionStore.getState().paused).toBe(false);
  });

  it("does not pause if session ended before timeout", async () => {
    useSessionStore.setState({ session: makeSession() });
    renderHook(() => useSoftNudge());
    await vi.advanceTimersByTimeAsync(0);

    await listeners["soft_nudge"]({
      payload: {
        type: "soft_nudge",
        active_duration_secs: 5400,
        current_task: "Task",
      },
    });

    // Session ends before timeout
    useSessionStore.setState({ session: null });

    vi.advanceTimersByTime(NUDGE_TIMEOUT_MS);

    expect(useSessionStore.getState().paused).toBe(false);
  });

  it("requests notification permission if not granted (Req 6.1)", async () => {
    mockIsPermissionGranted.mockResolvedValueOnce(false);
    mockRequestPermission.mockResolvedValueOnce("granted");

    useSessionStore.setState({ session: makeSession() });
    renderHook(() => useSoftNudge());
    await vi.advanceTimersByTimeAsync(0);

    await listeners["soft_nudge"]({
      payload: {
        type: "soft_nudge",
        active_duration_secs: 5400,
        current_task: "Task",
      },
    });

    expect(mockRequestPermission).toHaveBeenCalled();
    expect(mockSendNotification).toHaveBeenCalled();
  });

  it("does not send notification if permission denied", async () => {
    mockIsPermissionGranted.mockResolvedValueOnce(false);
    mockRequestPermission.mockResolvedValueOnce("denied");

    useSessionStore.setState({ session: makeSession() });
    renderHook(() => useSoftNudge());
    await vi.advanceTimersByTimeAsync(0);

    await listeners["soft_nudge"]({
      payload: {
        type: "soft_nudge",
        active_duration_secs: 5400,
        current_task: "Task",
      },
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("cleans up listener on unmount", async () => {
    useSessionStore.setState({ session: makeSession() });
    const { unmount } = renderHook(() => useSoftNudge());

    await vi.advanceTimersByTimeAsync(0);

    unmount();

    expect(mockUnlisten).toHaveBeenCalled();
  });
});
