import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeTeamAvailabilitySummary } from "@/lib/leave";
import type { LeaveRequest } from "@/types";

/**
 * Property 12: Team availability summary
 *
 * For any set of team members on a given day, the sum of
 * (available count + on-leave count + on-WFH count) should equal
 * the total team member count.
 *
 * A member with approved annual/sick leave for today is counted as onLeave.
 * A member with approved WFH for today is counted as onWFH.
 * A member with no approved leave/wfh for today is counted as available.
 * No member is double-counted.
 *
 * **Validates: Requirements 5.4**
 */

// --- Helpers ---

/** UTC midnight timestamp for a given date */
function utc(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

// --- Arbitraries ---

/** Generate a list of unique member IDs (1–6 members, small team) */
const memberIdsArb = fc
  .integer({ min: 1, max: 6 })
  .chain((count) =>
    fc.array(fc.stringMatching(/^user-[a-z0-9]{4,8}$/), {
      minLength: count,
      maxLength: count,
    }),
  )
  .map((ids) => [...new Set(ids)]) // deduplicate
  .filter((ids) => ids.length >= 1);

/** A day timestamp within a reasonable range */
const dayTimestampArb = fc
  .record({
    year: fc.integer({ min: 2023, max: 2027 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) => utc(year, month, day));

const leaveTypeArb = fc.constantFrom(
  "annual" as const,
  "sick" as const,
  "wfh" as const,
);

const leaveStatusArb = fc.constantFrom(
  "pending" as const,
  "approved" as const,
  "declined" as const,
);

// --- Property Tests ---

describe("Property 12: Team availability summary", () => {
  it("available + onLeave + onWFH always equals total team members", () => {
    fc.assert(
      fc.property(
        memberIdsArb,
        dayTimestampArb,
        fc.array(
          fc.record({
            id: fc.uuid(),
            memberIndex: fc.integer({ min: 0, max: 5 }),
            type: leaveTypeArb,
            status: leaveStatusArb,
            daysBefore: fc.integer({ min: 0, max: 3 }),
            daysAfter: fc.integer({ min: 0, max: 3 }),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        (memberIds, dayTs, reqSpecs) => {
          const requests: LeaveRequest[] = reqSpecs.map((spec) => ({
            id: spec.id,
            requesterId: memberIds[spec.memberIndex % memberIds.length],
            type: spec.type,
            startDate: dayTs - spec.daysBefore * 86400,
            endDate: dayTs + spec.daysAfter * 86400,
            reason: "",
            status: spec.status,
            reviewerId: null,
            reviewReason: null,
            createdAt: dayTs,
            updatedAt: dayTs,
          }));

          const summary = computeTeamAvailabilitySummary(
            memberIds,
            dayTs,
            requests,
          );

          // PARTITION PROPERTY: counts must sum to total
          expect(summary.available + summary.onLeave + summary.onWFH).toBe(
            summary.total,
          );
          expect(summary.total).toBe(memberIds.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("all counts are non-negative", () => {
    fc.assert(
      fc.property(
        memberIdsArb,
        dayTimestampArb,
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: leaveTypeArb,
            status: leaveStatusArb,
            daysBefore: fc.integer({ min: 0, max: 3 }),
            daysAfter: fc.integer({ min: 0, max: 3 }),
          }),
          { minLength: 0, maxLength: 6 },
        ),
        (memberIds, dayTs, reqSpecs) => {
          const requests: LeaveRequest[] = reqSpecs.map((spec, i) => ({
            id: spec.id,
            requesterId: memberIds[i % memberIds.length],
            type: spec.type,
            startDate: dayTs - spec.daysBefore * 86400,
            endDate: dayTs + spec.daysAfter * 86400,
            reason: "",
            status: spec.status,
            reviewerId: null,
            reviewReason: null,
            createdAt: dayTs,
            updatedAt: dayTs,
          }));

          const summary = computeTeamAvailabilitySummary(
            memberIds,
            dayTs,
            requests,
          );

          expect(summary.available).toBeGreaterThanOrEqual(0);
          expect(summary.onLeave).toBeGreaterThanOrEqual(0);
          expect(summary.onWFH).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("member with approved annual leave is counted as onLeave", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^user-[a-z0-9]{4,8}$/),
        dayTimestampArb,
        (memberId, dayTs) => {
          const request: LeaveRequest = {
            id: "lr-annual",
            requesterId: memberId,
            type: "annual",
            startDate: dayTs - 86400,
            endDate: dayTs + 86400,
            reason: "vacation",
            status: "approved",
            reviewerId: null,
            reviewReason: null,
            createdAt: dayTs,
            updatedAt: dayTs,
          };

          const summary = computeTeamAvailabilitySummary(
            [memberId],
            dayTs,
            [request],
          );

          expect(summary.onLeave).toBe(1);
          expect(summary.available).toBe(0);
          expect(summary.onWFH).toBe(0);
          expect(summary.total).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("member with approved sick leave is counted as onLeave", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^user-[a-z0-9]{4,8}$/),
        dayTimestampArb,
        (memberId, dayTs) => {
          const request: LeaveRequest = {
            id: "lr-sick",
            requesterId: memberId,
            type: "sick",
            startDate: dayTs - 86400,
            endDate: dayTs + 86400,
            reason: "unwell",
            status: "approved",
            reviewerId: null,
            reviewReason: null,
            createdAt: dayTs,
            updatedAt: dayTs,
          };

          const summary = computeTeamAvailabilitySummary(
            [memberId],
            dayTs,
            [request],
          );

          expect(summary.onLeave).toBe(1);
          expect(summary.available).toBe(0);
          expect(summary.onWFH).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("member with approved WFH is counted as onWFH", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^user-[a-z0-9]{4,8}$/),
        dayTimestampArb,
        (memberId, dayTs) => {
          const request: LeaveRequest = {
            id: "lr-wfh",
            requesterId: memberId,
            type: "wfh",
            startDate: dayTs - 86400,
            endDate: dayTs + 86400,
            reason: "remote",
            status: "approved",
            reviewerId: null,
            reviewReason: null,
            createdAt: dayTs,
            updatedAt: dayTs,
          };

          const summary = computeTeamAvailabilitySummary(
            [memberId],
            dayTs,
            [request],
          );

          expect(summary.onWFH).toBe(1);
          expect(summary.onLeave).toBe(0);
          expect(summary.available).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("member with no approved leave for today is counted as available", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^user-[a-z0-9]{4,8}$/),
        dayTimestampArb,
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: leaveTypeArb,
            offset: fc.integer({ min: 5, max: 30 }),
            duration: fc.integer({ min: 1, max: 4 }),
            before: fc.boolean(),
          }),
          { minLength: 0, maxLength: 3 },
        ),
        (memberId, dayTs, reqSpecs) => {
          // Build requests that are entirely before or after the day
          const requests: LeaveRequest[] = reqSpecs.map((spec) => {
            const base = spec.before
              ? dayTs - spec.offset * 86400
              : dayTs + spec.offset * 86400;
            return {
              id: spec.id,
              requesterId: memberId,
              type: spec.type,
              startDate: base,
              endDate: base + spec.duration * 86400,
              reason: "test",
              status: "approved" as const,
              reviewerId: null,
              reviewReason: null,
              createdAt: dayTs,
              updatedAt: dayTs,
            };
          });

          const summary = computeTeamAvailabilitySummary(
            [memberId],
            dayTs,
            requests,
          );

          expect(summary.available).toBe(1);
          expect(summary.onLeave).toBe(0);
          expect(summary.onWFH).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("pending and declined requests do not affect availability counts", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^user-[a-z0-9]{4,8}$/),
        dayTimestampArb,
        fc.constantFrom("pending" as const, "declined" as const),
        leaveTypeArb,
        (memberId, dayTs, status, type) => {
          const request: LeaveRequest = {
            id: "lr-non-approved",
            requesterId: memberId,
            type,
            startDate: dayTs - 86400,
            endDate: dayTs + 86400,
            reason: "test",
            status,
            reviewerId: null,
            reviewReason: null,
            createdAt: dayTs,
            updatedAt: dayTs,
          };

          const summary = computeTeamAvailabilitySummary(
            [memberId],
            dayTs,
            [request],
          );

          // Non-approved requests should not count
          expect(summary.available).toBe(1);
          expect(summary.onLeave).toBe(0);
          expect(summary.onWFH).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
