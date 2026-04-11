import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 3: Review score averaging
 *
 * For any set of founder reviews within a completed cycle, the computed average
 * score per founder per dimension should equal the arithmetic mean of all
 * submitted scores for that founder in that dimension, and the overall average
 * should equal (output_avg + reliability_avg + initiative_avg) / 3.0.
 *
 * **Validates: Requirements 1.7, 2.1**
 */

// --- Types mirroring the Rust/SQLite data model ---

interface FounderReview {
  id: string;
  cycleId: string;
  reviewerId: string;
  revieweeId: string;
  outputScore: number;      // 1-5
  reliabilityScore: number; // 1-5
  initiativeScore: number;  // 1-5
  submittedAt: number;
}

interface ReviewResult {
  founderId: string;
  outputAvg: number;
  reliabilityAvg: number;
  initiativeAvg: number;
  overallAvg: number;
}

// --- Pure computation function mirroring Rust logic ---

/**
 * Mirrors the Rust `compute_review_results` algorithm from the design doc:
 * 1. Group reviews by revieweeId
 * 2. For each founder, compute arithmetic mean of each dimension
 * 3. Overall average = (output_avg + reliability_avg + initiative_avg) / 3.0
 * 4. Sort ascending by overall_avg (lowest first for accountability)
 */
function computeReviewResults(reviews: FounderReview[]): ReviewResult[] {
  // Group reviews by reviewee
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

    results.push({
      founderId,
      outputAvg,
      reliabilityAvg,
      initiativeAvg,
      overallAvg,
    });
  }

  // Sort ascending by overall_avg (lowest first for accountability detection)
  results.sort((a, b) => a.overallAvg - b.overallAvg);

  return results;
}

// --- Arbitraries ---

/** Valid score: integer in [1, 5] */
const scoreArb = fc.integer({ min: 1, max: 5 });

/** Founder IDs from a small pool to ensure multiple reviews per founder */
const founderIdArb = fc.constantFrom(
  "founder-A",
  "founder-B",
  "founder-C",
  "founder-D",
  "founder-E",
);

/** Generate a single review for a given cycle */
function reviewArb(cycleId: string): fc.Arbitrary<FounderReview> {
  return fc
    .record({
      id: fc.uuid(),
      reviewerId: founderIdArb,
      revieweeId: founderIdArb,
      outputScore: scoreArb,
      reliabilityScore: scoreArb,
      initiativeScore: scoreArb,
      submittedAt: fc.integer({ min: 1_700_000_000, max: 1_800_000_000 }),
    })
    .filter((r) => r.reviewerId !== r.revieweeId) // no self-reviews
    .map((r) => ({ ...r, cycleId }));
}

/**
 * Generate a realistic set of reviews for a cycle:
 * 3-5 founders, each reviewing every other founder exactly once.
 */
const fullCycleReviewsArb = fc
  .integer({ min: 3, max: 5 })
  .chain((founderCount) => {
    const founders = ["founder-A", "founder-B", "founder-C", "founder-D", "founder-E"].slice(
      0,
      founderCount,
    );
    const cycleId = "cycle-test";

    // For each reviewer-reviewee pair, generate scores
    const pairs: Array<{ reviewerId: string; revieweeId: string }> = [];
    for (const reviewer of founders) {
      for (const reviewee of founders) {
        if (reviewer !== reviewee) {
          pairs.push({ reviewerId: reviewer, revieweeId: reviewee });
        }
      }
    }

    return fc
      .tuple(
        ...pairs.map(() => fc.tuple(scoreArb, scoreArb, scoreArb)),
      )
      .map((scoreSets) =>
        pairs.map((pair, i) => ({
          id: `review-${i}`,
          cycleId,
          reviewerId: pair.reviewerId,
          revieweeId: pair.revieweeId,
          outputScore: scoreSets[i][0],
          reliabilityScore: scoreSets[i][1],
          initiativeScore: scoreSets[i][2],
          submittedAt: 1_700_000_000 + i,
        })),
      );
  });

// --- Property Tests ---

describe("Property 3: Review score averaging", () => {
  it("per-dimension averages equal the arithmetic mean of submitted scores (Req 1.7)", () => {
    fc.assert(
      fc.property(fullCycleReviewsArb, (reviews) => {
        const results = computeReviewResults(reviews);

        // Group reviews by reviewee for manual verification
        const byReviewee = new Map<string, FounderReview[]>();
        for (const review of reviews) {
          const existing = byReviewee.get(review.revieweeId) ?? [];
          existing.push(review);
          byReviewee.set(review.revieweeId, existing);
        }

        // Every reviewee should have a result
        expect(results.length).toBe(byReviewee.size);

        for (const result of results) {
          const founderReviews = byReviewee.get(result.founderId)!;
          const count = founderReviews.length;

          // Manually compute arithmetic means
          const expectedOutput =
            founderReviews.reduce((s, r) => s + r.outputScore, 0) / count;
          const expectedReliability =
            founderReviews.reduce((s, r) => s + r.reliabilityScore, 0) / count;
          const expectedInitiative =
            founderReviews.reduce((s, r) => s + r.initiativeScore, 0) / count;

          expect(result.outputAvg).toBeCloseTo(expectedOutput, 10);
          expect(result.reliabilityAvg).toBeCloseTo(expectedReliability, 10);
          expect(result.initiativeAvg).toBeCloseTo(expectedInitiative, 10);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("overall average equals (output_avg + reliability_avg + initiative_avg) / 3.0 (Req 2.1)", () => {
    fc.assert(
      fc.property(fullCycleReviewsArb, (reviews) => {
        const results = computeReviewResults(reviews);

        for (const result of results) {
          const expectedOverall =
            (result.outputAvg + result.reliabilityAvg + result.initiativeAvg) / 3.0;
          expect(result.overallAvg).toBeCloseTo(expectedOverall, 10);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("all dimension averages are within [1.0, 5.0] (Req 1.7)", () => {
    fc.assert(
      fc.property(fullCycleReviewsArb, (reviews) => {
        const results = computeReviewResults(reviews);

        for (const result of results) {
          expect(result.outputAvg).toBeGreaterThanOrEqual(1.0);
          expect(result.outputAvg).toBeLessThanOrEqual(5.0);
          expect(result.reliabilityAvg).toBeGreaterThanOrEqual(1.0);
          expect(result.reliabilityAvg).toBeLessThanOrEqual(5.0);
          expect(result.initiativeAvg).toBeGreaterThanOrEqual(1.0);
          expect(result.initiativeAvg).toBeLessThanOrEqual(5.0);
          expect(result.overallAvg).toBeGreaterThanOrEqual(1.0);
          expect(result.overallAvg).toBeLessThanOrEqual(5.0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("results are sorted ascending by overall average (Req 2.1)", () => {
    fc.assert(
      fc.property(fullCycleReviewsArb, (reviews) => {
        const results = computeReviewResults(reviews);

        for (let i = 1; i < results.length; i++) {
          expect(results[i].overallAvg).toBeGreaterThanOrEqual(
            results[i - 1].overallAvg,
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it("single reviewer per reviewee produces exact scores as averages (Req 1.7)", () => {
    fc.assert(
      fc.property(
        scoreArb,
        scoreArb,
        scoreArb,
        (output, reliability, initiative) => {
          const reviews: FounderReview[] = [
            {
              id: "r1",
              cycleId: "cycle-1",
              reviewerId: "founder-A",
              revieweeId: "founder-B",
              outputScore: output,
              reliabilityScore: reliability,
              initiativeScore: initiative,
              submittedAt: 1_700_000_000,
            },
          ];

          const results = computeReviewResults(reviews);
          expect(results.length).toBe(1);
          expect(results[0].outputAvg).toBe(output);
          expect(results[0].reliabilityAvg).toBe(reliability);
          expect(results[0].initiativeAvg).toBe(initiative);
          expect(results[0].overallAvg).toBeCloseTo(
            (output + reliability + initiative) / 3.0,
            10,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("with random review sets, each founder gets exactly one result entry (Req 1.7)", () => {
    fc.assert(
      fc.property(
        fc.array(reviewArb("cycle-rand"), { minLength: 2, maxLength: 20 }),
        (reviews) => {
          const results = computeReviewResults(reviews);

          // Collect unique reviewee IDs from input
          const uniqueReviewees = new Set(reviews.map((r) => r.revieweeId));

          // One result per unique reviewee
          expect(results.length).toBe(uniqueReviewees.size);

          // Each result founderId should be unique
          const resultIds = results.map((r) => r.founderId);
          expect(new Set(resultIds).size).toBe(resultIds.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("empty reviews produce empty results", () => {
    const results = computeReviewResults([]);
    expect(results).toEqual([]);
  });
});
