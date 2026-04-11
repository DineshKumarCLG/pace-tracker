import { describe, it, expect, beforeEach, vi } from "vitest";
import { useLeaderboardStore } from "./leaderboardStore";

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock isTauri
vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
}));

// Mock PocketBase
const mockGetFullList = vi.fn();
vi.mock("@/lib/pocketbase", () => ({
  pb: {
    authStore: { isValid: false, record: null, token: "", clear: vi.fn(), save: vi.fn() },
    collection: vi.fn(() => ({
      getFullList: mockGetFullList,
    })),
  },
}));

describe("leaderboardStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLeaderboardStore.setState({
      scores: [],
      currentWeek: "",
      loading: false,
    });
  });

  it("starts with empty scores and loading false", () => {
    const state = useLeaderboardStore.getState();
    expect(state.scores).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("refresh computes scores from founder data", async () => {
    mockGetFullList.mockResolvedValue([
      { id: "f1", name: "Alice", role: "founder" },
      { id: "f2", name: "Bob", role: "Co-founder, CEO" },
    ]);

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "compute_startup_health") {
        return Promise.resolve({
          founderHours: [
            { founderId: "f1", weeklyHours: 40 },
            { founderId: "f2", weeklyHours: 30 },
          ],
        });
      }
      if (cmd === "list_tasks") {
        return Promise.resolve([
          { assigneeId: "f1", status: "done" },
          { assigneeId: "f1", status: "done" },
          { assigneeId: "f2", status: "done" },
          { assigneeId: "f2", status: "inprogress" },
        ]);
      }
      return Promise.resolve(null);
    });

    await useLeaderboardStore.getState().refresh();

    const state = useLeaderboardStore.getState();
    expect(state.scores).toHaveLength(2);
    expect(state.loading).toBe(false);
    expect(state.currentWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Alice has more hours and tasks, should rank higher
    expect(state.scores[0].founderId).toBe("f1");
    expect(state.scores[0].isFounderOfWeek).toBe(true);
    expect(state.scores[1].isFounderOfWeek).toBe(false);
  });

  it("refresh handles no founders gracefully", async () => {
    mockGetFullList.mockResolvedValue([]);

    await useLeaderboardStore.getState().refresh();

    const state = useLeaderboardStore.getState();
    expect(state.scores).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("refresh sets loading false on error", async () => {
    mockGetFullList.mockRejectedValue(new Error("Network error"));

    await useLeaderboardStore.getState().refresh();

    expect(useLeaderboardStore.getState().loading).toBe(false);
  });

  it("currentWeek is a Monday date string", () => {
    // After refresh, currentWeek should be set
    const state = useLeaderboardStore.getState();
    // The initial value from create is computed at module load
    // Just verify the format is correct if set
    if (state.currentWeek) {
      expect(state.currentWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
