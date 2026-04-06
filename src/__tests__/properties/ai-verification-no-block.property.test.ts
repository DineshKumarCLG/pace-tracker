import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createWorkspaceProof,
  isProofRequired,
  getVerificationLabel,
} from "@/lib/workspaceProof";
import type { WorkspaceProof } from "@/types";

/**
 * Property 42: AI verification never blocks session
 *
 * Regardless of AI response (yes/no/unavailable/pending), session start
 * and end are never blocked. The proof creation always succeeds, and
 * isProofRequired always returns true (proof is about photo+location,
 * not AI verification).
 *
 * **Validates: Requirements 18.9, 18.10**
 */

// --- Arbitraries ---

const aiStatusArb = fc.constantFrom<WorkspaceProof["aiVerified"]>(
  "yes",
  "no",
  "pending",
  "unavailable",
);

const proofTypeArb = fc.constantFrom<"checkin" | "checkout">("checkin", "checkout");

describe("Property 42: AI verification never blocks session", () => {
  it("proof creation succeeds regardless of future AI status", () => {
    fc.assert(
      fc.property(
        proofTypeArb,
        fc.stringMatching(/^[a-zA-Z0-9/._-]{1,50}$/),
        fc.stringMatching(/^[a-f0-9]{4,16}$/),
        (type, photoPath, photoHash) => {
          // Proof creation should always succeed with valid inputs
          const proof = createWorkspaceProof(
            "proof-1",
            "session-1",
            "user-1",
            type,
            photoPath,
            photoHash,
            12.97,
            77.59,
            50,
            "loc-1",
          );

          // Initial state is always "pending" — never blocks
          expect(proof.aiVerified).toBe("pending");
          expect(proof.id).toBe("proof-1");
          expect(proof.type).toBe(type);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("isProofRequired always returns true regardless of AI status", () => {
    fc.assert(
      fc.property(proofTypeArb, (type) => {
        expect(isProofRequired(type)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it("all AI verification statuses produce valid display labels (never errors)", () => {
    fc.assert(
      fc.property(aiStatusArb, (status) => {
        const label = getVerificationLabel(status);

        // Label should always be a non-empty string — never throws
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("AI status does not affect proof record validity", () => {
    fc.assert(
      fc.property(
        aiStatusArb,
        proofTypeArb,
        (aiStatus, type) => {
          // Create a proof and simulate AI updating it
          const proof = createWorkspaceProof(
            "proof-1",
            "session-1",
            "user-1",
            type,
            "/photos/test.jpg",
            "abc123",
            12.97,
            77.59,
            50,
            "loc-1",
          );

          // Simulate AI updating the status (as would happen async)
          const updatedProof: WorkspaceProof = {
            ...proof,
            aiVerified: aiStatus,
            aiReason: aiStatus === "no" ? "Not a workspace" : null,
          };

          // The proof is still valid regardless of AI status
          expect(updatedProof.sessionId).toBe("session-1");
          expect(updatedProof.photoPath).toBe("/photos/test.jpg");
          expect(updatedProof.type).toBe(type);

          // Session should never be blocked by AI status
          // (isProofRequired checks photo+location, not AI)
          expect(isProofRequired(type)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
