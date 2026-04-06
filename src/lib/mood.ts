/**
 * Mood check-in — pure functions for PACE v2 Team Ops.
 *
 * - createMoodCheck: creates a MoodCheck record (local-only, never synced)
 * - handleMoodDismissal: returns null (no record created on dismissal)
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5
 */

import type { MoodCheck } from "@/types";

/**
 * Create a new MoodCheck record.
 *
 * Energy must be 1-5. MoodTag is optional (one-word tag or null).
 * This data is local-only and never synced to PocketBase (Req 19.3).
 *
 * Requirements: 19.1, 19.2
 *
 * @param id - Unique identifier
 * @param userId - The user recording the mood
 * @param sessionId - The session this mood check is linked to
 * @param energy - Energy level 1-5
 * @param moodTag - Optional one-word mood tag
 * @returns A new MoodCheck object
 */
export function createMoodCheck(
  id: string,
  userId: string,
  sessionId: string,
  energy: number,
  moodTag: string | null,
): MoodCheck {
  if (energy < 1 || energy > 5 || !Number.isInteger(energy)) {
    throw new Error("Energy must be an integer between 1 and 5");
  }

  return {
    id,
    userId,
    sessionId,
    energy,
    moodTag,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Handle mood check dismissal — no record is created.
 *
 * When the founder dismisses the mood check prompt, no mood data
 * should be recorded for that session (Req 19.5).
 *
 * @returns null (no MoodCheck record)
 */
export function handleMoodDismissal(): null {
  return null;
}
