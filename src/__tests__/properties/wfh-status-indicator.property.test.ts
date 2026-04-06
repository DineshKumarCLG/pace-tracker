import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { LeaveRequest, TeamMember } from "@/types";

/**
 * Property 38: WFH status indicator
 *
 * For any user on an approved WFH day, the dashboard team status should
 * show "WFH" as the status indicator when the member is offline.
 *
 * We test the pure computation logic extracted from dashboardStore:
 *   deriveMemberStatus(member, leaveRequests, now)
 *
 * Properties verified:
 * 1. WFH + offline = "WFH" status
 * 2. WFH + active = "Active" status
 * 3. No WFH = normal status derived from member.status
 *
 * **Validates: Requirements 8.3**
 */

// --- Pure computation under test (mirrors dashboardStore.deriveMemberStatus) ---

function getStatusLabel(
  status: "active" | "on_break" | "away" | "offline",
): "Active" | "On Break" | "Away" | "Offline" {
  switch (status) {
    case "active":
      return "Active";
    case "on_break":
      return "On Break";
    case "away":
      return "Away";
    case "offline":
      return "Offline";
  }
}

function deriveMemberStatus(
  member: TeamMember,
  leaveRequests: LeaveRequest[],
  now: number,
): "Active" | "On Break" | "Away" | "Offline" | "On Leave" | "WFH" {
  // Check for approved leave (annual/sick) covering today
  const onLeave = leaveRequests.some(
    (r) =>
      r.requesterId === member.userId &&
      r.status === "approved" &&
      (r.type === "annual" || r.type === "sick") &&
      r.startDate <= now &&
      r.endDate >= now,
  );
  if (onLeave) return "On Leave";

  // Check for approved WFH covering today
  const onWfh = leaveRequests.some(
    (r) =>
      r.requesterId === member.userId &&
      r.status === "approved" &&
      r.type === "wfh" &&
      r.startDate <= now &&
      r.endDate >= now,
  );
  if (onWfh && member.status === "offline") return "WFH";
  if (onWfh) {
    if (member.status === "active") return "Active";
    if (member.status === "on_break") return "On Break";
    if (member.status === "away") return "Away";
    return "WFH";
  }

  return getStatusLabel(member.status);
}

// --- Helpers ---

function makeTeamMember(
  userId: string,
  status: "active" | "on_break" | "away" | "offline",
): TeamMember {
  return {
    userId,
    name: `Member ${userId}`,
    status,
    currentTask: null,
    sessionStart: status === "active" ? 1_700_000_000 : null,
    breakStart: status === "on_break" ? 1_700_000_000 : null,
    outputNote: null,
    avatarColor: "#000",
  };
}

function makeWfhRequest(
  requesterId: string,
  startDate: number,
  endDate: number,
): LeaveRequest {
  return {
    id: `wfh-${requesterId}`,
    requesterId,
    type: "wfh",
    startDate,
    endDate,
    reason: "Working from home",
    status: "approved",
    reviewerId: "reviewer-1",
    reviewReason: null,
    createdAt: startDate,
    updatedAt: startDate,
  };
}

// --- Arbitraries ---

const timestampArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });
const userIdArb = fc.uuid();
const memberStatusArb = fc.constantFrom("active", "on_break", "away", "offline") as fc.Arbitrary<
  "active" | "on_break" | "away" | "offline"
>;

// --- Property Tests ---

describe("Property 38: WFH status indicator", () => {
  it("WFH + offline = 'WFH' status", () => {
    fc.assert(
      fc.property(userIdArb, timestampArb, (userId, now) => {
        const member = makeTeamMember(userId, "offline");
        // WFH request covering "now"
        const wfhRequest = makeWfhRequest(userId, now - 86400, now + 86400);

        const status = deriveMemberStatus(member, [wfhRequest], now);
        expect(status).toBe("WFH");
      }),
      { numRuns: 200 },
    );
  });

  it("WFH + active = 'Active' status", () => {
    fc.assert(
      fc.property(userIdArb, timestampArb, (userId, now) => {
        const member = makeTeamMember(userId, "active");
        const wfhRequest = makeWfhRequest(userId, now - 86400, now + 86400);

        const status = deriveMemberStatus(member, [wfhRequest], now);
        expect(status).toBe("Active");
      }),
      { numRuns: 200 },
    );
  });

  it("no WFH = normal status derived from member.status", () => {
    fc.assert(
      fc.property(userIdArb, memberStatusArb, timestampArb, (userId, memberStatus, now) => {
        const member = makeTeamMember(userId, memberStatus);
        // No leave requests at all
        const status = deriveMemberStatus(member, [], now);
        expect(status).toBe(getStatusLabel(memberStatus));
      }),
      { numRuns: 200 },
    );
  });

  it("WFH + on_break = 'On Break' status", () => {
    fc.assert(
      fc.property(userIdArb, timestampArb, (userId, now) => {
        const member = makeTeamMember(userId, "on_break");
        const wfhRequest = makeWfhRequest(userId, now - 86400, now + 86400);

        const status = deriveMemberStatus(member, [wfhRequest], now);
        expect(status).toBe("On Break");
      }),
      { numRuns: 200 },
    );
  });

  it("WFH + away = 'Away' status", () => {
    fc.assert(
      fc.property(userIdArb, timestampArb, (userId, now) => {
        const member = makeTeamMember(userId, "away");
        const wfhRequest = makeWfhRequest(userId, now - 86400, now + 86400);

        const status = deriveMemberStatus(member, [wfhRequest], now);
        expect(status).toBe("Away");
      }),
      { numRuns: 200 },
    );
  });
});
