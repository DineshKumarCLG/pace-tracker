import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createWorkspaceProof,
  isProofRequired,
  hasCheckinProof,
  hasCheckoutProof,
  isMissedCheckout,
} from "@/lib/workspaceProof";
import type { WorkspaceProof, Session } from "@/types";

/**
 * Property 43: Session requires proof
 *
 * Every session start must have exactly one checkin proof record.
 * Every session end must have exactly one checkout proof record.
 * No session can exist without at least a checkin proof.
 *
 * This models the mandatory proof enforcement invariant: the system
 * never allows a session to start without a checkin proof, and never
 * allows a session to end without a checkout proof.
 *
 * **Validates: Requirements 18.7, 18.8**
 */

// --- In-memory session + proof manager mirroring the mandatory proof gate ---

interface SessionProofManager {
  sessions: Session[];
  proofs: WorkspaceProof[];
}

type StartResult =
  | { ok: true; session: Session; proof: WorkspaceProof }
  | { ok: false; error: string };

type EndResult =
  | { ok: true; proof: WorkspaceProof }
  | { ok: false; error: string };

function createManager(): SessionProofManager {
  return { sessions: [], proofs: [] };
}

let proofIdCounter = 0;

/**
 * Start a session — requires a valid proof (photo + hash).
 * Mirrors the gate in StartSessionFlow: session CANNOT start without proof.
 */
function startSession(
  mgr: SessionProofManager,
  sessionId: string,
  userId: string,
  startTime: number,
  photoPath: string,
  photoHash: string,
): StartResult {
  // Proof is always required (no skip, no bypass)
  if (!isProofRequired("checkin")) {
    return { ok: false, error: "Proof not required (should never happen)" };
  }

  // Validate photo inputs (same as createWorkspaceProof)
  if (!photoPath || photoPath.trim().length === 0) {
    return { ok: false, error: "Photo is required for workspace proof" };
  }
  if (!photoHash || photoHash.trim().length === 0) {
    return { ok: false, error: "Photo hash is required for workspace proof" };
  }

  // Create the checkin proof
  proofIdCounter += 1;
  const proof = createWorkspaceProof(
    `proof-${proofIdCounter}`,
    sessionId,
    userId,
    "checkin",
    photoPath,
    photoHash,
    null,
    null,
    null,
    null,
  );

  // Create the session
  const session: Session = {
    id: sessionId,
    userId,
    startTime,
    endTime: null,
    startType: "manual",
    startVerified: true,
    outputNote: null,
    lastHeartbeat: null,
    syncedAt: null,
    createdAt: startTime,
  };

  mgr.sessions.push(session);
  mgr.proofs.push(proof);

  return { ok: true, session, proof };
}

/**
 * End a session — requires a valid checkout proof.
 * Mirrors the gate in EndDayFlow: session CANNOT end without proof.
 */
function endSession(
  mgr: SessionProofManager,
  sessionId: string,
  userId: string,
  endTime: number,
  photoPath: string,
  photoHash: string,
): EndResult {
  const session = mgr.sessions.find(
    (s) => s.id === sessionId && s.endTime === null,
  );
  if (!session) {
    return { ok: false, error: "No active session found" };
  }

  // Proof is always required (no skip, no bypass)
  if (!isProofRequired("checkout")) {
    return { ok: false, error: "Proof not required (should never happen)" };
  }

  if (!photoPath || photoPath.trim().length === 0) {
    return { ok: false, error: "Photo is required for workspace proof" };
  }
  if (!photoHash || photoHash.trim().length === 0) {
    return { ok: false, error: "Photo hash is required for workspace proof" };
  }

  // Create the checkout proof
  proofIdCounter += 1;
  const proof = createWorkspaceProof(
    `proof-${proofIdCounter}`,
    sessionId,
    userId,
    "checkout",
    photoPath,
    photoHash,
    null,
    null,
    null,
    null,
  );

  session.endTime = endTime;
  mgr.proofs.push(proof);

  return { ok: true, proof };
}

// --- Arbitraries ---

const userIdArb = fc.constantFrom("user-a", "user-b", "user-c");
const timestampArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });
const photoPathArb = fc.constantFrom(
  "proofs/photo1.jpg",
  "proofs/photo2.jpg",
  "proofs/webcam-capture.jpg",
);
const photoHashArb = fc.stringMatching(/^[a-f0-9]{8}$/);

describe("Property 43: Session requires proof", () => {
  it("session start always produces exactly one checkin proof", () => {
    fc.assert(
      fc.property(
        userIdArb,
        timestampArb,
        photoPathArb,
        photoHashArb,
        (userId, startTime, photoPath, photoHash) => {
          proofIdCounter = 0;
          const mgr = createManager();
          const sessionId = `session-${startTime}`;

          const result = startSession(
            mgr,
            sessionId,
            userId,
            startTime,
            photoPath,
            photoHash,
          );

          expect(result.ok).toBe(true);

          // Exactly one checkin proof for this session
          const checkinProofs = mgr.proofs.filter(
            (p) => p.sessionId === sessionId && p.type === "checkin",
          );
          expect(checkinProofs.length).toBe(1);

          // hasCheckinProof utility agrees
          expect(hasCheckinProof(sessionId, mgr.proofs)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("session end always produces exactly one checkout proof", () => {
    fc.assert(
      fc.property(
        userIdArb,
        timestampArb,
        timestampArb,
        photoPathArb,
        photoHashArb,
        photoPathArb,
        photoHashArb,
        (userId, startTime, endOffset, startPhoto, startHash, endPhoto, endHash) => {
          proofIdCounter = 0;
          const mgr = createManager();
          const sessionId = `session-${startTime}`;
          const endTime = startTime + Math.abs(endOffset % 36000) + 1;

          // Start session with checkin proof
          startSession(mgr, sessionId, userId, startTime, startPhoto, startHash);

          // End session with checkout proof
          const result = endSession(
            mgr,
            sessionId,
            userId,
            endTime,
            endPhoto,
            endHash,
          );

          expect(result.ok).toBe(true);

          // Exactly one checkout proof for this session
          const checkoutProofs = mgr.proofs.filter(
            (p) => p.sessionId === sessionId && p.type === "checkout",
          );
          expect(checkoutProofs.length).toBe(1);

          // hasCheckoutProof utility agrees
          expect(hasCheckoutProof(sessionId, mgr.proofs)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("no session exists without at least a checkin proof", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            userId: userIdArb,
            startTime: timestampArb,
            photoPath: photoPathArb,
            photoHash: photoHashArb,
            shouldEnd: fc.boolean(),
            endPhotoPath: photoPathArb,
            endPhotoHash: photoHashArb,
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (ops) => {
          proofIdCounter = 0;
          const mgr = createManager();

          for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            const sessionId = `session-${i}`;

            startSession(
              mgr,
              sessionId,
              op.userId,
              op.startTime,
              op.photoPath,
              op.photoHash,
            );

            if (op.shouldEnd) {
              endSession(
                mgr,
                sessionId,
                op.userId,
                op.startTime + 3600,
                op.endPhotoPath,
                op.endPhotoHash,
              );
            }
          }

          // INVARIANT: every session in the manager has a checkin proof
          for (const session of mgr.sessions) {
            expect(hasCheckinProof(session.id, mgr.proofs)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("ended sessions have both checkin and checkout proofs", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            userId: userIdArb,
            startTime: timestampArb,
            photoPath: photoPathArb,
            photoHash: photoHashArb,
            endPhotoPath: photoPathArb,
            endPhotoHash: photoHashArb,
          }),
          { minLength: 1, maxLength: 15 },
        ),
        (ops) => {
          proofIdCounter = 0;
          const mgr = createManager();

          // Start and end all sessions
          for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            const sessionId = `session-${i}`;

            startSession(
              mgr,
              sessionId,
              op.userId,
              op.startTime,
              op.photoPath,
              op.photoHash,
            );

            endSession(
              mgr,
              sessionId,
              op.userId,
              op.startTime + 3600,
              op.endPhotoPath,
              op.endPhotoHash,
            );
          }

          // INVARIANT: every ended session has exactly 1 checkin + 1 checkout
          for (const session of mgr.sessions) {
            expect(session.endTime).not.toBeNull();

            const checkins = mgr.proofs.filter(
              (p) => p.sessionId === session.id && p.type === "checkin",
            );
            const checkouts = mgr.proofs.filter(
              (p) => p.sessionId === session.id && p.type === "checkout",
            );

            expect(checkins.length).toBe(1);
            expect(checkouts.length).toBe(1);

            // isMissedCheckout should be false for properly ended sessions
            expect(isMissedCheckout(session, mgr.proofs)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("session without checkout proof is detected as missed checkout", () => {
    fc.assert(
      fc.property(
        userIdArb,
        timestampArb,
        photoPathArb,
        photoHashArb,
        (userId, startTime, photoPath, photoHash) => {
          proofIdCounter = 0;
          const mgr = createManager();
          const sessionId = `session-${startTime}`;

          // Start session with checkin proof
          startSession(mgr, sessionId, userId, startTime, photoPath, photoHash);

          // Simulate crash: set endTime directly without checkout proof
          const session = mgr.sessions[0];
          session.endTime = startTime + 3600;

          // Has checkin but no checkout
          expect(hasCheckinProof(sessionId, mgr.proofs)).toBe(true);
          expect(hasCheckoutProof(sessionId, mgr.proofs)).toBe(false);

          // isMissedCheckout detects this
          expect(isMissedCheckout(session, mgr.proofs)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("session start without photo is rejected (proof is mandatory)", () => {
    fc.assert(
      fc.property(
        userIdArb,
        timestampArb,
        fc.constantFrom("", "  ", ""),
        photoHashArb,
        (userId, startTime, emptyPath, photoHash) => {
          proofIdCounter = 0;
          const mgr = createManager();
          const sessionId = `session-${startTime}`;

          const result = startSession(
            mgr,
            sessionId,
            userId,
            startTime,
            emptyPath,
            photoHash,
          );

          // Should be rejected — no session created
          expect(result.ok).toBe(false);
          expect(mgr.sessions.length).toBe(0);
          expect(mgr.proofs.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
