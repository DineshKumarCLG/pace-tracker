/**
 * UTC timestamp utilities for PACE.
 *
 * All timestamps in PACE are stored as Unix timestamps in seconds (UTC).
 * Local timezone conversion happens ONLY in the display layer via `toDisplayTime`.
 */

/** Returns the current Unix timestamp in seconds (UTC). */
export function nowUtc(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Validates that a value is a reasonable Unix timestamp (in seconds).
 * Must be a positive integer between Unix epoch (0) and year 2100.
 */
export function isValidTimestamp(ts: number): boolean {
  const MAX_REASONABLE = 4102444800; // 2100-01-01T00:00:00Z
  return Number.isInteger(ts) && ts >= 0 && ts <= MAX_REASONABLE;
}

/**
 * Converts a Unix timestamp (seconds, UTC) to a display string.
 * This is the ONLY place timezone conversion should happen.
 */
export function toDisplayTime(ts: number, timezone?: string): string {
  const date = new Date(ts * 1000);
  return date.toLocaleString(undefined, {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
