import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validateExifTimestamp, EXIF_MAX_AGE_SECONDS } from "@/lib/photoCapture";

/**
 * Property 41: EXIF freshness validation
 *
 * For any EXIF timestamp:
 * - Within 5 minutes of now → accepted (fresh)
 * - Beyond 5 minutes → rejected (stale)
 * - No EXIF data (null) → accepted with unverified flag
 *
 * **Validates: Requirements 18.5**
 */

const NOW = 1_700_000_000; // fixed reference time

describe("Property 41: EXIF freshness validation", () => {
  it("EXIF within 5 minutes → accepted as fresh", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: EXIF_MAX_AGE_SECONDS }),
        (ageSeconds) => {
          const exifTimestamp = NOW - ageSeconds;
          const result = validateExifTimestamp(exifTimestamp, NOW);

          expect(result.accepted).toBe(true);
          expect(result.reason).toBe("fresh");
          expect(result.unverifiedTimestamp).toBe(false);
          expect(result.exifTimestamp).toBe(exifTimestamp);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("EXIF beyond 5 minutes → rejected as stale", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: EXIF_MAX_AGE_SECONDS + 1, max: 86400 }),
        (ageSeconds) => {
          const exifTimestamp = NOW - ageSeconds;
          const result = validateExifTimestamp(exifTimestamp, NOW);

          expect(result.accepted).toBe(false);
          expect(result.reason).toBe("stale");
          expect(result.unverifiedTimestamp).toBe(false);
          expect(result.exifTimestamp).toBe(exifTimestamp);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("no EXIF data → accepted with unverified flag", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
        (now) => {
          const result = validateExifTimestamp(null, now);

          expect(result.accepted).toBe(true);
          expect(result.reason).toBe("no_exif");
          expect(result.unverifiedTimestamp).toBe(true);
          expect(result.exifTimestamp).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("boundary: exactly 5 minutes old → accepted", () => {
    const exifTimestamp = NOW - EXIF_MAX_AGE_SECONDS;
    const result = validateExifTimestamp(exifTimestamp, NOW);

    expect(result.accepted).toBe(true);
    expect(result.reason).toBe("fresh");
  });

  it("boundary: 5 minutes + 1 second → rejected", () => {
    const exifTimestamp = NOW - EXIF_MAX_AGE_SECONDS - 1;
    const result = validateExifTimestamp(exifTimestamp, NOW);

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("stale");
  });
});
