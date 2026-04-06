import { describe, it, expect } from "vitest";
import { checkAttendanceAlerts } from "@/lib/dashboard";
import type {
  TeamMember,
  Session,
  LeaveRequest,
  PublicHoliday,
} from "@/types";

// Helper: UTC timestamp for a given date and time
function utc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  min = 0,
  sec = 0,
): number {
  return Math.floor(Date.UTC(year, month - 1, day, hour, min, sec) / 1000);
}

function makeMember(id: string, name: string): TeamMember {
  return {
    userId: id,
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
  return {
    type: "annual",
    startDate: 0,
    endDate: 0,
    reason: "",
    status: "approved",
    reviewerId: null,
    reviewReason: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeHoliday(
  id: string,
  date: number,
  name: string,
  year: number,
): PublicHoliday {
  return { id, date, name, year, createdAt: date };
}

// Wednesday 2025-07-16 at 14:00 UTC — a normal workday afternoon
const WEDNESDAY_2PM = utc(2025, 7, 16, 14, 0);
// Saturday 2025-07-19 at 14:00 UTC
const SATURDAY_2PM = utc(2025, 7, 19, 14, 0);
// Sunday 2025-07-20 at 14:00 UTC
const SUNDAY_2PM = utc(2025, 7, 20, 14, 0);

const members = [
  makeMember("u1", "Alice"),
  makeMember("u2", "Bob"),
  makeMember("u3", "Charlie"),
];

describe("checkAttendanceAlerts", () => {
  it("returns empty on Saturday (Req 27.3)", () => {
    const alerts = checkAttendanceAlerts(members, [], [], [], SATURDAY_2PM, 14);
    expect(alerts).toEqual([]);
  });

  it("returns empty on Sunday (Req 27.3)", () => {
    const alerts = checkAttendanceAlerts(members, [], [], [], SUNDAY_2PM, 14);
    expect(alerts).toEqual([]);
  });

  it("returns empty on a public holiday (Req 27.2)", () => {
    const holidays = [
      makeHoliday("h1", utc(2025, 7, 16), "National Day", 2025),
    ];
    const alerts = checkAttendanceAlerts(
      members, [], [], holidays, WEDNESDAY_2PM, 14,
    );
    expect(alerts).toEqual([]);
  });

  it("returns empty before 12:00 PM (Req 14.3)", () => {
    const alerts = checkAttendanceAlerts(
      members, [], [], [], WEDNESDAY_2PM, 11,
    );
    expect(alerts).toEqual([]);
  });

  it("returns empty at exactly hour 11 (boundary)", () => {
    const alerts = checkAttendanceAlerts(
      members, [], [], [], WEDNESDAY_2PM, 11,
    );
    expect(alerts).toEqual([]);
  });

  it("generates alerts at exactly 12:00 PM", () => {
    const alerts = checkAttendanceAlerts(
      members, [], [], [], WEDNESDAY_2PM, 12,
    );
    expect(alerts).toHaveLength(3);
  });

  it("alerts all members with no sessions on a workday afternoon", () => {
    const alerts = checkAttendanceAlerts(
      members, [], [], [], WEDNESDAY_2PM, 14,
    );
    expect(alerts).toHaveLength(3);
    expect(alerts.map((a) => a.userId)).toEqual(["u1", "u2", "u3"]);
    for (const alert of alerts) {
      expect(alert.label).toBe("Not yet logged in");
    }
  });

  it("skips members who have a session today (Req 14.3)", () => {
    const sessions = [
      makeSession({ id: "s1", userId: "u1", startTime: utc(2025, 7, 16, 9, 0) }),
    ];
    const alerts = checkAttendanceAlerts(
      members, sessions, [], [], WEDNESDAY_2PM, 14,
    );
    expect(alerts).toHaveLength(2);
    expect(alerts.find((a) => a.userId === "u1")).toBeUndefined();
  });

  it("skips members on approved annual leave (Req 27.1)", () => {
    const leave = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: "u2",
        type: "annual",
        status: "approved",
        startDate: utc(2025, 7, 16),
        endDate: utc(2025, 7, 16, 23, 59, 59),
      }),
    ];
    const alerts = checkAttendanceAlerts(
      members, [], leave, [], WEDNESDAY_2PM, 14,
    );
    expect(alerts).toHaveLength(2);
    expect(alerts.find((a) => a.userId === "u2")).toBeUndefined();
  });

  it("skips members on approved sick leave (Req 27.1)", () => {
    const leave = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: "u3",
        type: "sick",
        status: "approved",
        startDate: utc(2025, 7, 16),
        endDate: utc(2025, 7, 16, 23, 59, 59),
      }),
    ];
    const alerts = checkAttendanceAlerts(
      members, [], leave, [], WEDNESDAY_2PM, 14,
    );
    expect(alerts).toHaveLength(2);
    expect(alerts.find((a) => a.userId === "u3")).toBeUndefined();
  });

  it("WFH user with no session gets WFH label (Req 27.4)", () => {
    const leave = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: "u1",
        type: "wfh",
        status: "approved",
        startDate: utc(2025, 7, 16),
        endDate: utc(2025, 7, 16, 23, 59, 59),
      }),
    ];
    const alerts = checkAttendanceAlerts(
      members, [], leave, [], WEDNESDAY_2PM, 14,
    );
    const aliceAlert = alerts.find((a) => a.userId === "u1");
    expect(aliceAlert).toBeDefined();
    expect(aliceAlert!.label).toBe("WFH — not yet logged in");
    // Others get normal label
    const bobAlert = alerts.find((a) => a.userId === "u2");
    expect(bobAlert!.label).toBe("Not yet logged in");
  });

  it("WFH user with a session gets no alert", () => {
    const leave = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: "u1",
        type: "wfh",
        status: "approved",
        startDate: utc(2025, 7, 16),
        endDate: utc(2025, 7, 16, 23, 59, 59),
      }),
    ];
    const sessions = [
      makeSession({ id: "s1", userId: "u1", startTime: utc(2025, 7, 16, 10, 0) }),
    ];
    const alerts = checkAttendanceAlerts(
      members, sessions, leave, [], WEDNESDAY_2PM, 14,
    );
    expect(alerts.find((a) => a.userId === "u1")).toBeUndefined();
  });

  it("does not alert for pending (unapproved) leave", () => {
    const leave = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: "u2",
        type: "annual",
        status: "pending",
        startDate: utc(2025, 7, 16),
        endDate: utc(2025, 7, 16, 23, 59, 59),
      }),
    ];
    const alerts = checkAttendanceAlerts(
      members, [], leave, [], WEDNESDAY_2PM, 14,
    );
    // u2 should still get an alert since leave is not approved
    expect(alerts.find((a) => a.userId === "u2")).toBeDefined();
  });

  it("returns alerts with correct name field", () => {
    const alerts = checkAttendanceAlerts(
      members, [], [], [], WEDNESDAY_2PM, 14,
    );
    const alice = alerts.find((a) => a.userId === "u1");
    expect(alice!.name).toBe("Alice");
  });

  it("returns empty when all members have sessions", () => {
    const sessions = [
      makeSession({ id: "s1", userId: "u1", startTime: utc(2025, 7, 16, 8, 0) }),
      makeSession({ id: "s2", userId: "u2", startTime: utc(2025, 7, 16, 9, 0) }),
      makeSession({ id: "s3", userId: "u3", startTime: utc(2025, 7, 16, 10, 0) }),
    ];
    const alerts = checkAttendanceAlerts(
      members, sessions, [], [], WEDNESDAY_2PM, 14,
    );
    expect(alerts).toEqual([]);
  });

  it("returns empty for empty team", () => {
    const alerts = checkAttendanceAlerts(
      [], [], [], [], WEDNESDAY_2PM, 14,
    );
    expect(alerts).toEqual([]);
  });
});

import { detectOverwork } from "@/lib/dashboard";
import type { AttendanceRecord } from "@/types";

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

describe("detectOverwork", () => {
  const members = [
    makeMember("u1", "Alice"),
    makeMember("u2", "Bob"),
    makeMember("u3", "Charlie"),
  ];

  it("returns empty when no attendance records exist", () => {
    const signals = detectOverwork(members, []);
    expect(signals).toEqual([]);
  });

  it("returns empty when no member exceeds 10h on any day", () => {
    const records = [
      makeAttendanceRecord("u1", "2025-07-14", 8),
      makeAttendanceRecord("u1", "2025-07-15", 9.5),
      makeAttendanceRecord("u1", "2025-07-16", 10),
      makeAttendanceRecord("u1", "2025-07-17", 7),
      makeAttendanceRecord("u1", "2025-07-18", 6),
    ];
    const signals = detectOverwork(members, records);
    expect(signals).toEqual([]);
  });

  it("returns empty when member has overwork days but fewer than 3 (Req 26.2)", () => {
    const records = [
      makeAttendanceRecord("u1", "2025-07-14", 11),
      makeAttendanceRecord("u1", "2025-07-15", 12),
      makeAttendanceRecord("u1", "2025-07-16", 8),
      makeAttendanceRecord("u1", "2025-07-17", 7),
    ];
    const signals = detectOverwork(members, records);
    expect(signals).toEqual([]);
  });

  it("flags a member with exactly 3 overwork days (Req 26.1, 26.2)", () => {
    const records = [
      makeAttendanceRecord("u1", "2025-07-14", 11),
      makeAttendanceRecord("u1", "2025-07-15", 10.5),
      makeAttendanceRecord("u1", "2025-07-16", 12),
      makeAttendanceRecord("u1", "2025-07-17", 8),
    ];
    const signals = detectOverwork(members, records);
    expect(signals).toHaveLength(1);
    expect(signals[0].userId).toBe("u1");
    expect(signals[0].name).toBe("Alice");
    expect(signals[0].daysOver10h).toBe(3);
    expect(signals[0].severity).toBe("warning");
  });

  it("uses supportive language in the message (Req 26.3, 26.4)", () => {
    const records = [
      makeAttendanceRecord("u2", "2025-07-14", 11),
      makeAttendanceRecord("u2", "2025-07-15", 11),
      makeAttendanceRecord("u2", "2025-07-16", 11),
    ];
    const signals = detectOverwork(members, records);
    expect(signals).toHaveLength(1);
    expect(signals[0].message).toBe(
      "Bob has worked 10+ hours on 3 days this week. Consider taking a break.",
    );
    // Ensure no punitive language
    expect(signals[0].message).not.toContain("Excessive");
    expect(signals[0].message).not.toContain("violation");
    expect(signals[0].message).not.toContain("penalty");
  });

  it("does not flag a day with exactly 10h (boundary — Req 26.1)", () => {
    const records = [
      makeAttendanceRecord("u1", "2025-07-14", 10),
      makeAttendanceRecord("u1", "2025-07-15", 10),
      makeAttendanceRecord("u1", "2025-07-16", 10),
    ];
    const signals = detectOverwork(members, records);
    expect(signals).toEqual([]);
  });

  it("flags multiple members independently", () => {
    const records = [
      // Alice: 3 overwork days
      makeAttendanceRecord("u1", "2025-07-14", 11),
      makeAttendanceRecord("u1", "2025-07-15", 11),
      makeAttendanceRecord("u1", "2025-07-16", 11),
      // Bob: 2 overwork days — not enough
      makeAttendanceRecord("u2", "2025-07-14", 11),
      makeAttendanceRecord("u2", "2025-07-15", 11),
      // Charlie: 4 overwork days
      makeAttendanceRecord("u3", "2025-07-14", 12),
      makeAttendanceRecord("u3", "2025-07-15", 13),
      makeAttendanceRecord("u3", "2025-07-16", 11),
      makeAttendanceRecord("u3", "2025-07-17", 14),
    ];
    const signals = detectOverwork(members, records);
    expect(signals).toHaveLength(2);
    expect(signals.map((s) => s.userId)).toEqual(["u1", "u3"]);
    expect(signals[1].daysOver10h).toBe(4);
  });

  it("returns empty for empty team", () => {
    const records = [
      makeAttendanceRecord("u1", "2025-07-14", 15),
      makeAttendanceRecord("u1", "2025-07-15", 15),
      makeAttendanceRecord("u1", "2025-07-16", 15),
    ];
    const signals = detectOverwork([], records);
    expect(signals).toEqual([]);
  });

  it("counts only records for the specific member", () => {
    // u1 has 3 overwork days, but records also include u2 data
    const records = [
      makeAttendanceRecord("u1", "2025-07-14", 11),
      makeAttendanceRecord("u2", "2025-07-14", 11),
      makeAttendanceRecord("u1", "2025-07-15", 11),
      makeAttendanceRecord("u2", "2025-07-15", 5),
      makeAttendanceRecord("u1", "2025-07-16", 11),
      makeAttendanceRecord("u2", "2025-07-16", 5),
    ];
    const signals = detectOverwork(members, records);
    expect(signals).toHaveLength(1);
    expect(signals[0].userId).toBe("u1");
  });
});


import { computeStreak } from "@/lib/dashboard";

describe("computeStreak", () => {
  // Helper: UTC midnight timestamp for a given date
  function midnight(year: number, month: number, day: number): number {
    return Math.floor(Date.UTC(year, month - 1, day) / 1000);
  }

  const userId = "u1";

  it("returns 0 when no sessions exist (Req 15.3)", () => {
    // Wednesday 2025-07-16
    const streak = computeStreak(userId, [], [], [], utc(2025, 7, 16, 10, 0));
    expect(streak).toBe(0);
  });

  it("returns 1 when only today has a session", () => {
    const sessions = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 7, 16, 9, 0) }),
    ];
    // Wednesday 2025-07-16
    const streak = computeStreak(userId, sessions, [], [], utc(2025, 7, 16, 14, 0));
    expect(streak).toBe(1);
  });

  it("counts consecutive workdays with sessions (Req 15.1)", () => {
    // Mon Jul 14, Tue Jul 15, Wed Jul 16 — 3 consecutive workdays
    const sessions = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 7, 14, 9, 0) }),
      makeSession({ id: "s2", userId, startTime: utc(2025, 7, 15, 9, 0) }),
      makeSession({ id: "s3", userId, startTime: utc(2025, 7, 16, 9, 0) }),
    ];
    const streak = computeStreak(userId, sessions, [], [], utc(2025, 7, 16, 14, 0));
    expect(streak).toBe(3);
  });

  it("skips weekends — streak continues across weekend (Req 15.4)", () => {
    // Fri Jul 11, Mon Jul 14 — weekend skipped, streak = 2
    const sessions = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 7, 11, 9, 0) }),
      makeSession({ id: "s2", userId, startTime: utc(2025, 7, 14, 9, 0) }),
    ];
    const streak = computeStreak(userId, sessions, [], [], utc(2025, 7, 14, 14, 0));
    expect(streak).toBe(2);
  });

  it("skips public holidays (Req 15.4)", () => {
    // Tue Jul 15 is a holiday, Mon Jul 14 and Wed Jul 16 have sessions
    const sessions = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 7, 14, 9, 0) }),
      makeSession({ id: "s3", userId, startTime: utc(2025, 7, 16, 9, 0) }),
    ];
    const holidays: PublicHoliday[] = [
      makeHoliday("h1", midnight(2025, 7, 15), "National Day", 2025),
    ];
    const streak = computeStreak(userId, sessions, [], holidays, utc(2025, 7, 16, 14, 0));
    expect(streak).toBe(2);
  });

  it("skips approved annual leave days (Req 15.4)", () => {
    // Tue Jul 15 is approved annual leave, Mon Jul 14 and Wed Jul 16 have sessions
    const sessions = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 7, 14, 9, 0) }),
      makeSession({ id: "s3", userId, startTime: utc(2025, 7, 16, 9, 0) }),
    ];
    const leave: LeaveRequest[] = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: userId,
        type: "annual",
        status: "approved",
        startDate: midnight(2025, 7, 15),
        endDate: utc(2025, 7, 15, 23, 59, 59),
      }),
    ];
    const streak = computeStreak(userId, sessions, leave, [], utc(2025, 7, 16, 14, 0));
    expect(streak).toBe(2);
  });

  it("skips approved sick leave days (Req 15.4)", () => {
    // Tue Jul 15 is approved sick leave
    const sessions = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 7, 14, 9, 0) }),
      makeSession({ id: "s3", userId, startTime: utc(2025, 7, 16, 9, 0) }),
    ];
    const leave: LeaveRequest[] = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: userId,
        type: "sick",
        status: "approved",
        startDate: midnight(2025, 7, 15),
        endDate: utc(2025, 7, 15, 23, 59, 59),
      }),
    ];
    const streak = computeStreak(userId, sessions, leave, [], utc(2025, 7, 16, 14, 0));
    expect(streak).toBe(2);
  });

  it("resets streak on workday with no session and no leave (Req 15.3)", () => {
    // Mon Jul 14 has session, Tue Jul 15 has nothing, Wed Jul 16 has session
    // Streak from Wed: Wed has session (1), Tue has no session/no leave → break
    const sessions = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 7, 14, 9, 0) }),
      makeSession({ id: "s3", userId, startTime: utc(2025, 7, 16, 9, 0) }),
    ];
    const streak = computeStreak(userId, sessions, [], [], utc(2025, 7, 16, 14, 0));
    expect(streak).toBe(1);
  });

  it("does not count pending (unapproved) leave as skip", () => {
    // Tue Jul 15 has pending leave — should break streak
    const sessions = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 7, 14, 9, 0) }),
      makeSession({ id: "s3", userId, startTime: utc(2025, 7, 16, 9, 0) }),
    ];
    const leave: LeaveRequest[] = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: userId,
        type: "annual",
        status: "pending",
        startDate: midnight(2025, 7, 15),
        endDate: utc(2025, 7, 15, 23, 59, 59),
      }),
    ];
    const streak = computeStreak(userId, sessions, leave, [], utc(2025, 7, 16, 14, 0));
    expect(streak).toBe(1);
  });

  it("does not count WFH as leave skip — WFH expects sessions (Req 8.1)", () => {
    // Tue Jul 15 has approved WFH but no session — should break streak
    const sessions = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 7, 14, 9, 0) }),
      makeSession({ id: "s3", userId, startTime: utc(2025, 7, 16, 9, 0) }),
    ];
    const leave: LeaveRequest[] = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: userId,
        type: "wfh",
        status: "approved",
        startDate: midnight(2025, 7, 15),
        endDate: utc(2025, 7, 15, 23, 59, 59),
      }),
    ];
    const streak = computeStreak(userId, sessions, leave, [], utc(2025, 7, 16, 14, 0));
    expect(streak).toBe(1);
  });

  it("handles long streak across multiple weeks", () => {
    // 10 consecutive workdays: Jul 3 (Thu), Jul 4 (Fri), Jul 7 (Mon) ... Jul 16 (Wed)
    const sessions: Session[] = [];
    const workdays = [3, 4, 7, 8, 9, 10, 11, 14, 15, 16];
    workdays.forEach((day, i) => {
      sessions.push(
        makeSession({ id: `s${i}`, userId, startTime: utc(2025, 7, day, 9, 0) }),
      );
    });
    const streak = computeStreak(userId, sessions, [], [], utc(2025, 7, 16, 14, 0));
    expect(streak).toBe(10);
  });

  it("only counts sessions for the specified user", () => {
    // u1 has session on Wed, u2 has session on Tue — u1 streak should be 1
    const sessions = [
      makeSession({ id: "s1", userId: "u2", startTime: utc(2025, 7, 15, 9, 0) }),
      makeSession({ id: "s2", userId, startTime: utc(2025, 7, 16, 9, 0) }),
    ];
    const streak = computeStreak(userId, sessions, [], [], utc(2025, 7, 16, 14, 0));
    expect(streak).toBe(1);
  });

  it("only considers leave for the specified user", () => {
    // u2 has approved leave on Tue, but u1 does not — u1 streak breaks on Tue
    const sessions = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 7, 14, 9, 0) }),
      makeSession({ id: "s2", userId, startTime: utc(2025, 7, 16, 9, 0) }),
    ];
    const leave: LeaveRequest[] = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: "u2",
        type: "annual",
        status: "approved",
        startDate: midnight(2025, 7, 15),
        endDate: utc(2025, 7, 15, 23, 59, 59),
      }),
    ];
    const streak = computeStreak(userId, sessions, leave, [], utc(2025, 7, 16, 14, 0));
    expect(streak).toBe(1);
  });

  it("returns 0 when today is a workday with no session", () => {
    // Wed Jul 16, no sessions at all
    const streak = computeStreak(userId, [], [], [], utc(2025, 7, 16, 14, 0));
    expect(streak).toBe(0);
  });

  it("handles combined skips: weekend + holiday + leave", () => {
    // Thu Jul 10: session
    // Fri Jul 11: public holiday (skip)
    // Sat Jul 12: weekend (skip)
    // Sun Jul 13: weekend (skip)
    // Mon Jul 14: approved leave (skip)
    // Tue Jul 15: session
    // Wed Jul 16: session
    const sessions = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 7, 10, 9, 0) }),
      makeSession({ id: "s2", userId, startTime: utc(2025, 7, 15, 9, 0) }),
      makeSession({ id: "s3", userId, startTime: utc(2025, 7, 16, 9, 0) }),
    ];
    const holidays: PublicHoliday[] = [
      makeHoliday("h1", midnight(2025, 7, 11), "Holiday", 2025),
    ];
    const leave: LeaveRequest[] = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: userId,
        type: "annual",
        status: "approved",
        startDate: midnight(2025, 7, 14),
        endDate: utc(2025, 7, 14, 23, 59, 59),
      }),
    ];
    const streak = computeStreak(
      userId, sessions, leave, holidays, utc(2025, 7, 16, 14, 0),
    );
    expect(streak).toBe(3);
  });
});


import { getSessionExpectation } from "@/lib/dashboard";

describe("getSessionExpectation", () => {
  const userId = "u1";

  it("returns 'none' on Saturday (weekend)", () => {
    // Saturday 2025-07-19
    const result = getSessionExpectation(userId, [], [], SATURDAY_2PM);
    expect(result).toBe("none");
  });

  it("returns 'none' on Sunday (weekend)", () => {
    // Sunday 2025-07-20
    const result = getSessionExpectation(userId, [], [], SUNDAY_2PM);
    expect(result).toBe("none");
  });

  it("returns 'none' on a public holiday", () => {
    const holidays = [
      makeHoliday("h1", utc(2025, 7, 16), "National Day", 2025),
    ];
    const result = getSessionExpectation(userId, [], holidays, WEDNESDAY_2PM);
    expect(result).toBe("none");
  });

  it("returns 'on_leave' when user has approved annual leave (Req 8.2)", () => {
    const leave = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: userId,
        type: "annual",
        status: "approved",
        startDate: utc(2025, 7, 16),
        endDate: utc(2025, 7, 16, 23, 59, 59),
      }),
    ];
    const result = getSessionExpectation(userId, leave, [], WEDNESDAY_2PM);
    expect(result).toBe("on_leave");
  });

  it("returns 'on_leave' when user has approved sick leave (Req 8.2)", () => {
    const leave = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: userId,
        type: "sick",
        status: "approved",
        startDate: utc(2025, 7, 16),
        endDate: utc(2025, 7, 16, 23, 59, 59),
      }),
    ];
    const result = getSessionExpectation(userId, leave, [], WEDNESDAY_2PM);
    expect(result).toBe("on_leave");
  });

  it("returns 'wfh' when user has approved WFH (Req 8.1)", () => {
    const leave = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: userId,
        type: "wfh",
        status: "approved",
        startDate: utc(2025, 7, 16),
        endDate: utc(2025, 7, 16, 23, 59, 59),
      }),
    ];
    const result = getSessionExpectation(userId, leave, [], WEDNESDAY_2PM);
    expect(result).toBe("wfh");
  });

  it("returns 'normal' on a regular workday with no leave", () => {
    const result = getSessionExpectation(userId, [], [], WEDNESDAY_2PM);
    expect(result).toBe("normal");
  });

  it("ignores pending leave requests", () => {
    const leave = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: userId,
        type: "annual",
        status: "pending",
        startDate: utc(2025, 7, 16),
        endDate: utc(2025, 7, 16, 23, 59, 59),
      }),
    ];
    const result = getSessionExpectation(userId, leave, [], WEDNESDAY_2PM);
    expect(result).toBe("normal");
  });

  it("ignores leave for other users", () => {
    const leave = [
      makeLeaveRequest({
        id: "lr1",
        requesterId: "u2",
        type: "annual",
        status: "approved",
        startDate: utc(2025, 7, 16),
        endDate: utc(2025, 7, 16, 23, 59, 59),
      }),
    ];
    const result = getSessionExpectation(userId, leave, [], WEDNESDAY_2PM);
    expect(result).toBe("normal");
  });
});
