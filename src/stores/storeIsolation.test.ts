import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "./sessionStore";
import { useTaskStore } from "./taskStore";
import { useTeamStore } from "./teamStore";
import { useUiStore } from "./uiStore";
import type { Session, Task, TeamMember } from "@/types";

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

const mockTask: Task = {
  id: "t1",
  projectId: "p1",
  title: "Test task",
  status: "open",
  assigneeId: null,
  priority: "medium",
  dueDate: null,
  estimatedMinutes: null,
  notes: null,
  createdBy: "u1",
  createdAt: 1700000000,
  closedAt: null,
};

const mockMember: TeamMember = {
  userId: "u1",
  name: "Alice",
  status: "active",
  currentTask: "Build UI",
  sessionStart: 1700000000,
  breakStart: null,
  outputNote: null,
  avatarColor: "#6e6af6",
};

describe("store isolation", () => {
  beforeEach(() => {
    useSessionStore.setState({
      session: null,
      paused: false,
      breakState: { active: false, breakId: null, type: null, startTime: null },
      idleModalVisible: false,
    });
    useTaskStore.setState({ activeTaskId: null, tasks: [] });
    useTeamStore.setState({ members: {} });
    useUiStore.setState({
      sidebarCollapsed: false,
      theme: "system",
      syncStatus: "synced",
      lastSyncTime: null,
    });
  });

  it("mutating sessionStore does not affect taskStore", () => {
    useSessionStore.getState().setSession(mockSession);
    useSessionStore.getState().setPaused(true);

    expect(useTaskStore.getState().activeTaskId).toBeNull();
    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });

  it("mutating taskStore does not affect sessionStore", () => {
    useTaskStore.getState().addTask(mockTask);
    useTaskStore.getState().setActiveTask("t1");

    expect(useSessionStore.getState().session).toBeNull();
    expect(useSessionStore.getState().paused).toBe(false);
  });

  it("mutating teamStore does not affect uiStore", () => {
    useTeamStore.getState().updateMember("u1", mockMember);

    expect(useUiStore.getState().theme).toBe("system");
    expect(useUiStore.getState().syncStatus).toBe("synced");
    expect(useUiStore.getState().lastSyncTime).toBeNull();
  });

  it("mutating uiStore does not affect teamStore", () => {
    useUiStore.getState().setTheme("dark");
    useUiStore.getState().setSyncStatus("error");
    useUiStore.getState().setLastSyncTime(1700000000);

    expect(Object.keys(useTeamStore.getState().members)).toHaveLength(0);
  });

  it("clearing sessionStore does not affect other stores", () => {
    // Populate all stores
    useSessionStore.getState().setSession(mockSession);
    useTaskStore.getState().addTask(mockTask);
    useTaskStore.getState().setActiveTask("t1");
    useTeamStore.getState().updateMember("u1", mockMember);
    useUiStore.getState().setTheme("dark");

    // Clear session
    useSessionStore.getState().clearSession();

    // Other stores remain intact
    expect(useTaskStore.getState().activeTaskId).toBe("t1");
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(useTeamStore.getState().members["u1"]).toEqual(mockMember);
    expect(useUiStore.getState().theme).toBe("dark");
  });

  it("simultaneous mutations across all stores are independent", () => {
    useSessionStore.getState().setSession(mockSession);
    useTaskStore.getState().addTask(mockTask);
    useTeamStore.getState().updateMember("u1", mockMember);
    useUiStore.getState().setTheme("dark");

    // Verify each store has only its own state
    expect(useSessionStore.getState().session?.id).toBe("s1");
    expect(useTaskStore.getState().tasks[0].id).toBe("t1");
    expect(useTeamStore.getState().members["u1"].name).toBe("Alice");
    expect(useUiStore.getState().theme).toBe("dark");

    // Mutate one, verify others unchanged
    useTaskStore.setState({ activeTaskId: null, tasks: [] });

    expect(useSessionStore.getState().session?.id).toBe("s1");
    expect(useTeamStore.getState().members["u1"].name).toBe("Alice");
    expect(useUiStore.getState().theme).toBe("dark");
  });
});
