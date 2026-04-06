/**
 * Tests for OS notification helpers.
 *
 * Since we're not running inside Tauri, all functions should gracefully no-op.
 * We verify they don't throw and resolve cleanly.
 *
 * Requirements: 6.4, 7.3, 12.4, 24.4
 */

import { describe, it, expect } from "vitest";
import {
  notifyLeaveSubmission,
  notifyLeaveDecline,
  notifySyncConflict,
  notifyMorningDigest,
} from "@/lib/notifications";

describe("notifyLeaveSubmission", () => {
  it("does not throw outside Tauri (graceful fallback)", async () => {
    await expect(
      notifyLeaveSubmission("Alice", "annual", "Jul 16", "Jul 18"),
    ).resolves.toBeUndefined();
  });

  it("handles WFH type without error", async () => {
    await expect(
      notifyLeaveSubmission("Bob", "wfh", "Jul 20", "Jul 20"),
    ).resolves.toBeUndefined();
  });

  it("handles sick type without error", async () => {
    await expect(
      notifyLeaveSubmission("Charlie", "sick", "Jul 21", "Jul 22"),
    ).resolves.toBeUndefined();
  });
});

describe("notifyLeaveDecline", () => {
  it("does not throw outside Tauri (graceful fallback)", async () => {
    await expect(
      notifyLeaveDecline("Team needs you that week"),
    ).resolves.toBeUndefined();
  });
});

describe("notifySyncConflict", () => {
  it("does not throw outside Tauri (graceful fallback)", async () => {
    await expect(
      notifySyncConflict("Leave request lr-123 had a conflict."),
    ).resolves.toBeUndefined();
  });
});

describe("notifyMorningDigest", () => {
  it("does not throw outside Tauri (graceful fallback)", async () => {
    await expect(notifyMorningDigest()).resolves.toBeUndefined();
  });
});
