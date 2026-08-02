import { describe, it, expect } from "vitest";
import {
  isWeekend,
  isPublicHoliday,
  enumerateDays,
  countBusinessDays,
  computeLeaveBalance,
  validateLeaveRequest,
  ANNUAL_ALLOCATION,
  SICK_ALLOCATION,
} from "@/lib/leave";
import type { LeaveRequest, PublicHoliday } from "@/types";

// Helper: UTC midnight timestamp for a given date
function utc(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

function makeHoliday(
  year: number,
  month: number,
  day: number,
  name: string,
): PublicHoliday {
  return {
    id: `h-${year}-${month}-${day}`,
    date: utc(year, month, day),
    name,
    year,
    createdAt: utc(year, 1, 1),
  };
}

function makeRequest(
  overrides: Partial<LeaveRequest> & Pick<LeaveRequest, "requesterId" | "type" | "startDate" | "endDate" | "status">,
): LeaveRequest {
  return {
    id: `lr-${Math.random().toString(36).slice(2, 8)}`,
    reason: "",
    reviewerId: null,
    reviewReason: null,
    createdAt: overrides.startDate,
    updatedAt: overrides.startDate,
    ...overrides,
  };
}

describe("isWeekend", () => {
  it("identifies Saturday as weekend", () => {
    // 2025-01-04 is a Saturday
    expect(isWeekend(utc(2025, 1, 4))).toBe(true);
  });

  it("identifies Sunday as weekend", () => {
    // 2025-01-05 is a Sunday
    expect(isWeekend(utc(2025, 1, 5))).toBe(true);
  });

  it("identifies Monday as weekday", () => {
    // 2025-01-06 is a Monday
    expect(isWeekend(utc(2025, 1, 6))).toBe(false);
  });

  it("identifies Friday as weekday", () => {
    // 2025-01-03 is a Friday
    expect(isWeekend(utc(2025, 1, 3))).toBe(false);
  });
});

describe("isPublicHoliday", () => {
  const holidays = [
    makeHoliday(2025, 1, 1, "New Year's Day"),
    makeHoliday(2025, 12, 25, "Christmas Day"),
  ];

  it("returns true for a matching holiday date", () => {
    expect(isPublicHoliday(utc(2025, 1, 1), holidays)).toBe(true);
  });

  it("returns false for a non-holiday date", () => {
    expect(isPublicHoliday(utc(2025, 1, 2), holidays)).toBe(false);
  });

  it("returns false with empty holidays list", () => {
    expect(isPublicHoliday(utc(2025, 1, 1), [])).toBe(false);
  });
});

describe("enumerateDays", () => {
  it("returns a single day for same start and end", () => {
    const days = enumerateDays(utc(2025, 3, 10), utc(2025, 3, 10));
    expect(days).toHaveLength(1);
  });

  it("returns correct number of days for a range", () => {
    // Mon Mar 10 to Fri Mar 14 = 5 days
    const days = enumerateDays(utc(2025, 3, 10), utc(2025, 3, 14));
    expect(days).toHaveLength(5);
  });

  it("handles month boundaries", () => {
    // Jan 30 to Feb 2 = 4 days
    const days = enumerateDays(utc(2025, 1, 30), utc(2025, 2, 2));
    expect(days).toHaveLength(4);
  });
});

describe("countBusinessDays", () => {
  it("counts only weekdays in a Mon-Fri range", () => {
    // Mon Mar 10 to Fri Mar 14, 2025 = 5 business days
    expect(countBusinessDays(utc(2025, 3, 10), utc(2025, 3, 14), [])).toBe(5);
  });

  it("excludes weekends", () => {
    // Mon Mar 10 to Sun Mar 16, 2025 = 5 business days (Sat+Sun excluded)
    expect(countBusinessDays(utc(2025, 3, 10), utc(2025, 3, 16), [])).toBe(5);
  });

  it("excludes public holidays", () => {
    const holidays = [makeHoliday(2025, 3, 12, "Holiday")];
    // Mon Mar 10 to Fri Mar 14 minus 1 holiday = 4 business days
    expect(countBusinessDays(utc(2025, 3, 10), utc(2025, 3, 14), holidays)).toBe(4);
  });

  it("excludes holidays that fall on weekends (no double-count)", () => {
    // Holiday on Saturday — should still be 5 business days Mon-Fri
    const holidays = [makeHoliday(2025, 3, 15, "Saturday Holiday")];
    expect(countBusinessDays(utc(2025, 3, 10), utc(2025, 3, 16), holidays)).toBe(5);
  });
});

describe("computeLeaveBalance", () => {
  const userId = "user-1";
  const year = 2025;

  it("returns full allocation with no requests", () => {
    const balance = computeLeaveBalance(userId, year, [], []);
    expect(balance.annualAllocated).toBe(ANNUAL_ALLOCATION);
    expect(balance.annualUsed).toBe(0);
    expect(balance.annualRemaining).toBe(ANNUAL_ALLOCATION);
    expect(balance.sickAllocated).toBe(SICK_ALLOCATION);
    expect(balance.sickUsed).toBe(0);
    expect(balance.sickRemaining).toBe(SICK_ALLOCATION);
  });

  it("deducts approved annual leave business days", () => {
    const requests: LeaveRequest[] = [
      makeRequest({
        requesterId: userId,
        type: "annual",
        status: "approved",
        startDate: utc(2025, 3, 10), // Mon
        endDate: utc(2025, 3, 14), // Fri — 5 business days
      }),
    ];
    const balance = computeLeaveBalance(userId, year, requests, []);
    expect(balance.annualUsed).toBe(5);
    expect(balance.annualRemaining).toBe(15);
  });

  it("deducts approved sick leave business days", () => {
    const requests: LeaveRequest[] = [
      makeRequest({
        requesterId: userId,
        type: "sick",
        status: "approved",
        startDate: utc(2025, 4, 7), // Mon
        endDate: utc(2025, 4, 9), // Wed — 3 business days
      }),
    ];
    const balance = computeLeaveBalance(userId, year, requests, []);
    expect(balance.sickUsed).toBe(3);
    expect(balance.sickRemaining).toBe(7);
  });

  it("does not count WFH requests against any balance", () => {
    const requests: LeaveRequest[] = [
      makeRequest({
        requesterId: userId,
        type: "wfh",
        status: "approved",
        startDate: utc(2025, 3, 10),
        endDate: utc(2025, 3, 14),
      }),
    ];
    const balance = computeLeaveBalance(userId, year, requests, []);
    expect(balance.annualUsed).toBe(0);
    expect(balance.annualRemaining).toBe(ANNUAL_ALLOCATION);
    expect(balance.sickUsed).toBe(0);
    expect(balance.sickRemaining).toBe(SICK_ALLOCATION);
  });

  it("does not count pending or declined requests", () => {
    const requests: LeaveRequest[] = [
      makeRequest({
        requesterId: userId,
        type: "annual",
        status: "pending",
        startDate: utc(2025, 3, 10),
        endDate: utc(2025, 3, 14),
      }),
      makeRequest({
        requesterId: userId,
        type: "annual",
        status: "declined",
        startDate: utc(2025, 4, 7),
        endDate: utc(2025, 4, 11),
      }),
    ];
    const balance = computeLeaveBalance(userId, year, requests, []);
    expect(balance.annualUsed).toBe(0);
    expect(balance.annualRemaining).toBe(ANNUAL_ALLOCATION);
  });

  it("excludes public holidays from leave day count", () => {
    const holidays = [makeHoliday(2025, 3, 12, "Mid-week Holiday")];
    const requests: LeaveRequest[] = [
      makeRequest({
        requesterId: userId,
        type: "annual",
        status: "approved",
        startDate: utc(2025, 3, 10), // Mon
        endDate: utc(2025, 3, 14), // Fri — 5 days minus 1 holiday = 4
      }),
    ];
    const balance = computeLeaveBalance(userId, year, requests, holidays);
    expect(balance.annualUsed).toBe(4);
    expect(balance.annualRemaining).toBe(16);
  });

  it("does not count other users' requests", () => {
    const requests: LeaveRequest[] = [
      makeRequest({
        requesterId: "other-user",
        type: "annual",
        status: "approved",
        startDate: utc(2025, 3, 10),
        endDate: utc(2025, 3, 14),
      }),
    ];
    const balance = computeLeaveBalance(userId, year, requests, []);
    expect(balance.annualUsed).toBe(0);
    expect(balance.annualRemaining).toBe(ANNUAL_ALLOCATION);
  });

  it("remaining = allocated - used invariant holds", () => {
    const requests: LeaveRequest[] = [
      makeRequest({
        requesterId: userId,
        type: "annual",
        status: "approved",
        startDate: utc(2025, 2, 3),
        endDate: utc(2025, 2, 7),
      }),
      makeRequest({
        requesterId: userId,
        type: "sick",
        status: "approved",
        startDate: utc(2025, 5, 2),
        endDate: utc(2025, 5, 4),
      }),
    ];
    const balance = computeLeaveBalance(userId, year, requests, []);
    expect(balance.annualRemaining).toBe(balance.annualAllocated - balance.annualUsed);
    expect(balance.sickRemaining).toBe(balance.sickAllocated - balance.sickUsed);
  });
});

describe("validateLeaveRequest", () => {
  const userId = "user-1";

  it("rejects when startDate >= endDate", () => {
    const result = validateLeaveRequest(
      userId,
      "annual",
      utc(2025, 3, 14),
      utc(2025, 3, 10),
      [],
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Start date must be before end date");
  });

  it("rejects when startDate equals endDate", () => {
    const result = validateLeaveRequest(
      userId,
      "annual",
      utc(2025, 3, 10),
      utc(2025, 3, 10),
      [],
      [],
    );
    expect(result.valid).toBe(false);
  });

  it("rejects when no business days in range (weekend only)", () => {
    // Sat Mar 15 to Sun Mar 16
    const result = validateLeaveRequest(
      userId,
      "annual",
      utc(2025, 3, 15),
      utc(2025, 3, 16),
      [],
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("No business days");
  });

  it("allows WFH requests regardless of balance", () => {
    const result = validateLeaveRequest(
      userId,
      "wfh",
      utc(2025, 3, 10),
      utc(2025, 3, 14),
      [],
      [],
    );
    expect(result.valid).toBe(true);
    expect(result.requestedDays).toBe(5);
  });

  it("allows sick leave requests regardless of balance", () => {
    const result = validateLeaveRequest(
      userId,
      "sick",
      utc(2025, 3, 10),
      utc(2025, 3, 14),
      [],
      [],
    );
    expect(result.valid).toBe(true);
    expect(result.requestedDays).toBe(5);
  });

  it("allows annual leave when balance is sufficient", () => {
    const result = validateLeaveRequest(
      userId,
      "annual",
      utc(2025, 3, 10),
      utc(2025, 3, 14),
      [],
      [],
    );
    expect(result.valid).toBe(true);
    expect(result.requestedDays).toBe(5);
    expect(result.remainingBalance).toBe(15);
  });

  it("rejects annual leave when balance is insufficient", () => {
    // Use up 18 days first (4 weeks of Mon-Fri = 20 days, use ~18)
    const existingRequests: LeaveRequest[] = [
      makeRequest({
        requesterId: userId,
        type: "annual",
        status: "approved",
        startDate: utc(2025, 1, 6), // Mon
        endDate: utc(2025, 1, 10), // Fri — 5 days
      }),
      makeRequest({
        requesterId: userId,
        type: "annual",
        status: "approved",
        startDate: utc(2025, 1, 13),
        endDate: utc(2025, 1, 17), // 5 days
      }),
      makeRequest({
        requesterId: userId,
        type: "annual",
        status: "approved",
        startDate: utc(2025, 1, 20),
        endDate: utc(2025, 1, 24), // 5 days
      }),
      makeRequest({
        requesterId: userId,
        type: "annual",
        status: "approved",
        startDate: utc(2025, 1, 27),
        endDate: utc(2025, 1, 29), // 3 days (Mon-Wed)
      }),
    ];
    // 18 used, 2 remaining — requesting 5 should fail
    const result = validateLeaveRequest(
      userId,
      "annual",
      utc(2025, 3, 10),
      utc(2025, 3, 14),
      existingRequests,
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Insufficient annual leave balance");
    expect(result.remainingBalance).toBe(2);
    expect(result.requestedDays).toBe(5);
  });

  it("accounts for public holidays when validating annual leave", () => {
    const holidays = [
      makeHoliday(2025, 3, 12, "Holiday"),
      makeHoliday(2025, 3, 13, "Holiday 2"),
    ];
    // Mon-Fri with 2 holidays = 3 business days
    const result = validateLeaveRequest(
      userId,
      "annual",
      utc(2025, 3, 10),
      utc(2025, 3, 14),
      [],
      holidays,
    );
    expect(result.valid).toBe(true);
    expect(result.requestedDays).toBe(3);
  });
});


// --- Tests for createLeaveRequest ---

import { createLeaveRequest, approveLeaveRequest, declineLeaveRequest } from "@/lib/leave";
import { pb } from "@/lib/pocketbase";
import { vi, beforeEach, afterEach } from "vitest";

describe("createLeaveRequest", () => {
  const userId = "user-1";

  // Keep submission fixtures relative to the clock so the suite does not expire.
  const futureYear = new Date().getUTCFullYear() + 1;
  const futureBalanceStart = (() => {
    const date = new Date(Date.UTC(futureYear, 0, 4));
    while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
    return Math.floor(date.getTime() / 1000);
  })();
  const futureMonStart = futureBalanceStart + 147 * 86400;
  const futureFriEnd = futureMonStart + 4 * 86400;

  beforeEach(() => {
    // Mock PocketBase create to return a record with an id
    vi.spyOn(pb.collection("leave_requests"), "create").mockResolvedValue({
      id: "lr-mock-id",
      collectionId: "",
      collectionName: "leave_requests",
      created: "",
      updated: "",
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects when startDate >= endDate", async () => {
    await expect(
      createLeaveRequest(userId, "annual", futureFriEnd, futureMonStart, "vacation", [], []),
    ).rejects.toThrow("Start date must be before end date");
  });

  it("rejects when startDate equals endDate", async () => {
    await expect(
      createLeaveRequest(userId, "annual", futureMonStart, futureMonStart, "vacation", [], []),
    ).rejects.toThrow("Start date must be before end date");
  });

  it("rejects past start dates", async () => {
    const pastDate = utc(2020, 1, 6);
    const pastEnd = utc(2020, 1, 10);
    await expect(
      createLeaveRequest(userId, "annual", pastDate, pastEnd, "vacation", [], []),
    ).rejects.toThrow("Start date cannot be in the past");
  });

  it("sets status to 'approved' for sick leave", async () => {
    const result = await createLeaveRequest(
      userId,
      "sick",
      futureMonStart,
      futureFriEnd,
      "feeling unwell",
      [],
      [],
    );
    expect(result.status).toBe("approved");
    expect(result.type).toBe("sick");
  });

  it("sets status to 'pending' for annual leave", async () => {
    const result = await createLeaveRequest(
      userId,
      "annual",
      futureMonStart,
      futureFriEnd,
      "vacation",
      [],
      [],
    );
    expect(result.status).toBe("pending");
    expect(result.type).toBe("annual");
  });

  it("sets status to 'pending' for WFH", async () => {
    const result = await createLeaveRequest(
      userId,
      "wfh",
      futureMonStart,
      futureFriEnd,
      "working from home",
      [],
      [],
    );
    expect(result.status).toBe("pending");
    expect(result.type).toBe("wfh");
  });

  it("rejects annual leave when balance is insufficient", async () => {
    // Use up 18 of 20 annual days
    const existingRequests: LeaveRequest[] = [
      makeRequest({
        requesterId: userId,
        type: "annual",
        status: "approved",
        startDate: futureBalanceStart,
        endDate: futureBalanceStart + 4 * 86400, // 5 days
      }),
      makeRequest({
        requesterId: userId,
        type: "annual",
        status: "approved",
        startDate: futureBalanceStart + 7 * 86400,
        endDate: futureBalanceStart + 11 * 86400, // 5 days
      }),
      makeRequest({
        requesterId: userId,
        type: "annual",
        status: "approved",
        startDate: futureBalanceStart + 14 * 86400,
        endDate: futureBalanceStart + 18 * 86400, // 5 days
      }),
      makeRequest({
        requesterId: userId,
        type: "annual",
        status: "approved",
        startDate: futureBalanceStart + 21 * 86400,
        endDate: futureBalanceStart + 23 * 86400, // 3 days
      }),
    ];
    // 18 used, 2 remaining — requesting 5 should fail
    await expect(
      createLeaveRequest(
        userId,
        "annual",
        futureMonStart,
        futureFriEnd,
        "vacation",
        existingRequests,
        [],
      ),
    ).rejects.toThrow("Insufficient annual leave balance");
  });

  it("calls PocketBase create with correct data", async () => {
    const createSpy = vi.spyOn(pb.collection("leave_requests"), "create");

    await createLeaveRequest(
      userId,
      "wfh",
      futureMonStart,
      futureFriEnd,
      "remote day",
      [],
      [],
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    const callArg = createSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.requesterId).toBe(userId);
    expect(callArg.type).toBe("wfh");
    expect(callArg.startDate).toBe(futureMonStart);
    expect(callArg.endDate).toBe(futureFriEnd);
    expect(callArg.reason).toBe("remote day");
    expect(callArg.status).toBe("pending");
  });

  it("returns a complete LeaveRequest object", async () => {
    const result = await createLeaveRequest(
      userId,
      "sick",
      futureMonStart,
      futureFriEnd,
      "flu",
      [],
      [],
    );
    expect(result.id).toBe("lr-mock-id");
    expect(result.requesterId).toBe(userId);
    expect(result.type).toBe("sick");
    expect(result.startDate).toBe(futureMonStart);
    expect(result.endDate).toBe(futureFriEnd);
    expect(result.reason).toBe("flu");
    expect(result.status).toBe("approved");
    expect(result.reviewerId).toBeNull();
    expect(result.reviewReason).toBeNull();
    expect(result.createdAt).toBeGreaterThan(0);
    expect(result.updatedAt).toBeGreaterThan(0);
  });

  it("does not validate balance for sick leave", async () => {
    // Even with 0 sick balance remaining, sick leave should still be created
    const existingRequests: LeaveRequest[] = [
      makeRequest({
        requesterId: userId,
        type: "sick",
        status: "approved",
        startDate: futureBalanceStart + 28 * 86400,
        endDate: futureBalanceStart + 40 * 86400, // 10 business days — full sick allocation
      }),
    ];
    // Should succeed even though sick balance is exhausted
    const result = await createLeaveRequest(
      userId,
      "sick",
      futureMonStart,
      futureFriEnd,
      "still sick",
      existingRequests,
      [],
    );
    expect(result.status).toBe("approved");
  });

  it("does not validate balance for WFH", async () => {
    // WFH never checks balance
    const result = await createLeaveRequest(
      userId,
      "wfh",
      futureMonStart,
      futureFriEnd,
      "remote",
      [],
      [],
    );
    expect(result.status).toBe("pending");
  });
});


// --- Tests for approveLeaveRequest ---

describe("approveLeaveRequest", () => {
  beforeEach(() => {
    vi.spyOn(pb.collection("leave_requests"), "update").mockResolvedValue({
      id: "lr-1",
      collectionId: "",
      collectionName: "leave_requests",
      created: "",
      updated: "",
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects self-approval (reviewerId === requesterId)", async () => {
    const request = makeRequest({
      requesterId: "user-1",
      type: "annual",
      status: "pending",
      startDate: utc(2026, 6, 1),
      endDate: utc(2026, 6, 5),
    });

    await expect(
      approveLeaveRequest("lr-1", "user-1", request),
    ).rejects.toThrow("Cannot approve your own leave request");
  });

  it("approves a request when reviewer differs from requester", async () => {
    const request = makeRequest({
      requesterId: "user-1",
      type: "annual",
      status: "pending",
      startDate: utc(2026, 6, 1),
      endDate: utc(2026, 6, 5),
    });

    const result = await approveLeaveRequest("lr-1", "user-2", request);

    expect(result.status).toBe("approved");
    expect(result.reviewerId).toBe("user-2");
  });

  it("calls PocketBase update with correct data", async () => {
    const updateSpy = vi.spyOn(pb.collection("leave_requests"), "update");
    const request = makeRequest({
      requesterId: "user-1",
      type: "wfh",
      status: "pending",
      startDate: utc(2026, 6, 1),
      endDate: utc(2026, 6, 5),
    });

    await approveLeaveRequest("lr-1", "user-2", request);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith("lr-1", expect.objectContaining({
      status: "approved",
      reviewerId: "user-2",
    }));
  });

  it("preserves original request fields in the returned object", async () => {
    const request = makeRequest({
      requesterId: "user-1",
      type: "annual",
      status: "pending",
      startDate: utc(2026, 6, 1),
      endDate: utc(2026, 6, 5),
      reason: "vacation",
    });

    const result = await approveLeaveRequest("lr-1", "user-2", request);

    expect(result.requesterId).toBe("user-1");
    expect(result.type).toBe("annual");
    expect(result.startDate).toBe(utc(2026, 6, 1));
    expect(result.endDate).toBe(utc(2026, 6, 5));
    expect(result.reason).toBe("vacation");
    expect(result.updatedAt).toBeGreaterThan(0);
  });
});

// --- Tests for declineLeaveRequest ---

describe("declineLeaveRequest", () => {
  beforeEach(() => {
    vi.spyOn(pb.collection("leave_requests"), "update").mockResolvedValue({
      id: "lr-1",
      collectionId: "",
      collectionName: "leave_requests",
      created: "",
      updated: "",
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects self-decline (reviewerId === requesterId)", async () => {
    const request = makeRequest({
      requesterId: "user-1",
      type: "annual",
      status: "pending",
      startDate: utc(2026, 6, 1),
      endDate: utc(2026, 6, 5),
    });

    await expect(
      declineLeaveRequest("lr-1", "user-1", "conflict", request),
    ).rejects.toThrow("Cannot decline your own leave request");
  });

  it("rejects decline with empty reason", async () => {
    const request = makeRequest({
      requesterId: "user-1",
      type: "annual",
      status: "pending",
      startDate: utc(2026, 6, 1),
      endDate: utc(2026, 6, 5),
    });

    await expect(
      declineLeaveRequest("lr-1", "user-2", "", request),
    ).rejects.toThrow("A reason is required when declining a leave request");
  });

  it("rejects decline with whitespace-only reason", async () => {
    const request = makeRequest({
      requesterId: "user-1",
      type: "annual",
      status: "pending",
      startDate: utc(2026, 6, 1),
      endDate: utc(2026, 6, 5),
    });

    await expect(
      declineLeaveRequest("lr-1", "user-2", "   ", request),
    ).rejects.toThrow("A reason is required when declining a leave request");
  });

  it("declines a request with a valid reason", async () => {
    const request = makeRequest({
      requesterId: "user-1",
      type: "annual",
      status: "pending",
      startDate: utc(2026, 6, 1),
      endDate: utc(2026, 6, 5),
    });

    const result = await declineLeaveRequest("lr-1", "user-2", "Team conflict", request);

    expect(result.status).toBe("declined");
    expect(result.reviewerId).toBe("user-2");
    expect(result.reviewReason).toBe("Team conflict");
  });

  it("calls PocketBase update with correct data", async () => {
    const updateSpy = vi.spyOn(pb.collection("leave_requests"), "update");
    const request = makeRequest({
      requesterId: "user-1",
      type: "wfh",
      status: "pending",
      startDate: utc(2026, 6, 1),
      endDate: utc(2026, 6, 5),
    });

    await declineLeaveRequest("lr-1", "user-2", "Not available", request);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith("lr-1", expect.objectContaining({
      status: "declined",
      reviewerId: "user-2",
      reviewReason: "Not available",
    }));
  });

  it("preserves original request fields in the returned object", async () => {
    const request = makeRequest({
      requesterId: "user-1",
      type: "annual",
      status: "pending",
      startDate: utc(2026, 6, 1),
      endDate: utc(2026, 6, 5),
      reason: "vacation",
    });

    const result = await declineLeaveRequest("lr-1", "user-2", "Deadline week", request);

    expect(result.requesterId).toBe("user-1");
    expect(result.type).toBe("annual");
    expect(result.startDate).toBe(utc(2026, 6, 1));
    expect(result.endDate).toBe(utc(2026, 6, 5));
    expect(result.reason).toBe("vacation");
    expect(result.updatedAt).toBeGreaterThan(0);
  });
});


// --- Tests for Public Holiday CRUD ---

import {
  addPublicHoliday,
  removePublicHoliday,
  updatePublicHoliday,
  getPublicHolidays,
} from "@/lib/leave";

describe("addPublicHoliday", () => {
  beforeEach(() => {
    vi.spyOn(pb.collection("public_holidays"), "create").mockResolvedValue({
      id: "ph-mock-id",
      collectionId: "",
      collectionName: "public_holidays",
      created: "",
      updated: "",
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a public holiday with correct fields", async () => {
    const createSpy = vi.spyOn(pb.collection("public_holidays"), "create");
    const date = utc(2025, 12, 25);

    const result = await addPublicHoliday(date, "Christmas Day", 2025);

    expect(createSpy).toHaveBeenCalledTimes(1);
    const callArg = createSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.date).toBe(date);
    expect(callArg.name).toBe("Christmas Day");
    expect(callArg.year).toBe(2025);
    expect(callArg.createdAt).toBeGreaterThan(0);

    expect(result.id).toBe("ph-mock-id");
    expect(result.date).toBe(date);
    expect(result.name).toBe("Christmas Day");
    expect(result.year).toBe(2025);
  });

  it("trims whitespace from holiday name", async () => {
    const createSpy = vi.spyOn(pb.collection("public_holidays"), "create");

    await addPublicHoliday(utc(2025, 1, 1), "  New Year  ", 2025);

    const callArg = createSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.name).toBe("New Year");
  });

  it("rejects empty holiday name", async () => {
    await expect(
      addPublicHoliday(utc(2025, 1, 1), "", 2025),
    ).rejects.toThrow("Holiday name is required");
  });

  it("rejects whitespace-only holiday name", async () => {
    await expect(
      addPublicHoliday(utc(2025, 1, 1), "   ", 2025),
    ).rejects.toThrow("Holiday name is required");
  });
});

describe("updatePublicHoliday", () => {
  beforeEach(() => {
    vi.spyOn(pb.collection("public_holidays"), "update").mockResolvedValue({
      id: "ph-1",
      collectionId: "",
      collectionName: "public_holidays",
      created: "",
      updated: "",
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates a public holiday with correct fields", async () => {
    const updateSpy = vi.spyOn(pb.collection("public_holidays"), "update");
    const date = utc(2025, 12, 26);

    const result = await updatePublicHoliday("ph-1", date, "Boxing Day", 2025);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith("ph-1", expect.objectContaining({
      date,
      name: "Boxing Day",
      year: 2025,
    }));

    expect(result.id).toBe("ph-1");
    expect(result.date).toBe(date);
    expect(result.name).toBe("Boxing Day");
    expect(result.year).toBe(2025);
  });

  it("trims whitespace from updated name", async () => {
    const updateSpy = vi.spyOn(pb.collection("public_holidays"), "update");

    await updatePublicHoliday("ph-1", utc(2025, 1, 1), "  New Year  ", 2025);

    const callArg = updateSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(callArg.name).toBe("New Year");
  });

  it("rejects empty holiday name on update", async () => {
    await expect(
      updatePublicHoliday("ph-1", utc(2025, 1, 1), "", 2025),
    ).rejects.toThrow("Holiday name is required");
  });
});

describe("removePublicHoliday", () => {
  beforeEach(() => {
    vi.spyOn(pb.collection("public_holidays"), "delete").mockResolvedValue(true as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls PocketBase delete with the correct id", async () => {
    const deleteSpy = vi.spyOn(pb.collection("public_holidays"), "delete");

    await removePublicHoliday("ph-1");

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith("ph-1");
  });

  it("does not throw on successful deletion", async () => {
    await expect(removePublicHoliday("ph-1")).resolves.toBeUndefined();
  });
});

describe("getPublicHolidays", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches holidays for a given year with correct filter", async () => {
    const mockRecords = [
      {
        id: "ph-1",
        date: utc(2025, 1, 1),
        name: "New Year's Day",
        year: 2025,
        createdAt: utc(2025, 1, 1),
        collectionId: "",
        collectionName: "public_holidays",
        created: "",
        updated: "",
      },
      {
        id: "ph-2",
        date: utc(2025, 12, 25),
        name: "Christmas Day",
        year: 2025,
        createdAt: utc(2025, 1, 1),
        collectionId: "",
        collectionName: "public_holidays",
        created: "",
        updated: "",
      },
    ];

    vi.spyOn(pb.collection("public_holidays"), "getFullList").mockResolvedValue(
      mockRecords as any,
    );

    const result = await getPublicHolidays(2025);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("ph-1");
    expect(result[0].name).toBe("New Year's Day");
    expect(result[1].id).toBe("ph-2");
    expect(result[1].name).toBe("Christmas Day");
  });

  it("passes correct filter and sort to PocketBase", async () => {
    const getFullListSpy = vi.spyOn(
      pb.collection("public_holidays"),
      "getFullList",
    ).mockResolvedValue([]);

    await getPublicHolidays(2025);

    expect(getFullListSpy).toHaveBeenCalledWith({
      filter: "year = 2025",
      sort: "date",
    });
  });

  it("returns empty array when no holidays exist", async () => {
    vi.spyOn(pb.collection("public_holidays"), "getFullList").mockResolvedValue([]);

    const result = await getPublicHolidays(2025);

    expect(result).toEqual([]);
  });
});
