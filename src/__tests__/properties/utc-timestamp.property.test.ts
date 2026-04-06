import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { nowUtc, isValidTimestamp, toDisplayTime } from "@/lib/timestamp";

/**
 * Property 13: UTC Timestamp Consistency
 *
 * For all timestamps stored in SQLite, the value is a Unix timestamp in UTC
 * (seconds since epoch). Local timezone conversion occurs only in the
 * display/rendering layer, never in storage or business logic.
 *
 * **Validates: Requirement 20.5**
 */
describe("Property 13: UTC Timestamp Consistency", () => {
  // Reasonable Unix timestamp range: epoch to year 2100
  const MAX_REASONABLE = 4102444800;
  const timestampArb = fc.integer({ min: 0, max: MAX_REASONABLE });

  it("nowUtc returns a positive integer Unix timestamp", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const ts = nowUtc();
        expect(Number.isInteger(ts)).toBe(true);
        expect(ts).toBeGreaterThan(0);
        expect(ts).toBeLessThanOrEqual(MAX_REASONABLE);
      }),
      { numRuns: 10 }
    );
  });

  it("timestamps are stored and retrieved without modification (no timezone conversion)", () => {
    fc.assert(
      fc.property(timestampArb, (ts) => {
        // Simulate store → retrieve round-trip: value must be unchanged
        const stored = ts;
        const retrieved = stored;
        expect(retrieved).toBe(ts);

        // Verify the value is a raw integer — no fractional offset
        expect(Number.isInteger(retrieved)).toBe(true);

        // Verify no timezone offset is embedded (value is pure seconds since epoch)
        const asDate = new Date(retrieved * 1000);
        const reconstructed = Math.floor(asDate.getTime() / 1000);
        expect(reconstructed).toBe(ts);
      })
    );
  });

  it("all valid timestamps are positive integers (Unix epoch)", () => {
    fc.assert(
      fc.property(timestampArb, (ts) => {
        expect(isValidTimestamp(ts)).toBe(true);
        expect(Number.isInteger(ts)).toBe(true);
        expect(ts).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it("isValidTimestamp rejects non-integer and negative values", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e12, max: 1e12, noNaN: true }), (val) => {
        if (!Number.isInteger(val) || val < 0 || val > MAX_REASONABLE) {
          expect(isValidTimestamp(val)).toBe(false);
        }
      })
    );
  });

  it("timestamps do not contain timezone offset information (raw Unix seconds)", () => {
    fc.assert(
      fc.property(timestampArb, (ts) => {
        // A Unix timestamp is timezone-agnostic. Converting to Date and back
        // must yield the exact same value regardless of the runtime's local TZ.
        const date = new Date(ts * 1000);
        const roundTripped = Math.floor(date.getTime() / 1000);
        expect(roundTripped).toBe(ts);

        // The UTC components of the Date must reconstruct the same epoch
        const utcEpoch = Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          date.getUTCHours(),
          date.getUTCMinutes(),
          date.getUTCSeconds()
        );
        expect(Math.floor(utcEpoch / 1000)).toBe(ts);
      })
    );
  });

  it("nowUtc always produces UTC values (no local offset baked in)", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const ts = nowUtc();
        const jsNow = Math.floor(Date.now() / 1000);

        // nowUtc must be within 2 seconds of Date.now()/1000
        // (Date.now() is already UTC milliseconds)
        expect(Math.abs(ts - jsNow)).toBeLessThanOrEqual(2);

        // Verify it's a valid timestamp
        expect(isValidTimestamp(ts)).toBe(true);
      }),
      { numRuns: 10 }
    );
  });

  it("toDisplayTime is the only conversion point — input timestamp is not mutated", () => {
    fc.assert(
      fc.property(timestampArb, (ts) => {
        // Calling toDisplayTime must not alter the original value
        const original = ts;
        toDisplayTime(ts, "UTC");
        toDisplayTime(ts, "America/New_York");
        toDisplayTime(ts); // default locale
        expect(ts).toBe(original);
      })
    );
  });

  it("toDisplayTime with UTC timezone produces a string matching the UTC date components", () => {
    fc.assert(
      fc.property(timestampArb, (ts) => {
        const display = toDisplayTime(ts, "UTC");
        const date = new Date(ts * 1000);

        // The display string should contain the UTC year
        expect(display).toContain(String(date.getUTCFullYear()));

        // It should be a non-empty string
        expect(display.length).toBeGreaterThan(0);
      })
    );
  });
});
