import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 6: Idle Resolution Creates Correct Records
 *
 * For any idle event resolved by the user:
 *   - If resolution is "lunch", "short", or "meeting" → a Break record is
 *     created with type matching the resolution and time range matching the
 *     idle period (startTime = idle start, endTime = return time).
 *   - If resolution is "discarded" → no Break record is created, and the
 *     idle gap is excluded from session time.
 *   - Exactly one outcome occurs per resolution (no double records).
 *
 * **Validates: Requirements 5.4, 5.5**
 */

// ---------------------------------------------------------------------------
// In-memory model mirroring the idle resolution logic
// ---------------------------------------------------------------------------

type BreakType = "lunch" | "short" | "meeting" | "discarded";

interface Break {
  id: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  type: BreakType;
  autoDetected: boolean;
}

interface IdleEvent {
  id: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  resolution: BreakType;
}

interface ResolutionOutcome {
  breakRecord: Break | null;
  idleEvent: IdleEvent;
  excludedGapSecs: number; // seconds excluded from session time
}

/**
 * Pure function modelling the idle resolution logic from IdleModal / Session Manager.
 *
 * When the user returns from an idle period and picks a resolution:
 *   - lunch/short/meeting → create a Break record with matching type
 *   - discarded → no Break, gap excluded from session time
 */
function resolveIdleEvent(
  sessionId: string,
  idleStart: number,
  returnTime: number,
  resolution: BreakType,
): ResolutionOutcome {
  const idleEvent: IdleEvent = {
    id: `idle-${idleStart}`,
    sessionId,
    startTime: idleStart,
    endTime: returnTime,
    resolution,
  };

  if (resolution === "discarded") {
    // Req 5.5: no break record, gap excluded from session time
    return {
      breakRecord: null,
      idleEvent,
      excludedGapSecs: returnTime - idleStart,
    };
  }

  // Req 5.4: create break record with matching type and idle time range
  const breakRecord: Break = {
    id: `break-${idleStart}`,
    sessionId,
    startTime: idleStart,
    endTime: returnTime,
    type: resolution,
    autoDetected: true,
  };

  return {
    breakRecord,
    idleEvent,
    excludedGapSecs: 0,
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const timestampArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });

/** Idle periods are ≥ 20 min (1200s) since that's the threshold for the modal */
const awayDurationArb = fc.integer({ min: 1200, max: 4 * 3600 });

const breakResolutionArb = fc.constantFrom(
  "lunch" as const,
  "short" as const,
  "meeting" as const,
);

const discardResolutionArb = fc.constant("discarded" as const);

const anyResolutionArb = fc.constantFrom(
  "lunch" as const,
  "short" as const,
  "meeting" as const,
  "discarded" as const,
);

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("Property 6: Idle Resolution Creates Correct Records", () => {
  // -----------------------------------------------------------------------
  // lunch/short/meeting → break record created with matching type & range
  // -----------------------------------------------------------------------
  it("lunch/short/meeting resolution creates a break record with matching type and time range", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        timestampArb,
        awayDurationArb,
        breakResolutionArb,
        (sessionId, idleStart, awayDuration, resolution) => {
          const returnTime = idleStart + awayDuration;

          const outcome = resolveIdleEvent(sessionId, idleStart, returnTime, resolution);

          // Break record MUST exist
          expect(outcome.breakRecord).not.toBeNull();
          const br = outcome.breakRecord!;

          // Type matches the resolution
          expect(br.type).toBe(resolution);

          // Time range matches the idle period
          expect(br.startTime).toBe(idleStart);
          expect(br.endTime).toBe(returnTime);

          // Break belongs to the correct session
          expect(br.sessionId).toBe(sessionId);

          // Auto-detected since it came from idle detection
          expect(br.autoDetected).toBe(true);

          // No gap excluded from session time (break accounts for it)
          expect(outcome.excludedGapSecs).toBe(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  // -----------------------------------------------------------------------
  // discard → no break record, gap excluded from session time
  // -----------------------------------------------------------------------
  it("discard resolution creates no break record and excludes gap from session time", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        timestampArb,
        awayDurationArb,
        (sessionId, idleStart, awayDuration) => {
          const returnTime = idleStart + awayDuration;

          const outcome = resolveIdleEvent(
            sessionId,
            idleStart,
            returnTime,
            "discarded",
          );

          // No break record
          expect(outcome.breakRecord).toBeNull();

          // Gap is excluded from session time
          expect(outcome.excludedGapSecs).toBe(awayDuration);

          // Idle event still recorded with discarded resolution
          expect(outcome.idleEvent.resolution).toBe("discarded");
          expect(outcome.idleEvent.startTime).toBe(idleStart);
          expect(outcome.idleEvent.endTime).toBe(returnTime);
        },
      ),
      { numRuns: 300 },
    );
  });

  // -----------------------------------------------------------------------
  // Exactly one outcome per resolution (no double records)
  // -----------------------------------------------------------------------
  it("exactly one outcome per resolution — either a break record or an excluded gap, never both", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        timestampArb,
        awayDurationArb,
        anyResolutionArb,
        (sessionId, idleStart, awayDuration, resolution) => {
          const returnTime = idleStart + awayDuration;

          const outcome = resolveIdleEvent(sessionId, idleStart, returnTime, resolution);

          const hasBreak = outcome.breakRecord !== null;
          const hasExcludedGap = outcome.excludedGapSecs > 0;

          // Exactly one of these is true — mutual exclusivity
          expect(hasBreak !== hasExcludedGap).toBe(true);

          // Idle event is always created regardless of resolution
          expect(outcome.idleEvent).not.toBeNull();
          expect(outcome.idleEvent.resolution).toBe(resolution);
        },
      ),
      { numRuns: 300 },
    );
  });

  // -----------------------------------------------------------------------
  // Idle event is always recorded with correct fields regardless of resolution
  // -----------------------------------------------------------------------
  it("idle event is always recorded with correct session, time range, and resolution", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        timestampArb,
        awayDurationArb,
        anyResolutionArb,
        (sessionId, idleStart, awayDuration, resolution) => {
          const returnTime = idleStart + awayDuration;

          const outcome = resolveIdleEvent(sessionId, idleStart, returnTime, resolution);

          expect(outcome.idleEvent.sessionId).toBe(sessionId);
          expect(outcome.idleEvent.startTime).toBe(idleStart);
          expect(outcome.idleEvent.endTime).toBe(returnTime);
          expect(outcome.idleEvent.resolution).toBe(resolution);
        },
      ),
      { numRuns: 200 },
    );
  });

  // -----------------------------------------------------------------------
  // Break record type is always one of the valid break types
  // -----------------------------------------------------------------------
  it("when a break record is created, its type is a valid break type matching the resolution", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        timestampArb,
        awayDurationArb,
        breakResolutionArb,
        (sessionId, idleStart, awayDuration, resolution) => {
          const returnTime = idleStart + awayDuration;

          const outcome = resolveIdleEvent(sessionId, idleStart, returnTime, resolution);

          const validTypes = ["lunch", "short", "meeting"];
          expect(validTypes).toContain(outcome.breakRecord!.type);
          expect(outcome.breakRecord!.type).toBe(resolution);
        },
      ),
      { numRuns: 200 },
    );
  });
});
