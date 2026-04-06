/**
 * Typed wrappers around Tauri invoke for calling Rust commands.
 *
 * All database access goes through the Rust backend via IPC.
 * This module provides a clean TypeScript API for the frontend.
 */

import { invoke } from "@tauri-apps/api/core";
import type { Break, Session, Team, TeamMembership } from "@/types";
import { pb } from "@/lib/pocketbase";

/** Initialize the SQLite database schema on app launch. */
export async function initializeDb(): Promise<string> {
  return invoke<string>("initialize_db");
}

/** Start a new work session for the given user. */
export async function startSession(
  userId: string,
  claimedStartTime: number,
): Promise<Session> {
  return invoke<Session>("start_session", {
    userId,
    claimedStartTime,
  });
}

/** End an active session with an optional output note. */
export async function endSession(
  sessionId: string,
  endTime: number,
  outputNote?: string,
): Promise<void> {
  return invoke<void>("end_session", {
    sessionId,
    endTime,
    outputNote: outputNote ?? null,
  });
}

/** Get the active (endTime = null) session for a user, or null. */
export async function getActiveSession(
  userId: string,
): Promise<Session | null> {
  return invoke<Session | null>("get_active_session", { userId });
}

/**
 * Recover a stale session: sets startType to 'recovered' and closes
 * with the user-confirmed end time.
 */
export async function recoverStaleSession(
  sessionId: string,
  confirmedEndTime: number,
): Promise<void> {
  return invoke<void>("recover_stale_session", {
    sessionId,
    confirmedEndTime,
  });
}

/** Returns the estimated device wake time as a Unix timestamp. */
export async function getDeviceWakeTime(): Promise<number> {
  return invoke<number>("get_device_wake_time");
}

/**
 * Determines whether a session is stale (needs recovery).
 * A session is stale if its lastHeartbeat is older than 30 seconds.
 */
export function isSessionStale(session: Session): boolean {
  if (session.lastHeartbeat == null) return true;
  const now = Math.floor(Date.now() / 1000);
  return now - session.lastHeartbeat > 30;
}

/** Start a break for the given session. Returns the created break record. */
export async function startBreak(
  sessionId: string,
  breakType: Break["type"],
): Promise<Break> {
  return invoke<Break>("start_break", { sessionId, breakType });
}

/** End an active break by setting its endTime. */
export async function endBreak(breakId: string): Promise<void> {
  return invoke<void>("end_break", { breakId });
}

/** Get the active break for a session, or null if none. */
export async function getActiveBreak(
  sessionId: string,
): Promise<Break | null> {
  return invoke<Break | null>("get_active_break", { sessionId });
}

/** Get all visible breaks for a session (micro-breaks < 8min filtered out). */
export async function getVisibleBreaks(sessionId: string): Promise<Break[]> {
  return invoke<Break[]>("get_visible_breaks", { sessionId });
}

/** Micro-break threshold in seconds (8 minutes). */
export const MICRO_BREAK_THRESHOLD_SECS = 480;

/** Filter out micro-breaks (< 8 minutes) from a list of breaks. */
export function filterMicroBreaks(breaks: Break[]): Break[] {
  return breaks.filter((b) => {
    if (b.endTime == null) return true; // active break always visible
    return b.endTime - b.startTime >= MICRO_BREAK_THRESHOLD_SECS;
  });
}


// ---------------------------------------------------------------------------
// Team / Invite System
// ---------------------------------------------------------------------------

/**
 * Generate an 8-character alphanumeric invite code.
 * Excludes ambiguous characters (0, O, 1, l, I) for readability.
 */
export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Create a new team and add the creator as the first member.
 * Returns the created team record.
 */
export async function createTeam(
  name: string,
  createdBy: string,
): Promise<Team> {
  const inviteCode = generateInviteCode();
  const record = await pb.collection("teams").create({
    name: name.trim(),
    inviteCode,
    createdBy,
  });

  // Add creator as first team member
  await pb.collection("team_members").create({
    teamId: record.id,
    userId: createdBy,
  });

  return {
    id: record.id,
    name: record.name as string,
    inviteCode: record.inviteCode as string,
    createdBy: record.createdBy as string,
    createdAt: new Date(record.created).getTime() / 1000,
  };
}

/**
 * Join an existing team using an invite code.
 * Returns the team that was joined.
 * Throws if the invite code is invalid.
 */
export async function joinTeam(
  inviteCode: string,
  userId: string,
): Promise<Team> {
  const teams = await pb.collection("teams").getList(1, 1, {
    filter: `inviteCode = "${inviteCode.trim()}"`,
  });

  if (teams.items.length === 0) {
    throw new Error("Invalid invite code");
  }

  const team = teams.items[0];

  // Check if already a member (idempotent join)
  const existing = await pb.collection("team_members").getList(1, 1, {
    filter: `teamId = "${team.id}" && userId = "${userId}"`,
  });

  if (existing.items.length === 0) {
    await pb.collection("team_members").create({
      teamId: team.id,
      userId,
    });
  }

  return {
    id: team.id,
    name: team.name as string,
    inviteCode: team.inviteCode as string,
    createdBy: team.createdBy as string,
    createdAt: new Date(team.created).getTime() / 1000,
  };
}

/**
 * Get all members of a team.
 * Returns an array of team membership records.
 */
export async function getTeamMembers(
  teamId: string,
): Promise<TeamMembership[]> {
  const records = await pb.collection("team_members").getFullList({
    filter: `teamId = "${teamId}"`,
  });

  return records.map((r) => ({
    teamId: r.teamId as string,
    userId: r.userId as string,
    joinedAt: new Date(r.created).getTime() / 1000,
  }));
}

/**
 * Get the team for a given user, or null if the user has no team.
 */
export async function getUserTeam(
  userId: string,
): Promise<Team | null> {
  const memberships = await pb.collection("team_members").getList(1, 1, {
    filter: `userId = "${userId}"`,
  });

  if (memberships.items.length === 0) {
    return null;
  }

  const teamId = memberships.items[0].teamId as string;
  const team = await pb.collection("teams").getOne(teamId);

  return {
    id: team.id,
    name: team.name as string,
    inviteCode: team.inviteCode as string,
    createdBy: team.createdBy as string,
    createdAt: new Date(team.created).getTime() / 1000,
  };
}
