/**
 * OS notification helpers for PACE v2 Team Ops.
 *
 * All functions use @tauri-apps/plugin-notification with graceful fallback:
 * if not running in Tauri or permissions are denied, they silently no-op.
 *
 * Requirements: 6.4, 7.3, 12.4, 24.4
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

/**
 * Notify the founder that the morning digest is ready.
 *
 * Requirement: 12.4
 */
export async function notifyMorningDigest(): Promise<void> {
  await sendOsNotification(
    "Morning Digest Ready",
    "Your team's morning digest is ready. Check the Daily Digest screen for yesterday's summary.",
  );
}
