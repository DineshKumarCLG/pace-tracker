/**
 * OS notification helpers for PACE v2 Team Ops and Founder Governance.
 *
 * All functions use @tauri-apps/plugin-notification with graceful fallback:
 * if not running in Tauri or permissions are denied, they silently no-op.
 *
 * Requirements: 1.2, 6.4, 7.3, 12.4, 24.4
 */

import { isTauri } from "@/lib/tauri";

/**
 * Internal helper — request permission and send an OS notification.
 * Silently no-ops outside Tauri or when permission is denied.
 */
async function sendOsNotification(title: string, body: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { sendNotification, isPermissionGranted, requestPermission } =
      await import("@tauri-apps/plugin-notification");
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    if (granted) {
      sendNotification({ title, body });
    }
  } catch {
    // Notification unavailable — silently ignore
  }
}

/**
 * Notify other founders when a leave/WFH request is submitted.
 *
 * Requirement: 6.4
 *
 * @param requesterName - Name of the person submitting the request
 * @param type - Leave type ("annual", "sick", or "wfh")
 * @param startDate - Start date as a human-readable string
 * @param endDate - End date as a human-readable string
 */
export async function notifyLeaveSubmission(
  requesterName: string,
  type: string,
  startDate: string,
  endDate: string,
): Promise<void> {
  const typeLabel =
    type === "annual" ? "Annual Leave" :
    type === "sick" ? "Sick Leave" : "WFH";

  await sendOsNotification(
    "New Leave Request",
    `${requesterName} submitted a ${typeLabel} request for ${startDate} – ${endDate}.`,
  );
}

/**
 * Notify the requester when their leave request is declined.
 *
 * Requirement: 7.3
 *
 * @param reason - The decline reason provided by the reviewer
 */
export async function notifyLeaveDecline(reason: string): Promise<void> {
  await sendOsNotification(
    "Leave Request Declined",
    `Your leave request was declined. Reason: ${reason}`,
  );
}

/**
 * Notify affected founders when a sync conflict occurs on a leave request.
 *
 * Requirement: 24.4
 *
 * @param details - Description of the conflict
 */
export async function notifySyncConflict(details: string): Promise<void> {
  await sendOsNotification(
    "Leave Sync Conflict",
    `A sync conflict was detected on a leave request. ${details}`,
  );
}


// ── Founder Governance Notifications ──────────────────────────────────
// Requirement: 1.2

/**
 * Notify all founders that a new peer review cycle is open for submission.
 *
 * Requirement: 1.2
 */
export async function notifyReviewCycleOpen(): Promise<void> {
  await sendOsNotification(
    "Peer Review Cycle Open",
    "A new peer review cycle is open for submission.",
  );
}

/**
 * Notify founders that the submission deadline is approaching (24h before).
 *
 * Requirement: 1.2
 *
 * @param deadline - Human-readable deadline string (e.g. "Jul 18, 2025 at 5:00 PM")
 */
export async function notifyDeadlineApproaching(deadline: string): Promise<void> {
  await sendOsNotification(
    "Review Deadline Approaching",
    `Peer review submission deadline in 24 hours (${deadline}).`,
  );
}

/**
 * Notify all founders that peer review results are now available.
 *
 * Requirement: 1.2
 */
export async function notifyReviewResultsAvailable(): Promise<void> {
  await sendOsNotification(
    "Review Results Available",
    "Peer review results are now available. View them on the Founder Review screen.",
  );
}

/**
 * Notify founders when an accountability warning is issued.
 *
 * Requirement: 1.2
 *
 * @param founderName - Name of the founder who received the warning
 */
export async function notifyAccountabilityWarning(founderName: string): Promise<void> {
  await sendOsNotification(
    "Accountability Warning Issued",
    `An accountability warning has been issued to ${founderName}.`,
  );
}

/**
 * Notify founders when a dilution event is triggered due to consecutive warnings.
 *
 * Requirements: 2.5, 6.5
 *
 * @param founderName - Name of the founder whose equity was diluted
 * @param dilutionPct - The percentage of equity diluted (e.g. 1.0)
 */
export async function notifyDilutionTriggered(
  founderName: string,
  dilutionPct: number,
): Promise<void> {
  await sendOsNotification(
    "Equity Dilution Triggered",
    `${founderName}'s equity has been reduced by ${dilutionPct}% due to consecutive accountability warnings.`,
  );
}
