import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { declineLeaveRequest } from "@/lib/leave";
import type { LeaveRequest } from "@/types";

/**
 * Property 11: Decline requires reason
 *
 * For any Leave_Request that is declined, the reviewReason field must be non-empty.
 *
 * Properties verified:
 * 1. For any decline with an empty string reason, declineLeaveRequest() always throws
 * 2. For any decline with a whitespace-only reason, declineLeaveRequest() always throws
 * 3. For any decline with a non-empty, non-whitespace reason, declineLeaveRequest() succeeds
 *
 * **Validates: Requirements 7.3**
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

const requesterIdArb = fc.stringMatching(/^user-[a-z0-9]{4,8}$/);
const reviewerIdArb = fc.stringMatching(/^rev-[a-z0-9]{4,8}$/);
const requestIdArb = fc.stringMatching(/^lr-[a-z0-9]{4,8}$/);
const leaveTypeArb = fc.constantFrom("annual", "sick", "wfh") as fc.Arbitrary<
  "annual" | "sick" | "wfh"
>;

/** Whitespace-only strings: spaces, tabs, newlines */
const whitespaceOnlyArb = fc
  .array(fc.constantFrom(" ", "\t", "\n", "\r", "  "), { minLength: 1, maxLength: 20 })
  .map((chars) => chars.join(""));

/** Non-empty, non-whitespace reason */
const validReasonArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,49}$/);

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

describe("Property 11: Decline requires reason", () => {
  it("declineLeaveRequest throws when reason is an empty string", () => {
    return fc.assert(
      fc.asyncProperty(
        requesterIdArb,
        reviewerIdArb,
        requestIdArb,
        leaveTypeArb,
        async (requesterId, reviewerId, requestId, type) => {
          const request = pendingRequest(requesterId, type);

          await expect(
            declineLeaveRequest(requestId, reviewerId, "", request),
          ).rejects.toThrow(
            "A reason is required when declining a leave request",
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("declineLeaveRequest throws when reason is whitespace-only", () => {
    return fc.assert(
      fc.asyncProperty(
        requesterIdArb,
        reviewerIdArb,
        requestIdArb,
        leaveTypeArb,
        whitespaceOnlyArb,
        async (requesterId, reviewerId, requestId, type, wsReason) => {
          const request = pendingRequest(requesterId, type);

          await expect(
            declineLeaveRequest(requestId, reviewerId, wsReason, request),
          ).rejects.toThrow(
            "A reason is required when declining a leave request",
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("declineLeaveRequest succeeds with a non-empty, non-whitespace reason", () => {
    return fc.assert(
      fc.asyncProperty(
        requesterIdArb,
        reviewerIdArb,
        requestIdArb,
        leaveTypeArb,
        validReasonArb,
        async (requesterId, reviewerId, requestId, type, reason) => {
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
          // The reviewReason must be non-empty after trim
          expect(result.reviewReason!.trim().length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
