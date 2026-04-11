// Equity Dashboard Engine — stakes, vesting, dilution, projections
// Requirements: 6.1, 6.2, 6.3, 6.5, 7.1, 7.2, 7.3, 21.4

export interface EquityStake {
  id: string;
  founderId: string;
  initialStakePct: number;
  currentStakePct: number;
  vestingStartDate: number;      // UTC timestamp
  cliffDate: number;             // UTC timestamp
  vestingEndDate: number;        // UTC timestamp
  vestingScheduleMonths: number; // typically 48
  updatedAt: number;
}

export interface DilutionEvent {
  id: string;
  founderId: string;
  cycleId: string;
  dilutionPct: number;           // e.g. 1.0
  previousStakePct: number;
  newStakePct: number;
  redistributionDetails: Record<string, { previous: number; new: number }>;
  createdAt: number;
}

export type CliffStatus =
  | { status: "pre_cliff"; daysRemaining: number }
  | { status: "cliff_passed"; cliffDate: number }
  | { status: "fully_vested" };

/**
 * Computes linear vesting progress from vestingStartDate to vestingEndDate,
 * clamped to [0.0, 1.0].
 *
 * Algorithm (Req 6.2):
 *   if now < vestingStartDate → 0.0
 *   if now >= vestingEndDate  → 1.0
 *   else → (now - vestingStartDate) / (vestingEndDate - vestingStartDate)
 */
export function computeVestingProgress(stake: EquityStake, now: number): number {
  if (now < stake.vestingStartDate) return 0.0;
  if (now >= stake.vestingEndDate) return 1.0;

  const totalDuration = stake.vestingEndDate - stake.vestingStartDate;
  const elapsed = now - stake.vestingStartDate;
  return elapsed / totalDuration;
}

/**
 * Computes cliff status for an equity stake at a given time.
 *
 * Algorithm (Req 6.3):
 *   if now < cliffDate       → pre_cliff with daysRemaining = ceil((cliffDate - now) / 86400)
 *   if now >= vestingEndDate  → fully_vested
 *   else                      → cliff_passed with cliffDate
 */
export function computeCliffStatus(stake: EquityStake, now: number): CliffStatus {
  if (now < stake.cliffDate) {
    const daysRemaining = Math.ceil((stake.cliffDate - now) / 86400);
    return { status: "pre_cliff", daysRemaining };
  }
  if (now >= stake.vestingEndDate) {
    return { status: "fully_vested" };
  }
  return { status: "cliff_passed", cliffDate: stake.cliffDate };
}

/**
 * Applies dilution to a target founder's stake and redistributes proportionally
 * among remaining founders. Preserves cap table sum within 0.01% of 100%.
 *
 * Algorithm (Req 6.5, 7.2):
 *   1. Reduce target's currentStakePct by dilutionPct
 *   2. Redistribute dilutionPct proportionally among others based on their share
 *   3. Return updated stakes and a DilutionEvent record
 *
 * Postconditions:
 *   - stakes.sum(currentStakePct) ≈ 100.0 (within 0.01%)
 *   - target.currentStakePct == previousPct - dilutionPct
 *   - Each other founder's increase is proportional to their share of remaining equity
 */
export function applyDilution(
  stakes: EquityStake[],
  targetFounderId: string,
  dilutionPct: number,
): { updatedStakes: EquityStake[]; event: DilutionEvent } {
  // Deep copy to avoid mutating input
  const updated = stakes.map((s) => ({ ...s }));

  const target = updated.find((s) => s.founderId === targetFounderId);
  if (!target) {
    throw new Error(`Target founder ${targetFounderId} not found in stakes`);
  }

  const previousPct = target.currentStakePct;
  const newPct = previousPct - dilutionPct;
  target.currentStakePct = newPct;

  // Redistribute diluted amount proportionally among remaining founders
  const others = updated.filter((s) => s.founderId !== targetFounderId);
  const othersTotal = others.reduce((sum, s) => sum + s.currentStakePct, 0);

  const redistributionDetails: Record<string, { previous: number; new: number }> = {};
  redistributionDetails[targetFounderId] = { previous: previousPct, new: newPct };

  for (const other of others) {
    const prevOther = other.currentStakePct;
    const share = othersTotal > 0
      ? (other.currentStakePct / othersTotal) * dilutionPct
      : dilutionPct / others.length;
    other.currentStakePct += share;
    redistributionDetails[other.founderId] = {
      previous: prevOther,
      new: other.currentStakePct,
    };
  }

  const now = Date.now();
  const event: DilutionEvent = {
    id: crypto.randomUUID(),
    founderId: targetFounderId,
    cycleId: "",
    dilutionPct,
    previousStakePct: previousPct,
    newStakePct: newPct,
    redistributionDetails,
    createdAt: now,
  };

  return { updatedStakes: updated, event };
}

/**
 * Computes projected payout for a given stake percentage and company valuation.
 *
 * Formula (Req 7.3): valuation × currentStakePct / 100
 */
export function computeProjectedPayout(stakePct: number, valuation: number): number {
  return valuation * stakePct / 100;
}

/**
 * Validates that the sum of all equity stakes is within 0.01% of 100%.
 *
 * Requirement 21.4: equity stake percentages across all founders must sum
 * to 100% within 0.01% tolerance after every dilution event.
 */
export function validateCapTableSum(stakes: EquityStake[]): boolean {
  const sum = stakes.reduce((acc, s) => acc + s.currentStakePct, 0);
  return Math.abs(sum - 100.0) <= 0.01;
}

/**
 * Orchestrates the frontend side of a dilution trigger after peer review
 * detects consecutive accountability warnings.
 *
 * The Rust backend (`close_review_cycle` / `resolve_tie`) already performs
 * the actual equity mutation in SQLite. This function handles the frontend
 * concerns:
 *   1. Applies dilution to the in-memory stakes via `applyDilution()`
 *   2. Validates the cap table sum (Req 21.4)
 *   3. Returns the dilution event and updated stakes for store/notification use
 *
 * Requirements: 2.5, 6.5, 21.4
 *
 * @param stakes - Current equity stakes (from equity store)
 * @param targetFounderId - The founder being diluted
 * @param cycleId - The review cycle that triggered dilution
 * @param dilutionPct - Percentage to dilute (typically 1.0)
 * @returns Updated stakes, dilution event, and cap table validity
 */
export function triggerDilutionFromReview(
  stakes: EquityStake[],
  targetFounderId: string,
  cycleId: string,
  dilutionPct: number = 1.0,
): {
  updatedStakes: EquityStake[];
  event: DilutionEvent;
  capTableValid: boolean;
} {
  const { updatedStakes, event } = applyDilution(stakes, targetFounderId, dilutionPct);
  event.cycleId = cycleId;

  const capTableValid = validateCapTableSum(updatedStakes);

  return { updatedStakes, event, capTableValid };
}
