// Startup Health Engine — runway, founder balance, decision velocity, burn rate
// Requirements: 12.1, 12.2, 12.3, 12.4, 13.1, 13.2, 13.3, 13.4, 14.1, 14.2, 14.3, 14.4, 14.5

export interface StartupHealthData {
  runwayMonths: number;
  runwayStatus: "normal" | "amber" | "red";
  founderBalance: {
    stdDev: number;
    founders: Array<{
      founderId: string;
      name: string;
      weeklyHours: number;
      deviationPct: number;
      hasAlert: boolean;
    }>;
    teamAvgHours: number;
  };
  decisionVelocity: number;     // days, 1 decimal
  burnRateAlignment: number;    // percentage
  burnRateStatus: "normal" | "amber" | "red";
}

export interface StartupHealthConfig {
  cashBalance: number;
  monthlyExpenses: number[];     // last 3 months
  plannedMonthlyBudget: number;
}

export interface Decision {
  id: string;
  title: string;
  description: string;
  createdAt: number;             // UTC timestamp
  resolvedAt: number | null;     // UTC timestamp, null if open
}

/**
 * Computes runway in months from cash balance and monthly expenses.
 *
 * Algorithm (Req 12.1–12.4):
 *   If no expenses or all expenses are 0 → Infinity, "normal"
 *   Otherwise: cashBalance / mean(monthlyExpenses)
 *   Status: < 3 → "red", < 6 → "amber", else → "normal"
 */
export function computeRunway(config: StartupHealthConfig): {
  months: number;
  status: "normal" | "amber" | "red";
} {
  if (
    config.monthlyExpenses.length === 0 ||
    config.monthlyExpenses.every((e) => e === 0)
  ) {
    return { months: Infinity, status: "normal" };
  }

  const avgBurn =
    config.monthlyExpenses.reduce((sum, e) => sum + e, 0) /
    config.monthlyExpenses.length;

  const months = Math.round((config.cashBalance / avgBurn) * 10) / 10;

  const status: "normal" | "amber" | "red" =
    months < 3 ? "red" : months < 6 ? "amber" : "normal";

  return { months, status };
}


/**
 * Computes founder balance: standard deviation of weekly hours and per-founder alerts.
 *
 * Algorithm (Req 13.1–13.4):
 *   If fewer than 2 founders → stdDev 0, no alerts
 *   Otherwise: compute population std dev, flag founders deviating > 30% from team avg
 */
export function computeFounderBalance(
  founderHours: Map<string, number>,
  founderNames: Map<string, string>,
): StartupHealthData["founderBalance"] {
  const hours = Array.from(founderHours.values());

  if (hours.length < 2) {
    const founders = Array.from(founderHours.entries()).map(([founderId, weeklyHours]) => ({
      founderId,
      name: founderNames.get(founderId) ?? founderId,
      weeklyHours,
      deviationPct: 0,
      hasAlert: false,
    }));
    return { stdDev: 0, founders, teamAvgHours: hours[0] ?? 0 };
  }

  const teamAvg = hours.reduce((sum, h) => sum + h, 0) / hours.length;

  // Population standard deviation
  const variance =
    hours.reduce((sum, h) => sum + (h - teamAvg) ** 2, 0) / hours.length;
  const stdDev = Math.sqrt(variance);

  const founders = Array.from(founderHours.entries()).map(([founderId, weeklyHours]) => {
    const deviationPct =
      teamAvg > 0
        ? (Math.abs(weeklyHours - teamAvg) / teamAvg) * 100
        : 0;

    const hasAlert = deviationPct > 30; // Req 13.2: >30% deviation triggers alert

    return {
      founderId,
      name: founderNames.get(founderId) ?? founderId,
      weeklyHours,
      deviationPct,
      hasAlert,
    };
  });

  return { stdDev, founders, teamAvgHours: teamAvg };
}

/**
 * Computes decision velocity: mean days to resolve decisions in the given window.
 *
 * Algorithm (Req 14.1):
 *   Filter to decisions resolved within the window (windowDays, default 30)
 *   Mean of (resolvedAt - createdAt) / 86400 for each resolved decision
 *   Returns 0 if no resolved decisions in window
 */
export function computeDecisionVelocity(
  decisions: Decision[],
  windowDays: number = 30,
  now?: number,
): number {
  const currentTime = now ?? Date.now();
  const cutoff = currentTime - windowDays * 86400;

  const resolved = decisions.filter(
    (d) => d.resolvedAt != null && d.resolvedAt >= cutoff,
  );

  if (resolved.length === 0) {
    return 0.0;
  }

  const totalDays = resolved.reduce(
    (sum, d) => sum + (d.resolvedAt! - d.createdAt) / 86400,
    0,
  );

  return Math.round((totalDays / resolved.length) * 10) / 10;
}

/**
 * Computes burn rate alignment: (actual / planned) × 100.
 *
 * Algorithm (Req 14.3–14.5):
 *   pct = (actualSpend / plannedBudget) × 100
 *   Status: > 130 → "red", > 110 → "amber", else → "normal"
 */
export function computeBurnRateAlignment(
  actualSpend: number,
  plannedBudget: number,
): { pct: number; status: "normal" | "amber" | "red" } {
  if (plannedBudget === 0) {
    // If no budget planned, treat any spend as red
    if (actualSpend > 0) {
      return { pct: Infinity, status: "red" };
    }
    return { pct: 0, status: "normal" };
  }

  const pct = Math.round(((actualSpend / plannedBudget) * 100) * 10) / 10;

  const status: "normal" | "amber" | "red" =
    pct > 130 ? "red" : pct > 110 ? "amber" : "normal";

  return { pct, status };
}
