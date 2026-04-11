import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 2: Review submission validation
 *
 * For any review submission attempt, the submission should be accepted if and
 * only if: (a) the cycle status is "open", (b) the current time is before the
 * submission deadline, (c) the reviewerId differs from the revieweeId, (d) no
 * prior submission exists for the same (cycleId, reviewerId, revieweeId) triple,
 * and (e) all three scores are integers in [1, 5]. Submissions violating any
 * condition should be rejected.
 *
 * **Validates: Requirements 1.3, 1.4, 1.6**
 */

// --- Types mirroring the Rust/SQLite data model ---

interface ReviewCycle {
  id: string;
  status: "open" | "closed" | "resolved";
  submissionDeadline: number;
}

interface ExistingSubmission {
  cycleId: string;
  reviewerId: string;
  revieweeId: string;
}

interface SubmissionAttempt {
  cycleId: string;
  reviewerId: string;
  revieweeId: string;
  outputScore: number;
  reliabilityScore: number;
  initiativeScore: number;
}

interface ValidationResult {
  accepted: boolean;
  reason?: string;
}

// --- Pure validation function mirroring Rust logic ---

function validateReviewSubmission(
  attempt: SubmissionAttempt,
  cycle: ReviewCycle | undefined,
  now: number,
  existingSubmissions: ExistingSubmission[],
): ValidationResult {
  // Cycle must exist
  if (!cycle) {
    return { accepted: false, reason: "Review cycle not found" };
  }

  // (a) Cycle status must be "open"
  if (cycle.status !== "open") {
    return { accepted: false, reason: `Review cycle is '${cycle.status}', expected 'open'` };
  }

  // (b) Current time must be before submission deadline
  if (now >= cycle.submissionDeadline) {
    return { accepted: false, reason: "Submission deadline has passed" };
  }

  // (c) Reviewer must differ from reviewee
  if (attempt.reviewerId === attempt.revieweeId) {
    return { accepted: false, reason: "Reviewer and reviewee must be different founders" };
  }

  // (d) No duplicate (cycleId, reviewerId, revieweeId)
  const isDuplicate = existingSubmissions.some(
    (s) =>
      s.cycleId === attempt.cycleId &&
      s.reviewerId === attempt.reviewerId &&
      s.revieweeId === attempt.revieweeId,
  );
  if (isDuplicate) {
    return { accepted: false, reason: "A review for this reviewer-reviewee pair already exists in this cycle" };
  }

  // (e) All scores must be integers in [1, 5]
  for (const [name, score] of [
    ["output", attempt.outputScore],
    ["reliability", attempt.reliabilityScore],
    ["initiative", attempt.initiativeScore],
  ] as [string, number][]) {
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return { accepted: false, reason: `Invalid ${name} score: ${score}. Must be integer between 1 and 5` };
    }
  }

  return { accepted: true };
}


// --- Arbitraries ---

const DAY = 24 * 3600;
const HOUR = 3600;

/** Realistic UTC timestamp (2020–2030) */
const timestampArb = fc.integer({ min: 1_577_836_800, max: 1_893_456_000 });

/** Valid score: integer in [1, 5] */
const validScoreArb = fc.integer({ min: 1, max: 5 });

/** Invalid score: integer outside [1, 5] */
const invalidScoreArb = fc.oneof(
  fc.integer({ min: -100, max: 0 }),
  fc.integer({ min: 6, max: 100 }),
);

/** Non-integer score (float) */
const floatScoreArb = fc.double({ min: 1.01, max: 4.99, noNaN: true }).filter(
  (n) => !Number.isInteger(n),
);

/** Founder ID arbitrary */
const founderIdArb = fc.stringOf(fc.constantFrom("a", "b", "c", "d", "1", "2", "3"), {
  minLength: 1,
  maxLength: 6,
});

/** Cycle status arbitrary */
const cycleStatusArb = fc.constantFrom("open" as const, "closed" as const, "resolved" as const);

/** Generate a valid open cycle with deadline in the future relative to `now` */
function openCycleArb(cycleId: string) {
  return timestampArb.chain((startDate) => {
    const deadline = startDate + 48 * HOUR;
    return fc.record({
      id: fc.constant(cycleId),
      status: fc.constant("open" as const),
      submissionDeadline: fc.constant(deadline),
      now: fc.integer({ min: startDate, max: deadline - 1 }),
    });
  });
}

// --- Property Tests ---

describe("Property 2: Review submission validation", () => {
  it("accepts valid submissions when all five conditions are met (Req 1.3, 1.4, 1.6)", () => {
    fc.assert(
      fc.property(
        timestampArb,
        validScoreArb,
        validScoreArb,
        validScoreArb,
        (startDate, output, reliability, initiative) => {
          const cycleId = "cycle-1";
          const deadline = startDate + 48 * HOUR;
          const now = startDate + 1000; // well before deadline

          const cycle: ReviewCycle = {
            id: cycleId,
            status: "open",
            submissionDeadline: deadline,
          };

          const attempt: SubmissionAttempt = {
            cycleId,
            reviewerId: "founder-A",
            revieweeId: "founder-B",
            outputScore: output,
            reliabilityScore: reliability,
            initiativeScore: initiative,
          };

          const result = validateReviewSubmission(attempt, cycle, now, []);
          expect(result.accepted).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("rejects when cycle status is not 'open' (Req 1.6)", () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.constantFrom("closed" as const, "resolved" as const),
        validScoreArb,
        validScoreArb,
        validScoreArb,
        (startDate, status, output, reliability, initiative) => {
          const cycleId = "cycle-1";
          const deadline = startDate + 48 * HOUR;
          const now = startDate + 1000;

          const cycle: ReviewCycle = {
            id: cycleId,
            status,
            submissionDeadline: deadline,
          };

          const attempt: SubmissionAttempt = {
            cycleId,
            reviewerId: "founder-A",
            revieweeId: "founder-B",
            outputScore: output,
            reliabilityScore: reliability,
            initiativeScore: initiative,
          };

          const result = validateReviewSubmission(attempt, cycle, now, []);
          expect(result.accepted).toBe(false);
          expect(result.reason).toContain(status);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects when current time is at or past the submission deadline (Req 1.6)", () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.integer({ min: 0, max: 7 * DAY }),
        validScoreArb,
        validScoreArb,
        validScoreArb,
        (startDate, overshoot, output, reliability, initiative) => {
          const deadline = startDate + 48 * HOUR;
          const now = deadline + overshoot; // at or past deadline

          const cycle: ReviewCycle = {
            id: "cycle-1",
            status: "open",
            submissionDeadline: deadline,
          };

          const attempt: SubmissionAttempt = {
            cycleId: "cycle-1",
            reviewerId: "founder-A",
            revieweeId: "founder-B",
            outputScore: output,
            reliabilityScore: reliability,
            initiativeScore: initiative,
          };

          const result = validateReviewSubmission(attempt, cycle, now, []);
          expect(result.accepted).toBe(false);
          expect(result.reason).toContain("deadline");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects self-review where reviewerId equals revieweeId (Req 1.3)", () => {
    fc.assert(
      fc.property(
        timestampArb,
        founderIdArb,
        validScoreArb,
        validScoreArb,
        validScoreArb,
        (startDate, founderId, output, reliability, initiative) => {
          const deadline = startDate + 48 * HOUR;
          const now = startDate + 1000;

          const cycle: ReviewCycle = {
            id: "cycle-1",
            status: "open",
            submissionDeadline: deadline,
          };

          const attempt: SubmissionAttempt = {
            cycleId: "cycle-1",
            reviewerId: founderId,
            revieweeId: founderId, // same as reviewer
            outputScore: output,
            reliabilityScore: reliability,
            initiativeScore: initiative,
          };

          const result = validateReviewSubmission(attempt, cycle, now, []);
          expect(result.accepted).toBe(false);
          expect(result.reason).toContain("different");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects duplicate (cycleId, reviewerId, revieweeId) submissions (Req 1.3)", () => {
    fc.assert(
      fc.property(
        timestampArb,
        validScoreArb,
        validScoreArb,
        validScoreArb,
        (startDate, output, reliability, initiative) => {
          const cycleId = "cycle-1";
          const deadline = startDate + 48 * HOUR;
          const now = startDate + 1000;

          const cycle: ReviewCycle = {
            id: cycleId,
            status: "open",
            submissionDeadline: deadline,
          };

          const attempt: SubmissionAttempt = {
            cycleId,
            reviewerId: "founder-A",
            revieweeId: "founder-B",
            outputScore: output,
            reliabilityScore: reliability,
            initiativeScore: initiative,
          };

          // Existing submission for the same triple
          const existing: ExistingSubmission[] = [
            { cycleId, reviewerId: "founder-A", revieweeId: "founder-B" },
          ];

          const result = validateReviewSubmission(attempt, cycle, now, existing);
          expect(result.accepted).toBe(false);
          expect(result.reason).toContain("already exists");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("accepts when existing submissions are for different triples (Req 1.3)", () => {
    fc.assert(
      fc.property(
        timestampArb,
        validScoreArb,
        validScoreArb,
        validScoreArb,
        (startDate, output, reliability, initiative) => {
          const cycleId = "cycle-1";
          const deadline = startDate + 48 * HOUR;
          const now = startDate + 1000;

          const cycle: ReviewCycle = {
            id: cycleId,
            status: "open",
            submissionDeadline: deadline,
          };

          const attempt: SubmissionAttempt = {
            cycleId,
            reviewerId: "founder-A",
            revieweeId: "founder-B",
            outputScore: output,
            reliabilityScore: reliability,
            initiativeScore: initiative,
          };

          // Existing submissions for different triples
          const existing: ExistingSubmission[] = [
            { cycleId, reviewerId: "founder-A", revieweeId: "founder-C" },
            { cycleId, reviewerId: "founder-B", revieweeId: "founder-A" },
            { cycleId: "cycle-2", reviewerId: "founder-A", revieweeId: "founder-B" },
          ];

          const result = validateReviewSubmission(attempt, cycle, now, existing);
          expect(result.accepted).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects when any score is outside [1, 5] integer range (Req 1.4)", () => {
    fc.assert(
      fc.property(
        timestampArb,
        invalidScoreArb,
        validScoreArb,
        validScoreArb,
        fc.integer({ min: 0, max: 2 }),
        (startDate, badScore, goodScore1, goodScore2, badPosition) => {
          const deadline = startDate + 48 * HOUR;
          const now = startDate + 1000;

          const cycle: ReviewCycle = {
            id: "cycle-1",
            status: "open",
            submissionDeadline: deadline,
          };

          // Place the bad score in one of the three positions
          const scores = [goodScore1, goodScore1, goodScore2];
          scores[badPosition] = badScore;

          const attempt: SubmissionAttempt = {
            cycleId: "cycle-1",
            reviewerId: "founder-A",
            revieweeId: "founder-B",
            outputScore: scores[0],
            reliabilityScore: scores[1],
            initiativeScore: scores[2],
          };

          const result = validateReviewSubmission(attempt, cycle, now, []);
          expect(result.accepted).toBe(false);
          expect(result.reason).toContain("Invalid");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects non-integer scores (Req 1.4)", () => {
    fc.assert(
      fc.property(
        timestampArb,
        floatScoreArb,
        validScoreArb,
        validScoreArb,
        (startDate, floatScore, goodScore1, goodScore2) => {
          const deadline = startDate + 48 * HOUR;
          const now = startDate + 1000;

          const cycle: ReviewCycle = {
            id: "cycle-1",
            status: "open",
            submissionDeadline: deadline,
          };

          const attempt: SubmissionAttempt = {
            cycleId: "cycle-1",
            reviewerId: "founder-A",
            revieweeId: "founder-B",
            outputScore: floatScore,
            reliabilityScore: goodScore1,
            initiativeScore: goodScore2,
          };

          const result = validateReviewSubmission(attempt, cycle, now, []);
          expect(result.accepted).toBe(false);
          expect(result.reason).toContain("Invalid");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("boundary: exactly at deadline is rejected, one second before is accepted (Req 1.6)", () => {
    fc.assert(
      fc.property(timestampArb, (startDate) => {
        const deadline = startDate + 48 * HOUR;

        const cycle: ReviewCycle = {
          id: "cycle-1",
          status: "open",
          submissionDeadline: deadline,
        };

        const attempt: SubmissionAttempt = {
          cycleId: "cycle-1",
          reviewerId: "founder-A",
          revieweeId: "founder-B",
          outputScore: 3,
          reliabilityScore: 3,
          initiativeScore: 3,
        };

        // Exactly at deadline → rejected
        const atDeadline = validateReviewSubmission(attempt, cycle, deadline, []);
        expect(atDeadline.accepted).toBe(false);

        // One second before → accepted
        const beforeDeadline = validateReviewSubmission(attempt, cycle, deadline - 1, []);
        expect(beforeDeadline.accepted).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("score boundary: 1 and 5 are accepted, 0 and 6 are rejected (Req 1.4)", () => {
    fc.assert(
      fc.property(timestampArb, (startDate) => {
        const deadline = startDate + 48 * HOUR;
        const now = startDate + 1000;

        const cycle: ReviewCycle = {
          id: "cycle-1",
          status: "open",
          submissionDeadline: deadline,
        };

        const makeAttempt = (o: number, r: number, i: number): SubmissionAttempt => ({
          cycleId: "cycle-1",
          reviewerId: "founder-A",
          revieweeId: "founder-B",
          outputScore: o,
          reliabilityScore: r,
          initiativeScore: i,
        });

        // All 1s → accepted
        expect(validateReviewSubmission(makeAttempt(1, 1, 1), cycle, now, []).accepted).toBe(true);
        // All 5s → accepted
        expect(validateReviewSubmission(makeAttempt(5, 5, 5), cycle, now, []).accepted).toBe(true);
        // Score 0 → rejected
        expect(validateReviewSubmission(makeAttempt(0, 3, 3), cycle, now, []).accepted).toBe(false);
        // Score 6 → rejected
        expect(validateReviewSubmission(makeAttempt(3, 6, 3), cycle, now, []).accepted).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
