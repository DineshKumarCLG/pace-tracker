import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { SyncService, type PocketBaseCaller, type SyncOperationType } from "@/lib/sync";
import { useUiStore } from "@/stores/uiStore";

/**
 * Property 10: Offline-First Write Ordering
 *
 * For any data mutation, the SQLite write completes before any network call
 * is initiated. The local database is always the source of truth.
 *
 * We model this by verifying that `queue()` (the local write) is synchronous
 * and the operation is observable in the queue before `forceSync()` (the
 * network call) is invoked. The PocketBase caller only sees operations that
 * were already persisted locally.
 *
 * **Validates: Requirement 13.1**
 */

const collectionArb = fc.constantFrom("sessions", "session_tasks", "breaks", "tasks", "projects");
const operationArb = fc.constantFrom<SyncOperationType>("create", "update", "delete");
const recordIdArb = fc.uuid();

const mutationArb = fc.record({
  collection: collectionArb,
  operation: operationArb,
  recordId: recordIdArb,
});

describe("Property 10: Offline-First Write Ordering", () => {
  beforeEach(() => {
    useUiStore.setState({ syncStatus: "synced", lastSyncTime: null });
  });

  it("every queued operation is locally observable before any network call", () => {
    fc.assert(
      fc.property(
        fc.array(mutationArb, { minLength: 1, maxLength: 30 }),
        (mutations) => {
          let networkCallCount = 0;

          const trackingCaller: PocketBaseCaller = async () => {
            networkCallCount++;
          };

          const service = new SyncService(trackingCaller);

          // Queue all mutations (local writes) — each is synchronous
          for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            service.queue(m.collection, m.operation, m.recordId, {});

            // INVARIANT: after each queue() call, the operation is immediately
            // observable in the local queue — before any network call
            expect(service.getQueueSize()).toBe(i + 1);
          }

          // No network calls have happened yet
          expect(networkCallCount).toBe(0);

          // All operations are locally persisted
          expect(service.getQueueSize()).toBe(mutations.length);

          service.stop();
        }
      ),
      { numRuns: 200 }
    );
  });

  it("network calls only process operations already in the local queue", () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(mutationArb, { minLength: 1, maxLength: 20 }),
        async (mutations) => {
          const seenByNetwork: string[] = [];

          const trackingCaller: PocketBaseCaller = async (op) => {
            seenByNetwork.push(op.id);
          };

          const service = new SyncService(trackingCaller);

          // Step 1: local writes
          for (const m of mutations) {
            service.queue(m.collection, m.operation, m.recordId, {});
          }

          const localIds = service.getQueue().map((op) => op.id);

          // Step 2: network flush
          await service.forceSync();

          // Every operation the network saw was already in the local queue
          for (const id of seenByNetwork) {
            expect(localIds).toContain(id);
          }

          service.stop();
        }
      ),
      { numRuns: 200 }
    );
  });

  it("queue() is synchronous — size increments immediately with no awaits", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (count) => {
          const service = new SyncService();

          for (let i = 0; i < count; i++) {
            service.queue("sessions", "create", `r${i}`, {});
            // Synchronous check: size is always i+1 immediately after queue()
            expect(service.getQueueSize()).toBe(i + 1);
          }

          service.stop();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("offline mode: local writes accumulate while no network calls are made", () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(mutationArb, { minLength: 1, maxLength: 30 }),
        async (mutations) => {
          let networkCallCount = 0;

          const trackingCaller: PocketBaseCaller = async () => {
            networkCallCount++;
          };

          const service = new SyncService(trackingCaller);
          service.setOnline(false);

          // Queue mutations while offline
          for (const m of mutations) {
            service.queue(m.collection, m.operation, m.recordId, {});
          }

          // All locally persisted
          expect(service.getQueueSize()).toBe(mutations.length);

          // Attempt sync — should be skipped because offline
          await service.forceSync();

          // No network calls made
          expect(networkCallCount).toBe(0);

          // All operations still in local queue
          expect(service.getQueueSize()).toBe(mutations.length);

          service.stop();
        }
      ),
      { numRuns: 200 }
    );
  });
});
