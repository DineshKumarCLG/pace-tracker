import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { getStatusLabel } from "@/stores/teamStore";
import type { TeamMemberStatus } from "@/types";

/**
 * Property 12: Team Status Label Correctness
 *
 * For any team member displayed in the Team view, the status label is exactly
 * one of "Active", "On Break", "Away", or "Offline". When a team member is
 * idle, the label contains "Away" and never contains "Idle" or
 * surveillance-related language.
 *
 * **Validates: Requirements 15.3, 15.4**
 */

const VALID_LABELS = ["Active", "On Break", "Away", "Offline"] as const;
const BANNED_WORDS = ["idle", "tracked", "monitored", "surveillance", "watching", "spying"];

const statusArb: fc.Arbitrary<TeamMemberStatus> = fc.constantFrom(
  "active" as const,
  "on_break" as const,
  "away" as const,
  "offline" as const,
);

describe("Property 12: Team Status Label Correctness", () => {
  it("status label is exactly one of the four allowed values for any status", () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        const label = getStatusLabel(status);
        expect(VALID_LABELS).toContain(label);
      }),
      { numRuns: 200 },
    );
  });

  it("idle/away members show 'Away', never 'Idle' or surveillance language", () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        const label = getStatusLabel(status);
        const lower = label.toLowerCase();

        // No banned words in any label
        for (const banned of BANNED_WORDS) {
          expect(lower).not.toContain(banned);
        }

        // "away" status specifically maps to "Away"
        if (status === "away") {
          expect(label).toBe("Away");
        }
      }),
      { numRuns: 200 },
    );
  });

  it("getStatusLabel is a total function — every valid status produces a label", () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        const label = getStatusLabel(status);
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it("the mapping is deterministic — same status always yields same label", () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        const label1 = getStatusLabel(status);
        const label2 = getStatusLabel(status);
        expect(label1).toBe(label2);
      }),
      { numRuns: 200 },
    );
  });
});
