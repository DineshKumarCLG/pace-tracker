import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "./sessionStore";
import type { Session } from "@/types";

const mockSession: Session = {
  id: "s1",
  userId: "u1",
  startTime: 1700000000,
  endTime: null,
  startType: "manual",
  startVerified: true,
  outputNote: null,
  lastHeartbeat: 1700000010,
  syncedAt: null,
  createdAt: 1700000000,
};

describe("sessionStore", () => {
  beforeEach(() => {
    useSessionStore.setState({
      session: null,
      paused: false,
      breakState: { active: false, breakId: null, type: null, startTime: null },
      idleModalVisible: false,
    });
  });

  it("setSession stores the session", () => {
    useSessionStore.getState().setSession(mockSession);
    expect(useSessionStore.getState().session).toEqual(mockSession);
  });

  it("clearSession resets all state", () => {
    useSessionStore.getState().setSession(mockSession);
    useSessionStore.getState().setPaused(true);
    useSessionStore.getState().setBreakState({ active: true, breakId: "b1", type: "lunch", startTime: 1700000100 });
    useSessionStore.getState().setIdleModalVisible(true);

    useSessionStore.getState().clearSession();

    const state = useSessionStore.getState();
    expect(state.session).toBeNull();
    expect(state.paused).toBe(false);
    expect(state.breakState).toEqual({ active: false, breakId: null, type: null, startTime: null });
    expect(state.idleModalVisible).toBe(false);
  });

  it("setPaused toggles paused state", () => {
    useSessionStore.getState().setPaused(true);
    expect(useSessionStore.getState().paused).toBe(true);
    useSessionStore.getState().setPaused(false);
    expect(useSessionStore.getState().paused).toBe(false);
  });

  it("setBreakState updates break state", () => {
    useSessionStore.getState().setBreakState({ active: true, breakId: "b1", type: "short", startTime: 1700000200 });
    expect(useSessionStore.getState().breakState).toEqual({
      active: true,
      breakId: "b1",
      type: "short",
      startTime: 1700000200,
    });
  });

  it("setIdleModalVisible controls modal visibility", () => {
    useSessionStore.getState().setIdleModalVisible(true);
    expect(useSessionStore.getState().idleModalVisible).toBe(true);
  });

  it("setSession does not leak stale paused/break/idle state", () => {
    // Set up stale state
    useSessionStore.getState().setPaused(true);
    useSessionStore.getState().setBreakState({ active: true, breakId: "b1", type: "lunch", startTime: 1700000100 });
    useSessionStore.getState().setIdleModalVisible(true);

    // Setting a new session should NOT clear other fields (they are independent)
    useSessionStore.getState().setSession(mockSession);

    const state = useSessionStore.getState();
    expect(state.session).toEqual(mockSession);
    // paused/break/idle remain — only clearSession resets them
    expect(state.paused).toBe(true);
    expect(state.breakState.active).toBe(true);
    expect(state.idleModalVisible).toBe(true);
  });

  it("replacing a session with setSession overwrites the previous session entirely", () => {
    useSessionStore.getState().setSession(mockSession);
    const newSession: Session = {
      ...mockSession,
      id: "s2",
      startTime: 1700001000,
    };
    useSessionStore.getState().setSession(newSession);

    const state = useSessionStore.getState();
    expect(state.session?.id).toBe("s2");
    expect(state.session?.startTime).toBe(1700001000);
  });
});
