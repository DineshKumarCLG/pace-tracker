import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { SyncService, type PocketBaseCaller, type SyncOperationType } from "@/lib/sync";
import { useUiStore } from "@/stores/uiStore";

/**
 * Property 11: Sync Batch Size Limit
 *
 * For any sync cycle, the Sync_Service processes at most 50 operations,
 * selected in timestamp order from the queue. Remaining operations stay
 * queued for subsequent cycles.
 *
 * **Validates: Requirement 14.3**
 */

const collectionArb = fc.constantFrom("sessions", "session_tasks", "breaks", "tasks", "projects");
const operationArb = fc.constantFrom<SyncOperationType>("create", "update", "delete");

describe("Property 11: Sync Batch Size Limit", () => {
  beforeEach(() => {
    useUiStore.setState({ syncStatus: "synced", lastSyncTime: null });
  });

  it("each sync cycle processes at most 50 operations", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 200 }),
        async (count) => {
          let processedThisCycle = 0;

          const countingCaller: PocketBaseCaller = async () => {
            processedThisCycle++;
          };

          const service = new SyncService(countingCaller);

          for (let i = 0; i < count; i++) {
            service.queue("sessions", "create", `r${i}`, {});
          }

          processedThisCycle = 0;
          await service.forceSync();

          // INVARIANT: at most 50 operations processed per cycle
          expect(processedThisCycle).toBeLessThanOrEqual(50);

          // If we had more than 50, exactly 50 should have been processed
          if (count > 50) {
            expect(processedThisCycle).toBe(50);
          } else {
            expect(processedThisCycle).toBe(count);
          }

          service.stop();
        }
      ),
      { numRuns: 200 }
    );
  });

  it("remaining operations stay queued after a batch of 50", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 51, max: 200 }),
        async (count) => {
          const service = new SyncService(async () => {
            /* always succeeds */
          });

          for (let i = 0; i < count; i++) {
            service.queue("sessions", "create", `r${i}`, {});
          }

          const result = await service.forceSync();

          // INVARIANT: exactly 50 synced, remainder stays queued
          expect(result.synced).toBe(50);
          expect(result.queued).toBe(count - 50);
          expect(service.getQueueSize()).toBe(count - 50);

          service.stop();
        }
      ),
      { numRuns: 200 }
    );
  });

  it("batch selects operations in timestamp order — earliest first", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 51, max: 120 }),
        async (count) => {
          const processedRecordIds: string[] = [];

          const orderTracker: PocketBaseCaller = async (op) => {
            processedRecordIds.push(op.recordId);
          };

          const service = new SyncService(orderTracker);

          // Queue with incrementing timestamps (Date.now() increments naturally)
          for (let i = 0; i < count; i++) {
            service.queue("sessions", "create", `r${i}`, {});
          }

          await service.forceSync();

          // INVARIANT: the first 50 (by timestamp) are processed
          expect(processedRecordIds.length).toBe(50);
          for (let i = 0; i < 50; i++) {
            expect(processedRecordIds[i]).toBe(`r${i}`);
          }

          // Remaining operations are the later ones
          const remaining = service.getQueue();
          for (let i = 0; i < remaining.length; i++) {
            expect(remaining[i].recordId).toBe(`r${50 + i}`);
          }

          service.stop();
        }
      ),
      { numRuns: 200 }
    );
  });

  it("multiple cycles drain the full queue in 50-op batches", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 200 }),
        async (count) => {
          const service = new SyncService(async () => {
            /* always succeeds */
          });

          for (let i = 0; i < count; i++) {
            service.queue("sessions", "create", `r${i}`, {});
          }

          const expectedCycles = Math.ceil(count / 50);
          let cycles = 0;

          while (service.getQueueSize() > 0) {
            await service.forceSync();
            cycles++;
          }

          // INVARIANT: queue fully drained
          expect(service.getQueueSize()).toBe(0);

          // Took the expected number of cycles
          expect(cycles).toBe(expectedCycles);

          service.stop();
        }
      ),
      { numRuns: 200 }
    );
  });

  it("queues with exactly 50 operations are fully processed in one cycle", () => {
    fc.assert(
      fc.asyncProperty(
        fc.constant(50),
        async (count) => {
          const service = new SyncService(async () => {});

          for (let i = 0; i < count; i++) {
            service.queue("sessions", "create", `r${i}`, {});
          }

          const result = await service.forceSync();

          expect(result.synced).toBe(50);
          expect(result.queued).toBe(0);
          expect(service.getQueueSize()).toBe(0);

          service.stop();
        }
      ),
      { numRuns: 50 }
    );
  });
});
