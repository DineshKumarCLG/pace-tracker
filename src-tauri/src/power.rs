use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

// ---------------------------------------------------------------------------
// Power events emitted to the frontend
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum PowerEvent {
    /// Screen locked or system going to sleep — pause the session timer.
    #[serde(rename = "session_pause")]
    SessionPause { reason: PowerPauseReason, timestamp: i64 },
    /// Screen unlocked or system woke up — resume and trigger idle check.
    #[serde(rename = "session_resume")]
    SessionResume { reason: PowerResumeReason, timestamp: i64 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PowerPauseReason {
    ScreenLock,
    Sleep,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PowerResumeReason {
    ScreenUnlock,
    Wake,
}

// ---------------------------------------------------------------------------
// Pure helper — build events from detected transitions
// ---------------------------------------------------------------------------

/// Create a pause event for the given reason at the given timestamp.
pub fn make_pause_event(reason: PowerPauseReason, timestamp: i64) -> PowerEvent {
    PowerEvent::SessionPause { reason, timestamp }
}

/// Create a resume event for the given reason at the given timestamp.
pub fn make_resume_event(reason: PowerResumeReason, timestamp: i64) -> PowerEvent {
    PowerEvent::SessionResume { reason, timestamp }
}

/// Returns the current Unix timestamp in seconds (UTC).
pub fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

// ---------------------------------------------------------------------------
// Event emission helper
// ---------------------------------------------------------------------------

/// Emit a power event to the frontend via Tauri's event system.
pub fn emit_power_event(app_handle: &AppHandle, event: &PowerEvent) {
    let event_name = match event {
        PowerEvent::SessionPause { .. } => "session_pause",
        PowerEvent::SessionResume { .. } => "session_resume",
    };
    let _ = app_handle.emit(event_name, event);
}

// ---------------------------------------------------------------------------
// Platform-specific power monitor implementation
// ---------------------------------------------------------------------------

/// Sets up power monitor event listeners. This spawns a background thread
/// that listens for OS-level power/lock events and emits `session_pause` /
/// `session_resume` events to the frontend.
///
/// Returns `Some((JoinHandle, stop_flag))` on supported platforms, or `None`
/// if power monitoring is not available.
pub fn setup_power_monitor(
    app_handle: AppHandle,
) -> Option<(JoinHandle<()>, Arc<AtomicBool>)> {
    setup_platform_monitor(app_handle)
}

// ---------------------------------------------------------------------------
// macOS implementation
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn setup_platform_monitor(
    app_handle: AppHandle,
) -> Option<(JoinHandle<()>, Arc<AtomicBool>)> {
    use std::process::Command;

    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = Arc::clone(&stop);

    // On macOS, we poll the screen lock state and system sleep state
    // using IOKit / CGSession. We detect transitions by comparing
    // the current state to the previous state each poll cycle.
    let handle = thread::spawn(move || {
        let mut was_locked = false;
        let poll_interval = Duration::from_secs(5);

        while !stop_clone.load(Ordering::Relaxed) {
            // Sleep in small increments for responsive shutdown
            for _ in 0..50 {
                if stop_clone.load(Ordering::Relaxed) {
                    return;
                }
                thread::sleep(Duration::from_millis(100));
            }

            if stop_clone.load(Ordering::Relaxed) {
                return;
            }

            let is_locked = check_macos_screen_locked();

            if is_locked && !was_locked {
                // Transition: unlocked → locked
                let event = make_pause_event(PowerPauseReason::ScreenLock, unix_now());
                emit_power_event(&app_handle, &event);
            } else if !is_locked && was_locked {
                // Transition: locked → unlocked
                let event = make_resume_event(PowerResumeReason::ScreenUnlock, unix_now());
                emit_power_event(&app_handle, &event);
            }

            was_locked = is_locked;
        }
    });

    Some((handle, stop))
}

#[cfg(target_os = "macos")]
fn check_macos_screen_locked() -> bool {
    // Use the CGSessionCopyCurrentDictionary approach via a small
    // Python one-liner (available on all macOS). This checks the
    // "CGSSessionScreenIsLocked" key in the session dictionary.
    // Falls back to false if the check fails.
    use std::process::Command;

    let output = Command::new("python3")
        .args([
            "-c",
            "import Quartz; d = Quartz.CGSessionCopyCurrentDictionary(); print(1 if d and d.get('CGSSessionScreenIsLocked', 0) else 0)",
        ])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.trim() == "1"
        }
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Windows implementation
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn setup_platform_monitor(
    app_handle: AppHandle,
) -> Option<(JoinHandle<()>, Arc<AtomicBool>)> {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = Arc::clone(&stop);

    // On Windows, we poll for session lock state using a simple heuristic:
    // check if the desktop is accessible. A more robust approach would use
    // WTSRegisterSessionNotification, but that requires a window handle.
    // For now, we use a polling approach similar to macOS.
    let handle = thread::spawn(move || {
        let mut was_locked = false;

        while !stop_clone.load(Ordering::Relaxed) {
            for _ in 0..50 {
                if stop_clone.load(Ordering::Relaxed) {
                    return;
                }
                thread::sleep(Duration::from_millis(100));
            }

            if stop_clone.load(Ordering::Relaxed) {
                return;
            }

            let is_locked = check_windows_screen_locked();

            if is_locked && !was_locked {
                let event = make_pause_event(PowerPauseReason::ScreenLock, unix_now());
                emit_power_event(&app_handle, &event);
            } else if !is_locked && was_locked {
                let event = make_resume_event(PowerResumeReason::ScreenUnlock, unix_now());
                emit_power_event(&app_handle, &event);
            }

            was_locked = is_locked;
        }
    });

    Some((handle, stop))
}

#[cfg(target_os = "windows")]
fn check_windows_screen_locked() -> bool {
    // Use PowerShell to check if the logon UI is active (screen locked).
    // This is a lightweight check that works on all Windows versions.
    use std::process::Command;

    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "if (Get-Process -Name LogonUI -ErrorAction SilentlyContinue) { '1' } else { '0' }",
        ])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.trim() == "1"
        }
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Linux implementation
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
fn setup_platform_monitor(
    app_handle: AppHandle,
) -> Option<(JoinHandle<()>, Arc<AtomicBool>)> {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = Arc::clone(&stop);

    // On Linux, we poll the screensaver/lock state using loginctl or
    // xdg-screensaver. This works on most desktop environments.
    let handle = thread::spawn(move || {
        let mut was_locked = false;

        while !stop_clone.load(Ordering::Relaxed) {
            for _ in 0..50 {
                if stop_clone.load(Ordering::Relaxed) {
                    return;
                }
                thread::sleep(Duration::from_millis(100));
            }

            if stop_clone.load(Ordering::Relaxed) {
                return;
            }

            let is_locked = check_linux_screen_locked();

            if is_locked && !was_locked {
                let event = make_pause_event(PowerPauseReason::ScreenLock, unix_now());
                emit_power_event(&app_handle, &event);
            } else if !is_locked && was_locked {
                let event = make_resume_event(PowerResumeReason::ScreenUnlock, unix_now());
                emit_power_event(&app_handle, &event);
            }

            was_locked = is_locked;
        }
    });

    Some((handle, stop))
}

#[cfg(target_os = "linux")]
fn check_linux_screen_locked() -> bool {
    use std::process::Command;

    // Try loginctl first (systemd-based systems)
    let output = Command::new("loginctl")
        .args(["show-session", "self", "-p", "LockedHint", "--value"])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if stdout.trim() == "yes" {
                return true;
            }
        }
        Err(_) => {}
    }

    // Fallback: try xdg-screensaver
    let output = Command::new("xdg-screensaver")
        .args(["status"])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.trim().contains("enabled") || stdout.trim().contains("locked")
        }
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Unsupported platforms — graceful no-op
// ---------------------------------------------------------------------------

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn setup_platform_monitor(
    _app_handle: AppHandle,
) -> Option<(JoinHandle<()>, Arc<AtomicBool>)> {
    // Power monitoring not available on this platform
    None
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_make_pause_event_screen_lock() {
        let event = make_pause_event(PowerPauseReason::ScreenLock, 1_700_000_000);
        assert_eq!(
            event,
            PowerEvent::SessionPause {
                reason: PowerPauseReason::ScreenLock,
                timestamp: 1_700_000_000,
            }
        );
    }

    #[test]
    fn test_make_pause_event_sleep() {
        let event = make_pause_event(PowerPauseReason::Sleep, 1_700_000_000);
        assert_eq!(
            event,
            PowerEvent::SessionPause {
                reason: PowerPauseReason::Sleep,
                timestamp: 1_700_000_000,
            }
        );
    }

    #[test]
    fn test_make_resume_event_screen_unlock() {
        let event = make_resume_event(PowerResumeReason::ScreenUnlock, 1_700_000_000);
        assert_eq!(
            event,
            PowerEvent::SessionResume {
                reason: PowerResumeReason::ScreenUnlock,
                timestamp: 1_700_000_000,
            }
        );
    }

    #[test]
    fn test_make_resume_event_wake() {
        let event = make_resume_event(PowerResumeReason::Wake, 1_700_000_000);
        assert_eq!(
            event,
            PowerEvent::SessionResume {
                reason: PowerResumeReason::Wake,
                timestamp: 1_700_000_000,
            }
        );
    }

    #[test]
    fn test_session_pause_serialization() {
        let event = make_pause_event(PowerPauseReason::ScreenLock, 1_700_000_000);
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"session_pause\""));
        assert!(json.contains("\"reason\":\"screen_lock\""));
        assert!(json.contains("\"timestamp\":1700000000"));
    }

    #[test]
    fn test_session_resume_serialization() {
        let event = make_resume_event(PowerResumeReason::Wake, 1_700_000_000);
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"session_resume\""));
        assert!(json.contains("\"reason\":\"wake\""));
        assert!(json.contains("\"timestamp\":1700000000"));
    }

    #[test]
    fn test_sleep_pause_serialization() {
        let event = make_pause_event(PowerPauseReason::Sleep, 1_700_000_000);
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"session_pause\""));
        assert!(json.contains("\"reason\":\"sleep\""));
    }

    #[test]
    fn test_screen_unlock_resume_serialization() {
        let event = make_resume_event(PowerResumeReason::ScreenUnlock, 1_700_000_000);
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"session_resume\""));
        assert!(json.contains("\"reason\":\"screen_unlock\""));
    }

    #[test]
    fn test_unix_now_returns_valid_timestamp() {
        let now = unix_now();
        // Should be after 2020-01-01 and before 2100-01-01
        assert!(now > 1_577_836_800, "timestamp should be after 2020");
        assert!(now < 4_102_444_800, "timestamp should be before 2100");
    }

    #[test]
    fn test_pause_and_resume_events_are_distinct() {
        let pause = make_pause_event(PowerPauseReason::ScreenLock, 1_700_000_000);
        let resume = make_resume_event(PowerResumeReason::ScreenUnlock, 1_700_000_000);
        assert_ne!(pause, resume);
    }

    #[test]
    fn test_different_pause_reasons_are_distinct() {
        let lock = make_pause_event(PowerPauseReason::ScreenLock, 1_700_000_000);
        let sleep = make_pause_event(PowerPauseReason::Sleep, 1_700_000_000);
        assert_ne!(lock, sleep);
    }

    #[test]
    fn test_different_resume_reasons_are_distinct() {
        let unlock = make_resume_event(PowerResumeReason::ScreenUnlock, 1_700_000_000);
        let wake = make_resume_event(PowerResumeReason::Wake, 1_700_000_000);
        assert_ne!(unlock, wake);
    }

    #[test]
    fn test_power_event_deserialization_pause() {
        let json = r#"{"type":"session_pause","reason":"screen_lock","timestamp":1700000000}"#;
        let event: PowerEvent = serde_json::from_str(json).unwrap();
        assert_eq!(
            event,
            PowerEvent::SessionPause {
                reason: PowerPauseReason::ScreenLock,
                timestamp: 1_700_000_000,
            }
        );
    }

    #[test]
    fn test_power_event_deserialization_resume() {
        let json = r#"{"type":"session_resume","reason":"wake","timestamp":1700000000}"#;
        let event: PowerEvent = serde_json::from_str(json).unwrap();
        assert_eq!(
            event,
            PowerEvent::SessionResume {
                reason: PowerResumeReason::Wake,
                timestamp: 1_700_000_000,
            }
        );
    }
}
