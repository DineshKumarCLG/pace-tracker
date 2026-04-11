import { describe, it, expect } from "vitest";
import {
  computeFounderScores,
  determineFounderOfWeek,
  type FounderScore,
} from "@/lib/leaderboard";

const founders = [
  { id: "f1", name: "Alice" },
  { id: "f2", name: "Bob" },
  { id: "f3", name: "Carol" },
];

describe("computeFounderScores", () => {
  it("returns empty array for no founders", () => {
    expect(
      computeFounderScores([], new Map(), new Map(), new Map()),
    ).toEqual([]);
  });

  it("computes correct composite score with known values", () => {
    const hours = new Map([["f1", 40], ["f2", 20], ["f3", 30]]);
    const tasks = new Map([["f1", 10], ["f2", 5], ["f3", 8]]);
    const peer = new Map([["f1", 4.5], ["f2", 3.0], ["f3", 4.0]]);

    const scores = computeFounderScores(founders, hours, tasks, peer);

    // f1: normH=40/40=1.0, normT=10/10=1.0, normP=4.5/5=0.9
    //     composite = 1.0*0.3 + 1.0*0.4 + 0.9*0.3 = 0.3+0.4+0.27 = 0.97
    expect(scores[0].founderId).toBe("f1");
    expect(scores[0].compositeScore).toBeCloseTo(0.97, 5);
    expect(scores[0].normalizedHours).toBeCloseTo(1.0, 5);
    expect(scores[0].normalizedTasks).toBeCloseTo(1.0, 5);
    expect(scores[0].normalizedPeerReview).toBeCloseTo(0.9, 5);
  });

  it("sorts scores descending by composite", () => {
    const hours = new Map([["f1", 10], ["f2", 40], ["f3", 20]]);
    const tasks = new Map([["f1", 2], ["f2", 10], ["f3", 5]]);
    const peer = new Map([["f1", 2.0], ["f2", 5.0], ["f3", 3.0]]);

    const scores = computeFounderScores(founders, hours, tasks, peer);

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1].compositeScore).toBeGreaterThanOrEqual(
        scores[i].compositeScore,
      );
    }
  });

  it("marks exactly one founder as Founder of the Week", () => {
    const hours = new Map([["f1", 30], ["f2", 20], ["f3", 10]]);
    const tasks = new Map([["f1", 5], ["f2", 3], ["f3", 1]]);
    const peer = new Map<string, number>();

    const scores = computeFounderScores(founders, hours, tasks, peer);
    const winners = scores.filter((s) => s.isFounderOfWeek);
    expect(winners).toHaveLength(1);
  });

  it("uses default peer review of 3.0 when missing (Req 4.5)", () => {
    const hours = new Map([["f1", 10]]);
    const tasks = new Map([["f1", 5]]);
    const peer = new Map<string, number>(); // no peer data

    const scores = computeFounderScores(
      [{ id: "f1", name: "Alice" }],
      hours,
      tasks,
      peer,
    );

    expect(scores[0].peerReviewAvg).toBe(3.0);
    expect(scores[0].normalizedPeerReview).toBeCloseTo(0.6, 5);
  });

  it("sets normalized values to 0.0 when max is 0 (Req 4.6)", () => {
    const hours = new Map<string, number>(); // no hours
    const tasks = new Map<string, number>(); // no tasks
    const peer = new Map<string, number>();

    const scores = computeFounderScores(founders, hours, tasks, peer);

    for (const s of scores) {
      expect(s.normalizedHours).toBe(0.0);
      expect(s.normalizedTasks).toBe(0.0);
      // peer defaults to 3.0/5.0 = 0.6
      expect(s.normalizedPeerReview).toBeCloseTo(0.6, 5);
    }
  });

  it("breaks ties by task count (Req 5.4)", () => {
    // Give all founders identical hours and peer review so composite ties
    const hours = new Map([["f1", 20], ["f2", 20], ["f3", 20]]);
    const tasks = new Map([["f1", 5], ["f2", 8], ["f3", 3]]);
    const peer = new Map([["f1", 4.0], ["f2", 4.0], ["f3", 4.0]]);

    const scores = computeFounderScores(founders, hours, tasks, peer);
    const winner = scores.find((s) => s.isFounderOfWeek);
    // f2 has most tasks (8) so should win the tie-break
    expect(winner?.founderId).toBe("f2");
  });

  it("handles single founder", () => {
    const hours = new Map([["f1", 35]]);
    const tasks = new Map([["f1", 7]]);
    const peer = new Map([["f1", 4.0]]);

    const scores = computeFounderScores(
      [{ id: "f1", name: "Alice" }],
      hours,
      tasks,
      peer,
    );

    expect(scores).toHaveLength(1);
    expect(scores[0].isFounderOfWeek).toBe(true);
    // Single founder: normH=35/35=1.0, normT=7/7=1.0, normP=4.0/5=0.8
    expect(scores[0].compositeScore).toBeCloseTo(
      1.0 * 0.3 + 1.0 * 0.4 + 0.8 * 0.3,
      5,
    );
  });

  it("defaults hours and tasks to 0 for founders not in maps", () => {
    const hours = new Map([["f1", 10]]); // f2, f3 missing
    const tasks = new Map([["f2", 3]]); // f1, f3 missing
    const peer = new Map<string, number>();

    const scores = computeFounderScores(founders, hours, tasks, peer);

    const f2 = scores.find((s) => s.founderId === "f2");
    expect(f2?.hours).toBe(0);
    const f3 = scores.find((s) => s.founderId === "f3");
    expect(f3?.hours).toBe(0);
    expect(f3?.tasksCompleted).toBe(0);
  });
});

describe("determineFounderOfWeek", () => {
  it("throws on empty scores", () => {
    expect(() => determineFounderOfWeek([])).toThrow();
  });

  it("returns the top scorer when no tie", () => {
    const scores: FounderScore[] = [
      makeScore("f1", 0.9, 10),
      makeScore("f2", 0.7, 8),
      makeScore("f3", 0.5, 5),
    ];
    expect(determineFounderOfWeek(scores)).toBe("f1");
  });

  it("breaks tie by tasks completed", () => {
    const scores: FounderScore[] = [
      makeScore("f1", 0.8, 5),
      makeScore("f2", 0.8, 9),
      makeScore("f3", 0.6, 3),
    ];
    expect(determineFounderOfWeek(scores)).toBe("f2");
  });
});

function makeScore(
  founderId: string,
  compositeScore: number,
  tasksCompleted: number,
): FounderScore {
  return {
    founderId,
    name: founderId,
    hours: 0,
    tasksCompleted,
    peerReviewAvg: 3.0,
    normalizedHours: 0,
    normalizedTasks: 0,
    normalizedPeerReview: 0.6,
    compositeScore,
    isFounderOfWeek: false,
  };
}
