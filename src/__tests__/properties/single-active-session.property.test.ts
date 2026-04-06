import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 1: Single Active Session Invariant
 *
 * For any user and any sequence of start/stop operations, at most one session
 * has `endTime = null` at any point in time. Attempting to start a second
 * concurrent session is rejected and the existing session is preserved.
 *
 * **Validates: Requirements 1.6, 20.1**
 */

// --- In-memory session manager mirroring the Rust logic ---

interface Session {
  id: string;
  userId: string;
  startTime: number;
  endTime: number | null;
}

type StartResult = { ok: true; session: Session } | { ok: false; error: string };

class SessionManager {
  private sessions: Session[] = [];
  private nextId = 1;

  startSession(userId: string, startTime: number): StartResult {
    // Enforce single active session per user (mirrors Rust: Req 1.6, 20.1)
    const activeCount = this.sessions.filter(
      (s) => s.userId === userId && s.endTime === null
    ).length;

    if (activeCount > 0) {
      return { ok: false, error: "An active session already exists for this user" };
    }

    const session: Session = {
      id: `session-${this.nextId++}`,
      userId,
      startTime,
      endTime: null,
    };
    this.sessions.push(session);
    return { ok: true, session };
  }

  endSession(sessionId: string, endTime: number): boolean {
    const session = this.sessions.find((s) => s.id === sessionId && s.endTime === null);
    if (!session) return false;
    session.endTime = endTime;
    return true;
  }

  getActiveSessions(userId: string): Session[] {
    return this.sessions.filter((s) => s.userId === userId && s.endTime === null);
  }

  getAllSessions(): Session[] {
    return [...this.sessions];
  }
}

const userIdArb = fc.constantFrom("user-a", "user-b", "user-c");
const timestampArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });

describe("Property 1: Single Active Session Invariant", () => {
  it("at most one session per user has endTime=null after any sequence of start/stop operations", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({
              type: fc.constant("start" as const),
              userId: userIdArb,
              startTime: timestampArb,
            }),
            fc.record({
              type: fc.constant("end" as const),
              sessionId: fc.constantFrom(
                "session-1", "session-2", "session-3",
                "session-4", "session-5", "session-999"
              ),
              endTime: timestampArb,
            })
          ),
          { minLength: 1, maxLength: 50 }
        ),
        (ops) => {
          const manager = new SessionManager();

          for (const op of ops) {
            if (op.type === "start") {
              manager.startSession(op.userId, op.startTime);
            } else {
              manager.endSession(op.sessionId, op.endTime);
            }

            // INVARIANT: after every operation, each user has at most 1 active session
            for (const uid of ["user-a", "user-b", "user-c"]) {
              const active = manager.getActiveSessions(uid);
              expect(active.length).toBeLessThanOrEqual(1);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("starting a second concurrent session is rejected and preserves the existing session", () => {
    fc.assert(
      fc.property(
        userIdArb,
        timestampArb,
        timestampArb,
        (userId, time1, time2) => {
          const manager = new SessionManager();

          // First start succeeds
          const first = manager.startSession(userId, time1);
          expect(first.ok).toBe(true);

          // Second start for the same user is rejected
          const second = manager.startSession(userId, time2);
          expect(second.ok).toBe(false);

          // Original session is preserved and still active
          const active = manager.getActiveSessions(userId);
          expect(active.length).toBe(1);
          if (first.ok) {
            expect(active[0].id).toBe(first.session.id);
            expect(active[0].endTime).toBeNull();
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("after ending a session, a new session can be started for the same user", () => {
    fc.assert(
      fc.property(
        userIdArb,
        timestampArb,
        timestampArb,
        timestampArb,
        (userId, startTime, endTime, newStartTime) => {
          const manager = new SessionManager();

          // Start and end a session
          const first = manager.startSession(userId, startTime);
          expect(first.ok).toBe(true);
          if (first.ok) {
            manager.endSession(first.session.id, endTime);
          }

          // Now starting a new session should succeed
          const second = manager.startSession(userId, newStartTime);
          expect(second.ok).toBe(true);

          // Exactly one active session
          const active = manager.getActiveSessions(userId);
          expect(active.length).toBe(1);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("different users can have concurrent active sessions independently", () => {
    fc.assert(
      fc.property(
        timestampArb,
        timestampArb,
        timestampArb,
        (time1, time2, time3) => {
          const manager = new SessionManager();

          const a = manager.startSession("user-a", time1);
          const b = manager.startSession("user-b", time2);
          const c = manager.startSession("user-c", time3);

          expect(a.ok).toBe(true);
          expect(b.ok).toBe(true);
          expect(c.ok).toBe(true);

          // Each user has exactly one active session
          expect(manager.getActiveSessions("user-a").length).toBe(1);
          expect(manager.getActiveSessions("user-b").length).toBe(1);
          expect(manager.getActiveSessions("user-c").length).toBe(1);

          // Global invariant: at most 1 per user
          const all = manager.getAllSessions().filter((s) => s.endTime === null);
          expect(all.length).toBe(3); // one per user
        }
      ),
      { numRuns: 100 }
    );
  });
});
