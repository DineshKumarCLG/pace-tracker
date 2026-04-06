use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// GitCommit — parsed from `git log` output
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub timestamp: String, // raw ISO-ish string from git, e.g. "2026-04-01 14:30:00 +0000"
}

// ---------------------------------------------------------------------------
// GitEventRecord — stored in SQLite, returned to frontend
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitEventRecord {
    pub id: String,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "repoPath")]
    pub repo_path: String,
    #[serde(rename = "commitHash")]
    pub commit_hash: String,
    pub message: Option<String>,
    #[serde(rename = "commitTime")]
    pub commit_time: i64,
}

// ---------------------------------------------------------------------------
// Pure parsing function (no I/O — fully testable)
// ---------------------------------------------------------------------------

/// Parse the output of `git log --format="%H %s %ai"` into GitCommit structs.
///
/// Each line has the format:
///   <40-char hash> <subject> <author-date-iso>
///
/// The author date is the last 25 characters (e.g. "2026-04-01 14:30:00 +0000").
/// Everything between the hash and the date is the commit message (subject).
///
/// Malformed lines (too short, missing fields) are silently skipped.
pub fn parse_git_log_output(output: &str) -> Vec<GitCommit> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            // Minimum: 40 (hash) + 1 (space) + 1 (msg char) + 1 (space) + 25 (date) = 68
            if line.len() < 68 {
                return None;
            }

            let hash = &line[..40];
            // Validate hash is hex
            if !hash.chars().all(|c| c.is_ascii_hexdigit()) {
                return None;
            }

            // The date is the last 25 chars: "YYYY-MM-DD HH:MM:SS +ZZZZ"
            let date_part = &line[line.len() - 25..];
            // Basic validation: check for date-like pattern
            if date_part.len() != 25
                || !date_part.chars().nth(4).map_or(false, |c| c == '-')
                || !date_part.chars().nth(10).map_or(false, |c| c == ' ')
            {
                return None;
            }

            // Message is between hash+space and space+date
            let message = line[41..line.len() - 26].trim().to_string();
            if message.is_empty() {
                return None;
            }

            Some(GitCommit {
                hash: hash.to_string(),
                message,
                timestamp: date_part.to_string(),
            })
        })
        .collect()
}

/// Parse an ISO-ish date string from git into a Unix timestamp.
/// Expected format: "YYYY-MM-DD HH:MM:SS +ZZZZ" or "YYYY-MM-DD HH:MM:SS -ZZZZ"
pub fn parse_git_timestamp(ts: &str) -> Option<i64> {
    // "2026-04-01 14:30:00 +0000"
    let ts = ts.trim();
    if ts.len() < 25 {
        return None;
    }

    let year: i64 = ts[0..4].parse().ok()?;
    let month: i64 = ts[5..7].parse().ok()?;
    let day: i64 = ts[8..10].parse().ok()?;
    let hour: i64 = ts[11..13].parse().ok()?;
    let min: i64 = ts[14..16].parse().ok()?;
    let sec: i64 = ts[17..19].parse().ok()?;

    let tz_sign = if ts.as_bytes()[20] == b'-' { -1i64 } else { 1i64 };
    let tz_hours: i64 = ts[21..23].parse().ok()?;
    let tz_mins: i64 = ts[23..25].parse().ok()?;
    let tz_offset_secs = tz_sign * (tz_hours * 3600 + tz_mins * 60);

    // Days from epoch using a simplified calculation
    let unix = days_since_epoch(year, month, day) * 86400 + hour * 3600 + min * 60 + sec - tz_offset_secs;
    Some(unix)
}

/// Calculate days since Unix epoch (1970-01-01) for a given date.
fn days_since_epoch(year: i64, month: i64, day: i64) -> i64 {
    // Adjust for months Jan/Feb being in the "previous year" for leap year calc
    let (y, m) = if month <= 2 {
        (year - 1, month + 9)
    } else {
        (year, month - 3)
    };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

// ---------------------------------------------------------------------------
// Storage function (writes parsed commits to SQLite)
// ---------------------------------------------------------------------------

/// Store parsed git commits as git_event records linked to a session.
/// Returns the stored GitEventRecord entries.
pub fn store_git_events(
    conn: &Connection,
    session_id: &str,
    user_id: &str,
    repo_path: &str,
    commits: &[GitCommit],
) -> Result<Vec<GitEventRecord>, String> {
    let mut records = Vec::with_capacity(commits.len());

    for commit in commits {
        let commit_time = parse_git_timestamp(&commit.timestamp).unwrap_or(0);
        let id = Uuid::new_v4().to_string();

        conn.execute(
            "INSERT INTO git_events (id, sessionId, userId, repoPath, commitHash, message, commitTime)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, session_id, user_id, repo_path, commit.hash, commit.message, commit_time],
        )
        .map_err(|e| format!("Failed to insert git_event: {e}"))?;

        records.push(GitEventRecord {
            id,
            session_id: Some(session_id.to_string()),
            user_id: user_id.to_string(),
            repo_path: repo_path.to_string(),
            commit_hash: commit.hash.clone(),
            message: Some(commit.message.clone()),
            commit_time,
        });
    }

    Ok(records)
}


/// Collect git events for a session across all configured repo paths.
/// Parses git log output for each repo and stores results in SQLite.
///
/// The actual shell execution is handled by the caller (Tauri command).
/// This function takes pre-collected git log outputs keyed by repo path.
pub fn collect_git_events_inner(
    conn: &Connection,
    session_id: &str,
    user_id: &str,
    repo_outputs: &[(String, String)], // Vec of (repo_path, git_log_output)
) -> Result<Vec<GitEventRecord>, String> {
    let mut all_records = Vec::new();

    for (repo_path, output) in repo_outputs {
        let commits = parse_git_log_output(output);
        let records = store_git_events(conn, session_id, user_id, repo_path, &commits)?;
        all_records.extend(records);
    }

    Ok(all_records)
}

/// Query git events for a given session from SQLite.
pub fn get_git_events_for_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<GitEventRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, sessionId, userId, repoPath, commitHash, message, commitTime
             FROM git_events WHERE sessionId = ?1
             ORDER BY commitTime ASC",
        )
        .map_err(|e| format!("DB error: {e}"))?;

    let events = stmt
        .query_map(params![session_id], |row| {
            Ok(GitEventRecord {
                id: row.get(0)?,
                session_id: row.get(1)?,
                user_id: row.get(2)?,
                repo_path: row.get(3)?,
                commit_hash: row.get(4)?,
                message: row.get(5)?,
                commit_time: row.get(6)?,
            })
        })
        .map_err(|e| format!("DB error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(events)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::initialize_schema;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        initialize_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO users (id, name, email, createdAt) VALUES ('u1', 'Test', 'test@test.com', 1000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions (id, userId, startTime, startType, startVerified, createdAt) \
             VALUES ('s1', 'u1', 1000, 'manual', 1, 1000)",
            [],
        )
        .unwrap();
        conn
    }

    // -----------------------------------------------------------------------
    // parse_git_log_output tests (Task 22.1)
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_single_commit() {
        let output = "abc1234def5678901234567890abcdef12345678 Fix bug 2026-04-01 14:30:00 +0000\n";
        let commits = parse_git_log_output(output);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].hash, "abc1234def5678901234567890abcdef12345678");
        assert_eq!(commits[0].message, "Fix bug");
        assert_eq!(commits[0].timestamp, "2026-04-01 14:30:00 +0000");
    }

    #[test]
    fn test_parse_multiple_commits() {
        let output = "\
abc1234def5678901234567890abcdef12345678 First commit message 2026-04-01 10:00:00 +0000
bcd2345ef6789012345678901abcdef123456789 Second commit 2026-04-01 11:00:00 +0000
cde3456f07890123456789012abcdef12345678a Third one here 2026-04-01 12:00:00 +0000
def45670189012345678901234abcdef1234567ab Fourth commit msg 2026-04-01 13:00:00 +0000
ef0567012890123456789012345abcdef123456bc Fifth and final 2026-04-01 14:00:00 +0000
";
        let commits = parse_git_log_output(output);
        assert_eq!(commits.len(), 5);
        assert_eq!(commits[0].message, "First commit message");
        assert_eq!(commits[4].message, "Fifth and final");
    }

    #[test]
    fn test_parse_empty_output() {
        let commits = parse_git_log_output("");
        assert!(commits.is_empty());

        let commits = parse_git_log_output("\n\n");
        assert!(commits.is_empty());
    }

    #[test]
    fn test_parse_malformed_output() {
        // Too short
        let commits = parse_git_log_output("short line");
        assert!(commits.is_empty());

        // Non-hex hash
        let commits = parse_git_log_output(
            "ZZZZ234def5678901234567890abcdef12345678 Fix bug 2026-04-01 14:30:00 +0000\n",
        );
        assert!(commits.is_empty());

        // Missing date
        let commits = parse_git_log_output(
            "abc1234def5678901234567890abcdef12345678 Fix bug no-date-here\n",
        );
        assert!(commits.is_empty());
    }

    #[test]
    fn test_parse_commit_with_long_message() {
        let output = "abc1234def5678901234567890abcdef12345678 This is a very long commit message with lots of detail 2026-04-01 14:30:00 +0000\n";
        let commits = parse_git_log_output(output);
        assert_eq!(commits.len(), 1);
        assert_eq!(
            commits[0].message,
            "This is a very long commit message with lots of detail"
        );
    }

    #[test]
    fn test_parse_commit_with_negative_timezone() {
        let output = "abc1234def5678901234567890abcdef12345678 Fix timezone 2026-04-01 14:30:00 -0500\n";
        let commits = parse_git_log_output(output);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].timestamp, "2026-04-01 14:30:00 -0500");
    }

    // -----------------------------------------------------------------------
    // parse_git_timestamp tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_git_timestamp_utc() {
        let ts = parse_git_timestamp("2026-04-01 14:30:00 +0000");
        assert!(ts.is_some());
        // 2026-04-01 14:30:00 UTC
        // Manually: days from epoch to 2026-04-01 = 20544
        // 20544 * 86400 + 14*3600 + 30*60 = 1775052600 + 52200 = ...
        let unix = ts.unwrap();
        assert!(unix > 1_700_000_000); // sanity check: after 2023
        assert!(unix < 1_900_000_000); // sanity check: before 2030
    }

    #[test]
    fn test_parse_git_timestamp_with_offset() {
        let utc = parse_git_timestamp("2026-04-01 14:30:00 +0000").unwrap();
        let est = parse_git_timestamp("2026-04-01 09:30:00 -0500").unwrap();
        // Both should represent the same instant
        assert_eq!(utc, est);
    }

    #[test]
    fn test_parse_git_timestamp_invalid() {
        assert!(parse_git_timestamp("not a date").is_none());
        assert!(parse_git_timestamp("").is_none());
    }

    // -----------------------------------------------------------------------
    // store_git_events tests (Task 22.2)
    // -----------------------------------------------------------------------

    #[test]
    fn test_store_git_events_correct_fields() {
        let conn = setup_test_db();
        let commits = vec![GitCommit {
            hash: "abc1234def5678901234567890abcdef12345678".to_string(),
            message: "Fix bug".to_string(),
            timestamp: "2026-04-01 14:30:00 +0000".to_string(),
        }];

        let records = store_git_events(&conn, "s1", "u1", "/path/to/repo", &commits).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].session_id, Some("s1".to_string()));
        assert_eq!(records[0].user_id, "u1");
        assert_eq!(records[0].repo_path, "/path/to/repo");
        assert_eq!(records[0].commit_hash, "abc1234def5678901234567890abcdef12345678");
        assert_eq!(records[0].message, Some("Fix bug".to_string()));
        assert!(records[0].commit_time > 0);

        // Verify in DB
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM git_events WHERE sessionId = 's1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_store_multiple_git_events() {
        let conn = setup_test_db();
        let commits = vec![
            GitCommit {
                hash: "abc1234def5678901234567890abcdef12345678".to_string(),
                message: "First".to_string(),
                timestamp: "2026-04-01 10:00:00 +0000".to_string(),
            },
            GitCommit {
                hash: "bcd2345ef6789012345678901abcdef123456789".to_string(),
                message: "Second".to_string(),
                timestamp: "2026-04-01 11:00:00 +0000".to_string(),
            },
        ];

        let records = store_git_events(&conn, "s1", "u1", "/repo", &commits).unwrap();
        assert_eq!(records.len(), 2);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM git_events WHERE sessionId = 's1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_store_empty_commits() {
        let conn = setup_test_db();
        let records = store_git_events(&conn, "s1", "u1", "/repo", &[]).unwrap();
        assert!(records.is_empty());
    }

    // -----------------------------------------------------------------------
    // collect_git_events_inner tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_collect_git_events_multiple_repos() {
        let conn = setup_test_db();
        let repo_outputs = vec![
            (
                "/repo/a".to_string(),
                "abc1234def5678901234567890abcdef12345678 Commit A 2026-04-01 10:00:00 +0000\n".to_string(),
            ),
            (
                "/repo/b".to_string(),
                "bcd2345ef6789012345678901abcdef123456789 Commit B 2026-04-01 11:00:00 +0000\n".to_string(),
            ),
        ];

        let records = collect_git_events_inner(&conn, "s1", "u1", &repo_outputs).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].repo_path, "/repo/a");
        assert_eq!(records[1].repo_path, "/repo/b");
    }

    // -----------------------------------------------------------------------
    // get_git_events_for_session tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_git_events_for_session() {
        let conn = setup_test_db();
        let commits = vec![
            GitCommit {
                hash: "abc1234def5678901234567890abcdef12345678".to_string(),
                message: "First".to_string(),
                timestamp: "2026-04-01 10:00:00 +0000".to_string(),
            },
            GitCommit {
                hash: "bcd2345ef6789012345678901abcdef123456789".to_string(),
                message: "Second".to_string(),
                timestamp: "2026-04-01 11:00:00 +0000".to_string(),
            },
        ];
        store_git_events(&conn, "s1", "u1", "/repo", &commits).unwrap();

        let events = get_git_events_for_session(&conn, "s1").unwrap();
        assert_eq!(events.len(), 2);
        // Ordered by commitTime ASC
        assert_eq!(events[0].message, Some("First".to_string()));
        assert_eq!(events[1].message, Some("Second".to_string()));
    }

    #[test]
    fn test_get_git_events_empty_session() {
        let conn = setup_test_db();
        let events = get_git_events_for_session(&conn, "s1").unwrap();
        assert!(events.is_empty());
    }
}
