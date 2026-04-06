use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use user_idle::UserIdle;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdleConfig {
    /// Micro-break absorption threshold in seconds (default 480 = 8 min).
    /// Idle periods shorter than this are silently absorbed.
    pub micro_break_threshold_secs: u64,
    /// Idle threshold in seconds (default 900 = 15 min, configurable 5–60 min).
    /// When reached, emits `idle_threshold_reached`.
    pub idle_threshold_secs: u64,
    /// Soft nudge interval in seconds (default 5400 = 90 min, configurable 30–180 min).
    /// After this much continuous active time, emits `soft_nudge`.
    pub nudge_interval_secs: u64,
    /// Polling interval in seconds (default 30).
    pub poll_interval_secs: u64,
}

impl Default for IdleConfig {
    fn default() -> Self {
        Self {
            micro_break_threshold_secs: 480,  // 8 min
            idle_threshold_secs: 900,         // 15 min
            nudge_interval_secs: 5400,        // 90 min
            poll_interval_secs: 30,
        }
    }
}

// ---------------------------------------------------------------------------
// Events emitted to the frontend
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum IdleEvent {
    #[serde(rename = "micro_pause")]
    MicroPause {
        start: i64,
        duration_secs: u64,
    },
    #[serde(rename = "idle_threshold")]
    IdleThresholdReached {
        idle_since: i64,
    },
    #[serde(rename = "user_returned")]
    UserReturned {
        away_duration_secs: u64,
        away_since: i64,
    },
    #[serde(rename = "soft_nudge")]
    SoftNudge {
        active_duration_secs: u64,
        current_task: String,
    },
}

// ---------------------------------------------------------------------------
// Mutable state tracked across polling ticks
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct IdleState {
    /// Seconds of continuous active work since last idle or nudge reset.
    pub continuous_active_secs: u64,
    /// Whether the user is currently considered idle (past threshold).
    pub was_idle: bool,
    /// Unix timestamp when the current idle period started, if idle.
    pub idle_start: Option<i64>,
}

impl Default for IdleState {
    fn default() -> Self {
        Self {
            continuous_active_secs: 0,
            was_idle: false,
            idle_start: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Pure core logic — testable without system idle or Tauri
// ---------------------------------------------------------------------------

/// Process a single idle-detection tick. Returns any event to emit and the
/// updated state. This is a pure function: it reads `idle_secs` and `now`
/// as parameters so tests can inject deterministic values.
pub fn process_idle_tick(
    config: &IdleConfig,
    state: &IdleState,
    idle_secs: u64,
    now: i64,
    current_task: &str,
) -> (IdleState, Vec<IdleEvent>) {
    let mut next = state.clone();
    let mut events: Vec<IdleEvent> = Vec::new();

    if idle_secs >= config.idle_threshold_secs && !state.was_idle {
        // Transition: active → idle
        next.idle_start = Some(now - idle_secs as i64);
        next.was_idle = true;
        next.continuous_active_secs = 0;

        events.push(IdleEvent::IdleThresholdReached {
            idle_since: next.idle_start.unwrap(),
        });
    } else if idle_secs < config.micro_break_threshold_secs && state.was_idle {
        // Transition: idle → returned
        let away_duration = state
            .idle_start
            .map(|s| (now - s) as u64)
            .unwrap_or(0);

        if away_duration >= config.micro_break_threshold_secs && away_duration < 20 * 60 {
            // 8–20 min: micro-pause, noted in timeline, no prompt
            events.push(IdleEvent::MicroPause {
                start: state.idle_start.unwrap(),
                duration_secs: away_duration,
            });
        } else if away_duration >= 20 * 60 {
            // 20+ min: prompt user on return (triggers Idle Modal)
            events.push(IdleEvent::UserReturned {
                away_duration_secs: away_duration,
                away_since: state.idle_start.unwrap(),
            });
        }
        // Under 8 min: absorbed silently, no event

        next.was_idle = false;
        next.idle_start = None;
        next.continuous_active_secs = 0;
    } else if idle_secs < config.poll_interval_secs && !state.was_idle {
        // User is actively working
        next.continuous_active_secs = state.continuous_active_secs + config.poll_interval_secs;

        if next.continuous_active_secs >= config.nudge_interval_secs {
            events.push(IdleEvent::SoftNudge {
                active_duration_secs: next.continuous_active_secs,
                current_task: current_task.to_string(),
            });
            next.continuous_active_secs = 0; // Reset after nudge
        }
    }

    (next, events)
}

// ---------------------------------------------------------------------------
// Background thread — actual polling loop
// ---------------------------------------------------------------------------

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// Spawns the idle detection background thread. Returns the join handle and
/// a stop flag (set to `true` to terminate the loop).
pub fn spawn_idle_detection(
    config: IdleConfig,
    _session_id: String,
    app_handle: AppHandle,
) -> (JoinHandle<()>, Arc<AtomicBool>) {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = Arc::clone(&stop);

    let handle = thread::spawn(move || {
        let mut state = IdleState::default();

        while !stop_clone.load(Ordering::Relaxed) {
            // Sleep in small increments so we can check the stop flag promptly.
            let sleep_ms = config.poll_interval_secs * 1000;
            let increments = sleep_ms / 100;
            for _ in 0..increments {
                if stop_clone.load(Ordering::Relaxed) {
                    return;
                }
                thread::sleep(Duration::from_millis(100));
            }

            if stop_clone.load(Ordering::Relaxed) {
                return;
            }

            let idle_secs = match UserIdle::get_time() {
                Ok(idle) => idle.duration().as_secs(),
                Err(_) => continue, // skip this tick if we can't read idle time
            };
            let now = unix_now();

            // TODO: In a future task, wire up current task name from DB
            let current_task = String::new();

            let (next_state, events) =
                process_idle_tick(&config, &state, idle_secs, now, &current_task);
            state = next_state;

            for event in events {
                let event_name = match &event {
                    IdleEvent::MicroPause { .. } => "micro_pause",
                    IdleEvent::IdleThresholdReached { .. } => "idle_threshold_reached",
                    IdleEvent::UserReturned { .. } => "user_returned",
                    IdleEvent::SoftNudge { .. } => "soft_nudge",
                };
                let _ = app_handle.emit(event_name, &event);
            }
        }
    });

    (handle, stop)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn default_config() -> IdleConfig {
        IdleConfig::default()
    }

    // -- IdleConfig defaults --

    #[test]
    fn test_idle_config_defaults() {
        let cfg = IdleConfig::default();
        assert_eq!(cfg.micro_break_threshold_secs, 480);
        assert_eq!(cfg.idle_threshold_secs, 900);
        assert_eq!(cfg.nudge_interval_secs, 5400);
        assert_eq!(cfg.poll_interval_secs, 30);
    }

    // -- Transition: active → idle --

    #[test]
    fn test_idle_threshold_reached_emits_event() {
        let cfg = default_config();
        let state = IdleState::default();
        let now = 1_700_000_000i64;
        let idle_secs = 900; // exactly at threshold

        let (next, events) = process_idle_tick(&cfg, &state, idle_secs, now, "");

        assert!(next.was_idle);
        assert_eq!(next.idle_start, Some(now - 900));
        assert_eq!(next.continuous_active_secs, 0);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0],
            IdleEvent::IdleThresholdReached {
                idle_since: now - 900
            }
        );
    }

    #[test]
    fn test_no_double_idle_event_when_already_idle() {
        let cfg = default_config();
        // Already idle
        let state = IdleState {
            was_idle: true,
            idle_start: Some(1_700_000_000 - 900),
            continuous_active_secs: 0,
        };
        let now = 1_700_000_000i64 + 30;
        let idle_secs = 930; // still idle

        let (next, events) = process_idle_tick(&cfg, &state, idle_secs, now, "");

        assert!(next.was_idle);
        assert!(events.is_empty(), "should not re-emit idle event");
    }

    // -- Transition: idle → returned (under 8 min = silent) --

    #[test]
    fn test_return_under_8min_absorbed_silently() {
        let cfg = default_config();
        let idle_start = 1_700_000_000i64;
        let state = IdleState {
            was_idle: true,
            idle_start: Some(idle_start),
            continuous_active_secs: 0,
        };
        // User was away for 5 minutes (300s), now active
        let now = idle_start + 300;
        let idle_secs = 10; // below micro_break_threshold

        let (next, events) = process_idle_tick(&cfg, &state, idle_secs, now, "");

        assert!(!next.was_idle);
        assert!(next.idle_start.is_none());
        assert!(events.is_empty(), "under 8 min should be silent");
    }

    // -- Transition: idle → returned (8–20 min = micro_pause) --

    #[test]
    fn test_return_8_to_20min_emits_micro_pause() {
        let cfg = default_config();
        let idle_start = 1_700_000_000i64;
        let state = IdleState {
            was_idle: true,
            idle_start: Some(idle_start),
            continuous_active_secs: 0,
        };
        // User was away for 10 minutes (600s)
        let now = idle_start + 600;
        let idle_secs = 10; // below micro_break_threshold → returned

        let (next, events) = process_idle_tick(&cfg, &state, idle_secs, now, "");

        assert!(!next.was_idle);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0],
            IdleEvent::MicroPause {
                start: idle_start,
                duration_secs: 600,
            }
        );
    }

    // -- Transition: idle → returned (≥20 min = user_returned) --

    #[test]
    fn test_return_over_20min_emits_user_returned() {
        let cfg = default_config();
        let idle_start = 1_700_000_000i64;
        let state = IdleState {
            was_idle: true,
            idle_start: Some(idle_start),
            continuous_active_secs: 0,
        };
        // User was away for 25 minutes (1500s)
        let now = idle_start + 1500;
        let idle_secs = 5; // below micro_break_threshold → returned

        let (next, events) = process_idle_tick(&cfg, &state, idle_secs, now, "");

        assert!(!next.was_idle);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0],
            IdleEvent::UserReturned {
                away_duration_secs: 1500,
                away_since: idle_start,
            }
        );
    }

    // -- Soft nudge --

    #[test]
    fn test_soft_nudge_fires_at_interval() {
        let cfg = IdleConfig {
            nudge_interval_secs: 90, // short interval for testing
            poll_interval_secs: 30,
            ..default_config()
        };
        let state = IdleState {
            continuous_active_secs: 60, // already 60s active
            was_idle: false,
            idle_start: None,
        };
        let now = 1_700_000_000i64;
        let idle_secs = 5; // active

        let (next, events) = process_idle_tick(&cfg, &state, idle_secs, now, "Design review");

        // 60 + 30 = 90 >= 90 → nudge
        assert_eq!(next.continuous_active_secs, 0, "should reset after nudge");
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0],
            IdleEvent::SoftNudge {
                active_duration_secs: 90,
                current_task: "Design review".to_string(),
            }
        );
    }

    #[test]
    fn test_no_nudge_before_interval() {
        let cfg = default_config(); // nudge at 5400s
        let state = IdleState {
            continuous_active_secs: 60,
            was_idle: false,
            idle_start: None,
        };
        let now = 1_700_000_000i64;
        let idle_secs = 5;

        let (next, events) = process_idle_tick(&cfg, &state, idle_secs, now, "");

        assert_eq!(next.continuous_active_secs, 90); // 60 + 30
        assert!(events.is_empty());
    }

    // -- Active time resets on idle --

    #[test]
    fn test_continuous_active_resets_on_idle() {
        let cfg = default_config();
        let state = IdleState {
            continuous_active_secs: 3000,
            was_idle: false,
            idle_start: None,
        };
        let now = 1_700_000_000i64;
        let idle_secs = 900; // hit idle threshold

        let (next, _events) = process_idle_tick(&cfg, &state, idle_secs, now, "");

        assert_eq!(next.continuous_active_secs, 0);
    }

    #[test]
    fn test_continuous_active_resets_on_return() {
        let cfg = default_config();
        let idle_start = 1_700_000_000i64;
        let state = IdleState {
            was_idle: true,
            idle_start: Some(idle_start),
            continuous_active_secs: 0,
        };
        let now = idle_start + 1500; // 25 min away
        let idle_secs = 5;

        let (next, _events) = process_idle_tick(&cfg, &state, idle_secs, now, "");

        assert_eq!(next.continuous_active_secs, 0);
    }

    // -- Boundary: exactly 8 min away --

    #[test]
    fn test_return_exactly_8min_emits_micro_pause() {
        let cfg = default_config();
        let idle_start = 1_700_000_000i64;
        let state = IdleState {
            was_idle: true,
            idle_start: Some(idle_start),
            continuous_active_secs: 0,
        };
        let now = idle_start + 480; // exactly 8 min
        let idle_secs = 10;

        let (_next, events) = process_idle_tick(&cfg, &state, idle_secs, now, "");

        assert_eq!(events.len(), 1);
        match &events[0] {
            IdleEvent::MicroPause { duration_secs, .. } => {
                assert_eq!(*duration_secs, 480);
            }
            _ => panic!("expected MicroPause"),
        }
    }

    // -- Boundary: exactly 20 min away --

    #[test]
    fn test_return_exactly_20min_emits_user_returned() {
        let cfg = default_config();
        let idle_start = 1_700_000_000i64;
        let state = IdleState {
            was_idle: true,
            idle_start: Some(idle_start),
            continuous_active_secs: 0,
        };
        let now = idle_start + 1200; // exactly 20 min
        let idle_secs = 10;

        let (_next, events) = process_idle_tick(&cfg, &state, idle_secs, now, "");

        assert_eq!(events.len(), 1);
        match &events[0] {
            IdleEvent::UserReturned {
                away_duration_secs, ..
            } => {
                assert_eq!(*away_duration_secs, 1200);
            }
            _ => panic!("expected UserReturned"),
        }
    }

    // -- IdleEvent serialization --

    #[test]
    fn test_idle_event_serialization() {
        let event = IdleEvent::IdleThresholdReached {
            idle_since: 1_700_000_000,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"idle_threshold\""));
        assert!(json.contains("\"idle_since\":1700000000"));
    }

    #[test]
    fn test_micro_pause_serialization() {
        let event = IdleEvent::MicroPause {
            start: 1_700_000_000,
            duration_secs: 600,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"micro_pause\""));
        assert!(json.contains("\"start\":1700000000"));
        assert!(json.contains("\"duration_secs\":600"));
    }

    #[test]
    fn test_soft_nudge_serialization() {
        let event = IdleEvent::SoftNudge {
            active_duration_secs: 5400,
            current_task: "Code review".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"soft_nudge\""));
        assert!(json.contains("\"active_duration_secs\":5400"));
        assert!(json.contains("\"current_task\":\"Code review\""));
    }

    // -- Below-threshold idle does nothing --

    #[test]
    fn test_idle_below_threshold_no_event() {
        let cfg = default_config();
        let state = IdleState::default();
        let now = 1_700_000_000i64;
        let idle_secs = 600; // 10 min, below 15 min threshold

        let (next, events) = process_idle_tick(&cfg, &state, idle_secs, now, "");

        assert!(!next.was_idle);
        assert!(events.is_empty());
        // Also should not increment active time since idle_secs >= poll_interval
        assert_eq!(next.continuous_active_secs, 0);
    }

    // -- Configurable idle threshold (5–60 min range) --

    #[test]
    fn test_configurable_idle_threshold_5min() {
        let cfg = IdleConfig {
            idle_threshold_secs: 300, // 5 min (minimum)
            ..default_config()
        };
        let state = IdleState::default();
        let now = 1_700_000_000i64;

        // At exactly 5 min idle → should trigger
        let (next, events) = process_idle_tick(&cfg, &state, 300, now, "");
        assert!(next.was_idle);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], IdleEvent::IdleThresholdReached { .. }));
    }

    #[test]
    fn test_configurable_idle_threshold_60min() {
        let cfg = IdleConfig {
            idle_threshold_secs: 3600, // 60 min (maximum)
            ..default_config()
        };
        let state = IdleState::default();
        let now = 1_700_000_000i64;

        // At 59 min → should NOT trigger
        let (next, events) = process_idle_tick(&cfg, &state, 3540, now, "");
        assert!(!next.was_idle);
        assert!(events.is_empty());

        // At exactly 60 min → should trigger
        let (next2, events2) = process_idle_tick(&cfg, &state, 3600, now, "");
        assert!(next2.was_idle);
        assert_eq!(events2.len(), 1);
        assert!(matches!(events2[0], IdleEvent::IdleThresholdReached { .. }));
    }

    #[test]
    fn test_configurable_idle_threshold_exact_boundary() {
        // Threshold set to exactly the idle_secs value
        let cfg = IdleConfig {
            idle_threshold_secs: 600, // 10 min custom
            ..default_config()
        };
        let state = IdleState::default();
        let now = 1_700_000_000i64;

        let (next, events) = process_idle_tick(&cfg, &state, 600, now, "");
        assert!(next.was_idle);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0],
            IdleEvent::IdleThresholdReached {
                idle_since: now - 600
            }
        );
    }

    // -- Idle → return → idle cycle (full state transition) --

    #[test]
    fn test_idle_return_idle_cycle() {
        let cfg = default_config();
        let now = 1_700_000_000i64;

        // Step 1: Start active
        let state = IdleState::default();
        assert!(!state.was_idle);

        // Step 2: Go idle (15 min threshold reached)
        let (state, events) = process_idle_tick(&cfg, &state, 900, now, "");
        assert!(state.was_idle);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], IdleEvent::IdleThresholdReached { .. }));

        // Step 3: Return after 25 min away → user_returned event
        let return_time = now + 600; // some time passes
        let (state, events) = process_idle_tick(&cfg, &state, 5, return_time, "");
        assert!(!state.was_idle);
        assert!(state.idle_start.is_none());
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], IdleEvent::UserReturned { .. }));

        // Step 4: Work actively for a tick
        let (state, events) = process_idle_tick(&cfg, &state, 5, return_time + 30, "");
        assert!(!state.was_idle);
        assert_eq!(state.continuous_active_secs, 30);
        assert!(events.is_empty());

        // Step 5: Go idle again (15 min threshold)
        let (state, events) = process_idle_tick(&cfg, &state, 900, return_time + 960, "");
        assert!(state.was_idle);
        assert_eq!(state.continuous_active_secs, 0);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], IdleEvent::IdleThresholdReached { .. }));
    }

    // -- Soft nudge fires again after another full interval --

    #[test]
    fn test_soft_nudge_fires_again_after_reset() {
        let cfg = IdleConfig {
            nudge_interval_secs: 90,
            poll_interval_secs: 30,
            ..default_config()
        };
        let now = 1_700_000_000i64;

        // Tick 1: 60s active already
        let state = IdleState {
            continuous_active_secs: 60,
            was_idle: false,
            idle_start: None,
        };
        let (state, events) = process_idle_tick(&cfg, &state, 5, now, "Task A");
        // 60 + 30 = 90 → first nudge fires
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], IdleEvent::SoftNudge { .. }));
        assert_eq!(state.continuous_active_secs, 0); // reset

        // Tick 2: accumulate 30s
        let (state, events) = process_idle_tick(&cfg, &state, 5, now + 30, "Task A");
        assert_eq!(state.continuous_active_secs, 30);
        assert!(events.is_empty());

        // Tick 3: accumulate 60s
        let (state, events) = process_idle_tick(&cfg, &state, 5, now + 60, "Task A");
        assert_eq!(state.continuous_active_secs, 60);
        assert!(events.is_empty());

        // Tick 4: accumulate 90s → second nudge fires
        let (state, events) = process_idle_tick(&cfg, &state, 5, now + 90, "Task A");
        assert_eq!(state.continuous_active_secs, 0); // reset again
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0],
            IdleEvent::SoftNudge {
                active_duration_secs: 90,
                current_task: "Task A".to_string(),
            }
        );
    }

    // -- Continuous active tracking increments per poll --

    #[test]
    fn test_continuous_active_increments_per_poll() {
        let cfg = default_config(); // poll_interval = 30s
        let now = 1_700_000_000i64;

        let state = IdleState::default();

        // Tick 1: 0 + 30 = 30
        let (state, events) = process_idle_tick(&cfg, &state, 5, now, "");
        assert_eq!(state.continuous_active_secs, 30);
        assert!(events.is_empty());

        // Tick 2: 30 + 30 = 60
        let (state, events) = process_idle_tick(&cfg, &state, 5, now + 30, "");
        assert_eq!(state.continuous_active_secs, 60);
        assert!(events.is_empty());

        // Tick 3: 60 + 30 = 90
        let (state, events) = process_idle_tick(&cfg, &state, 5, now + 60, "");
        assert_eq!(state.continuous_active_secs, 90);
        assert!(events.is_empty());
    }

    // =========================================================================
    // Stress tests for idle detection timing (Task 8.6)
    // Validates: Requirements 5.1, 6.1, performance
    // =========================================================================

    /// Rapid idle/active transitions every 30 seconds for 10 minutes:
    /// no missed events, no duplicate events.
    #[test]
    fn stress_rapid_idle_active_transitions() {
        let cfg = IdleConfig {
            idle_threshold_secs: 60,       // low threshold so we can trigger quickly
            micro_break_threshold_secs: 30,
            nudge_interval_secs: 99999,    // disable nudge for this test
            poll_interval_secs: 30,
        };
        let base_time = 1_700_000_000i64;
        let total_ticks = 20; // 20 ticks × 30s = 10 minutes

        let mut state = IdleState::default();
        let mut idle_threshold_count = 0u64;
        let mut return_event_count = 0u64; // MicroPause + UserReturned

        for tick in 0..total_ticks {
            let now = base_time + (tick as i64 * 30);
            // Alternate: even ticks = idle (report 60s idle), odd ticks = active (report 5s idle)
            let idle_secs = if tick % 2 == 0 { 60 } else { 5 };

            let (next, events) = process_idle_tick(&cfg, &state, idle_secs, now, "");

            for ev in &events {
                match ev {
                    IdleEvent::IdleThresholdReached { .. } => idle_threshold_count += 1,
                    IdleEvent::UserReturned { .. } | IdleEvent::MicroPause { .. } => {
                        return_event_count += 1
                    }
                    IdleEvent::SoftNudge { .. } => {}
                }
            }

            // No tick should ever produce more than 1 event
            assert!(
                events.len() <= 1,
                "tick {} produced {} events, expected at most 1",
                tick,
                events.len()
            );

            state = next;
        }

        // With alternating idle/active every tick, we expect:
        // - idle_threshold events on even ticks when transitioning active→idle
        // - return events (MicroPause or UserReturned) on odd ticks when idle→active
        // No duplicates: threshold count should equal return count (±1 for boundary)
        assert!(
            idle_threshold_count > 0,
            "should have detected at least one idle threshold"
        );
        assert!(
            return_event_count > 0,
            "should have detected at least one return event"
        );
        assert!(
            (idle_threshold_count as i64 - return_event_count as i64).abs() <= 1,
            "idle/return counts should be balanced: idle={}, returned={}",
            idle_threshold_count,
            return_event_count
        );
    }

    /// Idle detection with varying thresholds (5min, 15min, 30min, 60min):
    /// correct classification at each threshold.
    #[test]
    fn stress_varying_idle_thresholds() {
        let thresholds_secs: Vec<u64> = vec![300, 900, 1800, 3600]; // 5, 15, 30, 60 min
        let base_time = 1_700_000_000i64;

        for &threshold in &thresholds_secs {
            let cfg = IdleConfig {
                idle_threshold_secs: threshold,
                micro_break_threshold_secs: 480,
                nudge_interval_secs: 99999,
                poll_interval_secs: 30,
            };

            // --- Just below threshold: should NOT trigger ---
            let state = IdleState::default();
            let (next, events) = process_idle_tick(&cfg, &state, threshold - 1, base_time, "");
            assert!(
                !next.was_idle,
                "threshold={}s: idle_secs={} should NOT trigger idle",
                threshold,
                threshold - 1
            );
            assert!(
                events.is_empty(),
                "threshold={}s: no event expected below threshold",
                threshold
            );

            // --- Exactly at threshold: SHOULD trigger ---
            let state = IdleState::default();
            let (next, events) = process_idle_tick(&cfg, &state, threshold, base_time, "");
            assert!(
                next.was_idle,
                "threshold={}s: idle_secs={} SHOULD trigger idle",
                threshold,
                threshold
            );
            assert_eq!(
                events.len(),
                1,
                "threshold={}s: exactly one event expected at threshold",
                threshold
            );
            assert!(
                matches!(events[0], IdleEvent::IdleThresholdReached { .. }),
                "threshold={}s: event should be IdleThresholdReached",
                threshold
            );

            // --- Well above threshold: SHOULD trigger ---
            let state = IdleState::default();
            let (next, events) = process_idle_tick(&cfg, &state, threshold + 600, base_time, "");
            assert!(
                next.was_idle,
                "threshold={}s: idle_secs={} SHOULD trigger idle",
                threshold,
                threshold + 600
            );
            assert_eq!(events.len(), 1);

            // --- Already idle, still idle: no duplicate ---
            let idle_state = IdleState {
                was_idle: true,
                idle_start: Some(base_time - threshold as i64),
                continuous_active_secs: 0,
            };
            let (_next, events) =
                process_idle_tick(&cfg, &idle_state, threshold + 30, base_time + 30, "");
            assert!(
                events.is_empty(),
                "threshold={}s: no duplicate idle event when already idle",
                threshold
            );

            // --- Return from idle: correct event based on away duration ---
            // Away for 25 minutes (1500s) → should emit UserReturned
            let idle_state = IdleState {
                was_idle: true,
                idle_start: Some(base_time),
                continuous_active_secs: 0,
            };
            let return_time = base_time + 1500;
            let (_next, events) = process_idle_tick(&cfg, &idle_state, 5, return_time, "");
            assert_eq!(
                events.len(),
                1,
                "threshold={}s: should emit return event after 25min away",
                threshold
            );
            assert!(
                matches!(events[0], IdleEvent::UserReturned { .. }),
                "threshold={}s: should be UserReturned for 25min away",
                threshold
            );
        }
    }

    /// Soft nudge timing accuracy: fires within ±30 seconds of configured
    /// interval over a 3-hour simulated session.
    #[test]
    fn stress_soft_nudge_timing_accuracy() {
        let nudge_interval: u64 = 5400; // 90 min default
        let poll_interval: u64 = 30;
        let cfg = IdleConfig {
            idle_threshold_secs: 99999, // disable idle for this test
            micro_break_threshold_secs: 480,
            nudge_interval_secs: nudge_interval,
            poll_interval_secs: poll_interval,
        };

        let base_time = 1_700_000_000i64;
        let three_hours_secs: u64 = 3 * 3600; // 10800s
        let total_ticks = three_hours_secs / poll_interval; // 360 ticks

        let mut state = IdleState::default();
        let mut nudge_times: Vec<u64> = Vec::new(); // elapsed seconds when nudge fired

        for tick in 0..total_ticks {
            let elapsed = tick * poll_interval;
            let now = base_time + elapsed as i64;

            let (next, events) = process_idle_tick(&cfg, &state, 5, now, "Deep work");

            for ev in &events {
                if matches!(ev, IdleEvent::SoftNudge { .. }) {
                    nudge_times.push(elapsed + poll_interval); // nudge fires after this tick adds poll_interval
                }
            }

            state = next;
        }

        // Over 3 hours with 90-min nudge interval, expect exactly 2 nudges:
        // at ~90min (5400s) and ~180min (10800s)
        assert_eq!(
            nudge_times.len(),
            2,
            "expected 2 nudges in 3 hours, got {}: {:?}",
            nudge_times.len(),
            nudge_times
        );

        // Each nudge should fire within ±30 seconds of the expected time
        let expected_nudge_times: Vec<u64> = vec![nudge_interval, nudge_interval * 2];
        for (actual, expected) in nudge_times.iter().zip(expected_nudge_times.iter()) {
            let drift = (*actual as i64 - *expected as i64).unsigned_abs();
            assert!(
                drift <= 30,
                "nudge at {}s drifted {}s from expected {}s (tolerance ±30s)",
                actual,
                drift,
                expected
            );
        }
    }

    /// Concurrent heartbeat + idle detection: calling both pure functions
    /// in sequence doesn't corrupt state. Since actual threading is in
    /// spawn_heartbeat/spawn_idle_detection, we test that interleaved
    /// calls to process_idle_tick produce consistent state.
    #[test]
    fn stress_concurrent_heartbeat_and_idle_detection() {
        let cfg = IdleConfig {
            idle_threshold_secs: 900,
            micro_break_threshold_secs: 480,
            nudge_interval_secs: 5400,
            poll_interval_secs: 30,
        };
        let base_time = 1_700_000_000i64;

        let mut idle_state = IdleState::default();
        let mut heartbeat_timestamps: Vec<i64> = Vec::new();
        let mut all_events: Vec<IdleEvent> = Vec::new();

        // Simulate 30 minutes of interleaved heartbeat (10s) and idle (30s) ticks.
        // Heartbeat fires 3× per idle tick. We simulate 60 idle ticks = 30 min.
        let total_idle_ticks = 60u64;

        for tick in 0..total_idle_ticks {
            let tick_time = base_time + (tick * 30) as i64;

            // Simulate 3 heartbeat writes between each idle tick (every 10s)
            for hb in 0..3 {
                let hb_time = tick_time + (hb * 10) as i64;
                heartbeat_timestamps.push(hb_time);
            }

            // Idle detection tick — user is active throughout
            let (next, events) = process_idle_tick(&cfg, &idle_state, 5, tick_time, "Task X");
            all_events.extend(events);
            idle_state = next;
        }

        // Verify idle state is consistent after all ticks
        assert!(!idle_state.was_idle, "user should still be active");
        assert!(idle_state.idle_start.is_none(), "no idle_start when active");
        // continuous_active_secs should be 60 ticks × 30s = 1800s, but nudge resets at 5400s
        // which doesn't happen in 30 min, so it should be 60 * 30 = 1800
        assert_eq!(
            idle_state.continuous_active_secs, 1800,
            "should have accumulated 1800s of active time"
        );

        // Heartbeat timestamps should be monotonically non-decreasing
        for window in heartbeat_timestamps.windows(2) {
            assert!(
                window[1] >= window[0],
                "heartbeat timestamps should be monotonically non-decreasing"
            );
        }

        // Should have exactly 180 heartbeat timestamps (60 ticks × 3)
        assert_eq!(heartbeat_timestamps.len(), 180);

        // No idle events should have fired (user was active the whole time)
        // Only soft nudge is possible but 1800s < 5400s nudge interval
        assert!(
            all_events.is_empty(),
            "no events expected during 30min active session, got {}",
            all_events.len()
        );

        // Now simulate the user going idle mid-session and verify state isn't corrupted
        // by continued heartbeat simulation
        let idle_tick_time = base_time + 1800;
        let (idle_state_2, events) =
            process_idle_tick(&cfg, &idle_state, 900, idle_tick_time, "Task X");
        assert!(idle_state_2.was_idle, "should transition to idle");
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], IdleEvent::IdleThresholdReached { .. }));

        // Simulate more heartbeats while idle — state should remain idle
        for hb in 0..5 {
            let hb_time = idle_tick_time + (hb * 10) as i64;
            heartbeat_timestamps.push(hb_time);
        }

        // Next idle tick — still idle, no duplicate event
        let (idle_state_3, events) =
            process_idle_tick(&cfg, &idle_state_2, 930, idle_tick_time + 30, "Task X");
        assert!(idle_state_3.was_idle);
        assert!(events.is_empty(), "no duplicate idle event");

        // User returns — heartbeats continue, idle state resets
        let return_time = idle_tick_time + 1500;
        let (returned_state, events) =
            process_idle_tick(&cfg, &idle_state_3, 5, return_time, "Task X");
        assert!(!returned_state.was_idle, "should be active after return");
        assert_eq!(returned_state.continuous_active_secs, 0, "reset on return");
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], IdleEvent::UserReturned { .. }));
    }
}
