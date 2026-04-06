import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { detectLeaveConflicts } from "@/lib/leave";
import type { LeaveRequest } from "@/types";

/**
 * Property 34: Smart leave conflict detection
 *
 * For any requested leave date range, the conflict detector should identify:
 * (a) other team members with approved leave overlapping the range,
 * (b) milestones with deadlines within 3 days of the range, and
 * (c) days where team availability drops below 50%.
 * Conflicts should never block submission.
 *
 * **Validates: Requirements 21.1, 21.4**
 */

// --- Helpers ---

const DAY = 86400;
const BASE_TS = 1700000000; // ~Nov 2023

function makeLeaveRequest(
  requesterId: string,
  startDate: number,
  endDate: number,
  type: "annual" | "sick" | "wfh" = "annual",
  status: "pending" | "approved" | "declined" = "approved",
): LeaveRequest {
  return {
    id: `lr-${Math.random().toString(36).slice(2, 8)}`,
    requesterId,
    type,
    startDate,
    endDate,
    reason: "",
    status,
    reviewerId: null,
    reviewReason: null,
    createdAt: startDate,
    updatedAt: startDate,
  };
}

// --- Arbitraries ---

const dateArb = fc.integer({ min: BASE_TS, max: BASE_TS + 365 * DAY });

const dateRangeArb = fc.tuple(dateArb, fc.integer({ min: 1, max: 14 })).map(
  ([start, days]) => ({ start, end: start + days * DAY }),
);

// --- Property Tests ---

describe("Property 34: Smart leave conflict detection", () => {
  it("detects conflicts when other members have approved leave overlapping the range (Req 21.1)", () => {
    fc.assert(
      fc.property(
        dateRangeArb,
        fc.integer({ min: 1, max: 4 }), // number of other members on leave
        (range, otherCount) => {
          const requesterId = "requester";
          const teamMemberIds = [requesterId, ...Array.from({ length: otherCount }, (_, i) => `member-${i}`)];

          // Create overlapping approved leave for other members
          const approvedLeave = teamMemberIds
            .filter((id) => id !== requesterId)
            .map((id) =>
              makeLeaveRequest(id, range.start, range.end, "annual", "approved"),
            );

          const result = detectLeaveConflicts(
            requesterId,
            range.start,
            range.end,
            teamMemberIds,
            approvedLeave,
            [],
          );

          // Each other member on leave should produce a conflict
          const memberConflicts = result.conflicts.filter(
            (c) => c.type === "team_member_on_leave",
          );
          expect(memberConflicts.length).toBe(otherCount);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("detects milestone deadlines within 3 days of the range (Req 21.1)", () => {
    fc.assert(
      fc.property(
        dateRangeArb,
        fc.integer({ min: -3, max: 3 }), // days offset from range boundary
        (range, offsetDays) => {
          const requesterId = "requester";
          const teamMemberIds = [requesterId, "member-1", "member-2"];

          // Place milestone deadline within 3 days of the range
          const milestoneDeadline = range.start + offsetDays * DAY;
          const milestones = [
            { id: "ms-1", name: "Sprint End", deadline: milestoneDeadline, completedAt: null },
          ];

          const result = detectLeaveConflicts(
            requesterId,
            range.start,
            range.end,
            teamMemberIds,
            [],
            milestones,
          );

          // Milestone within 3 days of range should be detected
          const msConflicts = result.conflicts.filter(
            (c) => c.type === "milestone_deadline",
          );
          expect(msConflicts.length).toBe(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("does not detect milestones far from the range", () => {
    fc.assert(
      fc.property(
        dateRangeArb,
        fc.integer({ min: 5, max: 30 }), // days away (well beyond 3-day window)
        (range, daysAway) => {
          const requesterId = "requester";
          const teamMemberIds = [requesterId, "member-1"];

          // Place milestone deadline far from the range
          const milestones = [
            { id: "ms-1", name: "Far Milestone", deadline: range.end + daysAway * DAY, completedAt: null },
          ];

          const result = detectLeaveConflicts(
            requesterId,
            range.start,
            range.end,
            teamMemberIds,
            [],
            milestones,
          );

          const msConflicts = result.conflicts.filter(
            (c) => c.type === "milestone_deadline",
          );
          expect(msConflicts.length).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("completed milestones are not flagged as conflicts", () => {
    fc.assert(
      fc.property(dateRangeArb, (range) => {
        const requesterId = "requester";
        const teamMemberIds = [requesterId, "member-1"];

        const milestones = [
          { id: "ms-1", name: "Done Milestone", deadline: range.start, completedAt: range.start - DAY },
        ];

        const result = detectLeaveConflicts(
          requesterId,
          range.start,
          range.end,
          teamMemberIds,
          [],
          milestones,
        );

        const msConflicts = result.conflicts.filter(
          (c) => c.type === "milestone_deadline",
        );
        expect(msConflicts.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it("conflicts are advisory only — canSubmit is always true (Req 21.4)", () => {
    fc.assert(
      fc.property(
        dateRangeArb,
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 3 }),
        (range, leaveCount, milestoneCount) => {
          const requesterId = "requester";
          const teamMemberIds = [
            requesterId,
            ...Array.from({ length: Math.max(leaveCount, 1) }, (_, i) => `member-${i}`),
          ];

          const approvedLeave = Array.from({ length: leaveCount }, (_, i) =>
            makeLeaveRequest(`member-${i}`, range.start, range.end, "annual", "approved"),
          );

          const milestones = Array.from({ length: milestoneCount }, (_, i) => ({
            id: `ms-${i}`,
            name: `Milestone ${i}`,
            deadline: range.start + i * DAY,
            completedAt: null,
          }));

          const result = detectLeaveConflicts(
            requesterId,
            range.start,
            range.end,
            teamMemberIds,
            approvedLeave,
            milestones,
          );

          // INVARIANT: canSubmit is always true regardless of conflicts
          expect(result.canSubmit).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("does not flag the requester's own leave as a conflict", () => {
    fc.assert(
      fc.property(dateRangeArb, (range) => {
        const requesterId = "requester";
        const teamMemberIds = [requesterId, "member-1"];

        // Requester's own approved leave should not be flagged
        const ownLeave = [
          makeLeaveRequest(requesterId, range.start, range.end, "annual", "approved"),
        ];

        const result = detectLeaveConflicts(
          requesterId,
          range.start,
          range.end,
          teamMemberIds,
          ownLeave,
          [],
        );

        const memberConflicts = result.conflicts.filter(
          (c) => c.type === "team_member_on_leave",
        );
        expect(memberConflicts.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
