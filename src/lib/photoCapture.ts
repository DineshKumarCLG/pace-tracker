/**
 * Photo capture and EXIF validation for workspace access proofs.
 *
 * Pure functions for:
 * - EXIF timestamp extraction and freshness validation
 * - Photo hash computation
 * - Webcam capture helpers
 *
 * Requirements: Task 18.5
 */

/** Maximum age of an EXIF timestamp in seconds (5 minutes) */
export const EXIF_MAX_AGE_SECONDS = 5 * 60;

/** Result of EXIF timestamp validation */
export interface ExifValidationResult {
  accepted: boolean;
  reason: "fresh" | "stale" | "no_exif";
  unverifiedTimestamp: boolean;
  exifTimestamp: number | null;
}

/**
 * Validate an EXIF timestamp against the current time.
 *
 * Rules:
 * - If EXIF timestamp exists and is within 5 minutes of now → accepted
 * - If EXIF timestamp exists and is older than 5 minutes → rejected
 * - If no EXIF timestamp → accepted with "unverified timestamp" flag
 *
 * @param exifTimestamp - EXIF timestamp in seconds (UTC), or null if no EXIF data
 * @param nowSeconds - Current time in seconds (UTC)
 * @returns Validation result
 */
export function validateExifTimestamp(
  exifTimestamp: number | null,
  nowSeconds: number,
): ExifValidationResult {
  if (exifTimestamp === null) {
    return {
      accepted: true,
      reason: "no_exif",
      unverifiedTimestamp: true,
      exifTimestamp: null,
    };
  }

  const age = nowSeconds - exifTimestamp;

  if (age <= EXIF_MAX_AGE_SECONDS) {
    return {
      accepted: true,
      reason: "fresh",
      unverifiedTimestamp: false,
      exifTimestamp,
    };
  }

  return {
    accepted: false,
    reason: "stale",
    unverifiedTimestamp: false,
    exifTimestamp,
  };
}

/**
 * Compute a simple hash string for a photo blob.
 * Uses a basic FNV-1a-like hash for quick fingerprinting.
 *
 * @param data - Photo data as Uint8Array
 * @returns Hex hash string
 */
export function computePhotoHash(data: Uint8Array): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = (hash * 0x01000193) >>> 0; // FNV prime, keep as uint32
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Capture a frame from a video element (webcam stream).
 * Returns the image as a Blob (JPEG, max ~500KB).
 *
 * @param videoElement - HTMLVideoElement with active stream
 * @returns JPEG Blob or null if capture fails
 */
export async function captureWebcamFrame(
  videoElement: HTMLVideoElement,
): Promise<Blob | null> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = videoElement.videoWidth || 640;
    canvas.height = videoElement.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob),
        "image/jpeg",
        0.7, // quality — keeps size under ~500KB
      );
    });
  } catch {
    return null;
  }
}

/**
 * Parse EXIF timestamp from a JPEG file's raw bytes.
 * Looks for the DateTimeOriginal tag in EXIF data.
 * Returns UTC timestamp in seconds, or null if not found.
 *
 * This is a simplified parser that handles the most common JPEG EXIF format.
 *
 * @param data - Raw file bytes
 * @returns EXIF timestamp in seconds (UTC) or null
 */
export function parseExifTimestamp(data: Uint8Array): number | null {
  // Look for EXIF marker (0xFFE1) in JPEG
  if (data.length < 12) return null;
  if (data[0] !== 0xff || data[1] !== 0xd8) return null; // Not JPEG

  let offset = 2;
  while (offset < data.length - 4) {
    if (data[offset] !== 0xff) break;
    const marker = data[offset + 1];

    // APP1 marker (EXIF)
    if (marker === 0xe1) {
      const length = (data[offset + 2] << 8) | data[offset + 3];
      const exifData = data.slice(offset + 4, offset + 2 + length);
      return extractDateTimeOriginal(exifData);
    }

    // Skip other markers
    const segLen = (data[offset + 2] << 8) | data[offset + 3];
    offset += 2 + segLen;
  }

  return null;
}

/**
 * Extract DateTimeOriginal from EXIF APP1 segment.
 * Format: "YYYY:MM:DD HH:MM:SS"
 */
function extractDateTimeOriginal(exifData: Uint8Array): number | null {
  // Convert to string and search for date pattern
  const text = new TextDecoder("ascii", { fatal: false }).decode(exifData);
  // Look for DateTimeOriginal pattern: YYYY:MM:DD HH:MM:SS
  const datePattern = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/;
  const match = text.match(datePattern);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Date.UTC(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second),
    ),
  );

  if (isNaN(date.getTime())) return null;
  return Math.floor(date.getTime() / 1000);
}
