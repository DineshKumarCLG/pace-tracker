import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  filterMicroBreaks,
  MICRO_BREAK_THRESHOLD_SECS,
} from "@/lib/db";
import type { Break } from "@/types";

/**
 * Property 22: Break Visibility Filtering
 *
 * For any break record with duration under 8 minutes (480s), the break is
 * excluded from all user-facing UI. Only breaks ≥ 8 minutes appear in the
 * session timeline and day summary. Active breaks (endTime = null) are
 * always visible regardless of elapsed time.
 *
 * **Validates: Requirement 7.6**
 */

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const breakTypeArb = fc.constantFrom<Break["type"]>(
  "lunch",
  "short",
  "meeting",
  "discarded",
);

const baseTimeArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });

/** A completed break with duration < 480s (micro-break, should be filtered). */
const microBreakArb: fc.Arbitrary<Break> = fc
  .record({
    id: fc.uuid(),
    sessionId: fc.uuid(),
    startTime: baseTimeArb,
    duration: fc.integer({ min: 1, max: MICRO_BREAK_THRESHOLD_SECS - 1 }),
    type: breakTypeArb,
    autoDetected: fc.boolean(),
  })
  .map(({ id, sessionId, startTime, duration, type, autoDetected }) => ({
    id,
    sessionId,
    startTime,
    endTime: startTime + duration,
    type,
    autoDetected,
  }));

/** A completed break with duration >= 480s (visible break). */
const visibleBreakArb: fc.Arbitrary<Break> = fc
  .record({
    id: fc.uuid(),
    sessionId: fc.uuid(),
    startTime: baseTimeArb,
    duration: fc.integer({ min: MICRO_BREAK_THRESHOLD_SECS, max: 7200 }),
    type: breakTypeArb,
    autoDetected: fc.boolean(),
  })
  .map(({ id, sessionId, startTime, duration, type, autoDetected }) => ({
    id,
    sessionId,
    startTime,
    endTime: startTime + duration,
    type,
    autoDetected,
  }));

/** An active break (endTime = null). */
const activeBreakArb: fc.Arbitrary<Break> = fc
  .record({
    id: fc.uuid(),
    sessionId: fc.uuid(),
    startTime: baseTimeArb,
    type: breakTypeArb,
    autoDetected: fc.boolean(),
  })
  .map(({ id, sessionId, startTime, type, autoDetected }) => ({
    id,
    sessionId,
    startTime,
    endTime: null,
    type,
    autoDetected,
  }));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Property 22: Break Visibility Filtering", () => {
  it("breaks under 8 minutes are excluded from the filtered list", () => {
    fc.assert(
      fc.property(
        fc.array(microBreakArb, { minLength: 1, maxLength: 20 }),
        (microBreaks) => {
          const result = filterMicroBreaks(microBreaks);
          expect(result).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("breaks >= 8 minutes are included in the filtered list", () => {
    fc.assert(
      fc.property(
        fc.array(visibleBreakArb, { minLength: 1, maxLength: 20 }),
        (breaks) => {
          const result = filterMicroBreaks(breaks);
          expect(result).toHaveLength(breaks.length);
          for (const b of result) {
            expect(b.endTime! - b.startTime).toBeGreaterThanOrEqual(
              MICRO_BREAK_THRESHOLD_SECS,
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("active breaks (endTime=null) are always included regardless of duration", () => {
    fc.assert(
      fc.property(
        fc.array(activeBreakArb, { minLength: 1, maxLength: 20 }),
        (activeBreaks) => {
          const result = filterMicroBreaks(activeBreaks);
          expect(result).toHaveLength(activeBreaks.length);
          for (const b of result) {
            expect(b.endTime).toBeNull();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("filter preserves order and identity of visible breaks", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(microBreakArb, visibleBreakArb, activeBreakArb),
          { minLength: 0, maxLength: 30 },
        ),
        (breaks) => {
          const result = filterMicroBreaks(breaks);

          // Every returned break must be from the original list (identity)
          const originalIds = new Set(breaks.map((b) => b.id));
          for (const b of result) {
            expect(originalIds.has(b.id)).toBe(true);
          }

          // Order is preserved: indices in original array are strictly increasing
          const resultIds = result.map((b) => b.id);
          const originalIndices = resultIds.map((id) =>
            breaks.findIndex((b) => b.id === id),
          );
          for (let i = 1; i < originalIndices.length; i++) {
            expect(originalIndices[i]).toBeGreaterThan(originalIndices[i - 1]);
          }

          // Every result is either active or >= threshold
          for (const b of result) {
            if (b.endTime != null) {
              expect(b.endTime - b.startTime).toBeGreaterThanOrEqual(
                MICRO_BREAK_THRESHOLD_SECS,
              );
            }
          }

          // No visible break was dropped
          const expectedVisible = breaks.filter(
            (b) =>
              b.endTime == null ||
              b.endTime - b.startTime >= MICRO_BREAK_THRESHOLD_SECS,
          );
          expect(result).toHaveLength(expectedVisible.length);
        },
      ),
      { numRuns: 200 },
    );
  });
});
