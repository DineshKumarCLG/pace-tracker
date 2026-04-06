import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeOutputConsistency } from "@/lib/analytics";
import type { AttendanceRecord } from "@/types";

/**
 * Property 19: Output consistency computation
 *
 * For any user and 4-week window of daily session hours, the output consistency
 * metric should equal the standard deviation of the daily hours values.
 *
 * **Validates: Requirements 9.5**
 */

// --- Helpers ---

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

function dateStr(dayOffset: number): string {
  const base = new Date(2025, 5, 1); // June 1, 2025
  base.setDate(base.getDate() + dayOffset);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, "0");
  const d = String(base.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Compute population standard deviation manually for verification */
function stdDev(values: number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / values.length;
  return Math.sqrt(variance);
}

// --- Arbitraries ---

const hoursArb = fc.double({ min: 0, max: 24, noNaN: true, noDefaultInfinity: true });

const recordsArb = (minLen: number) =>
  fc
    .array(hoursArb, { minLength: minLen, maxLength: 28 })
    .map((hoursList) =>
      hoursList.map((h, i) => makeAttendanceRecord("user-1", dateStr(i), h)),
    );

// --- Property Tests ---

describe("Property 19: Output consistency computation", () => {
  it("result equals standard deviation of daily hours (Req 9.5)", () => {
    fc.assert(
      fc.property(recordsArb(2), (records) => {
        const result = computeOutputConsistency(records);
        const hours = records.map((r) => r.totalHours);
        const expected = stdDev(hours);

        // INVARIANT: output consistency equals population std dev
        expect(result).toBeCloseTo(expected, 8);
      }),
      { numRuns: 300 },
    );
  });

  it("result >= 0 (Req 9.5)", () => {
    fc.assert(
      fc.property(recordsArb(0), (records) => {
        const result = computeOutputConsistency(records);

        // INVARIANT: standard deviation is non-negative
        expect(result).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });

  it("identical hours → 0 (Req 9.5)", () => {
    fc.assert(
      fc.property(
        hoursArb,
        fc.integer({ min: 2, max: 28 }),
        (hours, count) => {
          const records = Array.from({ length: count }, (_, i) =>
            makeAttendanceRecord("user-1", dateStr(i), hours),
          );
          const result = computeOutputConsistency(records);

          // INVARIANT: no variance when all values are identical
          expect(result).toBeCloseTo(0, 10);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("fewer than 2 records → 0 (Req 9.5)", () => {
    // Empty records
    expect(computeOutputConsistency([])).toBe(0);

    // Single record
    fc.assert(
      fc.property(hoursArb, (hours) => {
        const records = [makeAttendanceRecord("user-1", dateStr(0), hours)];
        const result = computeOutputConsistency(records);

        // INVARIANT: fewer than 2 records returns 0
        expect(result).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it("higher variance → higher consistency value (Req 9.5)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),
        fc.double({ min: 1, max: 10, noNaN: true, noDefaultInfinity: true }),
        (count, baseHours) => {
          // Low variance: all values close together
          const lowVarRecords = Array.from({ length: count }, (_, i) =>
            makeAttendanceRecord("user-1", dateStr(i), baseHours),
          );

          // High variance: alternating 0 and 2*baseHours
          const highVarRecords = Array.from({ length: count }, (_, i) =>
            makeAttendanceRecord(
              "user-1",
              dateStr(i),
              i % 2 === 0 ? 0 : 2 * baseHours,
            ),
          );

          const lowResult = computeOutputConsistency(lowVarRecords);
          const highResult = computeOutputConsistency(highVarRecords);

          // INVARIANT: higher variance data produces higher consistency value
          expect(highResult).toBeGreaterThanOrEqual(lowResult);
        },
      ),
      { numRuns: 200 },
    );
  });
});
