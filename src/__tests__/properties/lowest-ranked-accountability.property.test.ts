import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Feature: founder-governance, Property 4: Lowest-ranked identification and accountability warning
 *
 * For any resolved review cycle, exactly one accountability warning should be
 * issued to the founder with the lowest overall average score. When multiple
 * founders tie for the lowest score and no CEO tie-break vote exists, the
 * warning should go to the tied founder with the fewest total hours logged
 * during the review period.
 *
 * **Validates: Requirements 2.1, 2.3, 2.4**
 */

// --- Types mirroring the Rust/SQLite data model ---

interface FounderReview {
  reviewerId: string;
  revieweeId: string;
  outputScore: number;
  reliabilityScore: number;
  initiativeScore: number;
}

interface ReviewResult {
  founderId: string;
  outputAvg: number;
  reliabilityAvg: number;
  initiativeAvg: number;
  overallAvg: number;
}

interface AccountabilityWarning {
  founderId: string;
  cycleId: string;
}

interface FounderHours {
  founderId: string;
  totalHours: number;
}

// --- Pure computation functions mirroring Rust logic ---

/**
 * Compute review results: group by reviewee, average each dimension,
 * compute overall average, sort ascending by overallAvg.
 */
function computeReviewResults(reviews: FounderReview[]): ReviewResult[] {
  const byReviewee = new Map<string, FounderReview[]>();
  for (const review of reviews) {
    const existing = byReviewee.get(review.revieweeId) ?? [];
    existing.push(review);
    byReviewee.set(review.revieweeId, existing);
  }

  const results: ReviewResult[] = [];
  for (const [founderId, founderReviews] of byReviewee) {
    const count = founderReviews.length;
    const outputAvg =
      founderReviews.reduce((sum, r) => sum + r.outputScore, 0) / count;
    const reliabilityAvg =
      founderReviews.reduce((sum, r) => sum + r.reliabilityScore, 0) / count;
    const initiativeAvg =
      founderReviews.reduce((sum, r) => sum + r.initiativeScore, 0) / count;
    const overallAvg = (outputAvg + reliabilityAvg + initiativeAvg) / 3.0;

    results.push({ founderId, outputAvg, reliabilityAvg, initiativeAvg, overallAvg });
  }

  results.sort((a, b) => a.overallAvg - b.overallAvg);
  return results;
}

/**
 * Identify the lowest-ranked founder and issue an accountability warning.
 * - If exactly one founder has the lowest score → warn that founder.
 * - If multiple founders tie for lowest and no CEO tie-break → use hours fallback:
 *   warn the tied founder with the fewest total hours logged.
 * - If no reviews → no warning.
 *
 * Returns exactly zero or one warning.
 */
function identifyLowestAndWarn(
  results: ReviewResult[],
  founderHours: FounderHours[],
  cycleId: string,
  ceoTieBreak: string | null,
): AccountabilityWarning | null {
  if (results.length === 0) {
    return null;
  }

  const lowestScore = results[0].overallAvg;
  const tied = results.filter(
    (r) => Math.abs(r.overallAvg - lowestScore) < 1e-9,
  );

  if (tied.length === 1) {
    // Exactly one lowest — auto-issue warning (Req 2.4)
    return { founderId: tied[0].founderId, cycleId };
  }

  // Multiple tied at lowest
  if (ceoTieBreak !== null) {
    // CEO resolved the tie (Req 2.2)
    return { founderId: ceoTieBreak, cycleId };
  }

  // No CEO tie-break → fallback to fewest hours (Req 2.3)
  const hoursMap = new Map<string, number>();
  for (const fh of founderHours) {
    hoursMap.set(fh.founderId, fh.totalHours);
  }

  // Sort tied founders by hours ascending; first one gets the warning
  const tiedSorted = [...tied].sort((a, b) => {
    const hoursA = hoursMap.get(a.founderId) ?? 0;
    const hoursB = hoursMap.get(b.founderId) ?? 0;
    return hoursA - hoursB;
  });

  return { founderId: tiedSorted[0].founderId, cycleId };
}

// --- Arbitraries ---

const scoreArb = fc.integer({ min: 1, max: 5 });

const founderPoolAll = ["founder-A", "founder-B", "founder-C", "founder-D", "founder-E"];

/**
 * Generate a full cycle of reviews: 3-5 founders, each reviewing every other founder.
 * Returns the reviews and the list of founder IDs.
 */
const fullCycleArb = fc
  .integer({ min: 3, max: 5 })
  .chain((founderCount) => {
    const founders = founderPoolAll.slice(0, founderCount);

    const pairs: Array<{ reviewerId: string; revieweeId: string }> = [];
    for (const reviewer of founders) {
      for (const reviewee of founders) {
        if (reviewer !== reviewee) {
          pairs.push({ reviewerId: reviewer, revieweeId: reviewee });
        }
      }
    }

    return fc
      .tuple(...pairs.map(() => fc.tuple(scoreArb, scoreArb, scoreArb)))
      .map((scoreSets) => ({
        founders,
        reviews: pairs.map((pair, i) => ({
          reviewerId: pair.reviewerId,
          revieweeId: pair.revieweeId,
          outputScore: scoreSets[i][0],
          reliabilityScore: scoreSets[i][1],
          initiativeScore: scoreSets[i][2],
        })),
      }));
  });

/** Generate hours for a set of founders */
function founderHoursArb(founders: string[]): fc.Arbitrary<FounderHours[]> {
  return fc
    .tuple(...founders.map(() => fc.float({ min: 0, max: 200, noNaN: true })))
    .map((hours) =>
      founders.map((id, i) => ({ founderId: id, totalHours: hours[i] })),
    );
}

// --- Property Tests ---

describe("Property 4: Lowest-ranked identification and accountability warning", () => {
  it("exactly one warning is issued per resolved cycle with reviews (Req 2.1, 2.4)", () => {
    fc.assert(
      fc.property(
        fullCycleArb.chain(({ founders, reviews }) =>
          founderHoursArb(founders).map((hours) => ({ founders, reviews, hours })),
        ),
        ({ reviews, hours }) => {
          const results = computeReviewResults(reviews);
          const warning = identifyLowestAndWarn(results, hours, "cycle-1", null);

          // With reviews present, exactly one warning should be issued
          expect(warning).not.toBeNull();
          // The warned founder must be one of the reviewed founders
          const reviewedIds = new Set(results.map((r) => r.founderId));
          expect(reviewedIds.has(warning!.founderId)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("warning goes to the founder with the lowest overall average when no tie (Req 2.1)", () => {
    fc.assert(
      fc.property(
        fullCycleArb.chain(({ founders, reviews }) =>
          founderHoursArb(founders).map((hours) => ({ founders, reviews, hours })),
        ),
        ({ reviews, hours }) => {
          const results = computeReviewResults(reviews);
          if (results.length === 0) return;

          const lowestScore = results[0].overallAvg;
          const tied = results.filter(
            (r) => Math.abs(r.overallAvg - lowestScore) < 1e-9,
          );

          if (tied.length === 1) {
            // Clear lowest — warning must go to that founder
            const warning = identifyLowestAndWarn(results, hours, "cycle-1", null);
            expect(warning!.founderId).toBe(results[0].founderId);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("when tied with no CEO vote, warning goes to tied founder with fewest hours (Req 2.3)", () => {
    fc.assert(
      fc.property(
        fullCycleArb.chain(({ founders, reviews }) =>
          founderHoursArb(founders).map((hours) => ({ founders, reviews, hours })),
        ),
        ({ reviews, hours }) => {
          const results = computeReviewResults(reviews);
          if (results.length === 0) return;

          const lowestScore = results[0].overallAvg;
          const tied = results.filter(
            (r) => Math.abs(r.overallAvg - lowestScore) < 1e-9,
          );

          if (tied.length > 1) {
            const warning = identifyLowestAndWarn(results, hours, "cycle-1", null);
            expect(warning).not.toBeNull();

            // The warned founder should be the one with fewest hours among tied
            const hoursMap = new Map(hours.map((h) => [h.founderId, h.totalHours]));
            const tiedHours = tied.map((t) => ({
              founderId: t.founderId,
              hours: hoursMap.get(t.founderId) ?? 0,
            }));
            tiedHours.sort((a, b) => a.hours - b.hours);

            expect(warning!.founderId).toBe(tiedHours[0].founderId);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("CEO tie-break overrides hours fallback (Req 2.3)", () => {
    fc.assert(
      fc.property(
        fullCycleArb.chain(({ founders, reviews }) =>
          founderHoursArb(founders).map((hours) => ({ founders, reviews, hours })),
        ),
        ({ founders, reviews, hours }) => {
          const results = computeReviewResults(reviews);
          if (results.length === 0) return;

          const lowestScore = results[0].overallAvg;
          const tied = results.filter(
            (r) => Math.abs(r.overallAvg - lowestScore) < 1e-9,
          );

          if (tied.length > 1) {
            // CEO picks the last tied founder (not necessarily the one with fewest hours)
            const ceoChoice = tied[tied.length - 1].founderId;
            const warning = identifyLowestAndWarn(results, hours, "cycle-1", ceoChoice);
            expect(warning).not.toBeNull();
            expect(warning!.founderId).toBe(ceoChoice);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("no warning is issued when there are no reviews (Req 2.1)", () => {
    fc.assert(
      fc.property(
        founderHoursArb(founderPoolAll.slice(0, 3)),
        (hours) => {
          const results = computeReviewResults([]);
          const warning = identifyLowestAndWarn(results, hours, "cycle-1", null);
          expect(warning).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("warned founder always has the minimum overall average score (Req 2.1, 2.4)", () => {
    fc.assert(
      fc.property(
        fullCycleArb.chain(({ founders, reviews }) =>
          founderHoursArb(founders).map((hours) => ({ founders, reviews, hours })),
        ),
        ({ reviews, hours }) => {
          const results = computeReviewResults(reviews);
          if (results.length === 0) return;

          const warning = identifyLowestAndWarn(results, hours, "cycle-1", null);
          expect(warning).not.toBeNull();

          const warnedResult = results.find(
            (r) => r.founderId === warning!.founderId,
          )!;
          const minScore = Math.min(...results.map((r) => r.overallAvg));

          expect(Math.abs(warnedResult.overallAvg - minScore)).toBeLessThan(1e-9);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("warning cycleId matches the provided cycle (Req 2.4)", () => {
    fc.assert(
      fc.property(
        fullCycleArb.chain(({ founders, reviews }) =>
          fc.tuple(
            fc.constant({ founders, reviews }),
            founderHoursArb(founders),
            fc.uuid(),
          ),
        ),
        ([{ reviews }, hours, cycleId]) => {
          const results = computeReviewResults(reviews);
          if (results.length === 0) return;

          const warning = identifyLowestAndWarn(results, hours, cycleId, null);
          expect(warning).not.toBeNull();
          expect(warning!.cycleId).toBe(cycleId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
