import { describe, it, expect } from "vitest";
import {
  computeRunway,
  computeFounderBalance,
  computeDecisionVelocity,
  computeBurnRateAlignment,
  type StartupHealthConfig,
  type Decision,
} from "@/lib/startupHealth";

const DAY = 86400;

describe("computeRunway", () => {
  it("computes runway as cashBalance / mean(expenses)", () => {
    const config: StartupHealthConfig = {
      cashBalance: 120000,
      monthlyExpenses: [10000, 10000, 10000],
      plannedMonthlyBudget: 10000,
    };
    const result = computeRunway(config);
    expect(result.months).toBe(12);
    expect(result.status).toBe("normal");
  });

  it("returns amber when runway is between 3 and 6 months", () => {
    const config: StartupHealthConfig = {
      cashBalance: 50000,
      monthlyExpenses: [10000, 10000, 10000],
      plannedMonthlyBudget: 10000,
    };
    const result = computeRunway(config);
    expect(result.months).toBe(5);
    expect(result.status).toBe("amber");
  });

  it("returns red when runway is below 3 months", () => {
    const config: StartupHealthConfig = {
      cashBalance: 20000,
      monthlyExpenses: [10000, 10000, 10000],
      plannedMonthlyBudget: 10000,
    };
    const result = computeRunway(config);
    expect(result.months).toBe(2);
    expect(result.status).toBe("red");
  });

  it("returns Infinity with normal status when all expenses are 0", () => {
    const config: StartupHealthConfig = {
      cashBalance: 100000,
      monthlyExpenses: [0, 0, 0],
      plannedMonthlyBudget: 0,
    };
    const result = computeRunway(config);
    expect(result.months).toBe(Infinity);
    expect(result.status).toBe("normal");
  });

  it("returns Infinity with normal status when expenses array is empty", () => {
    const config: StartupHealthConfig = {
      cashBalance: 100000,
      monthlyExpenses: [],
      plannedMonthlyBudget: 0,
    };
    const result = computeRunway(config);
    expect(result.months).toBe(Infinity);
    expect(result.status).toBe("normal");
  });

  it("handles varying monthly expenses", () => {
    const config: StartupHealthConfig = {
      cashBalance: 60000,
      monthlyExpenses: [8000, 10000, 12000],
      plannedMonthlyBudget: 10000,
    };
    const result = computeRunway(config);
    // mean = 10000, runway = 6.0
    expect(result.months).toBe(6);
    expect(result.status).toBe("normal");
  });

  it("handles single month expense", () => {
    const config: StartupHealthConfig = {
      cashBalance: 15000,
      monthlyExpenses: [5000],
      plannedMonthlyBudget: 5000,
    };
    const result = computeRunway(config);
    expect(result.months).toBe(3);
    expect(result.status).toBe("amber");
  });
});

describe("computeFounderBalance", () => {
  it("computes std dev and alerts for multiple founders", () => {
    const hours = new Map([["f1", 40], ["f2", 40], ["f3", 20]]);
    const names = new Map([["f1", "Alice"], ["f2", "Bob"], ["f3", "Charlie"]]);
    const result = computeFounderBalance(hours, names);

    // teamAvg = (40+40+20)/3 ≈ 33.33
    expect(result.teamAvgHours).toBeCloseTo(33.33, 1);
    expect(result.stdDev).toBeGreaterThan(0);

    // f3 deviation: |20 - 33.33| / 33.33 * 100 = 40% → alert
    const f3 = result.founders.find((f) => f.founderId === "f3")!;
    expect(f3.hasAlert).toBe(true);
    expect(f3.deviationPct).toBeCloseTo(40, 0);

    // f1 deviation: |40 - 33.33| / 33.33 * 100 = 20% → no alert
    const f1 = result.founders.find((f) => f.founderId === "f1")!;
    expect(f1.hasAlert).toBe(false);
  });

  it("returns stdDev 0 for single founder", () => {
    const hours = new Map([["f1", 40]]);
    const names = new Map([["f1", "Alice"]]);
    const result = computeFounderBalance(hours, names);
    expect(result.stdDev).toBe(0);
    expect(result.teamAvgHours).toBe(40);
    expect(result.founders[0].hasAlert).toBe(false);
  });

  it("returns stdDev 0 and no alerts when all hours are equal", () => {
    const hours = new Map([["f1", 30], ["f2", 30], ["f3", 30]]);
    const names = new Map([["f1", "A"], ["f2", "B"], ["f3", "C"]]);
    const result = computeFounderBalance(hours, names);
    expect(result.stdDev).toBe(0);
    expect(result.founders.every((f) => !f.hasAlert)).toBe(true);
  });

  it("handles empty map", () => {
    const hours = new Map<string, number>();
    const names = new Map<string, string>();
    const result = computeFounderBalance(hours, names);
    expect(result.stdDev).toBe(0);
    expect(result.teamAvgHours).toBe(0);
    expect(result.founders).toHaveLength(0);
  });

  it("handles zero hours for all founders", () => {
    const hours = new Map([["f1", 0], ["f2", 0]]);
    const names = new Map([["f1", "A"], ["f2", "B"]]);
    const result = computeFounderBalance(hours, names);
    expect(result.stdDev).toBe(0);
    expect(result.teamAvgHours).toBe(0);
    // deviationPct should be 0 when teamAvg is 0
    expect(result.founders.every((f) => f.deviationPct === 0)).toBe(true);
    expect(result.founders.every((f) => !f.hasAlert)).toBe(true);
  });
});

describe("computeDecisionVelocity", () => {
  const baseTime = 1700000000;

  it("computes mean days for resolved decisions in window", () => {
    const decisions: Decision[] = [
      { id: "d1", title: "D1", description: "", createdAt: baseTime - 10 * DAY, resolvedAt: baseTime - 5 * DAY },
      { id: "d2", title: "D2", description: "", createdAt: baseTime - 8 * DAY, resolvedAt: baseTime - 2 * DAY },
    ];
    // d1: 5 days, d2: 6 days → mean = 5.5
    const result = computeDecisionVelocity(decisions, 30, baseTime);
    expect(result).toBe(5.5);
  });

  it("returns 0 when no resolved decisions exist", () => {
    const decisions: Decision[] = [
      { id: "d1", title: "D1", description: "", createdAt: baseTime - 5 * DAY, resolvedAt: null },
    ];
    expect(computeDecisionVelocity(decisions, 30, baseTime)).toBe(0);
  });

  it("returns 0 for empty decisions array", () => {
    expect(computeDecisionVelocity([], 30, baseTime)).toBe(0);
  });

  it("excludes decisions resolved outside the window", () => {
    const decisions: Decision[] = [
      { id: "d1", title: "D1", description: "", createdAt: baseTime - 60 * DAY, resolvedAt: baseTime - 40 * DAY },
      { id: "d2", title: "D2", description: "", createdAt: baseTime - 5 * DAY, resolvedAt: baseTime - 2 * DAY },
    ];
    // Only d2 is within 30-day window: 3 days
    const result = computeDecisionVelocity(decisions, 30, baseTime);
    expect(result).toBe(3);
  });

  it("respects custom window days", () => {
    const decisions: Decision[] = [
      { id: "d1", title: "D1", description: "", createdAt: baseTime - 10 * DAY, resolvedAt: baseTime - 5 * DAY },
    ];
    // Within 7-day window: resolvedAt = baseTime - 5*DAY, cutoff = baseTime - 7*DAY → included
    expect(computeDecisionVelocity(decisions, 7, baseTime)).toBe(5);
    // Within 3-day window: cutoff = baseTime - 3*DAY → excluded
    expect(computeDecisionVelocity(decisions, 3, baseTime)).toBe(0);
  });
});

describe("computeBurnRateAlignment", () => {
  it("computes (actual / planned) × 100", () => {
    const result = computeBurnRateAlignment(10000, 10000);
    expect(result.pct).toBe(100);
    expect(result.status).toBe("normal");
  });

  it("returns amber when > 110%", () => {
    const result = computeBurnRateAlignment(11500, 10000);
    expect(result.pct).toBe(115);
    expect(result.status).toBe("amber");
  });

  it("returns red when > 130%", () => {
    const result = computeBurnRateAlignment(14000, 10000);
    expect(result.pct).toBe(140);
    expect(result.status).toBe("red");
  });

  it("returns normal at exactly 110%", () => {
    const result = computeBurnRateAlignment(11000, 10000);
    expect(result.pct).toBe(110);
    expect(result.status).toBe("normal");
  });

  it("returns amber at exactly 130%", () => {
    const result = computeBurnRateAlignment(13000, 10000);
    expect(result.pct).toBe(130);
    expect(result.status).toBe("amber");
  });

  it("handles zero planned budget with zero spend", () => {
    const result = computeBurnRateAlignment(0, 0);
    expect(result.pct).toBe(0);
    expect(result.status).toBe("normal");
  });

  it("handles zero planned budget with positive spend", () => {
    const result = computeBurnRateAlignment(5000, 0);
    expect(result.pct).toBe(Infinity);
    expect(result.status).toBe("red");
  });

  it("handles underspending", () => {
    const result = computeBurnRateAlignment(5000, 10000);
    expect(result.pct).toBe(50);
    expect(result.status).toBe("normal");
  });
});
