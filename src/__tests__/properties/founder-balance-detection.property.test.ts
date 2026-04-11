import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeFounderBalance } from "@/lib/startupHealth";

/**
 * Property 12: Founder balance detection
 *
 * For any set of founder weekly hours (2+ founders), the standard deviation should
 * match the population standard deviation formula. A founder should have a balance
 * alert if and only if their absolute deviation from the team average exceeds 30%
 * of the team average.
 *
 * **Validates: Requirements 13.1, 13.2**
 */

// --- Helpers ---

function populationStdDev(values: number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// --- Arbitraries ---

const hoursArb = fc.double({ min: 0, max: 80, noNaN: true, noDefaultInfinity: true });

// Generate 2-5 founders with hours
const founderHoursArb = fc
  .array(
    fc.tuple(fc.uuid(), hoursArb),
    { minLength: 2, maxLength: 5 },
  )
  .map((entries) => {
    // Ensure unique founder IDs
    const seen = new Set<string>();
    const unique: Array<[string, number]> = [];
    for (const [id, hours] of entries) {
      if (!seen.has(id)) {
        seen.add(id);
        unique.push([id, hours]);
      }
    }
    // Ensure at least 2
    while (unique.length < 2) {
      const newId = `f-extra-${unique.length}`;
      unique.push([newId, 30]);
    }
    return unique;
  });

// --- Property Tests ---

describe("Property 12: Founder balance detection", () => {
  it("stdDev matches population standard deviation formula (Req 13.1)", () => {
    fc.assert(
      fc.property(founderHoursArb, (entries) => {
        const founderHours = new Map(entries);
        const founderNames = new Map(entries.map(([id]) => [id, `Name-${id.slice(0, 4)}`]));

        const result = computeFounderBalance(founderHours, founderNames);
        const hours = entries.map(([, h]) => h);
        const expectedStdDev = populationStdDev(hours);

        expect(result.stdDev).toBeCloseTo(expectedStdDev, 5);
      }),
      { numRuns: 100 },
    );
  });

  it("teamAvgHours matches arithmetic mean (Req 13.1)", () => {
    fc.assert(
      fc.property(founderHoursArb, (entries) => {
        const founderHours = new Map(entries);
        const founderNames = new Map(entries.map(([id]) => [id, `Name-${id.slice(0, 4)}`]));

        const result = computeFounderBalance(founderHours, founderNames);
        const hours = entries.map(([, h]) => h);
        const expectedMean = mean(hours);

        expect(result.teamAvgHours).toBeCloseTo(expectedMean, 5);
      }),
      { numRuns: 100 },
    );
  });

  it("hasAlert is true iff deviation > 30% of team average (Req 13.2)", () => {
    fc.assert(
      fc.property(founderHoursArb, (entries) => {
        const founderHours = new Map(entries);
        const founderNames = new Map(entries.map(([id]) => [id, `Name-${id.slice(0, 4)}`]));

        const result = computeFounderBalance(founderHours, founderNames);
        const teamAvg = result.teamAvgHours;

        for (const founder of result.founders) {
          const expectedDeviationPct =
            teamAvg > 0
              ? (Math.abs(founder.weeklyHours - teamAvg) / teamAvg) * 100
              : 0;
          const expectedAlert = expectedDeviationPct > 30;

          expect(founder.hasAlert).toBe(expectedAlert);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("deviationPct is correctly computed for each founder (Req 13.2)", () => {
    fc.assert(
      fc.property(founderHoursArb, (entries) => {
        const founderHours = new Map(entries);
        const founderNames = new Map(entries.map(([id]) => [id, `Name-${id.slice(0, 4)}`]));

        const result = computeFounderBalance(founderHours, founderNames);
        const teamAvg = result.teamAvgHours;

        for (const founder of result.founders) {
          const expectedPct =
            teamAvg > 0
              ? (Math.abs(founder.weeklyHours - teamAvg) / teamAvg) * 100
              : 0;

          expect(founder.deviationPct).toBeCloseTo(expectedPct, 5);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("stdDev is always >= 0 (Req 13.1)", () => {
    fc.assert(
      fc.property(founderHoursArb, (entries) => {
        const founderHours = new Map(entries);
        const founderNames = new Map(entries.map(([id]) => [id, `Name-${id.slice(0, 4)}`]));

        const result = computeFounderBalance(founderHours, founderNames);
        expect(result.stdDev).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });

  it("no alerts when all founders have equal hours (Req 13.2)", () => {
    fc.assert(
      fc.property(
        hoursArb,
        fc.integer({ min: 2, max: 5 }),
        (hours, count) => {
          const entries: Array<[string, number]> = Array.from(
            { length: count },
            (_, i) => [`f-${i}`, hours],
          );
          const founderHours = new Map(entries);
          const founderNames = new Map(entries.map(([id]) => [id, `Name-${id}`]));

          const result = computeFounderBalance(founderHours, founderNames);

          expect(result.stdDev).toBeCloseTo(0, 10);
          expect(result.founders.every((f) => !f.hasAlert)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
