import { describe, it, expect } from "vitest";
import {
  createWorkspaceProof,
  isProofRequired,
  isMissedCheckout,
  hasCheckinProof,
  hasCheckoutProof,
  getVerificationLabel,
} from "@/lib/workspaceProof";
import type { Session, WorkspaceProof } from "@/types";

// --- Helpers ---

function makeSession(id: string, endTime: number | null): Session {
  return {
    id,
    userId: "user-1",
    startTime: 1_700_000_000,
    endTime,
    startType: "manual",
    startVerified: true,
    outputNote: null,
    lastHeartbeat: null,
    syncedAt: null,
    createdAt: 1_700_000_000,
  };
}

function makeProof(
  id: string,
  sessionId: string,
  type: "checkin" | "checkout",
): WorkspaceProof {
  return {
    id,
    sessionId,
    userId: "user-1",
    type,
    photoPath: "/photos/test.jpg",
    photoHash: "abc123",
    lat: 12.97,
    lng: 77.59,
    accuracy: 50,
    locationId: "loc-1",
    aiVerified: "pending",
    aiReason: null,
    exifTimestamp: null,
    createdAt: 1_700_000_000,
  };
}

describe("createWorkspaceProof", () => {
  it("creates a valid checkin proof", () => {
    const proof = createWorkspaceProof(
      "p-1", "s-1", "u-1", "checkin",
      "/photos/test.jpg", "hash123",
      12.97, 77.59, 50, "loc-1",
    );

    expect(proof.id).toBe("p-1");
    expect(proof.type).toBe("checkin");
    expect(proof.aiVerified).toBe("pending");
    expect(proof.photoPath).toBe("/photos/test.jpg");
  });

  it("creates a valid checkout proof", () => {
    const proof = createWorkspaceProof(
      "p-2", "s-1", "u-1", "checkout",
      "/photos/out.jpg", "hash456",
      null, null, null, null,
    );

    expect(proof.type).toBe("checkout");
    expect(proof.lat).toBeNull();
  });

  it("throws on empty photo path", () => {
    expect(() =>
      createWorkspaceProof("p-1", "s-1", "u-1", "checkin", "", "hash", 0, 0, 0, null),
    ).toThrow("Photo is required");
  });

  it("throws on empty photo hash", () => {
    expect(() =>
      createWorkspaceProof("p-1", "s-1", "u-1", "checkin", "/photo.jpg", "", 0, 0, 0, null),
    ).toThrow("Photo hash is required");
  });

  it("stores EXIF timestamp when provided", () => {
    const proof = createWorkspaceProof(
      "p-1", "s-1", "u-1", "checkin",
      "/photo.jpg", "hash", 0, 0, 0, null, 1_700_000_100,
    );
    expect(proof.exifTimestamp).toBe(1_700_000_100);
  });
});

describe("isProofRequired", () => {
  it("always returns true for checkin", () => {
    expect(isProofRequired("checkin")).toBe(true);
  });

  it("always returns true for checkout", () => {
    expect(isProofRequired("checkout")).toBe(true);
  });
});

describe("isMissedCheckout", () => {
  it("returns true for ended session without checkout proof", () => {
    const session = makeSession("s-1", 1_700_003_600);
    const proofs = [makeProof("p-1", "s-1", "checkin")];

    expect(isMissedCheckout(session, proofs)).toBe(true);
  });

  it("returns false for ended session with checkout proof", () => {
    const session = makeSession("s-1", 1_700_003_600);
    const proofs = [
      makeProof("p-1", "s-1", "checkin"),
      makeProof("p-2", "s-1", "checkout"),
    ];

    expect(isMissedCheckout(session, proofs)).toBe(false);
  });

  it("returns false for active session (no endTime)", () => {
    const session = makeSession("s-1", null);
    expect(isMissedCheckout(session, [])).toBe(false);
  });
});

describe("hasCheckinProof / hasCheckoutProof", () => {
  const proofs = [
    makeProof("p-1", "s-1", "checkin"),
    makeProof("p-2", "s-1", "checkout"),
  ];

  it("detects checkin proof", () => {
    expect(hasCheckinProof("s-1", proofs)).toBe(true);
    expect(hasCheckinProof("s-2", proofs)).toBe(false);
  });

  it("detects checkout proof", () => {
    expect(hasCheckoutProof("s-1", proofs)).toBe(true);
    expect(hasCheckoutProof("s-2", proofs)).toBe(false);
  });
});

describe("getVerificationLabel", () => {
  it("returns correct labels for all statuses", () => {
    expect(getVerificationLabel("yes")).toBe("Verified");
    expect(getVerificationLabel("no")).toBe("AI Flagged");
    expect(getVerificationLabel("pending")).toBe("Pending");
    expect(getVerificationLabel("unavailable")).toBe("Unverified");
  });
});
