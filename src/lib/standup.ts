/**
 * Async standup prompt — pure functions for PACE v2 Team Ops.
 *
 * - shouldShowStandupPrompt: returns true if no response exists for today
 * - createStandupResponse: creates a StandupResponse record
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4
 */

import type { StandupResponse } from "@/types";

/**
 * Determine whether the standup prompt should be shown for a user on a given date.
 *
 * Returns true if no standup response exists for the user on the given date,
 * meaning the prompt should appear on the first session start of the day.
 * Returns false if a response (or dismissal) already exists, preventing re-prompting.
 *
 * Requirements: 18.1, 18.4
 *
 * @param userId - The user to check
 * @param date - The current date as YYYY-MM-DD string
 * @param existingResponses - All standup responses to search through
 * @returns true if the prompt should be shown, false otherwise
 */
export function shouldShowStandupPrompt(
  userId: string,
  date: string,
  existingResponses: StandupResponse[],
): boolean {
  return !existingResponses.some(
    (r) => r.userId === userId && r.date === date,
  );
}

/**
 * Create a new StandupResponse record.
 *
 * Requirements: 18.2
 *
 * @param id - Unique identifier
 * @param userId - The responding user
 * @param date - The date as YYYY-MM-DD string
 * @param response - The standup response text
 * @returns A new StandupResponse object
 */
export function createStandupResponse(
  id: string,
  userId: string,
  date: string,
  response: string,
): StandupResponse {
  return {
    id,
    userId,
    date,
    response,
    createdAt: Math.floor(Date.now() / 1000),
  };
}
