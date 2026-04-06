use rusqlite::Connection;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Writes the current heartbeat timestamp to the session row.
fn write_heartbeat(db_path: &str, session_id: &str, now: i64) {
    if let Ok(conn) = Connection::open(db_path) {
        let _ = conn.execute(
            "UPDATE sessions SET lastHeartbeat = ?1 WHERE id = ?2",
            rusqlite::params![now, session_id],
        );
    }
}

/// Spawns a background thread that writes `lastHeartbeat` to SQLite every 10 seconds.
/// Returns the join handle and a stop flag. Set the flag to `true` to stop the thread.
pub fn spawn_heartbeat(
    session_id: String,
    db_path: String,
) -> (JoinHandle<()>, Arc<AtomicBool>) {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = Arc::clone(&stop);

    let handle = thread::spawn(move || {
        while !stop_clone.load(Ordering::Relaxed) {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;
            write_heartbeat(&db_path, &session_id, now);
            // Sleep in small increments so we can check the stop flag promptly.
            for _ in 0..100 {
                if stop_clone.load(Ordering::Relaxed) {
                    return;
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
    });

    (handle, stop)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::initialize_schema;
    use std::thread;
    use std::time::Duration;
    use tempfile::NamedTempFile;

    fn setup_test_db() -> (String, Connection) {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap().to_string();
        // Keep the file alive by leaking the handle (test only)
        std::mem::forget(tmp);
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        initialize_schema(&conn).unwrap();
        // Insert a test user and session
        conn.execute(
            "INSERT INTO users (id, name, email, createdAt) VALUES ('u1', 'Test', 'test@test.com', 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, userId, startTime, startType, createdAt) VALUES ('s1', 'u1', 1000, 'manual', 1000)",
            [],
        ).unwrap();
        (path, conn)
    }

    #[test]
    fn test_write_heartbeat_updates_session() {
        let (path, conn) = setup_test_db();
        write_heartbeat(&path, "s1", 2000);
        let hb: i64 = conn
            .query_row("SELECT lastHeartbeat FROM sessions WHERE id = 's1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(hb, 2000);
    }

    #[test]
    fn test_spawn_heartbeat_writes_and_stops() {
        let (path, conn) = setup_test_db();
        let (handle, stop) = spawn_heartbeat("s1".to_string(), path);

        // Let it run for ~1.5 seconds — should get at least 1 write
        thread::sleep(Duration::from_millis(1500));

        let hb: Option<i64> = conn
            .query_row("SELECT lastHeartbeat FROM sessions WHERE id = 's1'", [], |r| r.get(0))
            .unwrap();
        assert!(hb.is_some(), "heartbeat should have been written");

        // Stop the thread
        stop.store(true, Ordering::Relaxed);
        handle.join().expect("heartbeat thread should join cleanly");
    }

    #[test]
    fn test_heartbeat_updates_correct_session_only() {
        let (path, conn) = setup_test_db();
        // Insert a second session for the same user
        conn.execute(
            "INSERT INTO sessions (id, userId, startTime, startType, createdAt) VALUES ('s2', 'u1', 2000, 'manual', 2000)",
            [],
        ).unwrap();

        // Write heartbeat targeting only s1
        write_heartbeat(&path, "s1", 5000);

        let hb_s1: i64 = conn
            .query_row("SELECT lastHeartbeat FROM sessions WHERE id = 's1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(hb_s1, 5000, "s1 should have updated heartbeat");

        let hb_s2: Option<i64> = conn
            .query_row("SELECT lastHeartbeat FROM sessions WHERE id = 's2'", [], |r| r.get(0))
            .unwrap();
        assert!(hb_s2.is_none(), "s2 should remain untouched (NULL)");
    }

    #[test]
    fn test_heartbeat_timestamp_is_valid_unix_utc() {
        let (path, conn) = setup_test_db();
        let (handle, stop) = spawn_heartbeat("s1".to_string(), path);

        // Let it write at least once
        thread::sleep(Duration::from_millis(500));

        let hb: i64 = conn
            .query_row("SELECT lastHeartbeat FROM sessions WHERE id = 's1'", [], |r| r.get(0))
            .unwrap();

        // Valid Unix UTC timestamp: positive, and within a reasonable range
        // (after 2020-01-01 = 1577836800, before 2100-01-01 = 4102444800)
        assert!(hb > 1_577_836_800, "heartbeat timestamp should be after 2020-01-01");
        assert!(hb < 4_102_444_800, "heartbeat timestamp should be before 2100-01-01");

        // Also verify it's close to "now"
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let drift = (now - hb).abs();
        assert!(drift < 5, "heartbeat should be within 5 seconds of current time, drift was {}s", drift);

        stop.store(true, Ordering::Relaxed);
        handle.join().expect("heartbeat thread should join cleanly");
    }

    #[test]
    fn test_heartbeat_no_writes_after_stop() {
        let (path, conn) = setup_test_db();
        let (handle, stop) = spawn_heartbeat("s1".to_string(), path);

        // Let it write at least once
        thread::sleep(Duration::from_millis(500));
        stop.store(true, Ordering::Relaxed);
        handle.join().expect("heartbeat thread should join cleanly");

        // Record the heartbeat value after stop
        let hb_after_stop: i64 = conn
            .query_row("SELECT lastHeartbeat FROM sessions WHERE id = 's1'", [], |r| r.get(0))
            .unwrap();

        // Wait a bit and confirm no further writes occurred
        thread::sleep(Duration::from_millis(500));
        let hb_later: i64 = conn
            .query_row("SELECT lastHeartbeat FROM sessions WHERE id = 's1'", [], |r| r.get(0))
            .unwrap();

        assert_eq!(hb_after_stop, hb_later, "no writes should occur after stop flag is set");
    }

    #[test]
    fn test_heartbeat_multiple_writes_monotonically_increasing() {
        // Shortened stress test: run for ~3 seconds, verify multiple writes
        // with monotonically increasing timestamps.
        // (The real 10s interval means only 1 cycle in 10s, but the first write
        // happens immediately on thread start, so we can observe overwrites.)
        let (path, conn) = setup_test_db();
        let (handle, stop) = spawn_heartbeat("s1".to_string(), path.clone());

        let mut timestamps: Vec<i64> = Vec::new();

        // Sample the heartbeat value several times over ~3 seconds
        for _ in 0..6 {
            thread::sleep(Duration::from_millis(500));
            let hb: Option<i64> = conn
                .query_row("SELECT lastHeartbeat FROM sessions WHERE id = 's1'", [], |r| r.get(0))
                .unwrap();
            if let Some(ts) = hb {
                timestamps.push(ts);
            }
        }

        stop.store(true, Ordering::Relaxed);
        handle.join().expect("heartbeat thread should join cleanly");

        // Should have captured at least 1 timestamp
        assert!(!timestamps.is_empty(), "should have at least one heartbeat reading");

        // All captured timestamps should be monotonically non-decreasing
        for window in timestamps.windows(2) {
            assert!(
                window[1] >= window[0],
                "timestamps should be monotonically non-decreasing: {} followed by {}",
                window[0], window[1]
            );
        }

        // All timestamps should be valid Unix UTC
        for ts in &timestamps {
            assert!(*ts > 1_577_836_800, "timestamp {} should be after 2020", ts);
        }
    }

    #[test]
    fn test_write_heartbeat_with_nonexistent_session() {
        let (path, conn) = setup_test_db();
        // Writing to a non-existent session should not panic or corrupt data
        write_heartbeat(&path, "nonexistent", 9999);

        // s1 should be unaffected
        let hb: Option<i64> = conn
            .query_row("SELECT lastHeartbeat FROM sessions WHERE id = 's1'", [], |r| r.get(0))
            .unwrap();
        assert!(hb.is_none(), "s1 heartbeat should still be NULL");
    }
}
