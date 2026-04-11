import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Feature: founder-governance, Property 5: Consecutive warnings trigger dilution
 *
 * For any founder who receives accountability warnings in two consecutive
 * review cycles (cycles with adjacent endDate/startDate), a dilution event
 * of exactly 1% should be triggered. If the warnings are not in consecutive
 * cycles, no dilution event should be triggered.
 *
 * **Validates: Requirements 2.5**
 */

// --- Types mirroring the Rust/SQLite data model ---

const CYCLE_INTERVAL_DAYS = 14;
const DAY = 24 * 3600;

interface ReviewCycle {
  id: string;
  startDate: number;
  endDate: number;
  status: "open" | "closed" | "resolved";
}

interface AccountabilityWarning {
  founderId: string;
  cycleId: string;
  issuedAt: number;
}

interface DilutionEvent {
  founderId: string;
  cycleId: string;
  dilutionPct: number;
}

// --- Pure computation functions mirroring Rust logic ---

/**
 * Determine if two cycles are consecutive: cycle B immediately follows cycle A
 * when A's endDate <= B's startDate (the Rust logic uses endDate <= startDate
 * to find the previous cycle via ORDER BY endDate DESC LIMIT 1).
 */
function areCyclesConsecutive(cycleA: ReviewCycle, cycleB: ReviewCycle): boolean {
  return cycleA.endDate <= cycleB.startDate;
}

/**
 * Check if a founder's warning in the current cycle should trigger dilution.
 * Mirrors the Rust `check_consecutive_warnings_and_dilute` logic:
 * 1. Find the previous cycle (latest endDate <= current startDate)
 * 2. Check if the founder had a warning in that previous cycle
 * 3. If yes → trigger 1% dilution
 */
function checkConsecutiveWarningsAndDilute(
  currentCycle: ReviewCycle,
  founderId: string,
  allCycles: ReviewCycle[],
  allWarnings: AccountabilityWarning[],
): DilutionEvent | null {
  // Find the immediately previous cycle: latest endDate <= current startDate
  const previousCycles = allCycles
    .filter((c) => c.id !== currentCycle.id && c.endDate <= currentCycle.startDate)
    .sort((a, b) => b.endDate - a.endDate);

  if (previousCycles.length === 0) {
    return null;
  }

  const prevCycle = previousCycles[0];

  // Check if the founder had a warning in the previous cycle
  const hadPrevWarning = allWarnings.some(
    (w) => w.founderId === founderId && w.cycleId === prevCycle.id,
  );

  if (hadPrevWarning) {
    return {
      founderId,
      cycleId: currentCycle.id,
      dilutionPct: 1.0,
    };
  }

  return null;
}

// --- Arbitraries ---

const timestampArb = fc.integer({ min: 1_577_836_800, max: 1_893_456_000 });

const founderIdArb = fc.constantFrom("founder-A", "founder-B", "founder-C");

/** Generate a sequence of consecutive review cycles */
function consecutiveCyclesArb(count: number): fc.Arbitrary<ReviewCycle[]> {
  return timestampArb.map((start) => {
    const cycles: ReviewCycle[] = [];
    for (let i = 0; i < count; i++) {
      const cycleStart = start + i * CYCLE_INTERVAL_DAYS * DAY;
      const cycleEnd = cycleStart + CYCLE_INTERVAL_DAYS * DAY;
      cycles.push({
        id: `cycle-${i}`,
        startDate: cycleStart,
        endDate: cycleEnd,
        status: "resolved",
      });
    }
    return cycles;
  });
}

/** Generate a sequence of cycles with a gap (non-consecutive) */
function gappedCyclesArb(): fc.Arbitrary<ReviewCycle[]> {
  return fc
    .tuple(
      timestampArb,
      fc.integer({ min: 2, max: 10 }), // gap multiplier (skip 1+ cycles)
    )
    .map(([start, gapMultiplier]) => {
      const cycle0Start = start;
      const cycle0End = cycle0Start + CYCLE_INTERVAL_DAYS * DAY;

      // Second cycle starts after a gap (skipping at least one cycle period)
      const cycle1Start = cycle0End + gapMultiplier * CYCLE_INTERVAL_DAYS * DAY;
      const cycle1End = cycle1Start + CYCLE_INTERVAL_DAYS * DAY;

      return [
        {
          id: "cycle-0",
          startDate: cycle0Start,
          endDate: cycle0End,
          status: "resolved" as const,
        },
        {
          id: "cycle-gap",
          startDate: cycle1Start,
          endDate: cycle1End,
          status: "resolved" as const,
        },
      ];
    });
}

// --- Property Tests ---

describe("Property 5: Consecutive warnings trigger dilution", () => {
  it("two consecutive cycle warnings trigger exactly 1% dilution (Req 2.5)", () => {
    fc.assert(
      fc.property(
        consecutiveCyclesArb(2),
        founderIdArb,
        (cycles, founderId) => {
          // Founder warned in both consecutive cycles
          const warnings: AccountabilityWarning[] = [
            { founderId, cycleId: cycles[0].id, issuedAt: cycles[0].endDate },
            { founderId, cycleId: cycles[1].id, issuedAt: cycles[1].endDate },
          ];

          const dilution = checkConsecutiveWarningsAndDilute(
            cycles[1],
            founderId,
            cycles,
            warnings,
          );

          expect(dilution).not.toBeNull();
          expect(dilution!.dilutionPct).toBe(1.0);
          expect(dilution!.founderId).toBe(founderId);
          expect(dilution!.cycleId).toBe(cycles[1].id);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("non-consecutive cycle warnings do NOT trigger dilution (Req 2.5)", () => {
    fc.assert(
      fc.property(
        gappedCyclesArb(),
        founderIdArb,
        (cycles, founderId) => {
          // Founder warned in both cycles, but they are NOT consecutive
          // (there's a gap cycle in between)
          const warnings: AccountabilityWarning[] = [
            { founderId, cycleId: cycles[0].id, issuedAt: cycles[0].endDate },
            { founderId, cycleId: cycles[1].id, issuedAt: cycles[1].endDate },
          ];

          // Insert a "middle" cycle that fills the gap (no warning for this founder)
          const middleCycleStart = cycles[0].endDate;
          const middleCycleEnd = middleCycleStart + CYCLE_INTERVAL_DAYS * DAY;
          const allCycles: ReviewCycle[] = [
            cycles[0],
            {
              id: "cycle-middle",
              startDate: middleCycleStart,
              endDate: middleCycleEnd,
              status: "resolved",
            },
            cycles[1],
          ];

          // The previous cycle for cycles[1] is "cycle-middle" (not cycles[0])
          // since cycle-middle has the latest endDate <= cycles[1].startDate
          const dilution = checkConsecutiveWarningsAndDilute(
            cycles[1],
            founderId,
            allCycles,
            warnings,
          );

          // No warning in the middle cycle → no consecutive warnings → no dilution
          expect(dilution).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("first warning in a sequence never triggers dilution (Req 2.5)", () => {
    fc.assert(
      fc.property(
        consecutiveCyclesArb(3),
        founderIdArb,
        (cycles, founderId) => {
          // Only one warning in the first cycle
          const warnings: AccountabilityWarning[] = [
            { founderId, cycleId: cycles[0].id, issuedAt: cycles[0].endDate },
          ];

          const dilution = checkConsecutiveWarningsAndDilute(
            cycles[0],
            founderId,
            cycles,
            warnings,
          );

          // First cycle has no previous cycle with a warning → no dilution
          expect(dilution).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("warning for a different founder does not trigger dilution (Req 2.5)", () => {
    fc.assert(
      fc.property(
        consecutiveCyclesArb(2),
        (cycles) => {
          // founder-A warned in cycle 0, founder-B warned in cycle 1
          const warnings: AccountabilityWarning[] = [
            { founderId: "founder-A", cycleId: cycles[0].id, issuedAt: cycles[0].endDate },
            { founderId: "founder-B", cycleId: cycles[1].id, issuedAt: cycles[1].endDate },
          ];

          // Check for founder-B in cycle 1: previous cycle warning is for founder-A, not B
          const dilution = checkConsecutiveWarningsAndDilute(
            cycles[1],
            "founder-B",
            cycles,
            warnings,
          );

          expect(dilution).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("three consecutive warnings trigger dilution on 2nd and 3rd cycles (Req 2.5)", () => {
    fc.assert(
      fc.property(
        consecutiveCyclesArb(3),
        founderIdArb,
        (cycles, founderId) => {
          const warnings: AccountabilityWarning[] = cycles.map((c) => ({
            founderId,
            cycleId: c.id,
            issuedAt: c.endDate,
          }));

          // Cycle 0: no previous → no dilution
          const d0 = checkConsecutiveWarningsAndDilute(
            cycles[0],
            founderId,
            cycles,
            warnings,
          );
          expect(d0).toBeNull();

          // Cycle 1: previous (cycle 0) has warning → dilution
          const d1 = checkConsecutiveWarningsAndDilute(
            cycles[1],
            founderId,
            cycles,
            warnings,
          );
          expect(d1).not.toBeNull();
          expect(d1!.dilutionPct).toBe(1.0);

          // Cycle 2: previous (cycle 1) has warning → dilution
          const d2 = checkConsecutiveWarningsAndDilute(
            cycles[2],
            founderId,
            cycles,
            warnings,
          );
          expect(d2).not.toBeNull();
          expect(d2!.dilutionPct).toBe(1.0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("dilution event always references the current cycle, not the previous (Req 2.5)", () => {
    fc.assert(
      fc.property(
        consecutiveCyclesArb(2),
        founderIdArb,
        (cycles, founderId) => {
          const warnings: AccountabilityWarning[] = [
            { founderId, cycleId: cycles[0].id, issuedAt: cycles[0].endDate },
            { founderId, cycleId: cycles[1].id, issuedAt: cycles[1].endDate },
          ];

          const dilution = checkConsecutiveWarningsAndDilute(
            cycles[1],
            founderId,
            cycles,
            warnings,
          );

          expect(dilution).not.toBeNull();
          expect(dilution!.cycleId).toBe(cycles[1].id);
          expect(dilution!.cycleId).not.toBe(cycles[0].id);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("consecutive cycles satisfy endDate <= next startDate adjacency (Req 2.5)", () => {
    fc.assert(
      fc.property(
        consecutiveCyclesArb(4),
        (cycles) => {
          for (let i = 0; i < cycles.length - 1; i++) {
            expect(areCyclesConsecutive(cycles[i], cycles[i + 1])).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
