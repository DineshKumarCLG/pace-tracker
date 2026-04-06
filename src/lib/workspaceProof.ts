/**
 * Workspace proof creation and validation for mandatory check-in/check-out.
 *
 * Pure functions for:
 * - Creating workspace proof records (check-in and check-out)
 * - Checking if proof is required (always true — no skip, no bypass)
 * - Detecting missed checkouts for crash recovery
 *
 * Requirements: Task 18.7, 18.8
 */

import type { WorkspaceProof, Session } from "@/types";

/**
 * Create a new WorkspaceProof record.
 *
 * @param id - Unique identifier
 * @param sessionId - Associated session ID
 * @param userId - User who created the proof
 * @param type - "checkin" or "checkout"
 * @param photoPath - Path to the captured/uploaded photo
 * @param photoHash - Hash of the photo data
 * @param lat - Latitude (null if geolocation unavailable)
 * @param lng - Longitude (null if geolocation unavailable)
 * @param accuracy - Accuracy in meters (null if geolocation unavailable)
 * @param locationId - Matched location ID (null if no match)
 * @param exifTimestamp - EXIF timestamp from uploaded photo (null if webcam or no EXIF)
 * @returns A new WorkspaceProof record
 */
export function createWorkspaceProof(
  id: string,
  sessionId: string,
  userId: string,
  type: "checkin" | "checkout",
  photoPath: string,
  photoHash: string,
  lat: number | null,
  lng: number | null,
  accuracy: number | null,
  locationId: string | null,
  exifTimestamp: number | null = null,
): WorkspaceProof {
  if (!photoPath || photoPath.trim().length === 0) {
    throw new Error("Photo is required for workspace proof");
  }

  if (!photoHash || photoHash.trim().length === 0) {
    throw new Error("Photo hash is required for workspace proof");
  }

  return {
    id,
    sessionId,
    userId,
    type,
    photoPath: photoPath.trim(),
    photoHash: photoHash.trim(),
    lat,
    lng,
    accuracy,
    locationId,
    aiVerified: "pending",
    aiReason: null,
    exifTimestamp,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Check if a workspace proof is required for a given type.
 *
 * Always returns true — workspace proofs are mandatory.
 * No skip, no bypass. This is by design.
 *
 * @param _type - "checkin" or "checkout" (unused, always required)
 * @returns Always true
 */
export function isProofRequired(_type: "checkin" | "checkout"): boolean {
  return true;
}

/**
 * Detect if a session has a missed checkout.
 *
 * A missed checkout occurs when:
 * - The session has ended (endTime is set)
 * - But no checkout proof exists for that session
 *
 * This is used for crash recovery: if the app crashed without
 * completing the checkout flow, the user is prompted on next launch.
 *
 * @param session - The session to check
 * @param proofs - All workspace proofs for this session
 * @returns true if the session ended without a checkout proof
 */
export function isMissedCheckout(
  session: Session,
  proofs: WorkspaceProof[],
): boolean {
  // Session must have ended
  if (session.endTime === null) {
    return false;
  }

  // Check if there's a checkout proof for this session
  const hasCheckout = proofs.some(
    (p) => p.sessionId === session.id && p.type === "checkout",
  );

  return !hasCheckout;
}

/**
 * Check if a session has a check-in proof.
 *
 * @param sessionId - The session ID to check
 * @param proofs - All workspace proofs
 * @returns true if a checkin proof exists for this session
 */
export function hasCheckinProof(
  sessionId: string,
  proofs: WorkspaceProof[],
): boolean {
  return proofs.some(
    (p) => p.sessionId === sessionId && p.type === "checkin",
  );
}

/**
 * Check if a session has a checkout proof.
 *
 * @param sessionId - The session ID to check
 * @param proofs - All workspace proofs
 * @returns true if a checkout proof exists for this session
 */
export function hasCheckoutProof(
  sessionId: string,
  proofs: WorkspaceProof[],
): boolean {
  return proofs.some(
    (p) => p.sessionId === sessionId && p.type === "checkout",
  );
}

/**
 * Determine the AI verification display status for a proof.
 *
 * AI verification is advisory only — it never blocks session start/end.
 *
 * @param aiVerified - The AI verification status
 * @returns Display label for the verification status
 */
export function getVerificationLabel(
  aiVerified: WorkspaceProof["aiVerified"],
): string {
  switch (aiVerified) {
    case "yes":
      return "Verified";
    case "no":
      return "AI Flagged";
    case "pending":
      return "Pending";
    case "unavailable":
      return "Unverified";
  }
}
