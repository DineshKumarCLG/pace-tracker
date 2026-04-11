import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeFounderScores } from "@/lib/leaderboard";

/**
 * Property 6: Leaderboard score computation and ranking
 *
 * For any set of founders with weekly hours, task counts, and peer review
 * averages, the composite score should equal
 *   (normalizedHours × 0.3) + (normalizedTasks × 0.4) + (normalizedPeerReview × 0.3)
 * where:
 *   normalizedHours = hours / maxHours (or 0.0 if maxHours is 0)
 *   normalizedTasks = tasks / maxTasks (or 0.0 if maxTasks is 0)
 *   normalizedPeerReview = peerAvg / 5.0 (defaulting to 3.0/5.0 = 0.6 when missing)
 *
 * The output should be sorted by composite score descending, and exactly one
 * founder should be marked as Founder of the Week — the one with the highest
 * score, with ties broken by higher task count.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.3, 5.4**
 */

// --- Arbitraries ---

/** Generate a founder entry */
const founderArb = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 20 }),
});

/** Generate 1–5 unique founders */
const foundersArb = fc
  .array(founderArb, { minLength: 1, maxLength: 5 })
  .map((arr) => {
    // Ensure unique IDs
    const seen = new Set<string>();
    return arr.filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
  })
  .filter((arr) => arr.length >= 1);

/** Generate weekly hours (0–80) for a set of founder IDs */
function weeklyHoursArb(ids: string[]) {
  return fc
    .array(fc.double({ min: 0, max: 80, noNaN: true }), {
      minLength: ids.length,
      maxLength: ids.length,
    })
    .map((vals) => {
      const m = new Map<string, number>();
      ids.forEach((id, i) => m.set(id, vals[i]));
      return m;
    });
}

/** Generate weekly tasks (0–50) for a set of founder IDs */
function weeklyTasksArb(ids: string[]) {
  return fc
    .array(fc.integer({ min: 0, max: 50 }), {
      minLength: ids.length,
      maxLength: ids.length,
    })
    .map((vals) => {
      const m = new Map<string, number>();
      ids.forEach((id, i) => m.set(id, vals[i]));
      return m;
    });
}

/** Generate peer review averages (1.0–5.0) for a subset of founder IDs */
function peerReviewArb(ids: string[]) {
  return fc
    .array(
      fc.record({
        present: fc.boolean(),
        value: fc.double({ min: 1.0, max: 5.0, noNaN: true }),
      }),
      { minLength: ids.length, maxLength: ids.length },
    )
    .map((entries) => {
      const m = new Map<string, number>();
      ids.forEach((id, i) => {
        if (entries[i].present) m.set(id, entries[i].value);
      });
      return m;
    });
}

// --- Property Tests ---

describe("Property 6: Leaderboard score computation and ranking", () => {
  it("composite score equals weighted formula (Req 4.1, 4.2, 4.3, 4.4)", () => {
    fc.assert(
      fc.property(foundersArb, (founders) =>
        fc.assert(
          fc.property(
            weeklyHoursArb(founders.map((f) => f.id)),
            weeklyTasksArb(founders.map((f) => f.id)),
            peerReviewArb(founders.map((f) => f.id)),
            (hours, tasks, peer) => {
              const scores = computeFounderScores(founders, hours, tasks, peer);

              const maxH = Math.max(...founders.map((f) => hours.get(f.id) ?? 0), 0);
              const maxT = Math.max(...founders.map((f) => tasks.get(f.id) ?? 0), 0);

              for (const s of scores) {
                const h = hours.get(s.founderId) ?? 0;
                const t = tasks.get(s.founderId) ?? 0;
                const p = peer.get(s.founderId) ?? 3.0;

                const expectedNormH = maxH > 0 ? h / maxH : 0.0;
                const expectedNormT = maxT > 0 ? t / maxT : 0.0;
                const expectedNormP = p / 5.0;
                const expectedComposite =
                  expectedNormH * 0.3 + expectedNormT * 0.4 + expectedNormP * 0.3;

                expect(s.normalizedHours).toBeCloseTo(expectedNormH, 10);
                expect(s.normalizedTasks).toBeCloseTo(expectedNormT, 10);
                expect(s.normalizedPeerReview).toBeCloseTo(expectedNormP, 10);
                expect(s.compositeScore).toBeCloseTo(expectedComposite, 10);
              }
            },
          ),
          { numRuns: 20 },
        ),
      ),
      { numRuns: 10 },
    );
  });

  it("all normalized values are in [0.0, 1.0] and composite in [0.0, 1.0] (Req 4.2, 4.3, 4.4)", () => {
    fc.assert(
      fc.property(foundersArb, (founders) =>
        fc.assert(
          fc.property(
            weeklyHoursArb(founders.map((f) => f.id)),
            weeklyTasksArb(founders.map((f) => f.id)),
            peerReviewArb(founders.map((f) => f.id)),
            (hours, tasks, peer) => {
              const scores = computeFounderScores(founders, hours, tasks, peer);

              for (const s of scores) {
                expect(s.normalizedHours).toBeGreaterThanOrEqual(0.0);
                expect(s.normalizedHours).toBeLessThanOrEqual(1.0);
                expect(s.normalizedTasks).toBeGreaterThanOrEqual(0.0);
                expect(s.normalizedTasks).toBeLessThanOrEqual(1.0);
                expect(s.normalizedPeerReview).toBeGreaterThanOrEqual(0.0);
                expect(s.normalizedPeerReview).toBeLessThanOrEqual(1.0);
                expect(s.compositeScore).toBeGreaterThanOrEqual(0.0);
                expect(s.compositeScore).toBeLessThanOrEqual(1.0);
              }
            },
          ),
          { numRuns: 20 },
        ),
      ),
      { numRuns: 10 },
    );
  });

  it("scores are sorted descending by composite (Req 5.1)", () => {
    fc.assert(
      fc.property(foundersArb, (founders) =>
        fc.assert(
          fc.property(
            weeklyHoursArb(founders.map((f) => f.id)),
            weeklyTasksArb(founders.map((f) => f.id)),
            peerReviewArb(founders.map((f) => f.id)),
            (hours, tasks, peer) => {
              const scores = computeFounderScores(founders, hours, tasks, peer);

              for (let i = 1; i < scores.length; i++) {
                expect(scores[i - 1].compositeScore).toBeGreaterThanOrEqual(
                  scores[i].compositeScore - 1e-10,
                );
              }
            },
          ),
          { numRuns: 20 },
        ),
      ),
      { numRuns: 10 },
    );
  });

  it("exactly one founder is marked Founder of the Week (Req 5.3)", () => {
    fc.assert(
      fc.property(foundersArb, (founders) =>
        fc.assert(
          fc.property(
            weeklyHoursArb(founders.map((f) => f.id)),
            weeklyTasksArb(founders.map((f) => f.id)),
            peerReviewArb(founders.map((f) => f.id)),
            (hours, tasks, peer) => {
              const scores = computeFounderScores(founders, hours, tasks, peer);
              const winners = scores.filter((s) => s.isFounderOfWeek);
              expect(winners).toHaveLength(1);
            },
          ),
          { numRuns: 20 },
        ),
      ),
      { numRuns: 10 },
    );
  });

  it("Founder of the Week has the highest composite score (Req 5.3, 5.4)", () => {
    fc.assert(
      fc.property(foundersArb, (founders) =>
        fc.assert(
          fc.property(
            weeklyHoursArb(founders.map((f) => f.id)),
            weeklyTasksArb(founders.map((f) => f.id)),
            peerReviewArb(founders.map((f) => f.id)),
            (hours, tasks, peer) => {
              const scores = computeFounderScores(founders, hours, tasks, peer);
              const winner = scores.find((s) => s.isFounderOfWeek)!;
              const topScore = scores[0].compositeScore;

              // Winner must have the top composite score
              expect(winner.compositeScore).toBeCloseTo(topScore, 10);
            },
          ),
          { numRuns: 20 },
        ),
      ),
      { numRuns: 10 },
    );
  });

  it("tie-break awards badge to founder with more tasks (Req 5.4)", () => {
    fc.assert(
      fc.property(foundersArb, (founders) =>
        fc.assert(
          fc.property(
            weeklyHoursArb(founders.map((f) => f.id)),
            weeklyTasksArb(founders.map((f) => f.id)),
            peerReviewArb(founders.map((f) => f.id)),
            (hours, tasks, peer) => {
              const scores = computeFounderScores(founders, hours, tasks, peer);
              const winner = scores.find((s) => s.isFounderOfWeek)!;
              const topScore = scores[0].compositeScore;
              const tied = scores.filter(
                (s) => Math.abs(s.compositeScore - topScore) < 1e-10,
              );

              if (tied.length > 1) {
                // Winner should have the highest task count among tied
                const maxTasks = Math.max(...tied.map((s) => s.tasksCompleted));
                expect(winner.tasksCompleted).toBe(maxTasks);
              }
            },
          ),
          { numRuns: 20 },
        ),
      ),
      { numRuns: 10 },
    );
  });

  it("missing peer review defaults to 3.0/5.0 = 0.6 (Req 4.5)", () => {
    fc.assert(
      fc.property(foundersArb, (founders) =>
        fc.assert(
          fc.property(
            weeklyHoursArb(founders.map((f) => f.id)),
            weeklyTasksArb(founders.map((f) => f.id)),
            (hours, tasks) => {
              // Empty peer review map — all should default
              const scores = computeFounderScores(
                founders,
                hours,
                tasks,
                new Map(),
              );

              for (const s of scores) {
                expect(s.peerReviewAvg).toBe(3.0);
                expect(s.normalizedPeerReview).toBeCloseTo(0.6, 10);
              }
            },
          ),
          { numRuns: 20 },
        ),
      ),
      { numRuns: 10 },
    );
  });

  it("zero hours/tasks for all founders yields 0.0 normalized (Req 4.6)", () => {
    fc.assert(
      fc.property(foundersArb, (founders) => {
        const zeroHours = new Map<string, number>();
        const zeroTasks = new Map<string, number>();
        const scores = computeFounderScores(
          founders,
          zeroHours,
          zeroTasks,
          new Map(),
        );

        for (const s of scores) {
          expect(s.normalizedHours).toBe(0.0);
          expect(s.normalizedTasks).toBe(0.0);
        }
      }),
      { numRuns: 50 },
    );
  });
});
