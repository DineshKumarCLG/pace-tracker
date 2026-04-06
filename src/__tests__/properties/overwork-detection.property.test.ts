import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { detectOverwork } from "@/lib/dashboard";
import type { TeamMember, AttendanceRecord } from "@/types";

/**
 * Property 22: Overwork detection
 *
 * For any user and rolling 7-day window, if 3 or more days have total session
 * hours exceeding 10 hours, an overwork signal should be generated. If fewer
 * than 3 days exceed 10 hours, no signal should be generated. The signal
 * message should contain supportive language.
 *
 * **Validates: Requirements 10.5, 26.1, 26.2, 26.3**
 */

// --- Helpers ---

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

function makeAttendanceRecord(
  userId: string,
  date: string,
  totalHours: number,
): AttendanceRecord {
  return {
    userId,
    date,
    loginTime: null,
    logoutTime: null,
    totalHours,
    breakMinutes: 0,
    outputNote: null,
  };
}

/** Generate a YYYY-MM-DD date string offset from a base date */
function dateStr(dayOffset: number): string {
  const base = new Date(2025, 5, 16); // June 16, 2025
  base.setDate(base.getDate() + dayOffset);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, "0");
  const d = String(base.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// --- Arbitraries ---

/** Generate 1–5 unique team members */
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
    const seen = new Set<string>();
    return members.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  })
  .filter((members) => members.length >= 1);

/** Generate hours for a single day: either over 10h or at most 10h */
const hoursArb = fc.oneof(
  fc.double({ min: 10.01, max: 18, noNaN: true }), // overwork day
  fc.double({ min: 0, max: 10, noNaN: true }),      // normal day
);

/** Generate 0–7 attendance records for a single user within a 7-day window */
const userRecordsArb = (userId: string) =>
  fc
    .array(hoursArb, { minLength: 0, maxLength: 7 })
    .map((hoursList) =>
      hoursList.map((h, i) => makeAttendanceRecord(userId, dateStr(i), h)),
    );

// --- Property Tests ---

describe("Property 22: Overwork detection", () => {
  it("signal emitted only when daysOver10h >= 3 (Req 26.2)", () => {
    fc.assert(
      fc.property(
        teamMembersArb,
        fc.integer({ min: 0, max: 7 }),
        (members, overworkDayCount) => {
          const teamMembers = members.map((m) => makeTeamMember(m.id, m.name));

          // Build attendance records for the first member with exactly
          // `overworkDayCount` days over 10h and the rest at/below 10h
          const target = members[0];
          const records: AttendanceRecord[] = [];
          for (let i = 0; i < 7; i++) {
            const hours = i < overworkDayCount ? 11 : 8;
            records.push(makeAttendanceRecord(target.id, dateStr(i), hours));
          }

          const signals = detectOverwork(teamMembers, records);
          const targetSignal = signals.find((s) => s.userId === target.id);

          if (overworkDayCount >= 3) {
            // INVARIANT: signal must be emitted
            expect(targetSignal).toBeDefined();
            expect(targetSignal!.daysOver10h).toBe(overworkDayCount);
          } else {
            // INVARIANT: no signal
            expect(targetSignal).toBeUndefined();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("a day is flagged only when totalHours > 10 (Req 26.1)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 18, noNaN: true }), {
          minLength: 7,
          maxLength: 7,
        }),
        (hoursList) => {
          const userId = "user-test";
          const member = makeTeamMember(userId, "Test");
          const records = hoursList.map((h, i) =>
            makeAttendanceRecord(userId, dateStr(i), h),
          );

          const signals = detectOverwork([member], records);
          const signal = signals.find((s) => s.userId === userId);

          // Count days that are strictly > 10h
          const expectedOverworkDays = hoursList.filter((h) => h > 10).length;

          if (expectedOverworkDays >= 3) {
            expect(signal).toBeDefined();
            expect(signal!.daysOver10h).toBe(expectedOverworkDays);
          } else {
            expect(signal).toBeUndefined();
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("message uses supportive language containing 'Consider taking a break' (Req 26.3)", () => {
    fc.assert(
      fc.property(
        teamMembersArb,
        fc.integer({ min: 3, max: 7 }),
        (members, overworkDayCount) => {
          const teamMembers = members.map((m) => makeTeamMember(m.id, m.name));
          const target = members[0];

          const records: AttendanceRecord[] = [];
          for (let i = 0; i < 7; i++) {
            const hours = i < overworkDayCount ? 12 : 5;
            records.push(makeAttendanceRecord(target.id, dateStr(i), hours));
          }

          const signals = detectOverwork(teamMembers, records);
          const targetSignal = signals.find((s) => s.userId === target.id);

          // INVARIANT: message must contain supportive language
          expect(targetSignal).toBeDefined();
          expect(targetSignal!.message).toContain("Consider taking a break");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("signal count <= team member count", () => {
    fc.assert(
      fc.property(teamMembersArb, (members) => {
        const teamMembers = members.map((m) => makeTeamMember(m.id, m.name));

        // Give every member 4 overwork days so all trigger signals
        const records: AttendanceRecord[] = [];
        for (const m of members) {
          for (let i = 0; i < 7; i++) {
            records.push(makeAttendanceRecord(m.id, dateStr(i), i < 4 ? 12 : 5));
          }
        }

        const signals = detectOverwork(teamMembers, records);

        // INVARIANT: at most one signal per team member
        expect(signals.length).toBeLessThanOrEqual(teamMembers.length);
      }),
      { numRuns: 200 },
    );
  });

  it("no signal when all days have <= 10h", () => {
    fc.assert(
      fc.property(
        teamMembersArb,
        fc.array(fc.double({ min: 0, max: 10, noNaN: true }), {
          minLength: 1,
          maxLength: 7,
        }),
        (members, hoursList) => {
          const teamMembers = members.map((m) => makeTeamMember(m.id, m.name));

          // All records have hours <= 10 for every member
          const records: AttendanceRecord[] = [];
          for (const m of members) {
            for (let i = 0; i < hoursList.length; i++) {
              records.push(
                makeAttendanceRecord(m.id, dateStr(i), hoursList[i]),
              );
            }
          }

          const signals = detectOverwork(teamMembers, records);

          // INVARIANT: no signals when no day exceeds 10h
          expect(signals).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("daysOver10h in signal matches actual count of >10h days", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z][a-z]{2,8}$/),
        fc.array(fc.double({ min: 0, max: 18, noNaN: true }), {
          minLength: 3,
          maxLength: 7,
        }),
        (name, hoursList) => {
          const userId = "user-check";
          const member = makeTeamMember(userId, name);
          const records = hoursList.map((h, i) =>
            makeAttendanceRecord(userId, dateStr(i), h),
          );

          const signals = detectOverwork([member], records);
          const signal = signals.find((s) => s.userId === userId);

          const actualOverworkDays = hoursList.filter((h) => h > 10).length;

          if (actualOverworkDays >= 3) {
            expect(signal).toBeDefined();
            // INVARIANT: reported count matches actual count
            expect(signal!.daysOver10h).toBe(actualOverworkDays);
          } else {
            expect(signal).toBeUndefined();
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
