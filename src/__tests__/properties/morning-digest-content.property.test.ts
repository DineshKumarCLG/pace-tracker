import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateMorningDigest } from "@/lib/reports";
import type { LeaveRequest, User } from "@/types";

/**
 * Property 25: Morning digest content
 *
 * For any workday, the morning digest should contain: one entry per team
 * member with their previous workday's total hours, completed tasks, and
 * output note; plus a list of members on leave or WFH for the current day.
 *
 * **Validates: Requirements 12.2, 12.3**
 */

// --- Arbitraries ---

const dateArb = fc
  .record({
    year: fc.integer({ min: 2024, max: 2026 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) => {
    const m = String(month).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    return `${year}-${m}-${d}`;
  });

function userArb(): fc.Arbitrary<User> {
  return fc
    .record({
      id: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 30 }),
      email: fc.emailAddress(),
      avatarColor: fc.hexaString({ minLength: 6, maxLength: 6 }).map((h) => `#${h}`),
    })
    .map(({ id, name, email, avatarColor }) => ({
      id,
      name,
      role: null,
      email,
      avatarColor,
      createdAt: 1_700_000_000,
    }));
}



/** Convert a YYYY-MM-DD date string to a UTC timestamp (start of day in seconds) */
function dateToUtc(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 1000;
}

// --- Property Tests ---

describe("Property 25: Morning digest content", () => {
  it("memberSummaries count equals team member count", () => {
    fc.assert(
      fc.property(
        dateArb,
        dateArb,
        fc.array(userArb(), { minLength: 1, maxLength: 5 }),
        (date, previousWorkday, members) => {
          const digest = generateMorningDigest(
            "digest-1",
            date,
            previousWorkday,
            [],
            [],
            [],
            members,
          );

          expect(digest.memberSummaries).toHaveLength(members.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("each member summary has correct userId and name", () => {
    fc.assert(
      fc.property(
        dateArb,
        dateArb,
        fc.array(userArb(), { minLength: 1, maxLength: 5 }),
        (date, previousWorkday, members) => {
          const digest = generateMorningDigest(
            "digest-1",
            date,
            previousWorkday,
            [],
            [],
            [],
            members,
          );

          for (let i = 0; i < members.length; i++) {
            expect(digest.memberSummaries[i].userId).toBe(members[i].id);
            expect(digest.memberSummaries[i].name).toBe(members[i].name);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("onLeaveToday only includes members with approved annual/sick leave covering today", () => {
    fc.assert(
      fc.property(
        dateArb,
        dateArb,
        fc.array(userArb(), { minLength: 2, maxLength: 5 }),
        (date, previousWorkday, members) => {
          const todayUtc = dateToUtc(date);

          // First member: approved annual leave covering today
          // Second member: no leave
          const leaveRequests: LeaveRequest[] = [
            {
              id: "lr-1",
              requesterId: members[0].id,
              type: "annual",
              startDate: todayUtc - 86400,
              endDate: todayUtc + 86400,
              reason: "vacation",
              status: "approved",
              reviewerId: "reviewer-1",
              reviewReason: null,
              createdAt: 1_700_000_000,
              updatedAt: 1_700_000_000,
            },
          ];

          const digest = generateMorningDigest(
            "digest-1",
            date,
            previousWorkday,
            [],
            [],
            leaveRequests,
            members,
          );

          expect(digest.onLeaveToday).toContain(members[0].name);
          expect(digest.onLeaveToday).not.toContain(members[1].name);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("onWfhToday only includes members with approved WFH covering today", () => {
    fc.assert(
      fc.property(
        dateArb,
        dateArb,
        fc.array(userArb(), { minLength: 2, maxLength: 5 }),
        (date, previousWorkday, members) => {
          const todayUtc = dateToUtc(date);

          // First member: approved WFH covering today
          // Second member: no WFH
          const leaveRequests: LeaveRequest[] = [
            {
              id: "lr-wfh-1",
              requesterId: members[0].id,
              type: "wfh",
              startDate: todayUtc - 86400,
              endDate: todayUtc + 86400,
              reason: "remote",
              status: "approved",
              reviewerId: "reviewer-1",
              reviewReason: null,
              createdAt: 1_700_000_000,
              updatedAt: 1_700_000_000,
            },
          ];

          const digest = generateMorningDigest(
            "digest-1",
            date,
            previousWorkday,
            [],
            [],
            leaveRequests,
            members,
          );

          expect(digest.onWfhToday).toContain(members[0].name);
          expect(digest.onWfhToday).not.toContain(members[1].name);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("pending/declined requests don't appear in onLeaveToday or onWfhToday", () => {
    fc.assert(
      fc.property(
        dateArb,
        dateArb,
        fc.array(userArb(), { minLength: 2, maxLength: 5 }),
        fc.constantFrom<"pending" | "declined">("pending", "declined"),
        fc.constantFrom<"annual" | "sick" | "wfh">("annual", "sick", "wfh"),
        (date, previousWorkday, members, status, leaveType) => {
          const todayUtc = dateToUtc(date);

          const leaveRequests: LeaveRequest[] = [
            {
              id: "lr-non-approved",
              requesterId: members[0].id,
              type: leaveType,
              startDate: todayUtc - 86400,
              endDate: todayUtc + 86400,
              reason: "test",
              status,
              reviewerId: status === "declined" ? "reviewer-1" : null,
              reviewReason: status === "declined" ? "reason" : null,
              createdAt: 1_700_000_000,
              updatedAt: 1_700_000_000,
            },
          ];

          const digest = generateMorningDigest(
            "digest-1",
            date,
            previousWorkday,
            [],
            [],
            leaveRequests,
            members,
          );

          expect(digest.onLeaveToday).not.toContain(members[0].name);
          expect(digest.onWfhToday).not.toContain(members[0].name);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("digest.date matches the input date", () => {
    fc.assert(
      fc.property(
        dateArb,
        dateArb,
        fc.array(userArb(), { minLength: 1, maxLength: 3 }),
        (date, previousWorkday, members) => {
          const digest = generateMorningDigest(
            "digest-1",
            date,
            previousWorkday,
            [],
            [],
            [],
            members,
          );

          expect(digest.date).toBe(date);
        },
      ),
      { numRuns: 200 },
    );
  });
});
