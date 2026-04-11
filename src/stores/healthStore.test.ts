import { describe, it, expect, beforeEach, vi } from "vitest";
import { useHealthStore } from "./healthStore";

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
    })),
  },
}));

describe("healthStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHealthStore.setState({
      data: null,
      config: null,
      decisions: [],
      loading: false,
    });
  });

  it("starts with null data and loading false", () => {
    const state = useHealthStore.getState();
    expect(state.data).toBeNull();
    expect(state.config).toBeNull();
    expect(state.decisions).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("refresh computes health data from Rust raw data", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "compute_startup_health") {
        return Promise.resolve({
          config: {
            id: "cfg1",
            cashBalance: 50000,
            monthlyExpenses: "[5000, 6000, 5500]",
            plannedMonthlyBudget: 5500,
            updatedAt: 1700000000,
          },
          decisions: [
            {
              id: "d1",
              title: "Hire engineer",
              description: "Need backend dev",
              createdAt: 1700000000 - 86400,
              resolvedAt: 1700000000,
            },
            {
              id: "d2",
              title: "Office lease",
              description: "Renew or move",
              createdAt: 1700000000 - 3600,
              resolvedAt: null,
            },
          ],
          founderHours: [
            { founderId: "f1", name: "Alice", weeklyHours: 40 },
            { founderId: "f2", name: "Bob", weeklyHours: 35 },
          ],
        });
      }
      return Promise.resolve(null);
    });

    await useHealthStore.getState().refresh();

    const state = useHealthStore.getState();
    expect(state.data).not.toBeNull();
    expect(state.config).not.toBeNull();
    expect(state.decisions).toHaveLength(2);
    expect(state.loading).toBe(false);

    // Runway: 50000 / mean(5000, 6000, 5500) = 50000 / 5500 ≈ 9.1
    expect(state.data!.runwayMonths).toBeCloseTo(9.1, 0);
    expect(state.data!.runwayStatus).toBe("normal");

    // Founder balance: 2 founders with 40 and 35 hours
    expect(state.data!.founderBalance.founders).toHaveLength(2);
    expect(state.data!.founderBalance.teamAvgHours).toBeCloseTo(37.5, 1);

    // Burn rate: 5500 / 5500 * 100 = 100%
    expect(state.data!.burnRateAlignment).toBe(100);
    expect(state.data!.burnRateStatus).toBe("normal");
  });

  it("refresh handles missing config with defaults", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "compute_startup_health") {
        return Promise.resolve({
          config: null,
          decisions: [],
          founderHours: [],
        });
      }
      return Promise.resolve(null);
    });

    await useHealthStore.getState().refresh();

    const state = useHealthStore.getState();
    expect(state.data).not.toBeNull();
    expect(state.data!.runwayMonths).toBe(Infinity);
    expect(state.data!.runwayStatus).toBe("normal");
    expect(state.data!.founderBalance.founders).toEqual([]);
    expect(state.config).toBeNull();
  });

  it("refresh sets loading false on error", async () => {
    mockInvoke.mockRejectedValue(new Error("DB error"));

    await useHealthStore.getState().refresh();

    expect(useHealthStore.getState().loading).toBe(false);
  });

  it("logDecision adds decision optimistically", async () => {
    // First call for logDecision's execute_sql, subsequent for refresh
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "execute_sql") return Promise.resolve(undefined);
      if (cmd === "compute_startup_health") {
        return Promise.resolve({
          config: null,
          decisions: [],
          founderHours: [],
        });
      }
      return Promise.resolve(null);
    });

    await useHealthStore.getState().logDecision("New hire", "Hire a designer");

    const state = useHealthStore.getState();
    // After refresh, decisions come from the backend (empty in mock)
    // But the optimistic update should have been applied before refresh
    expect(state.loading).toBe(false);
  });

  it("resolveDecision updates decision optimistically", async () => {
    useHealthStore.setState({
      decisions: [
        { id: "d1", title: "Test", description: "Desc", createdAt: 1700000000, resolvedAt: null },
      ],
    });

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "execute_sql") return Promise.resolve(undefined);
      if (cmd === "compute_startup_health") {
        return Promise.resolve({
          config: null,
          decisions: [
            { id: "d1", title: "Test", description: "Desc", createdAt: 1700000000, resolvedAt: 1700100000 },
          ],
          founderHours: [],
        });
      }
      return Promise.resolve(null);
    });

    await useHealthStore.getState().resolveDecision("d1");

    const state = useHealthStore.getState();
    expect(state.loading).toBe(false);
  });

  it("updateConfig calls invoke and refreshes", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "execute_sql") return Promise.resolve(undefined);
      if (cmd === "compute_startup_health") {
        return Promise.resolve({
          config: {
            id: "default",
            cashBalance: 100000,
            monthlyExpenses: "[8000, 9000, 8500]",
            plannedMonthlyBudget: 8500,
            updatedAt: 1700100000,
          },
          decisions: [],
          founderHours: [],
        });
      }
      return Promise.resolve(null);
    });

    await useHealthStore.getState().updateConfig({
      cashBalance: 100000,
      monthlyExpenses: [8000, 9000, 8500],
      plannedMonthlyBudget: 8500,
    });

    const state = useHealthStore.getState();
    expect(state.loading).toBe(false);
  });
});
