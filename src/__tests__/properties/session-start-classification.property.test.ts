import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 2: Session Start Classification
 *
 * For any claimed start time: if earlier than now but within 4 hours →
 * `startType = "backfill"`; if earlier than device wake time →
 * `startVerified = false`. Both may apply simultaneously.
 *
 * **Validates: Requirements 1.2, 1.3**
 */

// --- Pure classification function mirroring Rust start_session logic ---

interface ClassificationResult {
  ok: true;
  startType: "manual" | "backfill";
  startVerified: boolean;
}

interface ClassificationError {
  ok: false;
  error: string;
}

type ClassifyResult = ClassificationResult | ClassificationError;

function classifySessionStart(
  claimedStartTime: number,
  now: number,
  deviceWakeTime: number
): ClassifyResult {
  // Reject future start times
  if (claimedStartTime > now) {
    return { ok: false, error: "Claimed start time cannot be in the future" };
  }

  // Reject start times more than 4 hours in the past
  const fourHours = 4 * 60 * 60;
  if (now - claimedStartTime > fourHours) {
    return { ok: false, error: "Claimed start time cannot be more than 4 hours in the past" };
  }

  // Determine startType (Req 1.2): backfill if >60s before now
  const startType = claimedStartTime < now - 60 ? "backfill" : "manual";

  // Determine startVerified (Req 1.3): false if before device wake time
  const startVerified = claimedStartTime >= deviceWakeTime;

  return { ok: true, startType, startVerified };
}

// --- Arbitraries ---

const baseTimestamp = 1_700_000_000; // ~Nov 2023
const nowArb = fc.integer({ min: baseTimestamp, max: baseTimestamp + 86400 });
const fourHours = 4 * 60 * 60;

describe("Property 2: Session Start Classification", () => {
  it("claimed start >60s before now is classified as backfill", () => {
    fc.assert(
      fc.property(
        nowArb,
        // offset: 61s to 4h before now
        fc.integer({ min: 61, max: fourHours }),
        fc.integer({ min: 0, max: 7200 }), // device wake offset from now
        (now, offset, wakeOffset) => {
          const claimedStartTime = now - offset;
          const deviceWakeTime = now - wakeOffset;
          const result = classifySessionStart(claimedStartTime, now, deviceWakeTime);

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.startType).toBe("backfill");
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("claimed start within 60s of now is classified as manual", () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.integer({ min: 0, max: 60 }), // 0 to 60s before now
        fc.integer({ min: 0, max: 7200 }),
        (now, offset, wakeOffset) => {
          const claimedStartTime = now - offset;
          const deviceWakeTime = now - wakeOffset;
          const result = classifySessionStart(claimedStartTime, now, deviceWakeTime);

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.startType).toBe("manual");
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("claimed start before device wake time sets startVerified = false", () => {
    fc.assert(
      fc.property(
        nowArb,
        // claimed start within valid range (0 to 4h before now)
        fc.integer({ min: 0, max: fourHours }),
        (now, claimedOffset) => {
          const claimedStartTime = now - claimedOffset;
          // Device woke AFTER the claimed start (so claimed is unverifiable)
          const deviceWakeTime = claimedStartTime + 1;

          const result = classifySessionStart(claimedStartTime, now, deviceWakeTime);

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.startVerified).toBe(false);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("claimed start at or after device wake time sets startVerified = true", () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.integer({ min: 0, max: fourHours }),
        (now, claimedOffset) => {
          const claimedStartTime = now - claimedOffset;
          // Device woke BEFORE or AT the claimed start
          const deviceWakeTime = claimedStartTime;

          const result = classifySessionStart(claimedStartTime, now, deviceWakeTime);

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.startVerified).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("both backfill and unverified can apply simultaneously", () => {
    fc.assert(
      fc.property(
        nowArb,
        // offset >60s to make it backfill
        fc.integer({ min: 61, max: fourHours }),
        (now, offset) => {
          const claimedStartTime = now - offset;
          // Device woke after claimed start → unverified
          const deviceWakeTime = claimedStartTime + 30;

          const result = classifySessionStart(claimedStartTime, now, deviceWakeTime);

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.startType).toBe("backfill");
            expect(result.startVerified).toBe(false);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("rejects claimed start time in the future", () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.integer({ min: 1, max: 86400 }), // 1s to 24h in the future
        (now, futureOffset) => {
          const claimedStartTime = now + futureOffset;
          const deviceWakeTime = now - 3600;

          const result = classifySessionStart(claimedStartTime, now, deviceWakeTime);

          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("rejects claimed start time more than 4 hours in the past", () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.integer({ min: fourHours + 1, max: fourHours + 86400 }),
        (now, pastOffset) => {
          const claimedStartTime = now - pastOffset;
          const deviceWakeTime = now - 3600;

          const result = classifySessionStart(claimedStartTime, now, deviceWakeTime);

          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("startType and startVerified are independent dimensions", () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.integer({ min: 0, max: fourHours }),
        fc.integer({ min: 0, max: fourHours + 3600 }),
        (now, claimedOffset, wakeOffset) => {
          const claimedStartTime = now - claimedOffset;
          const deviceWakeTime = now - wakeOffset;

          const result = classifySessionStart(claimedStartTime, now, deviceWakeTime);

          expect(result.ok).toBe(true);
          if (result.ok) {
            // startType depends only on (now - claimedStartTime) vs 60s threshold
            const expectedType = claimedOffset > 60 ? "backfill" : "manual";
            expect(result.startType).toBe(expectedType);

            // startVerified depends only on claimedStartTime vs deviceWakeTime
            const expectedVerified = claimedStartTime >= deviceWakeTime;
            expect(result.startVerified).toBe(expectedVerified);
          }
        }
      ),
      { numRuns: 300 }
    );
  });
});
