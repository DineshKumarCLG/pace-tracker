import { describe, it, expect } from "vitest";
import {
  computeAttendance,
  getAttendance,
  exportAttendanceCsv,
  utcTimestampToDateString,
} from "@/lib/attendance";
import type { Session, Break, AttendanceRecord } from "@/types";

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

function makeSession(overrides: Partial<Session> & Pick<Session, "id" | "userId" | "startTime">): Session {
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

function makeBreak(
  overrides: Partial<Break> & Pick<Break, "id" | "sessionId" | "startTime">,
): Break {
  return {
    endTime: null,
    type: "short",
    autoDetected: false,
    ...overrides,
  };
}

describe("utcTimestampToDateString", () => {
  it("converts a UTC timestamp to YYYY-MM-DD", () => {
    expect(utcTimestampToDateString(utc(2025, 3, 15))).toBe("2025-03-15");
  });

  it("pads single-digit months and days", () => {
    expect(utcTimestampToDateString(utc(2025, 1, 5))).toBe("2025-01-05");
  });
});

describe("computeAttendance", () => {
  const userId = "user-1";
  const date = "2025-03-15";

  it("returns empty record when no sessions", () => {
    const result = computeAttendance(userId, date, [], {});
    expect(result.loginTime).toBeNull();
    expect(result.logoutTime).toBeNull();
    expect(result.totalHours).toBe(0);
    expect(result.breakMinutes).toBe(0);
    expect(result.outputNote).toBeNull();
  });

  it("ignores open sessions (endTime === null)", () => {
    const sessions: Session[] = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 3, 15, 9, 0) }),
    ];
    const result = computeAttendance(userId, date, sessions, {});
    expect(result.loginTime).toBeNull();
    expect(result.totalHours).toBe(0);
  });

  it("computes login time as earliest session start (Req 2.1)", () => {
    const sessions: Session[] = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 3, 15, 10, 0), endTime: utc(2025, 3, 15, 12, 0) }),
      makeSession({ id: "s2", userId, startTime: utc(2025, 3, 15, 9, 0), endTime: utc(2025, 3, 15, 11, 0) }),
    ];
    const result = computeAttendance(userId, date, sessions, {});
    expect(result.loginTime).toBe(utc(2025, 3, 15, 9, 0));
  });

  it("computes logout time as latest session end (Req 2.2)", () => {
    const sessions: Session[] = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 3, 15, 9, 0), endTime: utc(2025, 3, 15, 12, 0) }),
      makeSession({ id: "s2", userId, startTime: utc(2025, 3, 15, 13, 0), endTime: utc(2025, 3, 15, 17, 30) }),
    ];
    const result = computeAttendance(userId, date, sessions, {});
    expect(result.logoutTime).toBe(utc(2025, 3, 15, 17, 30));
  });

  it("computes total hours as session durations minus breaks (Req 2.3)", () => {
    // Session: 9:00 - 12:00 = 3h, with a 30min break → 2.5h net
    const sessions: Session[] = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 3, 15, 9, 0), endTime: utc(2025, 3, 15, 12, 0) }),
    ];
    const breaks: Record<string, Break[]> = {
      s1: [
        makeBreak({ id: "b1", sessionId: "s1", startTime: utc(2025, 3, 15, 10, 0), endTime: utc(2025, 3, 15, 10, 30) }),
      ],
    };
    const result = computeAttendance(userId, date, sessions, breaks);
    expect(result.totalHours).toBeCloseTo(2.5, 4);
  });

  it("computes break minutes as sum of break durations (Req 2.4)", () => {
    const sessions: Session[] = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 3, 15, 9, 0), endTime: utc(2025, 3, 15, 17, 0) }),
    ];
    const breaks: Record<string, Break[]> = {
      s1: [
        makeBreak({ id: "b1", sessionId: "s1", startTime: utc(2025, 3, 15, 12, 0), endTime: utc(2025, 3, 15, 13, 0) }), // 60 min
        makeBreak({ id: "b2", sessionId: "s1", startTime: utc(2025, 3, 15, 15, 0), endTime: utc(2025, 3, 15, 15, 15) }), // 15 min
      ],
    };
    const result = computeAttendance(userId, date, sessions, breaks);
    expect(result.breakMinutes).toBe(75);
  });

  it("extracts output note from last closed session (Req 2.5)", () => {
    const sessions: Session[] = [
      makeSession({
        id: "s1", userId,
        startTime: utc(2025, 3, 15, 9, 0),
        endTime: utc(2025, 3, 15, 12, 0),
        outputNote: "Morning work",
      }),
      makeSession({
        id: "s2", userId,
        startTime: utc(2025, 3, 15, 13, 0),
        endTime: utc(2025, 3, 15, 17, 0),
        outputNote: "Afternoon work",
      }),
    ];
    const result = computeAttendance(userId, date, sessions, {});
    expect(result.outputNote).toBe("Afternoon work");
  });

  it("returns null output note when last session has no note", () => {
    const sessions: Session[] = [
      makeSession({
        id: "s1", userId,
        startTime: utc(2025, 3, 15, 9, 0),
        endTime: utc(2025, 3, 15, 12, 0),
        outputNote: "Morning work",
      }),
      makeSession({
        id: "s2", userId,
        startTime: utc(2025, 3, 15, 13, 0),
        endTime: utc(2025, 3, 15, 17, 0),
        outputNote: null,
      }),
    ];
    const result = computeAttendance(userId, date, sessions, {});
    expect(result.outputNote).toBeNull();
  });

  it("ignores open breaks (endTime === null)", () => {
    const sessions: Session[] = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 3, 15, 9, 0), endTime: utc(2025, 3, 15, 12, 0) }),
    ];
    const breaks: Record<string, Break[]> = {
      s1: [
        makeBreak({ id: "b1", sessionId: "s1", startTime: utc(2025, 3, 15, 10, 0) }), // open break
      ],
    };
    const result = computeAttendance(userId, date, sessions, breaks);
    // 3 hours, no break deducted
    expect(result.totalHours).toBeCloseTo(3.0, 4);
    expect(result.breakMinutes).toBe(0);
  });

  it("handles multiple sessions with multiple breaks", () => {
    const sessions: Session[] = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 3, 15, 9, 0), endTime: utc(2025, 3, 15, 12, 0) }),  // 3h
      makeSession({ id: "s2", userId, startTime: utc(2025, 3, 15, 13, 0), endTime: utc(2025, 3, 15, 17, 0) }), // 4h
    ];
    const breaks: Record<string, Break[]> = {
      s1: [
        makeBreak({ id: "b1", sessionId: "s1", startTime: utc(2025, 3, 15, 10, 30), endTime: utc(2025, 3, 15, 10, 45) }), // 15 min
      ],
      s2: [
        makeBreak({ id: "b2", sessionId: "s2", startTime: utc(2025, 3, 15, 15, 0), endTime: utc(2025, 3, 15, 15, 30) }),  // 30 min
      ],
    };
    const result = computeAttendance(userId, date, sessions, breaks);
    // (3h - 15min) + (4h - 30min) = 2.75 + 3.5 = 6.25h
    expect(result.totalHours).toBeCloseTo(6.25, 4);
    expect(result.breakMinutes).toBe(45);
  });

  it("ensures loginTime <= logoutTime", () => {
    const sessions: Session[] = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 3, 15, 9, 0), endTime: utc(2025, 3, 15, 17, 0) }),
    ];
    const result = computeAttendance(userId, date, sessions, {});
    expect(result.loginTime!).toBeLessThanOrEqual(result.logoutTime!);
  });

  it("ensures totalHours >= 0", () => {
    const sessions: Session[] = [
      makeSession({ id: "s1", userId, startTime: utc(2025, 3, 15, 9, 0), endTime: utc(2025, 3, 15, 10, 0) }),
    ];
    const result = computeAttendance(userId, date, sessions, {});
    expect(result.totalHours).toBeGreaterThanOrEqual(0);
  });
});


describe("getAttendance", () => {
  it("groups sessions by user and date", () => {
    const sessions: Session[] = [
      makeSession({ id: "s1", userId: "user-1", startTime: utc(2025, 3, 15, 9, 0), endTime: utc(2025, 3, 15, 12, 0) }),
      makeSession({ id: "s2", userId: "user-1", startTime: utc(2025, 3, 16, 9, 0), endTime: utc(2025, 3, 16, 17, 0) }),
      makeSession({ id: "s3", userId: "user-2", startTime: utc(2025, 3, 15, 10, 0), endTime: utc(2025, 3, 15, 18, 0) }),
    ];
    const records = getAttendance(null, "2025-03-15", "2025-03-16", sessions, {});
    expect(records).toHaveLength(3);
  });

  it("filters by userId when specified", () => {
    const sessions: Session[] = [
      makeSession({ id: "s1", userId: "user-1", startTime: utc(2025, 3, 15, 9, 0), endTime: utc(2025, 3, 15, 12, 0) }),
      makeSession({ id: "s2", userId: "user-2", startTime: utc(2025, 3, 15, 10, 0), endTime: utc(2025, 3, 15, 18, 0) }),
    ];
    const records = getAttendance("user-1", "2025-03-15", "2025-03-15", sessions, {});
    expect(records).toHaveLength(1);
    expect(records[0].userId).toBe("user-1");
  });

  it("filters by date range", () => {
    const sessions: Session[] = [
      makeSession({ id: "s1", userId: "user-1", startTime: utc(2025, 3, 14, 9, 0), endTime: utc(2025, 3, 14, 17, 0) }),
      makeSession({ id: "s2", userId: "user-1", startTime: utc(2025, 3, 15, 9, 0), endTime: utc(2025, 3, 15, 17, 0) }),
      makeSession({ id: "s3", userId: "user-1", startTime: utc(2025, 3, 16, 9, 0), endTime: utc(2025, 3, 16, 17, 0) }),
    ];
    const records = getAttendance("user-1", "2025-03-15", "2025-03-15", sessions, {});
    expect(records).toHaveLength(1);
    expect(records[0].date).toBe("2025-03-15");
  });

  it("filters by project session IDs when specified", () => {
    const sessions: Session[] = [
      makeSession({ id: "s1", userId: "user-1", startTime: utc(2025, 3, 15, 9, 0), endTime: utc(2025, 3, 15, 12, 0) }),
      makeSession({ id: "s2", userId: "user-1", startTime: utc(2025, 3, 15, 13, 0), endTime: utc(2025, 3, 15, 17, 0) }),
    ];
    const projectSessionIds = new Set(["s1"]);
    const records = getAttendance("user-1", "2025-03-15", "2025-03-15", sessions, {}, projectSessionIds);
    expect(records).toHaveLength(1);
    // Only s1 included, so login=9:00, logout=12:00
    expect(records[0].loginTime).toBe(utc(2025, 3, 15, 9, 0));
    expect(records[0].logoutTime).toBe(utc(2025, 3, 15, 12, 0));
  });

  it("returns empty array when no sessions match", () => {
    const records = getAttendance("user-1", "2025-03-15", "2025-03-15", [], {});
    expect(records).toHaveLength(0);
  });

  it("sorts results by date then userId", () => {
    const sessions: Session[] = [
      makeSession({ id: "s1", userId: "user-2", startTime: utc(2025, 3, 15, 9, 0), endTime: utc(2025, 3, 15, 17, 0) }),
      makeSession({ id: "s2", userId: "user-1", startTime: utc(2025, 3, 15, 9, 0), endTime: utc(2025, 3, 15, 17, 0) }),
      makeSession({ id: "s3", userId: "user-1", startTime: utc(2025, 3, 16, 9, 0), endTime: utc(2025, 3, 16, 17, 0) }),
    ];
    const records = getAttendance(null, "2025-03-15", "2025-03-16", sessions, {});
    expect(records[0].date).toBe("2025-03-15");
    expect(records[0].userId).toBe("user-1");
    expect(records[1].date).toBe("2025-03-15");
    expect(records[1].userId).toBe("user-2");
    expect(records[2].date).toBe("2025-03-16");
  });

  it("excludes open sessions", () => {
    const sessions: Session[] = [
      makeSession({ id: "s1", userId: "user-1", startTime: utc(2025, 3, 15, 9, 0) }), // open
    ];
    const records = getAttendance("user-1", "2025-03-15", "2025-03-15", sessions, {});
    expect(records).toHaveLength(0);
  });
});

describe("exportAttendanceCsv", () => {
  it("generates CSV with header and data rows", () => {
    const records: AttendanceRecord[] = [
      {
        userId: "user-1",
        date: "2025-03-15",
        loginTime: utc(2025, 3, 15, 9, 0),
        logoutTime: utc(2025, 3, 15, 17, 0),
        totalHours: 7.5,
        breakMinutes: 30,
        outputNote: "Finished feature X",
      },
    ];
    const csv = exportAttendanceCsv(records, { "user-1": "Alice" });
    const lines = csv.split("\n");
    expect(lines[0]).toBe("date,person,login_time,logout_time,total_hours,break_minutes,output_note");
    expect(lines[1]).toContain("2025-03-15");
    expect(lines[1]).toContain("Alice");
    expect(lines[1]).toContain("7.50");
    expect(lines[1]).toContain("30");
    expect(lines[1]).toContain("Finished feature X");
  });

  it("uses userId when no name mapping provided", () => {
    const records: AttendanceRecord[] = [
      {
        userId: "user-1",
        date: "2025-03-15",
        loginTime: utc(2025, 3, 15, 9, 0),
        logoutTime: utc(2025, 3, 15, 17, 0),
        totalHours: 8,
        breakMinutes: 0,
        outputNote: null,
      },
    ];
    const csv = exportAttendanceCsv(records);
    expect(csv).toContain("user-1");
  });

  it("handles empty login/logout times", () => {
    const records: AttendanceRecord[] = [
      {
        userId: "user-1",
        date: "2025-03-15",
        loginTime: null,
        logoutTime: null,
        totalHours: 0,
        breakMinutes: 0,
        outputNote: null,
      },
    ];
    const csv = exportAttendanceCsv(records);
    const dataLine = csv.split("\n")[1];
    // Should have empty fields for login/logout
    expect(dataLine).toContain("2025-03-15,user-1,,,0.00,0,");
  });

  it("escapes commas in output notes", () => {
    const records: AttendanceRecord[] = [
      {
        userId: "user-1",
        date: "2025-03-15",
        loginTime: utc(2025, 3, 15, 9, 0),
        logoutTime: utc(2025, 3, 15, 17, 0),
        totalHours: 8,
        breakMinutes: 0,
        outputNote: "Fixed bug, deployed to prod",
      },
    ];
    const csv = exportAttendanceCsv(records);
    expect(csv).toContain('"Fixed bug, deployed to prod"');
  });

  it("returns only header for empty records", () => {
    const csv = exportAttendanceCsv([]);
    expect(csv).toBe("date,person,login_time,logout_time,total_hours,break_minutes,output_note");
  });
});
