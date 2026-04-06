import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { approveLeaveRequest, declineLeaveRequest } from "@/lib/leave";
import type { LeaveRequest } from "@/types";

/**
 * Property 10: Self-approval prevention
 *
 * For any leave request, if the reviewerId equals the requesterId then
 * both approveLeaveRequest() and declineLeaveRequest() must throw.
 * Conversely, when reviewerId differs from requesterId, both operations
 * succeed (decline requires a non-empty reason).
 *
 * **Validates: Requirements 7.4**
 */

// --- Mock PocketBase ---

vi.mock("@/lib/pocketbase", () => {
  const mockUpdate = vi.fn().mockResolvedValue({
    id: "lr-mock-id",
    collectionId: "",
    collectionName: "leave_requests",
    created: "",
    updated: "",
  });

  return {
    pb: {
      collection: vi.fn().mockReturnValue({
        update: mockUpdate,
      }),
    },
  };
});

// --- Arbitraries ---

const userIdArb = fc.stringMatching(/^user-[a-z0-9]{4,8}$/);
const requestIdArb = fc.stringMatching(/^lr-[a-z0-9]{4,8}$/);
const reasonArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,49}$/);
const leaveTypeArb = fc.constantFrom("annual", "sick", "wfh") as fc.Arbitrary<
  "annual" | "sick" | "wfh"
>;

/** Build a pending leave request for a given requester */
function pendingRequest(
  requesterId: string,
  type: "annual" | "sick" | "wfh",
): LeaveRequest {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "lr-test",
    requesterId,
    type,
    startDate: now + 86400,
    endDate: now + 86400 * 3,
    reason: "test leave",
    status: "pending",
    reviewerId: null,
    reviewReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

// --- Property Tests ---

describe("Property 10: Self-approval prevention", () => {
  it("approveLeaveRequest throws when reviewerId === requesterId", () => {
    return fc.assert(
      fc.asyncProperty(
        userIdArb,
        requestIdArb,
        leaveTypeArb,
        async (userId, requestId, type) => {
          const request = pendingRequest(userId, type);

          await expect(
            approveLeaveRequest(requestId, userId, request),
          ).rejects.toThrow("Cannot approve your own leave request");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("declineLeaveRequest throws when reviewerId === requesterId", () => {
    return fc.assert(
      fc.asyncProperty(
        userIdArb,
        requestIdArb,
        leaveTypeArb,
        reasonArb,
        async (userId, requestId, type, reason) => {
          const request = pendingRequest(userId, type);

          await expect(
            declineLeaveRequest(requestId, userId, reason, request),
          ).rejects.toThrow("Cannot decline your own leave request");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("approveLeaveRequest succeeds when reviewerId !== requesterId", () => {
    return fc.assert(
      fc.asyncProperty(
        userIdArb,
        userIdArb,
        requestIdArb,
        leaveTypeArb,
        async (requesterId, reviewerId, requestId, type) => {
          // Ensure distinct users
          fc.pre(requesterId !== reviewerId);

          const request = pendingRequest(requesterId, type);
          const result = await approveLeaveRequest(
            requestId,
            reviewerId,
            request,
          );

          expect(result.status).toBe("approved");
          expect(result.reviewerId).toBe(reviewerId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("declineLeaveRequest succeeds when reviewerId !== requesterId (with non-empty reason)", () => {
    return fc.assert(
      fc.asyncProperty(
        userIdArb,
        userIdArb,
        requestIdArb,
        leaveTypeArb,
        reasonArb,
        async (requesterId, reviewerId, requestId, type, reason) => {
          // Ensure distinct users and non-empty reason
          fc.pre(requesterId !== reviewerId);

          const request = pendingRequest(requesterId, type);
          const result = await declineLeaveRequest(
            requestId,
            reviewerId,
            reason,
            request,
          );

          expect(result.status).toBe("declined");
          expect(result.reviewerId).toBe(reviewerId);
          expect(result.reviewReason).toBe(reason);
        },
      ),
      { numRuns: 100 },
    );
  });
});
