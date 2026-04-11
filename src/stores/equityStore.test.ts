import { describe, it, expect, beforeEach, vi } from "vitest";
import { useEquityStore, subscribeEquityRealtime } from "./equityStore";

// Mock PocketBase
const mockGetFullList = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
vi.mock("@/lib/pocketbase", () => ({
  pb: {
    authStore: { isValid: false, record: null, token: "", clear: vi.fn(), save: vi.fn() },
    collection: vi.fn(() => ({
      getFullList: mockGetFullList,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    })),
  },
}));

describe("equityStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEquityStore.setState({
      stakes: [],
      dilutionHistory: [],
      loading: false,
    });
  });

  it("starts with empty stakes and loading false", () => {
    const state = useEquityStore.getState();
    expect(state.stakes).toEqual([]);
    expect(state.dilutionHistory).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("refresh fetches stakes and dilution history", async () => {
    let callCount = 0;
    mockGetFullList.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // equity_stakes
        return Promise.resolve([
          {
            id: "s1",
            founderId: "f1",
            initialStakePct: 25,
            currentStakePct: 24,
            vestingStartDate: 1700000000,
            cliffDate: 1731536000,
            vestingEndDate: 1826144000,
            vestingScheduleMonths: 48,
            updatedAt: 1700100000,
          },
        ]);
      }
      // dilution_events
      return Promise.resolve([
        {
          id: "d1",
          founderId: "f1",
          cycleId: "c1",
          dilutionPct: 1,
          previousStakePct: 25,
          newStakePct: 24,
          redistributionDetails: JSON.stringify({
            f1: { previous: 25, new: 24 },
            f2: { previous: 25, new: 25.33 },
          }),
          createdAt: 1700100000,
        },
      ]);
    });

    await useEquityStore.getState().refresh();

    const state = useEquityStore.getState();
    expect(state.stakes).toHaveLength(1);
    expect(state.stakes[0].founderId).toBe("f1");
    expect(state.stakes[0].currentStakePct).toBe(24);

    expect(state.dilutionHistory).toHaveLength(1);
    expect(state.dilutionHistory[0].dilutionPct).toBe(1);
    expect(state.dilutionHistory[0].redistributionDetails.f1.previous).toBe(25);
    expect(state.loading).toBe(false);
  });

  it("refresh handles empty data gracefully", async () => {
    mockGetFullList.mockResolvedValue([]);

    await useEquityStore.getState().refresh();

    const state = useEquityStore.getState();
    expect(state.stakes).toEqual([]);
    expect(state.dilutionHistory).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("refresh sets loading false on error", async () => {
    mockGetFullList.mockRejectedValue(new Error("Network error"));

    await useEquityStore.getState().refresh();

    expect(useEquityStore.getState().loading).toBe(false);
  });

  it("subscribeEquityRealtime sets up PocketBase subscriptions", async () => {
    mockSubscribe.mockResolvedValue(undefined);

    const unsub = await subscribeEquityRealtime();
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    expect(typeof unsub).toBe("function");
  });
});
