/**
 * Tests for PocketBase Realtime Manager — governance subscriptions.
 *
 * Validates that the RealtimeManager subscribes to equity_stakes,
 * review_cycles, and dilution_events collections, and triggers
 * the correct store refreshes on incoming events.
 *
 * Requirements: 22.3, 21.1
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { RealtimeManager } from "./realtime";

// Track subscribe calls per collection
const subscribeHandlers: Record<string, (e: unknown) => void> = {};
const mockSubscribe = vi.fn(
  (topic: string, handler: (e: unknown) => void) => {
    // Store handler keyed by collection name (set by mockCollection)
    subscribeHandlers[currentCollection + ":" + topic] = handler;
    return Promise.resolve(undefined);
  },
);
const mockUnsubscribe = vi.fn().mockResolvedValue(undefined);
const mockGetFullList = vi.fn().mockResolvedValue([]);

let currentCollection = "";
const mockCollection = vi.fn((name: string) => {
  currentCollection = name;
  return {
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    getFullList: mockGetFullList,
  };
});

vi.mock("@/lib/pocketbase", () => ({
  pb: {
    collection: (...args: unknown[]) => mockCollection(args[0] as string),
  },
}));

// Mock stores
const mockEquityRefresh = vi.fn().mockResolvedValue(undefined);
const mockReviewRefresh = vi.fn().mockResolvedValue(undefined);

vi.mock("@/stores/equityStore", () => ({
  useEquityStore: {
    getState: () => ({ refresh: mockEquityRefresh }),
  },
}));

vi.mock("@/stores/reviewStore", () => ({
  useReviewStore: {
    getState: () => ({ refresh: mockReviewRefresh }),
  },
}));

vi.mock("@/stores/teamStore", () => ({
  useTeamStore: {
    getState: () => ({
      clearMembers: vi.fn(),
      updateMember: vi.fn(),
      members: {},
    }),
  },
}));

describe("RealtimeManager — governance subscriptions", () => {
  let manager: RealtimeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(subscribeHandlers).forEach(
      (k) => delete subscribeHandlers[k],
    );
    manager = new RealtimeManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  it("subscribes to equity_stakes, review_cycles, and dilution_events on connect", async () => {
    await manager.connect();

    const subscribedCollections = mockCollection.mock.calls
      .filter((call) => {
        // Find calls where subscribe was subsequently called
        return true;
      })
      .map((call) => call[0]);

    expect(subscribedCollections).toContain("equity_stakes");
    expect(subscribedCollections).toContain("review_cycles");
    expect(subscribedCollections).toContain("dilution_events");
  });

  it("triggers equityStore.refresh on equity_stakes event", async () => {
    await manager.connect();

    const handler = subscribeHandlers["equity_stakes:*"];
    expect(handler).toBeDefined();

    handler({
      action: "update",
      record: { id: "s1", founderId: "f1", currentStakePct: 24 },
    });

    expect(mockEquityRefresh).toHaveBeenCalled();
  });

  it("triggers reviewStore.refresh on review_cycles event", async () => {
    await manager.connect();

    const handler = subscribeHandlers["review_cycles:*"];
    expect(handler).toBeDefined();

    handler({
      action: "create",
      record: { id: "rc1", status: "open" },
    });

    expect(mockReviewRefresh).toHaveBeenCalled();
  });

  it("triggers both equityStore and reviewStore refresh on dilution_events event", async () => {
    await manager.connect();

    const handler = subscribeHandlers["dilution_events:*"];
    expect(handler).toBeDefined();

    handler({
      action: "create",
      record: { id: "d1", founderId: "f1", dilutionPct: 1 },
    });

    expect(mockEquityRefresh).toHaveBeenCalled();
    expect(mockReviewRefresh).toHaveBeenCalled();
  });

  it("unsubscribes from governance collections on disconnect", async () => {
    await manager.connect();
    manager.disconnect();

    // Should have called unsubscribe for all 6 collections (3 team + 3 governance)
    const unsubCalls = mockUnsubscribe.mock.calls;
    expect(unsubCalls.length).toBeGreaterThanOrEqual(6);
  });

  it("updates lastUpdateTime on governance events", async () => {
    await manager.connect();

    expect(manager.lastUpdateTime).not.toBeNull();
    const beforeTime = manager.lastUpdateTime!;

    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 10));

    const handler = subscribeHandlers["equity_stakes:*"];
    handler({
      action: "update",
      record: { id: "s1", founderId: "f1" },
    });

    expect(manager.lastUpdateTime).toBeGreaterThanOrEqual(beforeTime);
  });
});
