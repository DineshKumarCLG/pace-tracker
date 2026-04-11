// Leaderboard Engine — weekly scoring and ranking for founders
// Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.3, 5.4

export interface FounderScore {
  founderId: string;
  name: string;
  hours: number;
  tasksCompleted: number;
  peerReviewAvg: number;
  normalizedHours: number;
  normalizedTasks: number;
  normalizedPeerReview: number;
  compositeScore: number;
  isFounderOfWeek: boolean;
}

/**
 * Computes composite scores for all founders for a given week.
 *
 * Composite = (normalizedHours × 0.3) + (normalizedTasks × 0.4) + (normalizedPeerReview × 0.3)
 *
 * Normalization:
 *   hours  → hours / maxHours across all founders (0.0 if maxHours is 0)  (Req 4.2, 4.6)
 *   tasks  → tasks / maxTasks across all founders (0.0 if maxTasks is 0)  (Req 4.3, 4.6)
 *   peer   → peerAvg / 5.0, default peerAvg = 3.0 when missing           (Req 4.4, 4.5)
 *
 * Returns scores sorted descending by compositeScore with exactly one
 * founder marked isFounderOfWeek (tie-break by tasksCompleted).          (Req 5.3, 5.4)
 */
export function computeFounderScores(
  founders: Array<{ id: string; name: string }>,
  weeklyHours: Map<string, number>,
  weeklyTasks: Map<string, number>,
  peerReviewAvgs: Map<string, number>,
): FounderScore[] {
  if (founders.length === 0) return [];

  // Find max values across all founders for normalization
  const allHours = founders.map((f) => weeklyHours.get(f.id) ?? 0);
  const allTasks = founders.map((f) => weeklyTasks.get(f.id) ?? 0);
  const maxHours = Math.max(...allHours, 0);
  const maxTasks = Math.max(...allTasks, 0);

  const scores: FounderScore[] = founders.map((founder) => {
    const hours = weeklyHours.get(founder.id) ?? 0;
    const tasks = weeklyTasks.get(founder.id) ?? 0;
    const peerAvg = peerReviewAvgs.get(founder.id) ?? 3.0; // Req 4.5: default 3.0

    // Normalize (Req 4.2, 4.3, 4.4, 4.6)
    const normalizedHours = maxHours > 0 ? hours / maxHours : 0.0;
    const normalizedTasks = maxTasks > 0 ? tasks / maxTasks : 0.0;
    const normalizedPeerReview = peerAvg / 5.0;

    // Weighted composite (Req 4.1)
    const compositeScore =
      normalizedHours * 0.3 + normalizedTasks * 0.4 + normalizedPeerReview * 0.3;

    return {
      founderId: founder.id,
      name: founder.name,
      hours,
      tasksCompleted: tasks,
      peerReviewAvg: peerAvg,
      normalizedHours,
      normalizedTasks,
      normalizedPeerReview,
      compositeScore,
      isFounderOfWeek: false,
    };
  });

  // Sort descending by composite score (Req 5.1)
  scores.sort((a, b) => b.compositeScore - a.compositeScore);

  // Determine Founder of the Week (Req 5.3, 5.4)
  if (scores.length > 0) {
    const winnerId = determineFounderOfWeek(scores);
    const winner = scores.find((s) => s.founderId === winnerId);
    if (winner) winner.isFounderOfWeek = true;
  }

  return scores;
}

/**
 * Determines the Founder of the Week from a sorted scores array.
 * Highest composite score wins; ties broken by higher tasksCompleted.
 * Returns the founderId of the winner.
 */
export function determineFounderOfWeek(scores: FounderScore[]): string {
  if (scores.length === 0) {
    throw new Error("Cannot determine Founder of the Week from empty scores");
  }

  const topScore = scores[0].compositeScore;
  const tied = scores.filter(
    (s) => Math.abs(s.compositeScore - topScore) < 1e-10,
  );

  if (tied.length === 1) return tied[0].founderId;

  // Tie-break by tasks completed (Req 5.4)
  tied.sort((a, b) => b.tasksCompleted - a.tasksCompleted);
  return tied[0].founderId;
}
