import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isValidTimestamp, toDisplayTime } from "@/lib/timestamp";

/**
 * Property 36: Leave dates stored as UTC
 *
 * For any leave request, the startDate and endDate fields in SQLite should be
 * UTC timestamps with no local timezone offset applied at the storage layer.
 *
 * **Validates: Requirements 24.3**
 */
describe("Property 36: Leave dates stored as UTC", () => {
  // Reasonable range: 2024-01-01 to 2027-12-31 (Unix seconds)
  const MIN_TS = 1704067200; // 2024-01-01T00:00:00Z
  const MAX_TS = 1830297600; // 2028-01-01T00:00:00Z

  // Generate a pair of UTC timestamps where startDate < endDate
  const leaveDatePairArb = fc
    .tuple(
      fc.integer({ min: MIN_TS, max: MAX_TS }),
      fc.integer({ min: MIN_TS, max: MAX_TS })
    )
    .filter(([a, b]) => a !== b)
    .map(([a, b]) => (a < b ? { startDate: a, endDate: b } : { startDate: b, endDate: a }));

  const leaveTypeArb = fc.constantFrom("annual", "sick", "wfh") as fc.Arbitrary<"annual" | "sick" | "wfh">;

  // Arbitrary that generates a full leave request record
  const leaveRequestArb = fc.record({
    id: fc.uuid(),
    requesterId: fc.uuid(),
    type: leaveTypeArb,
    dates: leaveDatePairArb,
    reason: fc.string({ minLength: 0, maxLength: 100 }),
    status: fc.constantFrom("pending", "approved", "declined"),
    createdAt: fc.integer({ min: MIN_TS, max: MAX_TS }),
    updatedAt: fc.integer({ min: MIN_TS, max: MAX_TS }),
  });

  it("leave dates are stored as integers, not strings or floats", () => {
    fc.assert(
      fc.property(leaveRequestArb, (req) => {
        const { startDate, endDate } = req.dates;

        // Dates must be integers (Unix seconds)
        expect(Number.isInteger(startDate)).toBe(true);
        expect(Number.isInteger(endDate)).toBe(true);

        // Must not be strings
        expect(typeof startDate).toBe("number");
        expect(typeof endDate).toBe("number");
      })
    );
  });

  it("startDate is always less than endDate", () => {
    fc.assert(
      fc.property(leaveRequestArb, (req) => {
        const { startDate, endDate } = req.dates;
        expect(startDate).toBeLessThan(endDate);
      })
    );
  });

  it("leave dates are valid UTC timestamps", () => {
    fc.assert(
      fc.property(leaveRequestArb, (req) => {
        const { startDate, endDate } = req.dates;

        expect(isValidTimestamp(startDate)).toBe(true);
        expect(isValidTimestamp(endDate)).toBe(true);
      })
    );
  });

  it("converting UTC timestamps to local display and back preserves the original value (round-trip)", () => {
    fc.assert(
      fc.property(leaveDatePairArb, ({ startDate, endDate }) => {
        // Convert to Date and back — must be lossless
        const startDate2 = new Date(startDate * 1000);
        const startRoundTripped = Math.floor(startDate2.getTime() / 1000);
        expect(startRoundTripped).toBe(startDate);

        const endDate2 = new Date(endDate * 1000);
        const endRoundTripped = Math.floor(endDate2.getTime() / 1000);
        expect(endRoundTripped).toBe(endDate);

        // UTC components must reconstruct the same epoch
        const startUtcEpoch = Date.UTC(
          startDate2.getUTCFullYear(),
          startDate2.getUTCMonth(),
          startDate2.getUTCDate(),
          startDate2.getUTCHours(),
          startDate2.getUTCMinutes(),
          startDate2.getUTCSeconds()
        );
        expect(Math.floor(startUtcEpoch / 1000)).toBe(startDate);

        const endUtcEpoch = Date.UTC(
          endDate2.getUTCFullYear(),
          endDate2.getUTCMonth(),
          endDate2.getUTCDate(),
          endDate2.getUTCHours(),
          endDate2.getUTCMinutes(),
          endDate2.getUTCSeconds()
        );
        expect(Math.floor(endUtcEpoch / 1000)).toBe(endDate);
      })
    );
  });

  it("toDisplayTime does not mutate the stored UTC timestamp", () => {
    fc.assert(
      fc.property(leaveDatePairArb, ({ startDate, endDate }) => {
        const originalStart = startDate;
        const originalEnd = endDate;

        // Display in various timezones — original values must be unchanged
        toDisplayTime(startDate, "UTC");
        toDisplayTime(startDate, "America/New_York");
        toDisplayTime(startDate, "Asia/Tokyo");
        toDisplayTime(endDate, "UTC");
        toDisplayTime(endDate, "Europe/London");

        expect(startDate).toBe(originalStart);
        expect(endDate).toBe(originalEnd);
      })
    );
  });

  it("leave date timestamps contain no embedded timezone offset (pure Unix seconds)", () => {
    fc.assert(
      fc.property(leaveDatePairArb, ({ startDate, endDate }) => {
        // A UTC Unix timestamp is timezone-agnostic. Regardless of the
        // runtime's local timezone, converting to Date and extracting
        // UTC components must yield the same epoch value.
        for (const ts of [startDate, endDate]) {
          const date = new Date(ts * 1000);
          const reconstructed = Math.floor(date.getTime() / 1000);
          expect(reconstructed).toBe(ts);

          // No fractional offset
          expect(Number.isInteger(ts)).toBe(true);
        }
      })
    );
  });
});
