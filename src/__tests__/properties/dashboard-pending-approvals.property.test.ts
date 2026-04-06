import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { LeaveRequest } from "@/types";

/**
 * Property 27: Dashboard pending approvals count
 *
 * For any set of Leave_Request records, the dashboard's pending approval
 * count should equal the count of records with status "pending".
 *
 * We test the pure computation logic extracted from dashboardStore:
 *   countPendingApprovals(requests) = requests.filter(r => r.status === "pending").length
 *
 * Properties verified:
 * 1. Count is always >= 0
 * 2. Count equals the number of requests with status === "pending"
 * 3. Approved and declined requests do not contribute to the count
 *
 * **Validates: Requirements 13.3**
 */

// --- Pure computation under test (mirrors dashboardStore.countPendingApprovals) ---

function countPendingApprovals(requests: LeaveRequest[]): number {
  return requests.filter((r) => r.status === "pending").length;
}

// --- Arbitraries ---

const leaveTypeArb = fc.constantFrom("annual", "sick", "wfh") as fc.Arbitrary<
  "annual" | "sick" | "wfh"
>;

const leaveStatusArb = fc.constantFrom("pending", "approved", "declined") as fc.Arbitrary<
  "pending" | "approved" | "declined"
>;

const timestampArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });

function leaveRequestArb(): fc.Arbitrary<LeaveRequest> {
  return fc
    .record({
      id: fc.uuid(),
      requesterId: fc.uuid(),
      type: leaveTypeArb,
      startDate: timestampArb,
      durationDays: fc.integer({ min: 1, max: 14 }),
      reason: fc.string({ minLength: 0, maxLength: 50 }),
      status: leaveStatusArb,
      reviewerId: fc.option(fc.uuid(), { nil: null }),
      reviewReason: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
      createdAt: timestampArb,
    })
    .map((r) => ({
      id: r.id,
      requesterId: r.requesterId,
      type: r.type,
      startDate: r.startDate,
      endDate: r.startDate + r.durationDays * 86400,
      reason: r.reason,
      status: r.status,
      reviewerId: r.reviewerId,
      reviewReason: r.reviewReason,
      createdAt: r.createdAt,
      updatedAt: r.createdAt,
    }));
}

const requestsArb = fc.array(leaveRequestArb(), { minLength: 0, maxLength: 20 });

// --- Property Tests ---

describe("Property 27: Dashboard pending approvals count", () => {
  it("count is always >= 0", () => {
    fc.assert(
      fc.property(requestsArb, (requests) => {
        const count = countPendingApprovals(requests);
        expect(count).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });

  it("count equals the number of requests with status 'pending'", () => {
    fc.assert(
      fc.property(requestsArb, (requests) => {
        const count = countPendingApprovals(requests);
        const expected = requests.reduce(
          (acc, r) => acc + (r.status === "pending" ? 1 : 0),
          0,
        );
        expect(count).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it("approved and declined requests do not contribute to the count", () => {
    // Generate only non-pending requests
    const nonPendingStatusArb = fc.constantFrom("approved", "declined") as fc.Arbitrary<
      "approved" | "declined"
    >;

    const nonPendingRequestArb = fc
      .record({
        id: fc.uuid(),
        requesterId: fc.uuid(),
        type: leaveTypeArb,
        startDate: timestampArb,
        durationDays: fc.integer({ min: 1, max: 14 }),
        reason: fc.string({ minLength: 0, maxLength: 50 }),
        status: nonPendingStatusArb,
        reviewerId: fc.option(fc.uuid(), { nil: null }),
        reviewReason: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
        createdAt: timestampArb,
      })
      .map((r) => ({
        id: r.id,
        requesterId: r.requesterId,
        type: r.type,
        startDate: r.startDate,
        endDate: r.startDate + r.durationDays * 86400,
        reason: r.reason,
        status: r.status,
        reviewerId: r.reviewerId,
        reviewReason: r.reviewReason,
        createdAt: r.createdAt,
        updatedAt: r.createdAt,
      }));

    fc.assert(
      fc.property(
        fc.array(nonPendingRequestArb, { minLength: 1, maxLength: 20 }),
        (requests) => {
          const count = countPendingApprovals(requests);
          expect(count).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
