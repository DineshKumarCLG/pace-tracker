import { describe, it, expect } from "vitest";
import {
  validateExifTimestamp,
  computePhotoHash,
  EXIF_MAX_AGE_SECONDS,
} from "@/lib/photoCapture";

const NOW = 1_700_000_000;

describe("validateExifTimestamp", () => {
  it("accepts fresh EXIF (within 5 minutes)", () => {
    const result = validateExifTimestamp(NOW - 60, NOW);
    expect(result.accepted).toBe(true);
    expect(result.reason).toBe("fresh");
    expect(result.unverifiedTimestamp).toBe(false);
  });

  it("rejects stale EXIF (older than 5 minutes)", () => {
    const result = validateExifTimestamp(NOW - 600, NOW);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("stale");
  });

  it("accepts null EXIF with unverified flag", () => {
    const result = validateExifTimestamp(null, NOW);
    expect(result.accepted).toBe(true);
    expect(result.reason).toBe("no_exif");
    expect(result.unverifiedTimestamp).toBe(true);
  });

  it("boundary: exactly 5 minutes → accepted", () => {
    const result = validateExifTimestamp(NOW - EXIF_MAX_AGE_SECONDS, NOW);
    expect(result.accepted).toBe(true);
  });

  it("boundary: 5 min + 1 sec → rejected", () => {
    const result = validateExifTimestamp(NOW - EXIF_MAX_AGE_SECONDS - 1, NOW);
    expect(result.accepted).toBe(false);
  });
});

describe("computePhotoHash", () => {
  it("returns a hex string", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const hash = computePhotoHash(data);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("same data produces same hash", () => {
    const data = new Uint8Array([10, 20, 30]);
    expect(computePhotoHash(data)).toBe(computePhotoHash(data));
  });

  it("different data produces different hash", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6]);
    expect(computePhotoHash(a)).not.toBe(computePhotoHash(b));
  });

  it("handles empty data", () => {
    const hash = computePhotoHash(new Uint8Array([]));
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});
