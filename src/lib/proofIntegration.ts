/**
 * Proof integration helpers for existing screens.
 *
 * Pure functions for:
 * - Deriving check-in status badges for dashboard
 * - Computing check-in compliance rate for monthly reports
 * - Mapping proofs to attendance rows
 *
 * Requirements: Task 18.13
 */

import type { WorkspaceProof } from "@/types";

/**
 * Check-in verification status for dashboard display.
 */
export type CheckinStatus = "verified" | "unverified" | "ai_flagged" | "pending";

/**
 * Derive the check-in status for a team member based on their proofs.
 *
 * Priority: if any checkin proof exists for today's session:
 * - aiVerified === "yes" → ✅ Verified
 * - aiVerified === "unavailable" → 🟡 Unverified
 * - aiVerified === "no" → 🟡 AI Flagged
 * - aiVerified === "pending" → ⬜ Pending
 * - No proof at all → null (no badge)
 */
export function getCheckinStatus(
  userId: string,
  proofs: WorkspaceProof[],
  todayStart: number,
): CheckinStatus | null {
  const todayCheckin = proofs.find(
    (p) =>
      p.userId === userId &&
      p.type === "checkin" &&
      p.createdAt >= todayStart,
  );

  if (!todayCheckin) return null;

  switch (todayCheckin.aiVerified) {
    case "yes":
      return "verified";
    case "unavailable":
      return "unverified";
    case "no":
      return "ai_flagged";
    case "pending":
      return "pending";
  }
}

/**
 * Get the display label for a check-in status.
 */
export function getCheckinStatusLabel(status: CheckinStatus): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "unverified":
      return "Unverified";
    case "ai_flagged":
      return "AI Flagged";
    case "pending":
      return "Pending";
  }
}

/**
 * Get the emoji/icon prefix for a check-in status.
 */
export function getCheckinStatusEmoji(status: CheckinStatus): string {
  switch (status) {
    case "verified":
      return "✅";
    case "unverified":
      return "🟡";
    case "ai_flagged":
      return "🟡";
    case "pending":
      return "⬜";
  }
}

/**
 * Get the badge variant for a check-in status.
 */
export function getCheckinBadgeVariant(
  status: CheckinStatus,
): "success" | "warning" | "danger" | "muted" {
  switch (status) {
    case "verified":
      return "success";
    case "unverified":
      return "warning";
    case "ai_flagged":
      return "danger";
    case "pending":
      return "muted";
  }
}

/**
 * Find proofs for a specific attendance record (by userId and date).
 *
 * Returns checkin and checkout proofs for the given user on the given date.
 */
export function getProofsForAttendanceRow(
  userId: string,
  date: string,
  proofs: WorkspaceProof[],
): { checkin: WorkspaceProof | null; checkout: WorkspaceProof | null } {
  // Parse date to get day boundaries
  const [y, m, d] = date.split("-").map(Number);
  const dayStart = Date.UTC(y, m - 1, d) / 1000;
  const dayEnd = dayStart + 86400;

  const dayProofs = proofs.filter(
    (p) => p.userId === userId && p.createdAt >= dayStart && p.createdAt < dayEnd,
  );

  const checkin = dayProofs.find((p) => p.type === "checkin") ?? null;
  const checkout = dayProofs.find((p) => p.type === "checkout") ?? null;

  return { checkin, checkout };
}

/**
 * Compute check-in compliance rate for a set of sessions.
 *
 * Compliance = (sessions with at least one verified checkin proof) / total sessions.
 * A "verified" proof means aiVerified is "yes".
 *
 * Returns a number between 0 and 1 (percentage as decimal).
 */
export function computeCheckinComplianceRate(
  sessionIds: string[],
  proofs: WorkspaceProof[],
): number {
  if (sessionIds.length === 0) return 0;

  const sessionsWithVerifiedProof = sessionIds.filter((sessionId) =>
    proofs.some(
      (p) =>
        p.sessionId === sessionId &&
        p.type === "checkin" &&
        p.aiVerified === "yes",
    ),
  ).length;

  return sessionsWithVerifiedProof / sessionIds.length;
}

/**
 * Get the location display name for a proof.
 * Falls back to coordinates if no location name is available.
 */
export function getProofLocationLabel(
  proof: WorkspaceProof,
  locationNames: Record<string, string>,
): string {
  if (proof.locationId && locationNames[proof.locationId]) {
    return locationNames[proof.locationId];
  }
  if (proof.lat !== null && proof.lng !== null) {
    return `${proof.lat.toFixed(2)}°, ${proof.lng.toFixed(2)}°`;
  }
  return "Unknown";
}
