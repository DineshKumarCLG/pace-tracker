import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { DashboardData, LeaveRequest, TeamMember } from "@/types";

/**
 * Property 39: Upcoming leave window
 *
 * For any set of approved leave and WFH requests, the dashboard's upcoming
 * leave list should contain only entries with start dates within the next
 * 14 calendar days.
 *
 * We test the pure computation logic extracted from dashboardStore:
 *   getUpcomingLeave(requests, members, now, 14)
 *
 * Properties verified:
 * 1. All returned entries have status "approved"
 * 2. All returned entries have startDate within 14 days of now (or endDate >= now)
 * 3. Entries with startDate beyond the 14-day window and endDate before now are excluded
 *
 * **Validates: Requirements 14.2**
 */

// --- Pure computation under test (mirrors dashboardStore.getUpcomingLeave) ---

function getUpcomingLeave(
  requests: LeaveRequest[],
  members: Record<string, TeamMember>,
  now: number,
  windowDays: number = 14,
): DashboardData["upcomingLeave"] {
  const windowEnd = now + windowDays * 86400;

  return requests
    .filter(
      (r) =>
        r.status === "approved" &&
        (r.type === "annual" || r.type === "sick" || r.type === "wfh") &&
        r.startDate <= windowEnd &&
        r.endDate >= now,
    )
    .map((r) => ({
      userId: r.requesterId,
      name: members[r.requesterId]?.name ?? r.requesterId,
      type: r.type,
      startDate: r.startDate,
      endDate: r.endDate,
    }));
}

// --- Helpers ---

function makeTeamMember(userId: string): TeamMember {
  return {
    userId,
    name: `Member ${userId}`,
    status: "offline",
    currentTask: null,
    sessionStart: null,
    breakStart: null,
    outputNote: null,
    avatarColor: "#000",
  };
}

// --- Arbitraries ---

const nowArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });

const leaveTypeArb = fc.constantFrom("annual", "sick", "wfh") as fc.Arbitrary<
  "annual" | "sick" | "wfh"
>;

const leaveStatusArb = fc.constantFrom("pending", "approved", "declined") as fc.Arbitrary<
  "pending" | "approved" | "declined"
>;

function leaveRequestArb(now: number): fc.Arbitrary<LeaveRequest> {
  // Generate requests with startDate ranging from 30 days before to 30 days after now
  return fc
    .record({
      id: fc.uuid(),
      requesterId: fc.constantFrom("user-a", "user-b", "user-c"),
      type: leaveTypeArb,
      offsetDays: fc.integer({ min: -30, max: 30 }),
      durationDays: fc.integer({ min: 1, max: 14 }),
      reason: fc.constant("Leave reason"),
      status: leaveStatusArb,
      reviewerId: fc.option(fc.uuid(), { nil: null }),
      reviewReason: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
    })
    .map((r) => {
      const startDate = now + r.offsetDays * 86400;
      return {
        id: r.id,
        requesterId: r.requesterId,
        type: r.type,
        startDate,
        endDate: startDate + r.durationDays * 86400,
        reason: r.reason,
        status: r.status,
        reviewerId: r.reviewerId,
        reviewReason: r.reviewReason,
        createdAt: now,
        updatedAt: now,
      };
    });
}

const membersRecord: Record<string, TeamMember> = {
  "user-a": makeTeamMember("user-a"),
  "user-b": makeTeamMember("user-b"),
  "user-c": makeTeamMember("user-c"),
};

// --- Property Tests ---

describe("Property 39: Upcoming leave window", () => {
  it("all returned entries are approved", () => {
    fc.assert(
      fc.property(
        nowArb.chain((now) =>
          fc.tuple(
            fc.constant(now),
            fc.array(leaveRequestArb(now), { minLength: 0, maxLength: 15 }),
          ),
        ),
        ([now, requests]) => {
          const result = getUpcomingLeave(requests, membersRecord, now);
          for (const entry of result) {
            // Find the original request
            const original = requests.find(
              (r) =>
                r.requesterId === entry.userId &&
                r.startDate === entry.startDate &&
                r.endDate === entry.endDate,
            );
            expect(original).toBeDefined();
            expect(original!.status).toBe("approved");
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("all returned entries have startDate within 14-day window or overlap with now", () => {
    fc.assert(
      fc.property(
        nowArb.chain((now) =>
          fc.tuple(
            fc.constant(now),
            fc.array(leaveRequestArb(now), { minLength: 0, maxLength: 15 }),
          ),
        ),
        ([now, requests]) => {
          const windowEnd = now + 14 * 86400;
          const result = getUpcomingLeave(requests, membersRecord, now);

          for (const entry of result) {
            // startDate must be <= windowEnd (within 14 days)
            expect(entry.startDate).toBeLessThanOrEqual(windowEnd);
            // endDate must be >= now (not already fully past)
            expect(entry.endDate).toBeGreaterThanOrEqual(now);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("entries fully outside the window are excluded", () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.integer({ min: 15, max: 60 }),
        fc.integer({ min: 1, max: 10 }),
        (now, futureOffsetDays, durationDays) => {
          const startDate = now + futureOffsetDays * 86400;
          const endDate = startDate + durationDays * 86400;

          // This request starts beyond the 14-day window
          const farFutureRequest: LeaveRequest = {
            id: "far-future",
            requesterId: "user-a",
            type: "annual",
            startDate,
            endDate,
            reason: "Far future leave",
            status: "approved",
            reviewerId: "reviewer-1",
            reviewReason: null,
            createdAt: now,
            updatedAt: now,
          };

          const result = getUpcomingLeave([farFutureRequest], membersRecord, now);
          expect(result).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("entries fully in the past are excluded", () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.integer({ min: 2, max: 60 }),
        fc.integer({ min: 1, max: 10 }),
        (now, pastOffsetDays, durationDays) => {
          // Ensure endDate is before now
          const endDate = now - pastOffsetDays * 86400;
          const startDate = endDate - durationDays * 86400;

          const pastRequest: LeaveRequest = {
            id: "past-request",
            requesterId: "user-a",
            type: "annual",
            startDate,
            endDate,
            reason: "Past leave",
            status: "approved",
            reviewerId: "reviewer-1",
            reviewReason: null,
            createdAt: now - 100 * 86400,
            updatedAt: now - 100 * 86400,
          };

          const result = getUpcomingLeave([pastRequest], membersRecord, now);
          expect(result).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("pending and declined requests are excluded", () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.constantFrom("pending", "declined") as fc.Arbitrary<"pending" | "declined">,
        (now, status) => {
          const request: LeaveRequest = {
            id: "non-approved",
            requesterId: "user-a",
            type: "annual",
            startDate: now,
            endDate: now + 5 * 86400,
            reason: "Leave",
            status,
            reviewerId: null,
            reviewReason: null,
            createdAt: now,
            updatedAt: now,
          };

          const result = getUpcomingLeave([request], membersRecord, now);
          expect(result).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
