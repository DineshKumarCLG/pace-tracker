import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { checkAttendanceAlerts } from "@/lib/dashboard";
import type {
  TeamMember,
  Session,
  LeaveRequest,
  PublicHoliday,
} from "@/types";

/**
 * Property 23: Attendance alert exclusions
 *
 * For any team and any day, attendance alerts should:
 * (a) never be generated on weekends or public holidays,
 * (b) never include users on approved leave,
 * (c) only be generated after 12:00 PM local time,
 * (d) for WFH users without a session, use the label "WFH — not yet logged in".
 *
 * Additional invariants:
 * (e) users with sessions today are never alerted,
 * (f) alert count <= team member count.
 *
 * **Validates: Requirements 14.3, 27.1, 27.2, 27.3, 27.4**
 */

// --- Helpers ---

/** UTC timestamp for a given date and time */
function utc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  min = 0,
): number {
  return Math.floor(Date.UTC(year, month - 1, day, hour, min) / 1000);
}

function makeTeamMember(userId: string, name: string): TeamMember {
  return {
    userId,
    name,
    status: "offline",
    currentTask: null,
    sessionStart: null,
    breakStart: null,
    outputNote: null,
    avatarColor: "#000",
  };
}

function makeSession(
  overrides: Partial<Session> & Pick<Session, "id" | "userId" | "startTime">,
): Session {
  return {
    endTime: null,
    startType: "manual",
    startVerified: true,
    outputNote: null,
    lastHeartbeat: null,
    syncedAt: null,
    createdAt: overrides.startTime,
    ...overrides,
  };
}

function makeLeaveRequest(
  overrides: Partial<LeaveRequest> & Pick<LeaveRequest, "id" | "requesterId">,
): LeaveRequest {
  const now = utc(2025, 6, 15);
  return {
    type: "annual",
    startDate: now,
    endDate: now + 86400,
    reason: "test",
    status: "approved",
    reviewerId: null,
    reviewReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePublicHoliday(
  date: number,
  name: string,
  year: number,
): PublicHoliday {
  return {
    id: `ph-${date}`,
    date,
    name,
    year,
    createdAt: date,
  };
}

// --- Arbitraries ---

/** Generate 1–5 unique team member IDs */
const teamMembersArb = fc
  .integer({ min: 1, max: 5 })
  .chain((count) =>
    fc.array(
      fc.record({
        id: fc.stringMatching(/^user-[a-z0-9]{4,8}$/),
        name: fc.stringMatching(/^[A-Z][a-z]{2,8}$/),
      }),
      { minLength: count, maxLength: count },
    ),
  )
  .map((members) => {
    // Deduplicate by id
    const seen = new Set<string>();
    return members.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  })
  .filter((members) => members.length >= 1);

/**
 * Generate a weekday (Mon-Fri) UTC timestamp.
 * We pick a known Monday (2025-06-16) and offset by 0–4 days.
 */
const weekdayTimestampArb = fc
  .integer({ min: 0, max: 4 })
  .map((offset) => utc(2025, 6, 16 + offset, 12)); // Mon Jun 16 – Fri Jun 20

/**
 * Generate a weekend (Sat or Sun) UTC timestamp.
 * 2025-06-14 is Saturday, 2025-06-15 is Sunday.
 */
const weekendTimestampArb = fc
  .constantFrom(0, 1)
  .map((offset) => utc(2025, 6, 14 + offset, 12));

/** Hour in the afternoon (12–23) */
const afternoonHourArb = fc.integer({ min: 12, max: 23 });

/** Hour in the morning (0–11) */
const morningHourArb = fc.integer({ min: 0, max: 11 });

// --- Property Tests ---

describe("Property 23: Attendance alert exclusions", () => {
  it("no alerts are generated on weekends (Req 27.3)", () => {
    fc.assert(
      fc.property(
        teamMembersArb,
        weekendTimestampArb,
        afternoonHourArb,
        (members, currentTime, currentHour) => {
          const teamMembers = members.map((m) =>
            makeTeamMember(m.id, m.name),
          );

          const alerts = checkAttendanceAlerts(
            teamMembers,
            [],    // no sessions
            [],    // no leave requests
            [],    // no holidays
            currentTime,
            currentHour,
          );

          // INVARIANT: weekends produce zero alerts
          expect(alerts).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("no alerts are generated on public holidays (Req 27.2)", () => {
    fc.assert(
      fc.property(
        teamMembersArb,
        weekdayTimestampArb,
        afternoonHourArb,
        (members, currentTime, currentHour) => {
          const teamMembers = members.map((m) =>
            makeTeamMember(m.id, m.name),
          );

          // Mark the current day as a public holiday
          const d = new Date(currentTime * 1000);
          const holidayDate = utc(
            d.getUTCFullYear(),
            d.getUTCMonth() + 1,
            d.getUTCDate(),
          );
          const holidays = [
            makePublicHoliday(holidayDate, "Test Holiday", d.getUTCFullYear()),
          ];

          const alerts = checkAttendanceAlerts(
            teamMembers,
            [],
            [],
            holidays,
            currentTime,
            currentHour,
          );

          // INVARIANT: public holidays produce zero alerts
          expect(alerts).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("no alerts are generated before 12:00 PM (Req 14.3)", () => {
    fc.assert(
      fc.property(
        teamMembersArb,
        weekdayTimestampArb,
        morningHourArb,
        (members, currentTime, currentHour) => {
          const teamMembers = members.map((m) =>
            makeTeamMember(m.id, m.name),
          );

          const alerts = checkAttendanceAlerts(
            teamMembers,
            [],
            [],
            [],
            currentTime,
            currentHour,
          );

          // INVARIANT: before noon produces zero alerts
          expect(alerts).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("no alerts for users on approved leave (Req 27.1)", () => {
    fc.assert(
      fc.property(
        teamMembersArb,
        weekdayTimestampArb,
        afternoonHourArb,
        fc.constantFrom("annual" as const, "sick" as const),
        (members, currentTime, currentHour, leaveType) => {
          const teamMembers = members.map((m) =>
            makeTeamMember(m.id, m.name),
          );

          // Every member has approved leave covering today
          const leaveRequests = members.map((m) =>
            makeLeaveRequest({
              id: `lr-${m.id}`,
              requesterId: m.id,
              type: leaveType,
              status: "approved",
              startDate: currentTime - 86400,
              endDate: currentTime + 86400,
            }),
          );

          const alerts = checkAttendanceAlerts(
            teamMembers,
            [],
            leaveRequests,
            [],
            currentTime,
            currentHour,
          );

          // INVARIANT: users on approved leave are never alerted
          expect(alerts).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("WFH users with no session get 'WFH — not yet logged in' label (Req 27.4)", () => {
    fc.assert(
      fc.property(
        teamMembersArb,
        weekdayTimestampArb,
        afternoonHourArb,
        (members, currentTime, currentHour) => {
          const teamMembers = members.map((m) =>
            makeTeamMember(m.id, m.name),
          );

          // Every member has approved WFH covering today
          const leaveRequests = members.map((m) =>
            makeLeaveRequest({
              id: `wfh-${m.id}`,
              requesterId: m.id,
              type: "wfh",
              status: "approved",
              startDate: currentTime - 86400,
              endDate: currentTime + 86400,
            }),
          );

          const alerts = checkAttendanceAlerts(
            teamMembers,
            [],    // no sessions
            leaveRequests,
            [],
            currentTime,
            currentHour,
          );

          // INVARIANT: every WFH user without a session gets the WFH label
          for (const alert of alerts) {
            expect(alert.label).toBe("WFH — not yet logged in");
          }
          // All WFH members without sessions should be alerted
          expect(alerts).toHaveLength(members.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("users with sessions today are never alerted", () => {
    fc.assert(
      fc.property(
        teamMembersArb,
        weekdayTimestampArb,
        afternoonHourArb,
        (members, currentTime, currentHour) => {
          const teamMembers = members.map((m) =>
            makeTeamMember(m.id, m.name),
          );

          // Every member has a session starting today
          const sessions = members.map((m, i) =>
            makeSession({
              id: `s-${i}`,
              userId: m.id,
              startTime: currentTime - 3600, // 1 hour ago on same day
              endTime: null,
            }),
          );

          const alerts = checkAttendanceAlerts(
            teamMembers,
            sessions,
            [],
            [],
            currentTime,
            currentHour,
          );

          // INVARIANT: users with sessions today are never alerted
          expect(alerts).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("alert count is always <= team member count", () => {
    fc.assert(
      fc.property(
        teamMembersArb,
        weekdayTimestampArb,
        afternoonHourArb,
        fc.array(
          fc.record({
            memberIndex: fc.integer({ min: 0, max: 4 }),
            hasSession: fc.boolean(),
            leaveType: fc.constantFrom(
              "annual" as const,
              "sick" as const,
              "wfh" as const,
              null,
            ),
          }),
          { minLength: 0, maxLength: 5 },
        ),
        (members, currentTime, currentHour, scenarios) => {
          const teamMembers = members.map((m) =>
            makeTeamMember(m.id, m.name),
          );

          const sessions: Session[] = [];
          const leaveRequests: LeaveRequest[] = [];

          for (const scenario of scenarios) {
            const member = members[scenario.memberIndex % members.length];

            if (scenario.hasSession) {
              sessions.push(
                makeSession({
                  id: `s-${member.id}`,
                  userId: member.id,
                  startTime: currentTime - 1800,
                }),
              );
            }

            if (scenario.leaveType) {
              leaveRequests.push(
                makeLeaveRequest({
                  id: `lr-${member.id}-${scenario.leaveType}`,
                  requesterId: member.id,
                  type: scenario.leaveType,
                  status: "approved",
                  startDate: currentTime - 86400,
                  endDate: currentTime + 86400,
                }),
              );
            }
          }

          const alerts = checkAttendanceAlerts(
            teamMembers,
            sessions,
            leaveRequests,
            [],
            currentTime,
            currentHour,
          );

          // INVARIANT: alert count can never exceed team size
          expect(alerts.length).toBeLessThanOrEqual(teamMembers.length);
        },
      ),
      { numRuns: 200 },
    );
  });
});
