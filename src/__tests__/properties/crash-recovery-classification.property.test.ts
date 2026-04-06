import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { isSessionStale } from "@/lib/db";
import type { Session } from "@/types";

/**
 * Property 3: Crash Recovery Classification
 *
 * For any app launch with a session where `endTime = null`:
 * if `lastHeartbeat` > 30s ago → recovery-needed (stale);
 * if within 30s → resume (not stale).
 * Classification determined solely by heartbeat age.
 *
 * **Validates: Requirements 2.2, 2.4**
 */

// --- Helpers ---

/** Build a minimal open session (endTime = null) with the given lastHeartbeat. */
function makeOpenSession(lastHeartbeat: number | null): Session {
  return {
    id: "session-1",
    userId: "user-1",
    startTime: 1_700_000_000,
    endTime: null,
    startType: "manual",
    startVerified: true,
    outputNote: null,
    lastHeartbeat,
    syncedAt: null,
    createdAt: 1_700_000_000,
  };
}

// --- Arbitraries ---

const nowArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });

describe("Property 3: Crash Recovery Classification", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lastHeartbeat > 30s ago → stale (recovery-needed)", () => {
    fc.assert(
      fc.property(
        nowArb,
        // heartbeat age: 31s to 7 days ago
        fc.integer({ min: 31, max: 7 * 86400 }),
        (now, ageSeconds) => {
          vi.setSystemTime(now * 1000); // Date.now() returns ms
          const lastHeartbeat = now - ageSeconds;
          const session = makeOpenSession(lastHeartbeat);

          expect(isSessionStale(session)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("lastHeartbeat within 30s → not stale (resume)", () => {
    fc.assert(
      fc.property(
        nowArb,
        // heartbeat age: 0 to 30s ago
        fc.integer({ min: 0, max: 30 }),
        (now, ageSeconds) => {
          vi.setSystemTime(now * 1000);
          const lastHeartbeat = now - ageSeconds;
          const session = makeOpenSession(lastHeartbeat);

          expect(isSessionStale(session)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("classification depends solely on heartbeat age, not on other session fields", () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.integer({ min: 0, max: 7 * 86400 }), // heartbeat age
        fc.string(),                               // arbitrary userId
        fc.integer({ min: 1_600_000_000, max: 1_800_000_000 }), // arbitrary startTime
        fc.constantFrom("manual", "backfill", "recovered") as fc.Arbitrary<"manual" | "backfill" | "recovered">,
        fc.boolean(),                              // startVerified
        fc.option(fc.string(), { nil: null }),     // outputNote
        (now, ageSeconds, userId, startTime, startType, startVerified, outputNote) => {
          vi.setSystemTime(now * 1000);
          const lastHeartbeat = now - ageSeconds;

          const session: Session = {
            id: "session-varied",
            userId,
            startTime,
            endTime: null,
            startType,
            startVerified,
            outputNote,
            lastHeartbeat,
            syncedAt: null,
            createdAt: startTime,
          };

          const expected = ageSeconds > 30;
          expect(isSessionStale(session)).toBe(expected);
        }
      ),
      { numRuns: 300 }
    );
  });

  it("null lastHeartbeat → always stale", () => {
    fc.assert(
      fc.property(
        nowArb,
        (now) => {
          vi.setSystemTime(now * 1000);
          const session = makeOpenSession(null);

          expect(isSessionStale(session)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });
});
