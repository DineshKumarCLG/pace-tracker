import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { getTeamAnalytics } from "@/lib/analytics";
import type {
  SessionTask,
  Task,
  Project,
  AttendanceRecord,
  LeaveRequest,
} from "@/types";

/**
 * Property 16: No comparative rankings
 *
 * For any call to the team analytics computation, the output should not
 * contain any field that ranks, scores, or compares individual team members
 * against each other. The heatmap doesn't sort by hours.
 *
 * **Validates: Requirements 10.6, 25.4**
 */

// --- Helpers ---

function makeProject(id: string, name: string): Project {
  return {
    id,
    name,
    color: "#000000",
    createdBy: "user-1",
    createdAt: 1000000,
    archivedAt: null,
  };
}

function makeTask(id: string, projectId: string): Task {
  return {
    id,
    projectId,
    title: `Task ${id}`,
    status: "done",
    assigneeId: "user-1",
    priority: "medium",
    dueDate: null,
    estimatedMinutes: null,
    notes: null,
    createdBy: "user-1",
    createdAt: 1000000,
    closedAt: 1500000,
  };
}

function makeSessionTask(
  id: string,
  taskId: string,
  startTime: number,
  endTime: number,
): SessionTask {
  return {
    id,
    sessionId: `session-${id}`,
    taskId,
    startTime,
    endTime,
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

// --- Forbidden field names ---

const RANKING_FIELDS = [
  "rank",
  "ranking",
  "score",
  "rating",
  "percentile",
  "comparison",
  "leaderboard",
  "position",
  "productivity_score",
  "productivityScore",
  "performanceRating",
  "performance_rating",
];

/** Recursively check an object for forbidden ranking/scoring fields */
function findForbiddenFields(obj: unknown, path = ""): string[] {
  const found: string[] = [];
  if (obj === null || obj === undefined || typeof obj !== "object") return found;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      found.push(...findForbiddenFields(obj[i], `${path}[${i}]`));
    }
  } else {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (RANKING_FIELDS.some((f) => lowerKey.includes(f))) {
        found.push(`${path}.${key}`);
      }
      found.push(...findForbiddenFields(value, `${path}.${key}`));
    }
  }
  return found;
}

// --- Arbitraries ---

const memberCountArb = fc.integer({ min: 2, max: 5 });

const scenarioArb = memberCountArb.chain((memberCount) => {
  const members = Array.from({ length: memberCount }, (_, i) => ({
    userId: `user-${i}`,
    name: `Member ${i}`,
  }));

  const project = makeProject("proj-0", "Project Alpha");
  const task = makeTask("task-0", "proj-0");

  // Generate varying attendance hours per member
  return fc
    .array(
      fc.tuple(
        fc.integer({ min: 0, max: memberCount - 1 }), // member index
        fc.double({ min: 0, max: 16, noNaN: true, noDefaultInfinity: true }), // hours
      ),
      { minLength: 0, maxLength: 20 },
    )
    .map((entries) => {
      const attendanceRecords = entries.map(([memberIdx, hours], i) =>
        makeAttendanceRecord(
          members[memberIdx].userId,
          `2025-06-${String((i % 28) + 1).padStart(2, "0")}`,
          hours,
        ),
      );

      const sessionTasks = [
        makeSessionTask("st-0", "task-0", 1000000, 1003600),
      ];

      return {
        members,
        project,
        task,
        attendanceRecords,
        sessionTasks,
      };
    });
});

const refDate = Math.floor(new Date("2025-06-15").getTime() / 1000);

// --- Property Tests ---

describe("Property 16: No comparative rankings", () => {
  it("output contains no rank/score/rating fields (Req 10.6, 25.4)", () => {
    fc.assert(
      fc.property(scenarioArb, ({ members, project, task, attendanceRecords, sessionTasks }) => {
        const result = getTeamAnalytics(
          sessionTasks,
          [task],
          [project],
          attendanceRecords,
          members,
          [],
          refDate,
        );

        const forbidden = findForbiddenFields(result);

        // INVARIANT: no ranking/scoring/comparison fields in output
        expect(forbidden).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it("heatmap preserves member input order, not sorted by hours (Req 10.6, 25.4)", () => {
    fc.assert(
      fc.property(scenarioArb, ({ members, project, task, attendanceRecords, sessionTasks }) => {
        const result = getTeamAnalytics(
          sessionTasks,
          [task],
          [project],
          attendanceRecords,
          members,
          [],
          refDate,
        );

        // INVARIANT: heatmap order matches input member order
        expect(result.availabilityHeatmap.length).toBe(members.length);
        for (let i = 0; i < members.length; i++) {
          expect(result.availabilityHeatmap[i].userId).toBe(members[i].userId);
          expect(result.availabilityHeatmap[i].name).toBe(members[i].name);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("members with different hours are not ranked against each other (Req 10.6, 25.4)", () => {
    // Specific scenario: member A has much more hours than member B
    const members = [
      { userId: "user-high", name: "High Hours" },
      { userId: "user-low", name: "Low Hours" },
    ];

    const project = makeProject("proj-0", "Project Alpha");
    const task = makeTask("task-0", "proj-0");

    const attendanceRecords = [
      makeAttendanceRecord("user-high", "2025-06-01", 12),
      makeAttendanceRecord("user-high", "2025-06-02", 11),
      makeAttendanceRecord("user-low", "2025-06-01", 2),
      makeAttendanceRecord("user-low", "2025-06-02", 3),
    ];

    const result = getTeamAnalytics(
      [makeSessionTask("st-0", "task-0", 1000000, 1003600)],
      [task],
      [project],
      attendanceRecords,
      members,
      [],
      refDate,
    );

    // INVARIANT: no ranking fields exist
    const forbidden = findForbiddenFields(result);
    expect(forbidden).toEqual([]);

    // INVARIANT: heatmap preserves input order (not sorted by hours)
    expect(result.availabilityHeatmap[0].userId).toBe("user-high");
    expect(result.availabilityHeatmap[1].userId).toBe("user-low");
  });
});
