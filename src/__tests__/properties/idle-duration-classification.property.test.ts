import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 5: Idle Duration Classification
 *
 * For any idle period detected during an active session, exactly one
 * classification applies:
 *   (a) under 8 minutes (480s) — silently absorbed, no event emitted
 *   (b) 8 to under 20 minutes (480–1199s) — micro_pause recorded, no prompt
 *   (c) 20 or more minutes (1200s+) — user_returned event (triggers Idle Modal)
 *
 * Additionally, when continuous active time reaches the configured nudge
 * interval, a soft nudge event fires and the nudge timer resets.
 *
 * **Validates: Requirements 5.2, 5.3, 5.6, 5.7, 6.1**
 */

// ---------------------------------------------------------------------------
// TypeScript mirror of Rust idle.rs types and process_idle_tick
// ---------------------------------------------------------------------------

interface IdleConfig {
  microBreakThresholdSecs: number; // 480 (8 min)
  idleThresholdSecs: number;       // 900 (15 min default)
  nudgeIntervalSecs: number;       // 5400 (90 min default)
  pollIntervalSecs: number;        // 30
}

interface IdleState {
  continuousActiveSecs: number;
  wasIdle: boolean;
  idleStart: number | null;
}

type IdleEvent =
  | { type: "micro_pause"; start: number; durationSecs: number }
  | { type: "idle_threshold"; idleSince: number }
  | { type: "user_returned"; awayDurationSecs: number; awaySince: number }
  | { type: "soft_nudge"; activeDurationSecs: number; currentTask: string };

function defaultConfig(): IdleConfig {
  return {
    microBreakThresholdSecs: 480,
    idleThresholdSecs: 900,
    nudgeIntervalSecs: 5400,
    pollIntervalSecs: 30,
  };
}

function defaultState(): IdleState {
  return { continuousActiveSecs: 0, wasIdle: false, idleStart: null };
}

/**
 * Pure function mirroring Rust `process_idle_tick` exactly.
 */
function processIdleTick(
  config: IdleConfig,
  state: IdleState,
  idleSecs: number,
  now: number,
  currentTask: string,
): { nextState: IdleState; events: IdleEvent[] } {
  const next: IdleState = { ...state };
  const events: IdleEvent[] = [];

  if (idleSecs >= config.idleThresholdSecs && !state.wasIdle) {
    // Transition: active → idle
    next.idleStart = now - idleSecs;
    next.wasIdle = true;
    next.continuousActiveSecs = 0;
    events.push({ type: "idle_threshold", idleSince: next.idleStart });
  } else if (idleSecs < config.microBreakThresholdSecs && state.wasIdle) {
    // Transition: idle → returned
    const awayDuration = state.idleStart != null ? now - state.idleStart : 0;

    if (awayDuration >= config.microBreakThresholdSecs && awayDuration < 20 * 60) {
      events.push({
        type: "micro_pause",
        start: state.idleStart!,
        durationSecs: awayDuration,
      });
    } else if (awayDuration >= 20 * 60) {
      events.push({
        type: "user_returned",
        awayDurationSecs: awayDuration,
        awaySince: state.idleStart!,
      });
    }
    // Under 8 min: silently absorbed

    next.wasIdle = false;
    next.idleStart = null;
    next.continuousActiveSecs = 0;
  } else if (idleSecs < config.pollIntervalSecs && !state.wasIdle) {
    // User is actively working
    next.continuousActiveSecs = state.continuousActiveSecs + config.pollIntervalSecs;

    if (next.continuousActiveSecs >= config.nudgeIntervalSecs) {
      events.push({
        type: "soft_nudge",
        activeDurationSecs: next.continuousActiveSecs,
        currentTask,
      });
      next.continuousActiveSecs = 0;
    }
  }

  return { nextState: next, events };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const nowArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });

describe("Property 5: Idle Duration Classification", () => {
  // -----------------------------------------------------------------------
  // (a) Under 8 min → silently absorbed, no event
  // -----------------------------------------------------------------------
  it("idle period < 8 min is silently absorbed with no event", () => {
    fc.assert(
      fc.property(
        nowArb,
        // away duration: 1s to 479s (under 8 min)
        fc.integer({ min: 1, max: 479 }),
        (baseTime, awayDuration) => {
          const config = defaultConfig();
          const idleStart = baseTime;

          // Simulate: user was idle (past threshold), now returns
          const idleState: IdleState = {
            continuousActiveSecs: 0,
            wasIdle: true,
            idleStart,
          };

          const now = idleStart + awayDuration;
          // idleSecs < microBreakThreshold triggers the return path
          const idleSecs = 5;

          const { events } = processIdleTick(config, idleState, idleSecs, now, "");

          // No event should be emitted for under-8-min idle
          expect(events.length).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  // -----------------------------------------------------------------------
  // (b) 8–20 min → micro_pause recorded, no prompt
  // -----------------------------------------------------------------------
  it("idle period 8–20 min emits micro_pause event", () => {
    fc.assert(
      fc.property(
        nowArb,
        // away duration: 480s (8 min) to 1199s (just under 20 min)
        fc.integer({ min: 480, max: 1199 }),
        (baseTime, awayDuration) => {
          const config = defaultConfig();
          const idleStart = baseTime;

          const idleState: IdleState = {
            continuousActiveSecs: 0,
            wasIdle: true,
            idleStart,
          };

          const now = idleStart + awayDuration;
          const idleSecs = 5;

          const { events } = processIdleTick(config, idleState, idleSecs, now, "");

          expect(events.length).toBe(1);
          expect(events[0].type).toBe("micro_pause");
          if (events[0].type === "micro_pause") {
            expect(events[0].start).toBe(idleStart);
            expect(events[0].durationSecs).toBe(awayDuration);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // -----------------------------------------------------------------------
  // (c) ≥ 20 min → user_returned event (triggers Idle Modal)
  // -----------------------------------------------------------------------
  it("idle period >= 20 min emits user_returned event", () => {
    fc.assert(
      fc.property(
        nowArb,
        // away duration: 1200s (20 min) to 4 hours
        fc.integer({ min: 1200, max: 4 * 3600 }),
        (baseTime, awayDuration) => {
          const config = defaultConfig();
          const idleStart = baseTime;

          const idleState: IdleState = {
            continuousActiveSecs: 0,
            wasIdle: true,
            idleStart,
          };

          const now = idleStart + awayDuration;
          const idleSecs = 5;

          const { events } = processIdleTick(config, idleState, idleSecs, now, "");

          expect(events.length).toBe(1);
          expect(events[0].type).toBe("user_returned");
          if (events[0].type === "user_returned") {
            expect(events[0].awayDurationSecs).toBe(awayDuration);
            expect(events[0].awaySince).toBe(idleStart);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // -----------------------------------------------------------------------
  // Exactly one classification per idle period (mutual exclusivity)
  // -----------------------------------------------------------------------
  it("exactly one classification applies for any away duration on return", () => {
    fc.assert(
      fc.property(
        nowArb,
        // any away duration from 0s to 4 hours
        fc.integer({ min: 0, max: 4 * 3600 }),
        (baseTime, awayDuration) => {
          const config = defaultConfig();
          const idleStart = baseTime;

          const idleState: IdleState = {
            continuousActiveSecs: 0,
            wasIdle: true,
            idleStart,
          };

          const now = idleStart + awayDuration;
          const idleSecs = 5;

          const { events } = processIdleTick(config, idleState, idleSecs, now, "");

          if (awayDuration < 480) {
            // Silently absorbed
            expect(events.length).toBe(0);
          } else if (awayDuration < 1200) {
            // Micro-pause
            expect(events.length).toBe(1);
            expect(events[0].type).toBe("micro_pause");
          } else {
            // User returned (Idle Modal)
            expect(events.length).toBe(1);
            expect(events[0].type).toBe("user_returned");
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  // -----------------------------------------------------------------------
  // Soft nudge fires at configured interval and resets
  // -----------------------------------------------------------------------
  it("soft nudge fires when continuous active time reaches nudge interval, then resets", () => {
    fc.assert(
      fc.property(
        nowArb,
        // nudge interval: 30–180 min in seconds
        fc.integer({ min: 1800, max: 10800 }),
        // poll interval
        fc.constant(30),
        (now, nudgeIntervalSecs, pollIntervalSecs) => {
          const config: IdleConfig = {
            ...defaultConfig(),
            nudgeIntervalSecs,
            pollIntervalSecs,
          };

          // Accumulate active time just below the nudge threshold
          const ticksNeeded = Math.ceil(nudgeIntervalSecs / pollIntervalSecs);
          let state = defaultState();
          let nudgeFired = false;

          for (let i = 0; i < ticksNeeded + 1; i++) {
            const tickNow = now + i * pollIntervalSecs;
            const result = processIdleTick(config, state, 0, tickNow, "task-1");
            state = result.nextState;

            if (result.events.some((e) => e.type === "soft_nudge")) {
              nudgeFired = true;
              // After nudge, continuous active time resets to 0
              expect(state.continuousActiveSecs).toBe(0);
              break;
            }
          }

          expect(nudgeFired).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -----------------------------------------------------------------------
  // Soft nudge resets and fires again after another full interval
  // -----------------------------------------------------------------------
  it("soft nudge fires again after reset and another full interval of active time", () => {
    fc.assert(
      fc.property(
        nowArb,
        // use a small nudge interval for tractable iteration
        fc.integer({ min: 60, max: 600 }),
        (now, nudgeIntervalSecs) => {
          const pollIntervalSecs = 30;
          const config: IdleConfig = {
            ...defaultConfig(),
            nudgeIntervalSecs,
            pollIntervalSecs,
          };

          const ticksNeeded = Math.ceil(nudgeIntervalSecs / pollIntervalSecs);
          let state = defaultState();
          let nudgeCount = 0;

          // Run enough ticks for two nudge cycles
          for (let i = 0; i < (ticksNeeded + 1) * 2; i++) {
            const tickNow = now + i * pollIntervalSecs;
            const result = processIdleTick(config, state, 0, tickNow, "task-1");
            state = result.nextState;

            if (result.events.some((e) => e.type === "soft_nudge")) {
              nudgeCount++;
            }
          }

          expect(nudgeCount).toBeGreaterThanOrEqual(2);
        },
      ),
      { numRuns: 100 },
    );
  });
});
