import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 8: Temporal Containment
 *
 * For any session_task or break belonging to a session, the child's startTime
 * is greater than or equal to the parent session's startTime, and the child's
 * endTime (when set) is less than or equal to the parent session's endTime.
 * Additionally, for any closed session, endTime is greater than or equal to
 * startTime.
 *
 * **Validates: Requirements 20.3, 20.4, 20.6**
 */

// --- In-memory model enforcing temporal containment ---

interface Session {
  id: string;
  startTime: number;
  endTime: number | null;
}

interface SessionTask {
  id: string;
  sessionId: string;
  startTime: number;
  endTime: number | null;
}

interface Break {
  id: string;
  sessionId: string;
  startTime: number;
  endTime: number | null;
  type: "lunch" | "short" | "meeting" | "discarded";
}

type AddResult = { ok: true } | { ok: false; error: string };

class TemporalManager {
  private sessions: Map<string, Session> = new Map();
  private sessionTasks: SessionTask[] = [];
  private breaks: Break[] = [];

  createSession(session: Session): void {
    this.sessions.set(session.id, session);
  }

  addSessionTask(st: SessionTask): AddResult {
    const session = this.sessions.get(st.sessionId);
    if (!session) return { ok: false, error: "Session not found" };

    // Enforce: child startTime >= parent startTime (Req 20.3)
    if (st.startTime < session.startTime) {
      return { ok: false, error: "session_task startTime before session startTime" };
    }

    // Enforce: child endTime <= parent endTime when both set (Req 20.3)
    if (st.endTime !== null && session.endTime !== null && st.endTime > session.endTime) {
      return { ok: false, error: "session_task endTime after session endTime" };
    }

    this.sessionTasks.push(st);
    return { ok: true };
  }

  addBreak(brk: Break): AddResult {
    const session = this.sessions.get(brk.sessionId);
    if (!session) return { ok: false, error: "Session not found" };

    // Enforce: break startTime >= parent startTime (Req 20.4)
    if (brk.startTime < session.startTime) {
      return { ok: false, error: "break startTime before session startTime" };
    }

    // Enforce: break endTime <= parent endTime when both set (Req 20.4)
    if (brk.endTime !== null && session.endTime !== null && brk.endTime > session.endTime) {
      return { ok: false, error: "break endTime after session endTime" };
    }

    this.breaks.push(brk);
    return { ok: true };
  }

  endSession(sessionId: string, endTime: number): AddResult {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, error: "Session not found" };

    // Enforce: endTime >= startTime (Req 20.6)
    if (endTime < session.startTime) {
      return { ok: false, error: "endTime before startTime" };
    }

    session.endTime = endTime;
    return { ok: true };
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  getSessionTasks(sessionId: string): SessionTask[] {
    return this.sessionTasks.filter((st) => st.sessionId === sessionId);
  }

  getBreaks(sessionId: string): Break[] {
    return this.breaks.filter((b) => b.sessionId === sessionId);
  }
}

// --- Arbitraries ---

const timestampArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });
const durationArb = fc.integer({ min: 60, max: 36000 }); // 1 min to 10 hours
const breakTypeArb = fc.constantFrom<Break["type"]>("lunch", "short", "meeting", "discarded");

describe("Property 8: Temporal Containment", () => {
  it("session_task startTime is always >= parent session startTime", () => {
    fc.assert(
      fc.property(
        timestampArb,
        durationArb,
        fc.integer({ min: 0, max: 35000 }),
        (sessionStart, sessionDuration, taskOffset) => {
          const manager = new TemporalManager();
          const sessionEnd = sessionStart + sessionDuration;

          manager.createSession({
            id: "s1",
            startTime: sessionStart,
            endTime: sessionEnd,
          });

          // Task starts within session bounds
          const taskStart = sessionStart + (taskOffset % sessionDuration);
          const result = manager.addSessionTask({
            id: "st1",
            sessionId: "s1",
            startTime: taskStart,
            endTime: null,
          });

          expect(result.ok).toBe(true);

          // Verify containment
          const tasks = manager.getSessionTasks("s1");
          for (const t of tasks) {
            expect(t.startTime).toBeGreaterThanOrEqual(sessionStart);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("session_task with startTime before session startTime is rejected", () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.integer({ min: 1, max: 7200 }),
        (sessionStart, beforeOffset) => {
          const manager = new TemporalManager();

          manager.createSession({
            id: "s1",
            startTime: sessionStart,
            endTime: sessionStart + 36000,
          });

          // Task starts BEFORE session → should be rejected
          const result = manager.addSessionTask({
            id: "st1",
            sessionId: "s1",
            startTime: sessionStart - beforeOffset,
            endTime: null,
          });

          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("session_task endTime is always <= parent session endTime when both set", () => {
    fc.assert(
      fc.property(
        timestampArb,
        durationArb,
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (sessionStart, sessionDuration, startPct, endPct) => {
          const manager = new TemporalManager();
          const sessionEnd = sessionStart + sessionDuration;

          manager.createSession({
            id: "s1",
            startTime: sessionStart,
            endTime: sessionEnd,
          });

          // Generate task times within session bounds
          const taskStart = sessionStart + Math.floor((startPct / 100) * sessionDuration);
          const taskEnd = taskStart + Math.floor(((endPct / 100) * (sessionEnd - taskStart)));

          const result = manager.addSessionTask({
            id: "st1",
            sessionId: "s1",
            startTime: taskStart,
            endTime: taskEnd,
          });

          expect(result.ok).toBe(true);

          const tasks = manager.getSessionTasks("s1");
          for (const t of tasks) {
            if (t.endTime !== null) {
              expect(t.endTime).toBeLessThanOrEqual(sessionEnd);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("session_task with endTime after session endTime is rejected", () => {
    fc.assert(
      fc.property(
        timestampArb,
        durationArb,
        fc.integer({ min: 1, max: 7200 }),
        (sessionStart, sessionDuration, afterOffset) => {
          const manager = new TemporalManager();
          const sessionEnd = sessionStart + sessionDuration;

          manager.createSession({
            id: "s1",
            startTime: sessionStart,
            endTime: sessionEnd,
          });

          // Task ends AFTER session → should be rejected
          const result = manager.addSessionTask({
            id: "st1",
            sessionId: "s1",
            startTime: sessionStart,
            endTime: sessionEnd + afterOffset,
          });

          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("break startTime is always >= parent session startTime", () => {
    fc.assert(
      fc.property(
        timestampArb,
        durationArb,
        fc.integer({ min: 0, max: 35000 }),
        breakTypeArb,
        (sessionStart, sessionDuration, breakOffset, bType) => {
          const manager = new TemporalManager();
          const sessionEnd = sessionStart + sessionDuration;

          manager.createSession({
            id: "s1",
            startTime: sessionStart,
            endTime: sessionEnd,
          });

          const breakStart = sessionStart + (breakOffset % sessionDuration);
          const result = manager.addBreak({
            id: "b1",
            sessionId: "s1",
            startTime: breakStart,
            endTime: null,
            type: bType,
          });

          expect(result.ok).toBe(true);

          const breaks = manager.getBreaks("s1");
          for (const b of breaks) {
            expect(b.startTime).toBeGreaterThanOrEqual(sessionStart);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("break with startTime before session startTime is rejected", () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.integer({ min: 1, max: 7200 }),
        breakTypeArb,
        (sessionStart, beforeOffset, bType) => {
          const manager = new TemporalManager();

          manager.createSession({
            id: "s1",
            startTime: sessionStart,
            endTime: sessionStart + 36000,
          });

          const result = manager.addBreak({
            id: "b1",
            sessionId: "s1",
            startTime: sessionStart - beforeOffset,
            endTime: null,
            type: bType,
          });

          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("break endTime is always <= parent session endTime when both set", () => {
    fc.assert(
      fc.property(
        timestampArb,
        durationArb,
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        breakTypeArb,
        (sessionStart, sessionDuration, startPct, endPct, bType) => {
          const manager = new TemporalManager();
          const sessionEnd = sessionStart + sessionDuration;

          manager.createSession({
            id: "s1",
            startTime: sessionStart,
            endTime: sessionEnd,
          });

          const breakStart = sessionStart + Math.floor((startPct / 100) * sessionDuration);
          const breakEnd = breakStart + Math.floor(((endPct / 100) * (sessionEnd - breakStart)));

          const result = manager.addBreak({
            id: "b1",
            sessionId: "s1",
            startTime: breakStart,
            endTime: breakEnd,
            type: bType,
          });

          expect(result.ok).toBe(true);

          const breaks = manager.getBreaks("s1");
          for (const b of breaks) {
            if (b.endTime !== null) {
              expect(b.endTime).toBeLessThanOrEqual(sessionEnd);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("for any closed session, endTime >= startTime", () => {
    fc.assert(
      fc.property(
        timestampArb,
        durationArb,
        (sessionStart, duration) => {
          const manager = new TemporalManager();

          manager.createSession({
            id: "s1",
            startTime: sessionStart,
            endTime: null,
          });

          const endTime = sessionStart + duration;
          const result = manager.endSession("s1", endTime);

          expect(result.ok).toBe(true);

          const session = manager.getSession("s1");
          expect(session!.endTime).toBeGreaterThanOrEqual(session!.startTime);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("closing a session with endTime < startTime is rejected", () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.integer({ min: 1, max: 86400 }),
        (sessionStart, beforeOffset) => {
          const manager = new TemporalManager();

          manager.createSession({
            id: "s1",
            startTime: sessionStart,
            endTime: null,
          });

          // endTime before startTime → rejected (Req 20.6)
          const result = manager.endSession("s1", sessionStart - beforeOffset);

          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("mixed session_tasks and breaks all satisfy containment within a session", () => {
    fc.assert(
      fc.property(
        timestampArb,
        durationArb,
        fc.array(
          fc.record({
            type: fc.constantFrom("task" as const, "break" as const),
            startPct: fc.integer({ min: 0, max: 99 }),
            durationPct: fc.integer({ min: 1, max: 50 }),
            breakType: breakTypeArb,
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (sessionStart, sessionDuration, children) => {
          const manager = new TemporalManager();
          const sessionEnd = sessionStart + sessionDuration;

          manager.createSession({
            id: "s1",
            startTime: sessionStart,
            endTime: sessionEnd,
          });

          for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const childStart = sessionStart + Math.floor((child.startPct / 100) * sessionDuration);
            const maxDuration = sessionEnd - childStart;
            const childEnd = childStart + Math.floor((child.durationPct / 100) * maxDuration);

            if (child.type === "task") {
              manager.addSessionTask({
                id: `st-${i}`,
                sessionId: "s1",
                startTime: childStart,
                endTime: childEnd,
              });
            } else {
              manager.addBreak({
                id: `b-${i}`,
                sessionId: "s1",
                startTime: childStart,
                endTime: childEnd,
                type: child.breakType,
              });
            }
          }

          // Verify all children satisfy containment
          const session = manager.getSession("s1")!;
          for (const st of manager.getSessionTasks("s1")) {
            expect(st.startTime).toBeGreaterThanOrEqual(session.startTime);
            if (st.endTime !== null && session.endTime !== null) {
              expect(st.endTime).toBeLessThanOrEqual(session.endTime);
            }
          }
          for (const b of manager.getBreaks("s1")) {
            expect(b.startTime).toBeGreaterThanOrEqual(session.startTime);
            if (b.endTime !== null && session.endTime !== null) {
              expect(b.endTime).toBeLessThanOrEqual(session.endTime);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
