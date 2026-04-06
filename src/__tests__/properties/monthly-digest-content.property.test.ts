import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateMonthlyDigestData } from "@/lib/monthlyDigest";
import type {
  AttendanceRecord,
  Task,
  LeaveRequest,
  User,
  Project,
} from "@/types";

/**
 * Property 37: Monthly digest PDF content
 *
 * For any selected calendar month, the generated monthly digest data should
 * contain: total team hours, hours per person, hours per project, tasks
 * completed count, leave days taken per person, and weekly output note summaries.
 *
 * Properties:
 * - total team hours >= 0
 * - hours per person sum = total team hours
 * - tasks completed count >= 0
 *
 * **Validates: Requirements 22.1**
 */

// --- Helpers ---

function makeUser(id: string, name: string): User {
  return {
    id,
    name,
    role: null,
    email: `${id}@test.com`,
    avatarColor: "#000",
    createdAt: 0,
  };
}

function makeProject(id: string, name: string): Project {
  return {
    id,
    name,
    color: "#000",
    createdBy: "user-1",
    createdAt: 0,
    archivedAt: null,
  };
}

function makeAttendanceRecord(
  userId: string,
  date: string,
  totalHours: number,
  outputNote: string | null = null,
): AttendanceRecord {
  return {
    userId,
    date,
    loginTime: null,
    logoutTime: null,
    totalHours,
    breakMinutes: 0,
    outputNote,
  };
}

function makeTask(
  id: string,
  projectId: string,
  closedAt: number | null,
  assigneeId: string | null = null,
): Task {
  return {
    id,
    projectId,
    title: `Task ${id}`,
    status: closedAt !== null ? "done" : "open",
    assigneeId,
    priority: "medium",
    dueDate: null,
    estimatedMinutes: null,
    notes: null,
    createdBy: "user-1",
    createdAt: 0,
    closedAt,
  };
}

function makeLeaveRequest(
  requesterId: string,
  startDate: number,
  endDate: number,
  type: "annual" | "sick" | "wfh" = "annual",
): LeaveRequest {
  return {
    id: `lr-${Math.random().toString(36).slice(2, 8)}`,
    requesterId,
    type,
    startDate,
    endDate,
    reason: "",
    status: "approved",
    reviewerId: null,
    reviewReason: null,
    createdAt: startDate,
    updatedAt: startDate,
  };
}

// --- Arbitraries ---

const yearArb = fc.integer({ min: 2020, max: 2030 });
const monthArb = fc.integer({ min: 1, max: 12 });

/** Generate a set of team members (1-5) */
const teamArb = fc.integer({ min: 1, max: 5 }).map((count) =>
  Array.from({ length: count }, (_, i) => makeUser(`user-${i}`, `User ${i}`)),
);

/** Generate hours per day (0-12h) */
const hoursArb = fc.float({ min: 0, max: 12, noNaN: true });

// --- Property Tests ---

describe("Property 37: Monthly digest PDF content", () => {
  it("total team hours >= 0 (Req 22.1)", () => {
    fc.assert(
      fc.property(
        yearArb,
        monthArb,
        teamArb,
        fc.array(hoursArb, { minLength: 0, maxLength: 20 }),
        (year, month, team, hoursList) => {
          // Create attendance records with the generated hours
          const records: AttendanceRecord[] = [];
          let dayIdx = 1;
          for (const hours of hoursList) {
            const memberIdx = dayIdx % team.length;
            const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(dayIdx, 28)).padStart(2, "0")}`;
            records.push(makeAttendanceRecord(team[memberIdx].id, dateStr, hours));
            dayIdx++;
          }

          const result = generateMonthlyDigestData(
            year, month, records, [], [], [], [], [], team, [],
          );

          expect(result.totalTeamHours).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("hours per person sum equals total team hours (Req 22.1)", () => {
    fc.assert(
      fc.property(
        yearArb,
        monthArb,
        teamArb,
        fc.array(hoursArb, { minLength: 0, maxLength: 20 }),
        (year, month, team, hoursList) => {
          const records: AttendanceRecord[] = [];
          let dayIdx = 1;
          for (const hours of hoursList) {
            const memberIdx = dayIdx % team.length;
            const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(dayIdx, 28)).padStart(2, "0")}`;
            records.push(makeAttendanceRecord(team[memberIdx].id, dateStr, hours));
            dayIdx++;
          }

          const result = generateMonthlyDigestData(
            year, month, records, [], [], [], [], [], team, [],
          );

          // Sum of hours per person should equal total team hours
          const sumPerPerson = result.hoursPerPerson.reduce(
            (sum, p) => sum + p.totalHours,
            0,
          );

          // Use approximate equality due to floating point rounding
          expect(Math.abs(sumPerPerson - result.totalTeamHours)).toBeLessThan(0.02);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("tasks completed count >= 0 (Req 22.1)", () => {
    fc.assert(
      fc.property(
        yearArb,
        monthArb,
        fc.integer({ min: 0, max: 20 }),
        (year, month, taskCount) => {
          const team = [makeUser("user-1", "User 1")];
          const projects = [makeProject("proj-1", "Project 1")];

          // Month range
          const monthStart = Date.UTC(year, month - 1, 1) / 1000;
          const monthEnd = Date.UTC(year, month, 1) / 1000 - 1;

          // Create tasks completed within the month
          const tasks: Task[] = Array.from({ length: taskCount }, (_, i) => {
            const closedAt = monthStart + i * 86400;
            return makeTask(`task-${i}`, "proj-1", closedAt <= monthEnd ? closedAt : null, "user-1");
          });

          const completedTasks = tasks.filter((t) => t.closedAt !== null);

          const result = generateMonthlyDigestData(
            year, month, [], [], [], completedTasks, [], [], team, projects,
          );

          expect(result.tasksCompleted).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("contains all required sections (Req 22.1)", () => {
    fc.assert(
      fc.property(yearArb, monthArb, teamArb, (year, month, team) => {
        const result = generateMonthlyDigestData(
          year, month, [], [], [], [], [], [], team, [],
        );

        // All required fields must be present
        expect(result.year).toBe(year);
        expect(result.month).toBe(month);
        expect(typeof result.monthLabel).toBe("string");
        expect(result.monthLabel.length).toBeGreaterThan(0);
        expect(typeof result.totalTeamHours).toBe("number");
        expect(Array.isArray(result.hoursPerPerson)).toBe(true);
        expect(Array.isArray(result.hoursPerProject)).toBe(true);
        expect(typeof result.tasksCompleted).toBe("number");
        expect(Array.isArray(result.leaveDaysPerPerson)).toBe(true);
        expect(Array.isArray(result.weeklyOutputSummaries)).toBe(true);

        // One entry per team member for hours and leave
        expect(result.hoursPerPerson.length).toBe(team.length);
        expect(result.leaveDaysPerPerson.length).toBe(team.length);

        // At least 4 weeks in any month
        expect(result.weeklyOutputSummaries.length).toBeGreaterThanOrEqual(4);
      }),
      { numRuns: 200 },
    );
  });

  it("leave days per person are non-negative (Req 22.1)", () => {
    fc.assert(
      fc.property(yearArb, monthArb, (year, month) => {
        const team = [makeUser("user-1", "User 1"), makeUser("user-2", "User 2")];

        // Create some leave requests
        const monthStart = Date.UTC(year, month - 1, 1) / 1000;
        const leaveRequests = [
          makeLeaveRequest("user-1", monthStart, monthStart + 4 * 86400, "annual"),
        ];

        const result = generateMonthlyDigestData(
          year, month, [], [], [], [], leaveRequests, [], team, [],
        );

        for (const entry of result.leaveDaysPerPerson) {
          expect(entry.leaveDays).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 200 },
    );
  });
});
