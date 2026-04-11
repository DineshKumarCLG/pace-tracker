import { describe, it, expect, beforeEach, vi } from "vitest";
import { useReviewStore } from "./reviewStore";

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
vi.mock("@/lib/pocketbase", () => ({
  pb: {
    authStore: { isValid: false, record: null, token: "", clear: vi.fn(), save: vi.fn() },
    collection: vi.fn(() => ({
      getFullList: vi.fn(async () => []),
      subscribe: vi.fn(async () => {}),
      unsubscribe: vi.fn(async () => {}),
    })),
  },
}));

// Mock authStore
vi.mock("@/stores/authStore", () => ({
  useAuthStore: {
    getState: () => ({
      user: { id: "f1", name: "Alice", email: "a@b.com", role: "founder", avatarColor: "#fff" },
    }),
  },
}));

// Mock equityStore
const mockEquityRefresh = vi.fn(async () => {});
vi.mock("@/stores/equityStore", () => ({
  useEquityStore: {
    getState: () => ({
      refresh: mockEquityRefresh,
      stakes: [
        { founderId: "f1", currentStakePct: 34.0 },
        { founderId: "f2", currentStakePct: 33.0 },
        { founderId: "f3", currentStakePct: 33.0 },
      ],
    }),
  },
}));

// Mock notifications
const mockNotifyDilution = vi.fn(async () => {});
vi.mock("@/lib/notifications", () => ({
  notifyDilutionTriggered: (...args: unknown[]) => mockNotifyDilution(...args),
}));

describe("reviewStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReviewStore.setState({
      currentCycle: null,
      results: [],
      history: [],
      warnings: {},
      loading: false,
    });
  });

  it("starts with null currentCycle and loading false", () => {
    const state = useReviewStore.getState();
    expect(state.currentCycle).toBeNull();
    expect(state.results).toEqual([]);
    expect(state.history).toEqual([]);
    expect(state.warnings).toEqual({});
    expect(state.loading).toBe(false);
  });

  it("refresh fetches review history and warning counts", async () => {
    const cycle = {
      id: "c1",
      startDate: 1700000000,
      endDate: 1701209600,
      submissionDeadline: 1700172800,
      status: "open",
      resolvedAt: null,
      createdAt: 1700000000,
    };

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_review_history") return Promise.resolve([cycle]);
      if (cmd === "get_warning_count") return Promise.resolve(2);
      return Promise.resolve(null);
    });

    await useReviewStore.getState().refresh();

    const state = useReviewStore.getState();
    expect(state.currentCycle).toEqual(cycle);
    expect(state.history).toEqual([cycle]);
    expect(state.warnings.f1).toBe(2);
    expect(state.loading).toBe(false);
  });

  it("refresh fetches results for closed cycles", async () => {
    const cycle = {
      id: "c1",
      startDate: 1700000000,
      endDate: 1701209600,
      submissionDeadline: 1700172800,
      status: "resolved",
      resolvedAt: 1700200000,
      createdAt: 1700000000,
    };

    const results = [
      { founderId: "f1", outputAvg: 4.0, reliabilityAvg: 3.5, initiativeAvg: 4.5, overallAvg: 4.0 },
      { founderId: "f2", outputAvg: 3.0, reliabilityAvg: 3.0, initiativeAvg: 3.0, overallAvg: 3.0 },
    ];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_review_history") return Promise.resolve([cycle]);
      if (cmd === "close_review_cycle") return Promise.resolve(results);
      if (cmd === "get_warning_count") return Promise.resolve(1);
      return Promise.resolve(null);
    });

    await useReviewStore.getState().refresh();

    const state = useReviewStore.getState();
    expect(state.results).toEqual(results);
    expect(state.warnings.f1).toBe(1);
    expect(state.warnings.f2).toBe(1);
  });

  it("submitReview calls invoke with correct params", async () => {
    useReviewStore.setState({
      currentCycle: {
        id: "c1",
        startDate: 1700000000,
        endDate: 1701209600,
        submissionDeadline: 1700172800,
        status: "open",
        resolvedAt: null,
        createdAt: 1700000000,
      },
    });

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "submit_founder_review") return Promise.resolve(undefined);
      if (cmd === "get_review_history") return Promise.resolve([]);
      if (cmd === "get_warning_count") return Promise.resolve(0);
      return Promise.resolve(null);
    });

    await useReviewStore.getState().submitReview("f2", 4, 3, 5);

    expect(mockInvoke).toHaveBeenCalledWith("submit_founder_review", {
      cycleId: "c1",
      reviewerId: "f1",
      revieweeId: "f2",
      outputScore: 4,
      reliabilityScore: 3,
      initiativeScore: 5,
    });
  });

  it("submitReview throws when no active cycle", async () => {
    await expect(
      useReviewStore.getState().submitReview("f2", 4, 3, 5),
    ).rejects.toThrow("No active review cycle");
  });

  it("refresh handles empty history gracefully", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_review_history") return Promise.resolve([]);
      if (cmd === "get_warning_count") return Promise.resolve(0);
      return Promise.resolve(null);
    });

    await useReviewStore.getState().refresh();

    const state = useReviewStore.getState();
    expect(state.currentCycle).toBeNull();
    expect(state.results).toEqual([]);
    expect(state.history).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("refresh sets loading false on error", async () => {
    mockInvoke.mockRejectedValue(new Error("DB error"));

    await useReviewStore.getState().refresh();

    expect(useReviewStore.getState().loading).toBe(false);
  });

  it("refresh checks for dilution events after closing a resolved cycle", async () => {
    const cycle = {
      id: "c1",
      startDate: 1700000000,
      endDate: 1701209600,
      submissionDeadline: 1700172800,
      status: "resolved",
      resolvedAt: 1700200000,
      createdAt: 1700000000,
    };

    const results = [
      { founderId: "f1", outputAvg: 4.0, reliabilityAvg: 3.5, initiativeAvg: 4.5, overallAvg: 4.0 },
      { founderId: "f2", outputAvg: 2.0, reliabilityAvg: 2.0, initiativeAvg: 2.0, overallAvg: 2.0 },
    ];

    const dilutionEvents = [
      {
        id: "d1",
        founderId: "f2",
        cycleId: "c1",
        dilutionPct: 1.0,
        previousStakePct: 33.33,
        newStakePct: 32.33,
        redistributionDetails: "{}",
        createdAt: 1700200000,
      },
    ];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_review_history") return Promise.resolve([cycle]);
      if (cmd === "close_review_cycle") return Promise.resolve(results);
      if (cmd === "get_dilution_events_for_cycle") return Promise.resolve(dilutionEvents);
      if (cmd === "get_warning_count") return Promise.resolve(2);
      return Promise.resolve(null);
    });

    await useReviewStore.getState().refresh();

    // Verify dilution events were queried for the cycle
    expect(mockInvoke).toHaveBeenCalledWith("get_dilution_events_for_cycle", { cycleId: "c1" });

    // Verify equity store was refreshed
    expect(mockEquityRefresh).toHaveBeenCalled();

    // Verify dilution notification was sent
    expect(mockNotifyDilution).toHaveBeenCalledWith("f2", 1.0);
  });

  it("refresh does not trigger dilution handling for open cycles", async () => {
    const cycle = {
      id: "c1",
      startDate: 1700000000,
      endDate: 1701209600,
      submissionDeadline: 1700172800,
      status: "open",
      resolvedAt: null,
      createdAt: 1700000000,
    };

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_review_history") return Promise.resolve([cycle]);
      if (cmd === "get_warning_count") return Promise.resolve(0);
      return Promise.resolve(null);
    });

    await useReviewStore.getState().refresh();

    // Should NOT call get_dilution_events_for_cycle for open cycles
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "get_dilution_events_for_cycle",
      expect.anything(),
    );
  });

  it("refresh handles dilution check failure gracefully", async () => {
    const cycle = {
      id: "c1",
      startDate: 1700000000,
      endDate: 1701209600,
      submissionDeadline: 1700172800,
      status: "resolved",
      resolvedAt: 1700200000,
      createdAt: 1700000000,
    };

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_review_history") return Promise.resolve([cycle]);
      if (cmd === "close_review_cycle") return Promise.resolve([]);
      if (cmd === "get_dilution_events_for_cycle") return Promise.reject(new Error("DB error"));
      if (cmd === "get_warning_count") return Promise.resolve(0);
      return Promise.resolve(null);
    });

    // Should not throw even if dilution check fails
    await useReviewStore.getState().refresh();

    const state = useReviewStore.getState();
    expect(state.loading).toBe(false);
  });
});
