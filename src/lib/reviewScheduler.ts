// Review Cycle Scheduler — pure functions for cycle timing logic
// Requirements: 1.1 (14-day cycle interval), 1.6 (48-hour submission window)

/** Cycle interval: 14 days in seconds */
export const CYCLE_INTERVAL_DAYS = 14;
const CYCLE_INTERVAL_SECONDS = CYCLE_INTERVAL_DAYS * 24 * 3600;

/** Submission window: 48 hours in seconds */
export const SUBMISSION_WINDOW_HOURS = 48;
const SUBMISSION_WINDOW_SECONDS = SUBMISSION_WINDOW_HOURS * 3600;

/**
 * Returns true if 14+ days have passed since the last cycle start
 * (or the feature enable date if no cycles exist).
 */
export function shouldCreateNewCycle(
  lastCycleStartDate: number | null,
  featureEnabledDate: number,
  now: number,
): boolean {
  const referenceDate = lastCycleStartDate ?? featureEnabledDate;
  return now - referenceDate >= CYCLE_INTERVAL_SECONDS;
}

/**
 * Returns the submission deadline: cycleStartDate + 48 hours.
 */
export function getSubmissionDeadline(cycleStartDate: number): number {
  return cycleStartDate + SUBMISSION_WINDOW_SECONDS;
}

/**
 * Returns true if the cycle's submission deadline has passed and the cycle is still open.
 */
export function isCycleExpired(
  cycle: { submissionDeadline: number; status: string },
  now: number,
): boolean {
  return now > cycle.submissionDeadline && cycle.status === "open";
}
