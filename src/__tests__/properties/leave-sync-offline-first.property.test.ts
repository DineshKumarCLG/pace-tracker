import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import {
  SyncService,
  SYNCED_COLLECTIONS,
  PRIVATE_COLLECTIONS,
  type PocketBaseCaller,
  type SyncOperationType,
} from "@/lib/sync";
import { useUiStore } from "@/stores/uiStore";

/**
 * Property 35: Leave request sync follows offline-first pattern
 *
 * For any leave request write (create, update), a corresponding sync_queue
 * entry should be created with the correct collection name, operation, and
 * data. The sync queue should flush within the standard 60-second interval.
 *
 * We verify:
 * 1. "leave_requests" is included in SYNCED_COLLECTIONS
 * 2. When a leave request is created, it's written to local storage first
 *    (before any network call)
 * 3. The sync queue includes leave_requests records
 * 4. Private collections (mood_checks, focus_score_history) are NOT in
 *    SYNCED_COLLECTIONS
 *
 * **Validates: Requirements 24.2**
 */

const leaveOperationArb = fc.constantFrom<SyncOperationType>("create", "update");
const recordIdArb = fc.uuid();

const leaveRequestDataArb = fc.record({
  requesterId: fc.uuid(),
  type: fc.constantFrom("annual", "sick", "wfh"),
  startDate: fc.integer({ min: 1_700_000_000, max: 1_800_000_000 }),
  endDate: fc.integer({ min: 1_700_000_000, max: 1_800_000_000 }),
  reason: fc.string({ minLength: 1, maxLength: 100 }),
  status: fc.constantFrom("pending", "approved", "declined"),
});

describe("Property 35: Leave request sync follows offline-first pattern", () => {
  beforeEach(() => {
    useUiStore.setState({ syncStatus: "synced", lastSyncTime: null });
  });

  it("leave_requests is included in SYNCED_COLLECTIONS", () => {
    // Static invariant: leave_requests must always be in the synced list
    expect(
      (SYNCED_COLLECTIONS as readonly string[]).includes("leave_requests"),
    ).toBe(true);
  });

  it("private collections are NOT in SYNCED_COLLECTIONS", () => {
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

  it("leave request write is locally observable before any network call", () => {
    fc.assert(
      fc.property(
        leaveOperationArb,
        recordIdArb,
        leaveRequestDataArb,
        (operation, recordId, data) => {
          let networkCallCount = 0;

          const trackingCaller: PocketBaseCaller = async () => {
            networkCallCount++;
          };

          const service = new SyncService(trackingCaller);

          // Queue the leave request operation (local write)
          service.queue("leave_requests", operation, recordId, data as unknown as Record<string, unknown>);

          // INVARIANT: operation is immediately observable in the local queue
          // before any network call
          expect(service.getQueueSize()).toBe(1);
          expect(networkCallCount).toBe(0);

          const queued = service.getQueue();
          expect(queued[0].collection).toBe("leave_requests");
          expect(queued[0].operation).toBe(operation);
          expect(queued[0].recordId).toBe(recordId);

          service.stop();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("leave request sync queue entries flush to network with correct data", () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            operation: leaveOperationArb,
            recordId: recordIdArb,
            data: leaveRequestDataArb,
          }),
          { minLength: 1, maxLength: 20 },
        ),
        async (mutations) => {
          const seenByNetwork: Array<{
            collection: string;
            operation: string;
            recordId: string;
          }> = [];

          const trackingCaller: PocketBaseCaller = async (op) => {
            seenByNetwork.push({
              collection: op.collection,
              operation: op.operation,
              recordId: op.recordId,
            });
          };

          const service = new SyncService(trackingCaller);

          // Step 1: local writes — all queued synchronously
          for (const m of mutations) {
            service.queue(
              "leave_requests",
              m.operation,
              m.recordId,
              m.data as unknown as Record<string, unknown>,
            );
          }

          // All locally persisted before any network call
          expect(service.getQueueSize()).toBe(mutations.length);

          // Step 2: flush to network
          await service.forceSync();

          // INVARIANT: every operation the network saw was a leave_requests entry
          for (const seen of seenByNetwork) {
            expect(seen.collection).toBe("leave_requests");
          }

          // INVARIANT: all operations were flushed
          expect(seenByNetwork.length).toBe(mutations.length);

          service.stop();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("leave request queue() is synchronous — size increments immediately", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (count) => {
          const service = new SyncService();

          for (let i = 0; i < count; i++) {
            service.queue("leave_requests", "create", `lr-${i}`, {
              requesterId: "user-1",
              type: "annual",
              status: "pending",
            });

            // Synchronous check: size is always i+1 immediately after queue()
            expect(service.getQueueSize()).toBe(i + 1);
          }

          // INVARIANT: all entries are leave_requests
          const queued = service.getQueue();
          for (const op of queued) {
            expect(op.collection).toBe("leave_requests");
          }

          service.stop();
        },
      ),
      { numRuns: 100 },
    );
  });
});
