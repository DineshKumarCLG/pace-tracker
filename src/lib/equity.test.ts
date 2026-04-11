import { describe, it, expect } from "vitest";
import {
  computeVestingProgress,
  computeCliffStatus,
  applyDilution,
  computeProjectedPayout,
  validateCapTableSum,
  triggerDilutionFromReview,
  type EquityStake,
} from "@/lib/equity";

const DAY = 86400;

function makeStake(overrides: Partial<EquityStake> = {}): EquityStake {
  const now = 1700000000;
  return {
    id: "stake-1",
    founderId: "f1",
    initialStakePct: 25.0,
    currentStakePct: 25.0,
    vestingStartDate: now,
    cliffDate: now + 365 * DAY,       // 1 year cliff
    vestingEndDate: now + 4 * 365 * DAY, // 4 year vesting
    vestingScheduleMonths: 48,
    updatedAt: now,
    ...overrides,
  };
}

describe("computeVestingProgress", () => {
  it("returns 0.0 before vesting start", () => {
    const stake = makeStake({ vestingStartDate: 1000, vestingEndDate: 2000 });
    expect(computeVestingProgress(stake, 500)).toBe(0.0);
  });

  it("returns 1.0 at or after vesting end", () => {
    const stake = makeStake({ vestingStartDate: 1000, vestingEndDate: 2000 });
    expect(computeVestingProgress(stake, 2000)).toBe(1.0);
    expect(computeVestingProgress(stake, 3000)).toBe(1.0);
  });

  it("returns 0.5 at midpoint", () => {
    const stake = makeStake({ vestingStartDate: 1000, vestingEndDate: 3000 });
    expect(computeVestingProgress(stake, 2000)).toBeCloseTo(0.5, 10);
  });

  it("returns correct linear progress at 25%", () => {
    const stake = makeStake({ vestingStartDate: 0, vestingEndDate: 4000 });
    expect(computeVestingProgress(stake, 1000)).toBeCloseTo(0.25, 10);
  });
});

describe("computeCliffStatus", () => {
  it("returns pre_cliff with correct daysRemaining before cliff", () => {
    const stake = makeStake({ cliffDate: 1000 + 10 * DAY, vestingEndDate: 1000 + 100 * DAY });
    const result = computeCliffStatus(stake, 1000);
    expect(result.status).toBe("pre_cliff");
    if (result.status === "pre_cliff") {
      expect(result.daysRemaining).toBe(10);
    }
  });

  it("returns pre_cliff with ceiling for partial days", () => {
    const stake = makeStake({ cliffDate: 1000 + 10 * DAY, vestingEndDate: 1000 + 100 * DAY });
    // 9.5 days remaining → ceil = 10
    const result = computeCliffStatus(stake, 1000 + DAY / 2);
    expect(result.status).toBe("pre_cliff");
    if (result.status === "pre_cliff") {
      expect(result.daysRemaining).toBe(10);
    }
  });

  it("returns cliff_passed after cliff but before vesting end", () => {
    const cliffDate = 1000 + 10 * DAY;
    const stake = makeStake({ cliffDate, vestingEndDate: 1000 + 100 * DAY });
    const result = computeCliffStatus(stake, cliffDate + DAY);
    expect(result.status).toBe("cliff_passed");
    if (result.status === "cliff_passed") {
      expect(result.cliffDate).toBe(cliffDate);
    }
  });

  it("returns fully_vested at or after vesting end", () => {
    const vestingEndDate = 1000 + 100 * DAY;
    const stake = makeStake({ cliffDate: 1000 + 10 * DAY, vestingEndDate });
    expect(computeCliffStatus(stake, vestingEndDate).status).toBe("fully_vested");
    expect(computeCliffStatus(stake, vestingEndDate + DAY).status).toBe("fully_vested");
  });
});

describe("applyDilution", () => {
  const threeFounders: EquityStake[] = [
    makeStake({ founderId: "f1", currentStakePct: 40.0 }),
    makeStake({ founderId: "f2", currentStakePct: 35.0 }),
    makeStake({ founderId: "f3", currentStakePct: 25.0 }),
  ];

  it("reduces target stake by dilutionPct", () => {
    const { updatedStakes } = applyDilution(threeFounders, "f1", 1.0);
    const target = updatedStakes.find((s) => s.founderId === "f1")!;
    expect(target.currentStakePct).toBeCloseTo(39.0, 10);
  });

  it("redistributes proportionally among others", () => {
    const { updatedStakes } = applyDilution(threeFounders, "f1", 1.0);
    const f2 = updatedStakes.find((s) => s.founderId === "f2")!;
    const f3 = updatedStakes.find((s) => s.founderId === "f3")!;
    // f2 share: (35/60) * 1.0 ≈ 0.5833
    // f3 share: (25/60) * 1.0 ≈ 0.4167
    expect(f2.currentStakePct).toBeCloseTo(35.0 + (35 / 60) * 1.0, 5);
    expect(f3.currentStakePct).toBeCloseTo(25.0 + (25 / 60) * 1.0, 5);
  });

  it("preserves cap table sum within 0.01%", () => {
    const { updatedStakes } = applyDilution(threeFounders, "f1", 1.0);
    const sum = updatedStakes.reduce((acc, s) => acc + s.currentStakePct, 0);
    expect(Math.abs(sum - 100.0)).toBeLessThanOrEqual(0.01);
  });

  it("does not mutate original stakes", () => {
    const original = threeFounders.map((s) => ({ ...s }));
    applyDilution(threeFounders, "f1", 1.0);
    expect(threeFounders[0].currentStakePct).toBe(original[0].currentStakePct);
  });

  it("returns correct DilutionEvent", () => {
    const { event } = applyDilution(threeFounders, "f1", 1.0);
    expect(event.founderId).toBe("f1");
    expect(event.dilutionPct).toBe(1.0);
    expect(event.previousStakePct).toBe(40.0);
    expect(event.newStakePct).toBeCloseTo(39.0, 10);
    expect(event.redistributionDetails["f1"]).toBeDefined();
    expect(event.redistributionDetails["f2"]).toBeDefined();
    expect(event.redistributionDetails["f3"]).toBeDefined();
  });

  it("throws for unknown target founder", () => {
    expect(() => applyDilution(threeFounders, "unknown", 1.0)).toThrow();
  });

  it("handles two founders", () => {
    const twoFounders: EquityStake[] = [
      makeStake({ founderId: "f1", currentStakePct: 60.0 }),
      makeStake({ founderId: "f2", currentStakePct: 40.0 }),
    ];
    const { updatedStakes } = applyDilution(twoFounders, "f1", 2.0);
    expect(updatedStakes.find((s) => s.founderId === "f1")!.currentStakePct).toBeCloseTo(58.0, 10);
    expect(updatedStakes.find((s) => s.founderId === "f2")!.currentStakePct).toBeCloseTo(42.0, 10);
  });
});

describe("computeProjectedPayout", () => {
  it("computes valuation × stakePct / 100", () => {
    expect(computeProjectedPayout(25.0, 1_000_000)).toBe(250_000);
  });

  it("returns 0 for 0% stake", () => {
    expect(computeProjectedPayout(0, 1_000_000)).toBe(0);
  });

  it("returns 0 for 0 valuation", () => {
    expect(computeProjectedPayout(25.0, 0)).toBe(0);
  });

  it("handles fractional stakes", () => {
    expect(computeProjectedPayout(33.33, 3_000_000)).toBeCloseTo(999_900, 2);
  });
});

describe("validateCapTableSum", () => {
  it("returns true when sum is exactly 100", () => {
    const stakes = [
      makeStake({ currentStakePct: 50.0 }),
      makeStake({ currentStakePct: 30.0 }),
      makeStake({ currentStakePct: 20.0 }),
    ];
    expect(validateCapTableSum(stakes)).toBe(true);
  });

  it("returns true when sum is within 0.01% of 100", () => {
    const stakes = [
      makeStake({ currentStakePct: 50.005 }),
      makeStake({ currentStakePct: 30.0 }),
      makeStake({ currentStakePct: 20.0 }),
    ];
    expect(validateCapTableSum(stakes)).toBe(true);
  });

  it("returns false when sum deviates more than 0.01%", () => {
    const stakes = [
      makeStake({ currentStakePct: 50.0 }),
      makeStake({ currentStakePct: 30.0 }),
      makeStake({ currentStakePct: 19.0 }),
    ];
    expect(validateCapTableSum(stakes)).toBe(false);
  });

  it("returns true for empty stakes (sum = 0 is not 100)", () => {
    expect(validateCapTableSum([])).toBe(false);
  });
});

describe("triggerDilutionFromReview", () => {
  const threeFounders: EquityStake[] = [
    makeStake({ founderId: "f1", currentStakePct: 40.0 }),
    makeStake({ founderId: "f2", currentStakePct: 35.0 }),
    makeStake({ founderId: "f3", currentStakePct: 25.0 }),
  ];

  it("applies 1% dilution and returns valid cap table", () => {
    const result = triggerDilutionFromReview(threeFounders, "f1", "cycle-1", 1.0);
    expect(result.capTableValid).toBe(true);
    expect(result.event.cycleId).toBe("cycle-1");
    expect(result.event.founderId).toBe("f1");
    expect(result.event.dilutionPct).toBe(1.0);
    const target = result.updatedStakes.find((s) => s.founderId === "f1")!;
    expect(target.currentStakePct).toBeCloseTo(39.0, 10);
  });

  it("sets cycleId on the dilution event", () => {
    const result = triggerDilutionFromReview(threeFounders, "f2", "cycle-42", 1.0);
    expect(result.event.cycleId).toBe("cycle-42");
  });

  it("preserves cap table sum within tolerance", () => {
    const result = triggerDilutionFromReview(threeFounders, "f1", "cycle-1", 1.0);
    const sum = result.updatedStakes.reduce((acc, s) => acc + s.currentStakePct, 0);
    expect(Math.abs(sum - 100.0)).toBeLessThanOrEqual(0.01);
    expect(result.capTableValid).toBe(true);
  });

  it("defaults to 1% dilution when dilutionPct not specified", () => {
    const result = triggerDilutionFromReview(threeFounders, "f1", "cycle-1");
    expect(result.event.dilutionPct).toBe(1.0);
  });

  it("throws for unknown target founder", () => {
    expect(() =>
      triggerDilutionFromReview(threeFounders, "unknown", "cycle-1"),
    ).toThrow();
  });
});
