/**
 * Leave balance computation and validation for PACE v2 Team Ops.
 *
 * Implements the Leave Balance Manager algorithm from the design doc:
 * - 20 annual leave days per person per calendar year
 * - 10 sick leave days per person per calendar year
 * - WFH does NOT affect leave balance
 * - Only business days count (exclude weekends and public holidays)
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.3
 */

import type {
  LeaveBalance,
  LeaveRequest,
  PublicHoliday,
  ValidationResult,
} from "@/types";
import { pb } from "@/lib/pocketbase";
import type { RecordModel } from "pocketbase";

/** Annual leave allocation per person per year */
export const ANNUAL_ALLOCATION = 20;

/** Sick leave allocation per person per year */
export const SICK_ALLOCATION = 10;

/**
 * Check if a given UTC timestamp falls on a weekend (Saturday or Sunday).
 */
export function isWeekend(timestamp: number): boolean {
  const date = new Date(timestamp * 1000);
  const day = date.getUTCDay();
  return day === 0 || day === 6; // Sunday = 0, Saturday = 6
}

/**
 * Check if a given UTC timestamp falls on a public holiday.
 * Compares by UTC date (year-month-day), not exact timestamp.
 */
export function isPublicHoliday(
  timestamp: number,
  holidays: PublicHoliday[],
): boolean {
  const date = new Date(timestamp * 1000);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();

  return holidays.some((h) => {
    const hDate = new Date(h.date * 1000);
    return (
      hDate.getUTCFullYear() === y &&
      hDate.getUTCMonth() === m &&
      hDate.getUTCDate() === d
    );
  });
}

/**
 * Enumerate all calendar days between startDate and endDate (inclusive)
 * as UTC midnight timestamps.
 */
export function enumerateDays(startDate: number, endDate: number): number[] {
  const days: number[] = [];
  // Normalize to UTC midnight
  const start = new Date(startDate * 1000);
  let current = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
  );

  const end = new Date(endDate * 1000);
  const endMidnight = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
  );

  while (current <= endMidnight) {
    days.push(Math.floor(current / 1000));
    current += 86400000; // add one day in ms
  }

  return days;
}

/**
 * Count business days in a leave request range, excluding weekends
 * and public holidays.
 */
export function countBusinessDays(
  startDate: number,
  endDate: number,
  holidays: PublicHoliday[],
): number {
  const days = enumerateDays(startDate, endDate);
  return days.filter(
    (day) => !isWeekend(day) && !isPublicHoliday(day, holidays),
  ).length;
}

/**
 * Compute leave balance for a user in a given year.
 *
 * Algorithm (from design doc):
 * 1. Start with allocations: 20 annual, 10 sick
 * 2. Count approved annual leave business days (excluding weekends + public holidays)
 * 3. Count approved sick leave business days (excluding weekends + public holidays)
 * 4. WFH requests do not affect any balance
 * 5. Return allocated - used = remaining
 */
export function computeLeaveBalance(
  userId: string,
  year: number,
  leaveRequests: LeaveRequest[],
  publicHolidays: PublicHoliday[],
): LeaveBalance {
  // Filter holidays for this year
  const yearHolidays = publicHolidays.filter((h) => h.year === year);

  // Year boundaries as UTC timestamps
  const yearStart = Date.UTC(year, 0, 1) / 1000; // Jan 1 00:00:00
  const yearEnd = Date.UTC(year, 11, 31, 23, 59, 59) / 1000; // Dec 31 23:59:59

  // Count approved annual leave business days
  const annualRequests = leaveRequests.filter(
    (r) =>
      r.requesterId === userId &&
      r.type === "annual" &&
      r.status === "approved" &&
      r.startDate >= yearStart &&
      r.endDate <= yearEnd,
  );

  let annualUsed = 0;
  for (const request of annualRequests) {
    annualUsed += countBusinessDays(request.startDate, request.endDate, yearHolidays);
  }

  // Count approved sick leave business days
  const sickRequests = leaveRequests.filter(
    (r) =>
      r.requesterId === userId &&
      r.type === "sick" &&
      r.status === "approved" &&
      r.startDate >= yearStart &&
      r.endDate <= yearEnd,
  );

  let sickUsed = 0;
  for (const request of sickRequests) {
    sickUsed += countBusinessDays(request.startDate, request.endDate, yearHolidays);
  }

  return {
    userId,
    year,
    annualAllocated: ANNUAL_ALLOCATION,
    annualUsed,
    annualRemaining: ANNUAL_ALLOCATION - annualUsed,
    sickAllocated: SICK_ALLOCATION,
    sickUsed,
    sickRemaining: SICK_ALLOCATION - sickUsed,
  };
}

/**
 * Validate a leave request before submission.
 *
 * Checks:
 * - startDate < endDate
 * - For annual leave: remaining balance >= requested business days
 * - WFH requests always valid (no balance impact)
 * - Sick leave always valid (auto-approved, advisory only)
 */
export function validateLeaveRequest(
  userId: string,
  leaveType: "annual" | "sick" | "wfh",
  startDate: number,
  endDate: number,
  existingRequests: LeaveRequest[],
  publicHolidays: PublicHoliday[],
): ValidationResult {
  // Basic date validation
  if (startDate >= endDate) {
    return {
      valid: false,
      reason: "Start date must be before end date",
    };
  }

  // Count requested business days
  const requestedDays = countBusinessDays(startDate, endDate, publicHolidays);

  if (requestedDays === 0) {
    return {
      valid: false,
      reason: "No business days in the selected range",
    };
  }

  // WFH never affects balance — always valid
  if (leaveType === "wfh") {
    return { valid: true, requestedDays };
  }

  // Sick leave — always valid (auto-approved, no balance gate)
  if (leaveType === "sick") {
    return { valid: true, requestedDays };
  }

  // Annual leave — check balance
  const startYear = new Date(startDate * 1000).getUTCFullYear();
  const balance = computeLeaveBalance(
    userId,
    startYear,
    existingRequests,
    publicHolidays,
  );

  if (requestedDays > balance.annualRemaining) {
    return {
      valid: false,
      reason: `Insufficient annual leave balance. Requested ${requestedDays} days but only ${balance.annualRemaining} remaining.`,
      remainingBalance: balance.annualRemaining,
      requestedDays,
    };
  }

  return {
    valid: true,
    remainingBalance: balance.annualRemaining - requestedDays,
    requestedDays,
  };
}


/**
 * Create a leave request record.
 *
 * Validation:
 * - startDate must be < endDate
 * - startDate must be >= today (no past dates / retroactive leave)
 * - For annual leave: remaining balance must cover requested business days
 * - Sick leave: auto-approved immediately (no approval workflow)
 * - Annual / WFH: status set to "pending"
 *
 * Requirements: 6.1, 6.2, 6.3, 6.5, 24.1, 24.3
 */
export async function createLeaveRequest(
  requesterId: string,
  leaveType: "annual" | "sick" | "wfh",
  startDate: number,
  endDate: number,
  reason: string,
  existingRequests: LeaveRequest[],
  publicHolidays: PublicHoliday[],
): Promise<LeaveRequest> {
  // 1. Validate startDate < endDate
  if (startDate >= endDate) {
    throw new Error("Start date must be before end date");
  }

  // 2. Reject past dates — startDate must be >= today (UTC midnight)
  const now = new Date();
  const todayMidnight =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  if (startDate < todayMidnight) {
    throw new Error("Start date cannot be in the past");
  }

  // 3. For annual leave, validate balance
  if (leaveType === "annual") {
    const validation = validateLeaveRequest(
      requesterId,
      leaveType,
      startDate,
      endDate,
      existingRequests,
      publicHolidays,
    );
    if (!validation.valid) {
      throw new Error(validation.reason ?? "Leave request validation failed");
    }
  }

  // 4. Determine status: sick → approved, annual/wfh → pending
  const status: LeaveRequest["status"] =
    leaveType === "sick" ? "approved" : "pending";

  const nowTs = Math.floor(Date.now() / 1000);

  // 5. Create record in PocketBase
  const record = await pb.collection("leave_requests").create({
    requesterId,
    type: leaveType,
    startDate,
    endDate,
    reason,
    status,
    reviewerId: null,
    reviewReason: null,
    createdAt: nowTs,
    updatedAt: nowTs,
  });

  return {
    id: record.id,
    requesterId,
    type: leaveType,
    startDate,
    endDate,
    reason,
    status,
    reviewerId: null,
    reviewReason: null,
    createdAt: nowTs,
    updatedAt: nowTs,
  };
}

/**
 * Approve a pending leave request.
 *
 * Validation:
 * - reviewerId must differ from request.requesterId (no self-approval)
 * - Updates status to "approved" and sets reviewerId
 *
 * Requirements: 7.1, 7.2, 7.4, 7.5
 */
export async function approveLeaveRequest(
  requestId: string,
  reviewerId: string,
  request: LeaveRequest,
): Promise<LeaveRequest> {
  // Prevent self-approval
  if (reviewerId === request.requesterId) {
    throw new Error("Cannot approve your own leave request");
  }

  const nowTs = Math.floor(Date.now() / 1000);

  // Update record in PocketBase
  await pb.collection("leave_requests").update(requestId, {
    status: "approved",
    reviewerId,
    updatedAt: nowTs,
  });

  return {
    ...request,
    status: "approved",
    reviewerId,
    updatedAt: nowTs,
  };
}

/**
 * Decline a pending leave request.
 *
 * Validation:
 * - reviewerId must differ from request.requesterId (no self-approval)
 * - reason must be non-empty
 * - Updates status to "declined", sets reviewerId and reviewReason
 *
 * Requirements: 7.1, 7.3, 7.4
 */
export async function declineLeaveRequest(
  requestId: string,
  reviewerId: string,
  reason: string,
  request: LeaveRequest,
): Promise<LeaveRequest> {
  // Prevent self-decline
  if (reviewerId === request.requesterId) {
    throw new Error("Cannot decline your own leave request");
  }

  // Require a reason
  if (!reason || reason.trim().length === 0) {
    throw new Error("A reason is required when declining a leave request");
  }

  const nowTs = Math.floor(Date.now() / 1000);

  // Update record in PocketBase
  await pb.collection("leave_requests").update(requestId, {
    status: "declined",
    reviewerId,
    reviewReason: reason,
    updatedAt: nowTs,
  });

  return {
    ...request,
    status: "declined",
    reviewerId,
    reviewReason: reason,
    updatedAt: nowTs,
  };
}


// ---------------------------------------------------------------------------
// Public Holiday CRUD
// Requirements: 4.1, 4.2, 4.4
// ---------------------------------------------------------------------------

/** Convert a PocketBase record to a PublicHoliday. */
function toPublicHoliday(record: RecordModel): PublicHoliday {
  return {
    id: record.id,
    date: record["date"] as number,
    name: record["name"] as string,
    year: record["year"] as number,
    createdAt: record["createdAt"] as number,
  };
}

/**
 * Add a new public holiday.
 *
 * Requirements: 4.1, 4.4
 */
export async function addPublicHoliday(
  date: number,
  name: string,
  year: number,
): Promise<PublicHoliday> {
  if (!name || name.trim().length === 0) {
    throw new Error("Holiday name is required");
  }

  const nowTs = Math.floor(Date.now() / 1000);

  const record = await pb.collection("public_holidays").create({
    date,
    name: name.trim(),
    year,
    createdAt: nowTs,
  });

  return toPublicHoliday({ ...record, date, name: name.trim(), year, createdAt: nowTs });
}

/**
 * Update an existing public holiday.
 *
 * Requirements: 4.4
 */
export async function updatePublicHoliday(
  id: string,
  date: number,
  name: string,
  year: number,
): Promise<PublicHoliday> {
  if (!name || name.trim().length === 0) {
    throw new Error("Holiday name is required");
  }

  const record = await pb.collection("public_holidays").update(id, {
    date,
    name: name.trim(),
    year,
  });

  return toPublicHoliday({ ...record, date, name: name.trim(), year });
}

/**
 * Remove a public holiday by id.
 *
 * Requirements: 4.4
 */
export async function removePublicHoliday(id: string): Promise<void> {
  await pb.collection("public_holidays").delete(id);
}

/**
 * Fetch all public holidays for a given year.
 *
 * Requirements: 4.1, 4.2
 */
export async function getPublicHolidays(year: number): Promise<PublicHoliday[]> {
  const records = await pb.collection("public_holidays").getFullList({
    filter: `year = ${year}`,
    sort: "date",
  });

  return records.map(toPublicHoliday);
}


// ---------------------------------------------------------------------------
// Team Availability Summary
// Requirements: 5.4
// ---------------------------------------------------------------------------

export interface TeamAvailabilitySummary {
  available: number;
  onLeave: number;
  onWFH: number;
  total: number;
}

/**
 * Compute team availability summary for a given day.
 *
 * For each team member, determine their status on the given day:
 * - "onLeave" if they have an approved annual or sick leave covering that day
 * - "onWFH" if they have an approved WFH covering that day
 * - "available" otherwise
 *
 * The summary counts must satisfy: available + onLeave + onWFH = total members.
 *
 * Requirements: 5.4
 */
export function computeTeamAvailabilitySummary(
  memberIds: string[],
  dayTimestamp: number,
  leaveRequests: LeaveRequest[],
): TeamAvailabilitySummary {
  const approvedRequests = leaveRequests.filter((r) => r.status === "approved");

  let onLeave = 0;
  let onWFH = 0;

  for (const memberId of memberIds) {
    // Find the first approved request covering this day for this member
    const matchingRequest = approvedRequests.find(
      (r) =>
        r.requesterId === memberId &&
        r.startDate <= dayTimestamp &&
        r.endDate >= dayTimestamp,
    );

    if (matchingRequest) {
      if (matchingRequest.type === "annual" || matchingRequest.type === "sick") {
        onLeave++;
      } else if (matchingRequest.type === "wfh") {
        onWFH++;
      }
    }
  }

  const available = memberIds.length - onLeave - onWFH;

  return {
    available,
    onLeave,
    onWFH,
    total: memberIds.length,
  };
}


// ---------------------------------------------------------------------------
// Smart Leave Conflict Detection (pure function)
// Requirements: 21.1, 21.4
// ---------------------------------------------------------------------------

export interface LeaveConflict {
  type: "team_member_on_leave" | "milestone_deadline" | "low_availability";
  description: string;
}

export interface SmartLeaveResult {
  conflicts: LeaveConflict[];
  /** Advisory only — never blocks submission (Req 21.4) */
  canSubmit: true;
}

/**
 * Detect scheduling conflicts for a proposed leave request.
 *
 * Pure function — all data passed in, result returned.
 *
 * Detects:
 * (a) Other team members with approved leave overlapping the range
 * (b) Milestones with deadlines within 3 days of the range
 * (c) Days where team availability drops below 50%
 *
 * Conflicts are advisory only — canSubmit is always true (Req 21.4).
 *
 * Requirements: 21.1, 21.4
 */
export function detectLeaveConflicts(
  requesterId: string,
  startDate: number,
  endDate: number,
  teamMemberIds: string[],
  approvedLeaveRequests: LeaveRequest[],
  milestones: Array<{ id: string; name: string; deadline: number; completedAt: number | null }>,
): SmartLeaveResult {
  const conflicts: LeaveConflict[] = [];

  // (a) Other team members with approved leave overlapping the range
  const overlapping = approvedLeaveRequests.filter(
    (r) =>
      r.requesterId !== requesterId &&
      r.status === "approved" &&
      (r.type === "annual" || r.type === "sick") &&
      r.startDate <= endDate &&
      r.endDate >= startDate,
  );

  for (const r of overlapping) {
    conflicts.push({
      type: "team_member_on_leave",
      description: `Team member ${r.requesterId} is on ${r.type} leave during this period`,
    });
  }

  // (b) Milestones with deadlines within 3 days of the range
  const THREE_DAYS = 3 * 86400;
  for (const ms of milestones) {
    if (ms.completedAt !== null) continue;
    if (ms.deadline >= startDate - THREE_DAYS && ms.deadline <= endDate + THREE_DAYS) {
      conflicts.push({
        type: "milestone_deadline",
        description: `Milestone "${ms.name}" has a deadline near this period`,
      });
    }
  }

  // (c) Low team availability (below 50%)
  if (teamMemberIds.length > 0) {
    // Count unique other members on leave overlapping the range
    const uniqueOnLeave = new Set(overlapping.map((r) => r.requesterId));
    // The requester would also be on leave
    const totalOnLeave = uniqueOnLeave.size + 1;
    const totalMembers = teamMemberIds.length;
    const available = totalMembers - totalOnLeave;

    if (available / totalMembers < 0.5) {
      conflicts.push({
        type: "low_availability",
        description: `Team availability would drop below 50% (${available} of ${totalMembers} available)`,
      });
    }
  }

  // Conflicts are advisory only — never block submission (Req 21.4)
  return {
    conflicts,
    canSubmit: true,
  };
}
