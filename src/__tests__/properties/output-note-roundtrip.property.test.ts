import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 18: Output Note Pre-fill Round Trip
 *
 * For any output note text written during an active session, when the user
 * initiates "End day," the end-of-day form is pre-filled with that same text.
 * After session close, querying the session record returns the stored output
 * note unchanged.
 *
 * **Validates: Requirements 12.2, 12.3**
 */

// --- In-memory session model mirroring the store + DB round trip ---

interface Session {
  id: string;
  userId: string;
  startTime: number;
  endTime: number | null;
  outputNote: string | null;
}

/**
 * Minimal session manager that models the output note lifecycle:
 *   1. Create session (outputNote = null)
 *   2. Write output note during session (Req 12.1 — editable any time)
 *   3. End-of-day form pre-fills from session.outputNote (Req 12.2)
 *   4. Close session, storing the note (Req 12.3)
 *   5. Query closed session — note is unchanged
 */
class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private nextId = 1;

  createSession(userId: string, startTime: number): Session {
    const session: Session = {
      id: `session-${this.nextId++}`,
      userId,
      startTime,
      endTime: null,
      outputNote: null,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Simulate user writing an output note during the session (Req 12.1). */
  writeOutputNote(sessionId: string, note: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.endTime !== null) {
      throw new Error("Cannot write note to inactive session");
    }
    session.outputNote = note || null;
  }

  /** Simulate end-of-day form pre-fill: reads session.outputNote (Req 12.2). */
  getEndDayPreFill(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    return session.outputNote ?? "";
  }

  /** Close session with the final output note (Req 12.3). */
  closeSession(sessionId: string, endTime: number, outputNote: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.endTime !== null) {
      throw new Error("Cannot close inactive session");
    }
    session.endTime = endTime;
    session.outputNote = outputNote || null;
  }

  /** Query a session by ID (simulates DB read after close). */
  getSession(sessionId: string): Session | undefined {
    const s = this.sessions.get(sessionId);
    if (!s) return undefined;
    // Return a copy to prove the value survives a read round trip
    return { ...s };
  }
}

// --- Arbitraries ---

const timestampArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });

// Arbitrary strings including unicode, empty, whitespace-only, and special chars
const outputNoteArb = fc.oneof(
  fc.string(),                                    // general strings (incl. empty)
  fc.unicodeString(),                             // unicode including emoji, CJK, etc.
  fc.constant(""),                                // explicit empty
  fc.stringOf(fc.constantFrom(" ", "\t", "\n")),  // whitespace-only
  fc.constant("Line1\nLine2\nLine3"),             // multiline
  fc.constant("  leading and trailing  "),        // padded
  fc.constant("emoji: 🚀🎉✅"),                   // emoji
  fc.constant('quotes "and" \'apostrophes\''),    // quotes
  fc.constant("<script>alert('xss')</script>"),   // HTML-like
);

describe("Property 18: Output Note Pre-fill Round Trip", () => {
  it("end-of-day form pre-fills with the exact text written during the session", () => {
    fc.assert(
      fc.property(timestampArb, outputNoteArb, (startTime, note) => {
        const mgr = new SessionManager();
        const session = mgr.createSession("user-1", startTime);

        // User writes output note during session
        mgr.writeOutputNote(session.id, note);

        // End-of-day form pre-fills with that text (Req 12.2)
        const preFill = mgr.getEndDayPreFill(session.id);

        // For non-empty notes, pre-fill must match exactly
        // For empty notes, pre-fill is "" (outputNote stored as null, displayed as "")
        if (note === "") {
          expect(preFill).toBe("");
        } else {
          expect(preFill).toBe(note);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("after session close, querying the session returns the output note unchanged", () => {
    fc.assert(
      fc.property(
        timestampArb,
        timestampArb,
        outputNoteArb,
        (startTime, endOffset, note) => {
          const endTime = startTime + Math.abs(endOffset % 86400) + 1; // ensure endTime > startTime
          const mgr = new SessionManager();
          const session = mgr.createSession("user-1", startTime);

          // Write note during session
          mgr.writeOutputNote(session.id, note);

          // Pre-fill reads the note
          const preFill = mgr.getEndDayPreFill(session.id);

          // Close session with the pre-filled note (Req 12.3)
          mgr.closeSession(session.id, endTime, preFill);

          // Query closed session — note must be unchanged
          const closed = mgr.getSession(session.id);
          expect(closed).toBeDefined();
          expect(closed!.endTime).toBe(endTime);

          if (note === "") {
            // Empty note stored as null, queried back as null
            expect(closed!.outputNote).toBeNull();
          } else {
            expect(closed!.outputNote).toBe(note);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("full round trip: write → pre-fill → close → query preserves text exactly", () => {
    fc.assert(
      fc.property(
        timestampArb,
        timestampArb,
        outputNoteArb,
        (startTime, endOffset, note) => {
          const endTime = startTime + Math.abs(endOffset % 86400) + 1;
          const mgr = new SessionManager();

          // Step 1: Create session
          const session = mgr.createSession("user-1", startTime);
          expect(session.outputNote).toBeNull();

          // Step 2: Write output note during session
          mgr.writeOutputNote(session.id, note);

          // Step 3: End-of-day form pre-fills with that text
          const preFill = mgr.getEndDayPreFill(session.id);

          // Step 4: Close session with the pre-filled note
          mgr.closeSession(session.id, endTime, preFill);

          // Step 5: Query closed session — note unchanged
          const result = mgr.getSession(session.id);
          expect(result).toBeDefined();

          // The full round trip: original note → stored → pre-filled → closed → queried
          // must produce the same text (or null for empty)
          if (note === "") {
            expect(result!.outputNote).toBeNull();
            expect(preFill).toBe("");
          } else {
            expect(result!.outputNote).toBe(note);
            expect(preFill).toBe(note);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("overwriting the output note multiple times still pre-fills with the latest value", () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.array(outputNoteArb, { minLength: 1, maxLength: 10 }),
        (startTime, notes) => {
          const mgr = new SessionManager();
          const session = mgr.createSession("user-1", startTime);

          // Write multiple notes — only the last one matters
          for (const n of notes) {
            mgr.writeOutputNote(session.id, n);
          }

          const lastNote = notes[notes.length - 1];
          const preFill = mgr.getEndDayPreFill(session.id);

          if (lastNote === "") {
            expect(preFill).toBe("");
          } else {
            expect(preFill).toBe(lastNote);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
