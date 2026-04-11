import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import {
  SyncService,
  PRIVATE_COLLECTIONS,
  SYNCED_COLLECTIONS,
} from "@/lib/sync";
import { useUiStore } from "@/stores/uiStore";

/**
 * Property 15: Private data never synced
 *
 * For any write to the focus_score_history table,
 * no corresponding entry should ever appear in the sync queue.
 * This table is excluded from the sync service's collection list.
 *
 * **Validates: Requirements 16.3, 16.4, 19.3, 25.1, 25.3**
 */

describe("Property 15: Private data never synced", () => {
  beforeEach(() => {
    useUiStore.setState({ syncStatus: "synced", lastSyncTime: null });
  });

  it("queuing a private collection always throws", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PRIVATE_COLLECTIONS),
        fc.constantFrom("create", "update", "delete" as const),
        fc.uuid(),
        (collection, operation, recordId) => {
          const service = new SyncService();

          expect(() => {
            service.queue(collection, operation, recordId, {});
          }).toThrow(`Collection "${collection}" is private and must not be synced`);

          // INVARIANT: queue remains empty — private data never enters sync
          expect(service.getQueueSize()).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("queuing a synced collection always succeeds", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SYNCED_COLLECTIONS),
        fc.constantFrom("create", "update", "delete" as const),
        fc.uuid(),
        (collection, operation, recordId) => {
          const service = new SyncService();

          expect(() => {
            service.queue(collection, operation, recordId, {});
          }).not.toThrow();

          // INVARIANT: operation is queued
          expect(service.getQueueSize()).toBe(1);
          const queued = service.getQueue();
          expect(queued[0].collection).toBe(collection);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("PRIVATE_COLLECTIONS and SYNCED_COLLECTIONS have no overlap", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PRIVATE_COLLECTIONS),
        (privateCollection) => {
          // INVARIANT: no private collection appears in the synced list
          expect(
            (SYNCED_COLLECTIONS as readonly string[]).includes(privateCollection),
          ).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});
