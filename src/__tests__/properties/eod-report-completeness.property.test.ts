import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateEndOfDayReport } from "@/lib/reports";
import type { Session, SessionTask, Break, GitEvent, Task } from "@/types";

/**
 * Property 24: End-of-day report completeness
 *
 * For any closed session with associated session_tasks, breaks,
 * and git_events, the generated end-of-day report should contain:
 * total session minutes, one entry per task with minutes, one entry per
 * break with type and minutes, the session's output note, and one entry
 * per git commit.
 *
 * **Validates: Requirements 11.1, 11.2**
 */

// --- Arbitraries ---

const timestampArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });
const sessionDurationArb = fc.integer({ min: 1800, max: 43200 }); // 30min–12h
const breakTypeArb = fc.constantFrom<Break["type"]>("lunch", "short", "meeting", "discarded");

function sessionArb(): fc.Arbitrary<Session> {
  return fc
    .record({
      id: fc.uuid(),
      userId: fc.uuid(),
      startTime: timestampArb,
      duration: sessionDurationArb,
      outputNote: fc.option(fc.string({ minLength: 1, maxLength: 80 }), { nil: null }),
    })
    .map(({ id, userId, startTime, duration, outputNote }) => ({
      id,
      userId,
      startTime,
      endTime: startTime + duration,
      startType: "manual" as const,
      startVerified: true,
      outputNote,
      lastHeartbeat: null,
      syncedAt: null,
      createdAt: startTime,
    }));
}

function closedSessionTaskArb(
  sessionId: string,
  sessionStart: number,
  sessionEnd: number,
): fc.Arbitrary<SessionTask> {
  const range = Math.max(sessionEnd - sessionStart - 60, 1);
  return fc
    .record({
      id: fc.uuid(),
      taskId: fc.uuid(),
      startOffset: fc.integer({ min: 0, max: range - 1 }),
      duration: fc.integer({ min: 60, max: Math.min(3600, range) }),
    })
    .map(({ id, taskId, startOffset, duration }) => ({
      id,
      sessionId,
      taskId,
      startTime: sessionStart + startOffset,
      endTime: Math.min(sessionStart + startOffset + duration, sessionEnd),
    }));
}

function closedBreakArb(
  sessionId: string,
  sessionStart: number,
  sessionEnd: number,
): fc.Arbitrary<Break> {
  const range = Math.max(sessionEnd - sessionStart - 60, 1);
  return fc
    .record({
      id: fc.uuid(),
      type: breakTypeArb,
      startOffset: fc.integer({ min: 0, max: range - 1 }),
      duration: fc.integer({ min: 60, max: Math.min(3600, range) }),
    })
    .map(({ id, type, startOffset, duration }) => ({
      id,
      sessionId,
      startTime: sessionStart + startOffset,
      endTime: Math.min(sessionStart + startOffset + duration, sessionEnd),
      type,
      autoDetected: false,
    }));
}

function gitEventArb(sessionId: string, userId: string): fc.Arbitrary<GitEvent> {
  return fc
    .record({
      id: fc.uuid(),
      commitHash: fc.hexaString({ minLength: 7, maxLength: 40 }),
      message: fc.option(fc.string({ minLength: 1, maxLength: 80 }), { nil: null }),
    })
    .map(({ id, commitHash, message }) => ({
      id,
      sessionId,
      userId,
      repoPath: "/repo",
      commitHash,
      message,
      commitTime: 1_700_000_000,
    }));
}

function taskArb(taskId: string): fc.Arbitrary<Task> {
  return fc.string({ minLength: 1, maxLength: 60 }).map((title) => ({
    id: taskId,
    projectId: "proj-1",
    title,
    status: "done" as const,
    assigneeId: null,
    priority: "medium" as const,
    dueDate: null,
    estimatedMinutes: null,
    notes: null,
    createdBy: "user-1",
    createdAt: 1_700_000_000,
    closedAt: null,
  }));
}

// --- Property Tests ---

describe("Property 24: End-of-day report completeness", () => {
  it("report always has userId, sessionId, date, and createdAt fields", () => {
    fc.assert(
      fc.property(sessionArb(), (session) => {
        const report = generateEndOfDayReport(
          "report-id",
          session,
          [],
          [],
          [],
          {},
        );

        expect(report.userId).toBe(session.userId);
        expect(report.sessionId).toBe(session.id);
        expect(report.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(report.createdAt).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it("totalMinutes is always >= 0", () => {
    fc.assert(
      fc.property(
        sessionArb(),
        fc.integer({ min: 0, max: 5 }),
        (session, breakCount) => {
          const sessionEnd = session.endTime!;
          const breaks: Break[] = [];
          // Generate breaks that may even exceed session duration
          for (let i = 0; i < breakCount; i++) {
            breaks.push({
              id: `b-${i}`,
              sessionId: session.id,
              startTime: session.startTime,
              endTime: sessionEnd + i * 600, // some may exceed session
              type: "short",
              autoDetected: false,
            });
          }

          const report = generateEndOfDayReport(
            "report-id",
            session,
            [],
            breaks,
            [],
            {},
          );

          expect(report.totalMinutes).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("tasksWorked is never empty — has 'No tasks logged' placeholder when no tasks", () => {
    fc.assert(
      fc.property(
        sessionArb(),
        fc.boolean(),
        (session, hasTasks) => {
          const sessionEnd = session.endTime!;

          if (hasTasks) {
            // With closed session tasks
            const st: SessionTask = {
              id: "st-1",
              sessionId: session.id,
              taskId: "task-1",
              startTime: session.startTime,
              endTime: Math.min(session.startTime + 3600, sessionEnd),
            };
            const tasksById: Record<string, Task> = {
              "task-1": {
                id: "task-1",
                projectId: "p1",
                title: "Some task",
                status: "done",
                assigneeId: null,
                priority: "medium",
                dueDate: null,
                estimatedMinutes: null,
                notes: null,
                createdBy: "u1",
                createdAt: 1_700_000_000,
                closedAt: null,
              },
            };

            const report = generateEndOfDayReport(
              "report-id",
              session,
              [st],
              [],
              [],
              tasksById,
            );

            expect(report.tasksWorked.length).toBeGreaterThanOrEqual(1);
            expect(report.tasksWorked[0].title).not.toBe("No tasks logged");
          } else {
            // No session tasks → placeholder
            const report = generateEndOfDayReport(
              "report-id",
              session,
              [],
              [],
              [],
              {},
            );

            expect(report.tasksWorked).toHaveLength(1);
            expect(report.tasksWorked[0].title).toBe("No tasks logged");
            expect(report.tasksWorked[0].minutes).toBe(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("breaks count matches closed break count", () => {
    fc.assert(
      fc.property(
        sessionArb(),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 4 }),
        (session, closedCount, openCount) => {
          const sessionEnd = session.endTime!;
          const breaks: Break[] = [];

          // Closed breaks
          for (let i = 0; i < closedCount; i++) {
            breaks.push({
              id: `closed-${i}`,
              sessionId: session.id,
              startTime: session.startTime + i * 600,
              endTime: Math.min(session.startTime + i * 600 + 300, sessionEnd),
              type: i % 2 === 0 ? "short" : "lunch",
              autoDetected: false,
            });
          }

          // Open breaks (endTime === null) — should be excluded
          for (let i = 0; i < openCount; i++) {
            breaks.push({
              id: `open-${i}`,
              sessionId: session.id,
              startTime: session.startTime + 100,
              endTime: null,
              type: "short",
              autoDetected: false,
            });
          }

          const report = generateEndOfDayReport(
            "report-id",
            session,
            [],
            breaks,
            [],
            {},
          );

          expect(report.breaks).toHaveLength(closedCount);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("gitCommits count matches git event input count", () => {
    fc.assert(
      fc.property(
        sessionArb(),
        fc.integer({ min: 0, max: 10 }),
        (session, commitCount) => {
          const gitEvents: GitEvent[] = [];
          for (let i = 0; i < commitCount; i++) {
            gitEvents.push({
              id: `g-${i}`,
              sessionId: session.id,
              userId: session.userId,
              repoPath: "/repo",
              commitHash: `hash${i}`,
              message: `commit ${i}`,
              commitTime: session.startTime + i * 60,
            });
          }

          const report = generateEndOfDayReport(
            "report-id",
            session,
            [],
            [],
            gitEvents,
            {},
          );

          expect(report.gitCommits).toHaveLength(commitCount);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("report date matches session start date", () => {
    fc.assert(
      fc.property(sessionArb(), (session) => {
        const report = generateEndOfDayReport(
          "report-id",
          session,
          [],
          [],
          [],
          {},
        );

        // Derive expected date from session.startTime
        const d = new Date(session.startTime * 1000);
        const expectedDate = [
          d.getUTCFullYear(),
          String(d.getUTCMonth() + 1).padStart(2, "0"),
          String(d.getUTCDate()).padStart(2, "0"),
        ].join("-");

        expect(report.date).toBe(expectedDate);
      }),
      { numRuns: 200 },
    );
  });
});
