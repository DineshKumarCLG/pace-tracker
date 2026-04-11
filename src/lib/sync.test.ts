import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SyncService,
  computeBackoffMs,
  SYNCED_COLLECTIONS,
  PRIVATE_COLLECTIONS,
  LOCAL_ONLY_COLLECTIONS,
  type PocketBaseCaller,
} from "./sync";
import { useUiStore } from "@/stores/uiStore";

describe("computeBackoffMs", () => {
  it("returns 1s for retry 0", () => {
    expect(computeBackoffMs(0)).toBe(1000);
  });

  it("returns exponential values", () => {
    expect(computeBackoffMs(1)).toBe(2000);
    expect(computeBackoffMs(2)).toBe(4000);
    expect(computeBackoffMs(3)).toBe(8000);
    expect(computeBackoffMs(4)).toBe(16000);
  });
});

describe("SyncService", () => {
  let service: SyncService;
  let pbCall: PocketBaseCaller;

  beforeEach(() => {
    vi.useFakeTimers();
    pbCall = vi.fn().mockResolvedValue(undefined);
    service = new SyncService(pbCall);
    // Reset uiStore
    useUiStore.setState({
      syncStatus: "synced",
      lastSyncTime: null,
    });
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  describe("queue()", () => {
    it("adds an operation to the queue", () => {
      service.queue("sessions", "create", "s1", { userId: "u1" });
      expect(service.getQueueSize()).toBe(1);
    });

    it("assigns unique ids to each operation", () => {
      service.queue("sessions", "create", "s1", {});
      service.queue("sessions", "update", "s1", {});
      const queue = service.getQueue();
      expect(queue[0].id).not.toBe(queue[1].id);
    });

    it("stores correct fields on queued operation", () => {
      const before = Date.now();
      service.queue("tasks", "update", "t1", { title: "Test" });
      const op = service.getQueue()[0];
      expect(op.collection).toBe("tasks");
      expect(op.operation).toBe("update");
      expect(op.recordId).toBe("t1");
      expect(op.data).toEqual({ title: "Test" });
      expect(op.retryCount).toBe(0);
      expect(op.timestamp).toBeGreaterThanOrEqual(before);
    });
  });

  describe("start() / stop()", () => {
    it("starts the interval timer", () => {
      service.start();
      expect(service.isRunning()).toBe(true);
    });

    it("stops the interval timer", () => {
      service.start();
      service.stop();
      expect(service.isRunning()).toBe(false);
    });

    it("is idempotent on start", () => {
      service.start();
      service.start(); // should not throw or create duplicate intervals
      expect(service.isRunning()).toBe(true);
    });
  });

  describe("_syncCycle()", () => {
    it("returns zeros when queue is empty", async () => {
      const result = await service.forceSync();
      expect(result).toEqual({ synced: 0, failed: 0, queued: 0 });
    });

    it("processes operations and removes on success", async () => {
      service.queue("sessions", "create", "s1", { userId: "u1" });
      service.queue("tasks", "update", "t1", { title: "X" });

      const result = await service.forceSync();
      expect(result.synced).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.queued).toBe(0);
      expect(service.getQueueSize()).toBe(0);
    });

    it("processes operations in timestamp order", async () => {
      const callOrder: string[] = [];
      const orderedPbCall: PocketBaseCaller = async (op) => {
        callOrder.push(op.recordId);
      };
      service = new SyncService(orderedPbCall);

      // Queue with explicit timestamps by advancing time
      service.queue("a", "create", "first", {});
      vi.advanceTimersByTime(10);
      service.queue("b", "create", "second", {});
      vi.advanceTimersByTime(10);
      service.queue("c", "create", "third", {});

      await service.forceSync();
      expect(callOrder).toEqual(["first", "second", "third"]);
    });

    it("processes at most 50 operations per cycle", async () => {
      for (let i = 0; i < 60; i++) {
        service.queue("col", "create", `r${i}`, {});
      }
      expect(service.getQueueSize()).toBe(60);

      const result = await service.forceSync();
      expect(result.synced).toBe(50);
      expect(result.queued).toBe(10);
      expect(service.getQueueSize()).toBe(10);
    });

    it("skips sync when offline", async () => {
      service.queue("sessions", "create", "s1", {});
      service.setOnline(false);

      const result = await service.forceSync();
      expect(result.synced).toBe(0);
      expect(result.queued).toBe(1);
      expect(service.getQueueSize()).toBe(1);
      expect(useUiStore.getState().syncStatus).toBe("offline");
    });
  });

  describe("retry and dead letter", () => {
    it("increments retryCount on failure", async () => {
      const failingCall: PocketBaseCaller = async () => {
        throw new Error("network error");
      };
      service = new SyncService(failingCall);
      service.queue("sessions", "create", "s1", {});

      await service.forceSync();
      const queue = service.getQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].retryCount).toBe(1);
    });

    it("moves to dead letter after 5 retries", async () => {
      const failingCall: PocketBaseCaller = async () => {
        throw new Error("persistent failure");
      };
      service = new SyncService(failingCall);
      service.queue("sessions", "create", "s1", {});

      // Simulate 5 failed sync cycles
      for (let i = 0; i < 5; i++) {
        // Advance time enough to pass backoff for each retry
        vi.advanceTimersByTime(100_000);
        await service.forceSync();
      }

      expect(service.getQueueSize()).toBe(0);
      const deadLetter = service.getDeadLetterQueue();
      expect(deadLetter.length).toBe(1);
      expect(deadLetter[0].collection).toBe("sessions");
      expect(deadLetter[0].operation).toBe("create");
      expect(deadLetter[0].recordId).toBe("s1");
      expect(deadLetter[0].error).toContain("5 retries");
    });

    it("keeps operation in queue when retries < 5", async () => {
      let callCount = 0;
      const sometimesFailCall: PocketBaseCaller = async () => {
        callCount++;
        if (callCount <= 3) throw new Error("fail");
      };
      service = new SyncService(sometimesFailCall);
      service.queue("tasks", "update", "t1", {});

      // Fail 3 times
      for (let i = 0; i < 3; i++) {
        vi.advanceTimersByTime(100_000);
        await service.forceSync();
      }
      expect(service.getQueueSize()).toBe(1);
      expect(service.getQueue()[0].retryCount).toBe(3);

      // 4th attempt succeeds
      vi.advanceTimersByTime(100_000);
      await service.forceSync();
      expect(service.getQueueSize()).toBe(0);
      expect(service.getDeadLetterQueue().length).toBe(0);
    });
  });

  describe("uiStore integration", () => {
    it("sets syncStatus to syncing during cycle", async () => {
      const statuses: string[] = [];
      const trackingCall: PocketBaseCaller = async () => {
        statuses.push(useUiStore.getState().syncStatus);
      };
      service = new SyncService(trackingCall);
      service.queue("sessions", "create", "s1", {});

      await service.forceSync();
      expect(statuses).toContain("syncing");
    });

    it("updates lastSyncTime on successful sync", async () => {
      service.queue("sessions", "create", "s1", {});
      expect(useUiStore.getState().lastSyncTime).toBeNull();

      await service.forceSync();
      expect(useUiStore.getState().lastSyncTime).not.toBeNull();
    });

    it("sets syncStatus to error when operations fail", async () => {
      const failingCall: PocketBaseCaller = async () => {
        throw new Error("fail");
      };
      service = new SyncService(failingCall);
      service.queue("sessions", "create", "s1", {});

      await service.forceSync();
      expect(useUiStore.getState().syncStatus).toBe("error");
    });

    it("sets syncStatus to synced when all succeed", async () => {
      service.queue("sessions", "create", "s1", {});
      await service.forceSync();
      expect(useUiStore.getState().syncStatus).toBe("synced");
    });
  });

  describe("forceSync()", () => {
    it("triggers an immediate sync cycle", async () => {
      service.queue("sessions", "create", "s1", {});
      const result = await service.forceSync();
      expect(result.synced).toBe(1);
      expect(service.getQueueSize()).toBe(0);
    });
  });

  describe("interval-based sync", () => {
    it("runs sync cycle every 60 seconds", async () => {
      service.queue("sessions", "create", "s1", {});
      service.start();

      // Advance 60 seconds
      await vi.advanceTimersByTimeAsync(60_000);
      expect(service.getQueueSize()).toBe(0);
      expect(pbCall).toHaveBeenCalledTimes(1);
    });
  });

  describe("v2 collections", () => {
    it("SYNCED_COLLECTIONS includes all v2 synced collections", () => {
      const v2Collections = [
        "leave_requests",
        "public_holidays",
        "milestones",
        "milestone_tasks",
        "daily_reports",
      ];
      for (const col of v2Collections) {
        expect(SYNCED_COLLECTIONS).toContain(col);
      }
    });

    it("SYNCED_COLLECTIONS does not include private collections", () => {
      for (const col of PRIVATE_COLLECTIONS) {
        expect(SYNCED_COLLECTIONS).not.toContain(col);
      }
    });

    it("SYNCED_COLLECTIONS does not include local-only collections", () => {
      for (const col of LOCAL_ONLY_COLLECTIONS) {
        expect(SYNCED_COLLECTIONS).not.toContain(col);
      }
    });

    it("PRIVATE_COLLECTIONS includes focus_score_history", () => {
      expect(PRIVATE_COLLECTIONS).toContain("focus_score_history");
    });

    it("allows queuing v2 synced collections", () => {
      service.queue("leave_requests", "create", "lr1", { type: "annual" });
      service.queue("milestones", "create", "m1", { name: "Beta" });
      expect(service.getQueueSize()).toBe(2);
    });

    it("rejects queuing focus_score_history", () => {
      expect(() =>
        service.queue("focus_score_history", "create", "fs1", { score: 85 }),
      ).toThrow("private and must not be synced");
      expect(service.getQueueSize()).toBe(0);
    });
  });

  describe("v3 governance collections", () => {
    it("SYNCED_COLLECTIONS includes all v3 governance collections", () => {
      const v3Collections = [
        "review_cycles",
        "founder_reviews",
        "accountability_warnings",
        "equity_stakes",
        "dilution_events",
        "decisions",
      ];
      for (const col of v3Collections) {
        expect(SYNCED_COLLECTIONS).toContain(col);
      }
    });

    it("SYNCED_COLLECTIONS does not include startup_health_config", () => {
      expect(SYNCED_COLLECTIONS).not.toContain("startup_health_config");
    });

    it("LOCAL_ONLY_COLLECTIONS includes startup_health_config", () => {
      expect(LOCAL_ONLY_COLLECTIONS).toContain("startup_health_config");
    });

    it("allows queuing v3 governance collections", () => {
      service.queue("review_cycles", "create", "rc1", { status: "open" });
      service.queue("founder_reviews", "create", "fr1", { outputScore: 4 });
      service.queue("equity_stakes", "create", "es1", { currentStakePct: 25 });
      service.queue("decisions", "create", "d1", { title: "Hire CTO" });
      expect(service.getQueueSize()).toBe(4);
    });

    it("rejects queuing startup_health_config", () => {
      expect(() =>
        service.queue("startup_health_config", "create", "shc1", { cashBalance: 100000 }),
      ).toThrow("local-only and must not be synced");
      expect(service.getQueueSize()).toBe(0);
    });
  });
});
