/**
 * Meeting logger — pure functions for PACE v2 Team Ops.
 *
 * - createMeeting: creates a Meeting record linked to a break and session
 * - validateMeetingTitle: validates that a meeting title is non-empty
 *
 * Requirements: 20.1, 20.2, 20.3
 */

import type { Meeting } from "@/types";

/**
 * Create a new Meeting record.
 *
 * Every meeting must be linked to a break record and a session.
 * Title is required and must be non-empty.
 *
 * Requirements: 20.1, 20.2
 *
 * @param id - Unique identifier
 * @param breakId - The break record this meeting is linked to
 * @param sessionId - The session this meeting belongs to
 * @param title - Meeting title (required, non-empty)
 * @param attendees - Comma-separated attendee names or null
 * @returns A new Meeting object
 */
export function createMeeting(
  id: string,
  breakId: string,
  sessionId: string,
  title: string,
  attendees: string | null,
): Meeting {
  if (!validateMeetingTitle(title)) {
    throw new Error("Meeting title is required and must be non-empty");
  }

  return {
    id,
    breakId,
    sessionId,
    title: title.trim(),
    attendees,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Validate that a meeting title is non-empty.
 *
 * Requirements: 20.1
 *
 * @param title - The title to validate
 * @returns true if the title is valid (non-empty after trimming)
 */
export function validateMeetingTitle(title: string): boolean {
  return typeof title === "string" && title.trim().length > 0;
}
