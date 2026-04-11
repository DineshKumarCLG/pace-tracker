use rusqlite::{Connection, Result as SqliteResult};
use std::fs;
use std::path::PathBuf;

/// Returns the path to the PACE SQLite database file in the user's app data directory.
pub fn get_db_path() -> PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.kenesis.pace");
    fs::create_dir_all(&data_dir).expect("Failed to create PACE data directory");
    data_dir.join("pace.db")
}

/// Opens a connection to the PACE database and enables foreign keys.
pub fn open_connection() -> SqliteResult<Connection> {
    let db_path = get_db_path();
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

/// Initializes the database schema — creates all tables and indexes if they don't exist.
pub fn initialize_schema(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(SCHEMA_SQL)?;
    Ok(())
}

const SCHEMA_SQL: &str = r#"
-- Users
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT,
    email TEXT UNIQUE,
    avatarColor TEXT DEFAULT '#6e6af6',
    createdAt INTEGER NOT NULL
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    createdBy TEXT NOT NULL REFERENCES users(id),
    createdAt INTEGER NOT NULL,
    archivedAt INTEGER
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open', 'inprogress', 'done', 'blocked')),
    assigneeId TEXT REFERENCES users(id),
    priority TEXT NOT NULL CHECK(priority IN ('high', 'medium', 'low')),
    dueDate INTEGER,
    estimatedMinutes INTEGER,
    notes TEXT,
    createdBy TEXT NOT NULL REFERENCES users(id),
    createdAt INTEGER NOT NULL,
    closedAt INTEGER
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id),
    startTime INTEGER NOT NULL,
    endTime INTEGER,
    startType TEXT NOT NULL CHECK(startType IN ('manual', 'backfill', 'recovered')),
    startVerified INTEGER NOT NULL DEFAULT 1,
    outputNote TEXT,
    lastHeartbeat INTEGER,
    syncedAt INTEGER,
    createdAt INTEGER NOT NULL
);

-- Session Tasks
CREATE TABLE IF NOT EXISTS session_tasks (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL REFERENCES sessions(id),
    taskId TEXT NOT NULL REFERENCES tasks(id),
    startTime INTEGER NOT NULL,
    endTime INTEGER,
    minutes INTEGER GENERATED ALWAYS AS (
        CASE WHEN endTime IS NOT NULL THEN (endTime - startTime) / 60 ELSE NULL END
    ) STORED
);

-- Breaks
CREATE TABLE IF NOT EXISTS breaks (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL REFERENCES sessions(id),
    startTime INTEGER NOT NULL,
    endTime INTEGER,
    type TEXT NOT NULL CHECK(type IN ('lunch', 'short', 'meeting', 'discarded')),
    autoDetected INTEGER NOT NULL DEFAULT 0
);

-- Idle Events
CREATE TABLE IF NOT EXISTS idle_events (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL REFERENCES sessions(id),
    startTime INTEGER NOT NULL,
    endTime INTEGER,
    resolution TEXT NOT NULL CHECK(resolution IN ('lunch', 'short', 'meeting', 'discarded', 'pending'))
);

-- Git Events
CREATE TABLE IF NOT EXISTS git_events (
    id TEXT PRIMARY KEY,
    sessionId TEXT REFERENCES sessions(id),
    userId TEXT NOT NULL REFERENCES users(id),
    repoPath TEXT NOT NULL,
    commitHash TEXT NOT NULL,
    message TEXT,
    commitTime INTEGER NOT NULL
);

-- Weekly Reviews
CREATE TABLE IF NOT EXISTS weekly_reviews (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id),
    weekStart INTEGER NOT NULL,
    weekEnd INTEGER NOT NULL,
    aiNarrative TEXT,
    nextPriority TEXT,
    savedAt INTEGER,
    createdAt INTEGER NOT NULL
);

-- Settings (one row per user)
CREATE TABLE IF NOT EXISTS settings (
    userId TEXT PRIMARY KEY REFERENCES users(id),
    theme TEXT NOT NULL CHECK(theme IN ('light', 'dark', 'system')) DEFAULT 'system',
    idleThresholdMin INTEGER NOT NULL DEFAULT 15,
    nudgeIntervalMin INTEGER NOT NULL DEFAULT 90,
    breakCapMin INTEGER NOT NULL DEFAULT 90,
    weeklyReviewDay INTEGER NOT NULL DEFAULT 5,
    weeklyReviewHour INTEGER NOT NULL DEFAULT 17,
    autoPauseOnLock INTEGER NOT NULL DEFAULT 1,
    autoPauseOnSleep INTEGER NOT NULL DEFAULT 1,
    litellmUrl TEXT,
    litellmModel TEXT NOT NULL DEFAULT 'gemini/gemini-2.0-flash',
    litellmApiKey TEXT,
    aiEnabled INTEGER NOT NULL DEFAULT 1,
    gitRepoPaths TEXT NOT NULL DEFAULT '[]'
);

-- Sync Queue
CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    collection TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('create', 'update', 'delete')),
    recordId TEXT NOT NULL,
    data TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    retryCount INTEGER NOT NULL DEFAULT 0
);

-- Sync Dead Letter
CREATE TABLE IF NOT EXISTS sync_dead_letter (
    id TEXT PRIMARY KEY,
    collection TEXT NOT NULL,
    operation TEXT,
    recordId TEXT NOT NULL,
    data TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    retryCount INTEGER,
    failedAt INTEGER NOT NULL,
    error TEXT
);

-- Teams
CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    inviteCode TEXT NOT NULL UNIQUE,
    createdBy TEXT NOT NULL REFERENCES users(id),
    createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teams_invite_code ON teams(inviteCode);

-- Team Members
CREATE TABLE IF NOT EXISTS team_members (
    teamId TEXT NOT NULL REFERENCES teams(id),
    userId TEXT NOT NULL REFERENCES users(id),
    joinedAt INTEGER NOT NULL,
    PRIMARY KEY (teamId, userId)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(userId);

-- Leave Requests
CREATE TABLE IF NOT EXISTS leave_requests (
    id TEXT PRIMARY KEY,
    requesterId TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK(type IN ('annual', 'sick', 'wfh')),
    startDate INTEGER NOT NULL,
    endDate INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'declined')),
    reviewerId TEXT REFERENCES users(id),
    reviewReason TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    CHECK(startDate < endDate)
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_requester ON leave_requests(requesterId, startDate);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);

-- Public Holidays
CREATE TABLE IF NOT EXISTS public_holidays (
    id TEXT PRIMARY KEY,
    date INTEGER NOT NULL,
    name TEXT NOT NULL,
    year INTEGER NOT NULL,
    createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_public_holidays_year ON public_holidays(year);

-- Milestones
CREATE TABLE IF NOT EXISTS milestones (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    deadline INTEGER NOT NULL,
    completedAt INTEGER,
    createdBy TEXT NOT NULL REFERENCES users(id),
    createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(projectId);
CREATE INDEX IF NOT EXISTS idx_milestones_deadline ON milestones(deadline);

-- Milestone Tasks (junction table)
CREATE TABLE IF NOT EXISTS milestone_tasks (
    milestoneId TEXT NOT NULL REFERENCES milestones(id),
    taskId TEXT NOT NULL REFERENCES tasks(id),
    PRIMARY KEY (milestoneId, taskId)
);

-- Daily Reports
CREATE TABLE IF NOT EXISTS daily_reports (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id),
    sessionId TEXT NOT NULL REFERENCES sessions(id),
    date TEXT NOT NULL,
    reportJson TEXT NOT NULL,
    createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_user ON daily_reports(userId, date);

-- Focus Score History (local-only, never synced)
CREATE TABLE IF NOT EXISTS focus_score_history (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    score REAL NOT NULL CHECK(score >= 0 AND score <= 100),
    createdAt INTEGER NOT NULL,
    UNIQUE(userId, date)
);

-- v1 Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_start ON sessions(userId, startTime);
CREATE INDEX IF NOT EXISTS idx_session_tasks_session ON session_tasks(sessionId);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(projectId);
CREATE INDEX IF NOT EXISTS idx_git_events_session ON git_events(sessionId);
CREATE INDEX IF NOT EXISTS idx_breaks_session ON breaks(sessionId);

-- ============================================================
-- v3 Founder Governance
-- ============================================================

-- Drop legacy tables
DROP TABLE IF EXISTS mood_checks;
DROP TABLE IF EXISTS meetings;
DROP TABLE IF EXISTS standup_responses;
DROP TABLE IF EXISTS morning_digests;

-- Review Cycles
CREATE TABLE IF NOT EXISTS review_cycles (
    id TEXT PRIMARY KEY,
    startDate INTEGER NOT NULL,
    endDate INTEGER NOT NULL,
    submissionDeadline INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open', 'closed', 'resolved')),
    resolvedAt INTEGER,
    createdAt INTEGER NOT NULL,
    CHECK(endDate > startDate),
    CHECK(submissionDeadline > startDate),
    CHECK(submissionDeadline <= endDate)
);
CREATE INDEX IF NOT EXISTS idx_review_cycles_status ON review_cycles(status);

-- Founder Reviews
CREATE TABLE IF NOT EXISTS founder_reviews (
    id TEXT PRIMARY KEY,
    cycleId TEXT NOT NULL REFERENCES review_cycles(id),
    reviewerId TEXT NOT NULL REFERENCES users(id),
    revieweeId TEXT NOT NULL REFERENCES users(id),
    outputScore INTEGER NOT NULL CHECK(outputScore >= 1 AND outputScore <= 5),
    reliabilityScore INTEGER NOT NULL CHECK(reliabilityScore >= 1 AND reliabilityScore <= 5),
    initiativeScore INTEGER NOT NULL CHECK(initiativeScore >= 1 AND initiativeScore <= 5),
    submittedAt INTEGER NOT NULL,
    CHECK(reviewerId != revieweeId),
    UNIQUE(cycleId, reviewerId, revieweeId)
);
CREATE INDEX IF NOT EXISTS idx_founder_reviews_cycle ON founder_reviews(cycleId);
CREATE INDEX IF NOT EXISTS idx_founder_reviews_reviewee ON founder_reviews(revieweeId);

-- Accountability Warnings
CREATE TABLE IF NOT EXISTS accountability_warnings (
    id TEXT PRIMARY KEY,
    founderId TEXT NOT NULL REFERENCES users(id),
    cycleId TEXT NOT NULL REFERENCES review_cycles(id),
    issuedAt INTEGER NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    UNIQUE(founderId, cycleId)
);
CREATE INDEX IF NOT EXISTS idx_warnings_founder ON accountability_warnings(founderId);

-- Equity Stakes
CREATE TABLE IF NOT EXISTS equity_stakes (
    id TEXT PRIMARY KEY,
    founderId TEXT NOT NULL REFERENCES users(id),
    initialStakePct REAL NOT NULL CHECK(initialStakePct >= 0),
    currentStakePct REAL NOT NULL CHECK(currentStakePct >= 0),
    vestingStartDate INTEGER NOT NULL,
    cliffDate INTEGER NOT NULL,
    vestingEndDate INTEGER NOT NULL,
    vestingScheduleMonths INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    CHECK(vestingStartDate < cliffDate),
    CHECK(cliffDate < vestingEndDate),
    UNIQUE(founderId)
);

-- Dilution Events
CREATE TABLE IF NOT EXISTS dilution_events (
    id TEXT PRIMARY KEY,
    founderId TEXT NOT NULL REFERENCES users(id),
    cycleId TEXT NOT NULL REFERENCES review_cycles(id),
    dilutionPct REAL NOT NULL CHECK(dilutionPct > 0),
    previousStakePct REAL NOT NULL,
    newStakePct REAL NOT NULL,
    redistributionDetails TEXT NOT NULL,
    createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dilution_founder ON dilution_events(founderId);

-- Decisions
CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    createdAt INTEGER NOT NULL,
    resolvedAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_decisions_resolved ON decisions(resolvedAt);

-- Startup Health Config (local-only, never synced)
CREATE TABLE IF NOT EXISTS startup_health_config (
    id TEXT PRIMARY KEY,
    cashBalance REAL NOT NULL DEFAULT 0,
    monthlyExpenses TEXT NOT NULL DEFAULT '[]',
    plannedMonthlyBudget REAL NOT NULL DEFAULT 0,
    updatedAt INTEGER NOT NULL
);
"#;

/// Tauri command: initializes the database schema on app launch.
#[tauri::command]
pub fn initialize_db() -> Result<String, String> {
    let conn = open_connection().map_err(|e| format!("Failed to open database: {}", e))?;
    initialize_schema(&conn).map_err(|e| format!("Failed to initialize schema: {}", e))?;
    Ok("Database initialized successfully".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_in_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        initialize_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn test_schema_creates_all_tables() {
        let conn = setup_in_memory();
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let expected = vec![
            "accountability_warnings", "breaks", "daily_reports", "decisions",
            "dilution_events", "equity_stakes", "focus_score_history",
            "founder_reviews", "git_events",
            "idle_events", "leave_requests", "milestone_tasks",
            "milestones", "projects",
            "public_holidays", "review_cycles", "session_tasks", "sessions",
            "settings", "startup_health_config",
            "sync_dead_letter", "sync_queue", "tasks",
            "team_members", "teams", "users", "weekly_reviews",
        ];
        assert_eq!(tables, expected);
    }

    #[test]
    fn test_schema_creates_all_indexes() {
        let conn = setup_in_memory();
        let indexes: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let expected = vec![
            "idx_breaks_session",
            "idx_daily_reports_date",
            "idx_daily_reports_user",
            "idx_decisions_resolved",
            "idx_dilution_founder",
            "idx_founder_reviews_cycle",
            "idx_founder_reviews_reviewee",
            "idx_git_events_session",
            "idx_leave_requests_requester",
            "idx_leave_requests_status",
            "idx_milestones_deadline",
            "idx_milestones_project",
            "idx_public_holidays_year",
            "idx_review_cycles_status",
            "idx_session_tasks_session",
            "idx_sessions_user_start",
            "idx_tasks_project",
            "idx_team_members_user",
            "idx_teams_invite_code",
            "idx_warnings_founder",
        ];
        assert_eq!(indexes, expected);
    }

    #[test]
    fn test_schema_is_idempotent() {
        let conn = setup_in_memory();
        // Running schema initialization twice should not error
        initialize_schema(&conn).unwrap();
    }

    #[test]
    fn test_sessions_start_type_check_constraint() {
        let conn = setup_in_memory();
        conn.execute(
            "INSERT INTO users (id, name, email, createdAt) VALUES ('u1', 'Test', 'test@test.com', 1000)",
            [],
        ).unwrap();

        // Valid startType
        let result = conn.execute(
            "INSERT INTO sessions (id, userId, startTime, startType, createdAt) VALUES ('s1', 'u1', 1000, 'manual', 1000)",
            [],
        );
        assert!(result.is_ok());

        // Invalid startType
        let result = conn.execute(
            "INSERT INTO sessions (id, userId, startTime, startType, createdAt) VALUES ('s2', 'u1', 1000, 'invalid', 1000)",
            [],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_tasks_status_check_constraint() {
        let conn = setup_in_memory();
        conn.execute(
            "INSERT INTO users (id, name, email, createdAt) VALUES ('u1', 'Test', 'test@test.com', 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, createdBy, createdAt) VALUES ('p1', 'Proj', 'u1', 1000)",
            [],
        ).unwrap();

        // Valid status
        let result = conn.execute(
            "INSERT INTO tasks (id, projectId, title, status, priority, createdBy, createdAt) VALUES ('t1', 'p1', 'Task', 'open', 'high', 'u1', 1000)",
            [],
        );
        assert!(result.is_ok());

        // Invalid status
        let result = conn.execute(
            "INSERT INTO tasks (id, projectId, title, status, priority, createdBy, createdAt) VALUES ('t2', 'p1', 'Task', 'invalid', 'high', 'u1', 1000)",
            [],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_breaks_type_check_constraint() {
        let conn = setup_in_memory();
        conn.execute(
            "INSERT INTO users (id, name, email, createdAt) VALUES ('u1', 'Test', 'test@test.com', 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, userId, startTime, startType, createdAt) VALUES ('s1', 'u1', 1000, 'manual', 1000)",
            [],
        ).unwrap();

        // Valid break type
        let result = conn.execute(
            "INSERT INTO breaks (id, sessionId, startTime, type) VALUES ('b1', 's1', 1000, 'lunch')",
            [],
        );
        assert!(result.is_ok());

        // Invalid break type
        let result = conn.execute(
            "INSERT INTO breaks (id, sessionId, startTime, type) VALUES ('b2', 's1', 1000, 'invalid')",
            [],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_foreign_key_enforcement() {
        let conn = setup_in_memory();
        // Inserting a session with a non-existent userId should fail
        let result = conn.execute(
            "INSERT INTO sessions (id, userId, startTime, startType, createdAt) VALUES ('s1', 'nonexistent', 1000, 'manual', 1000)",
            [],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_session_tasks_generated_minutes_column() {
        let conn = setup_in_memory();
        conn.execute(
            "INSERT INTO users (id, name, email, createdAt) VALUES ('u1', 'Test', 'test@test.com', 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, createdBy, createdAt) VALUES ('p1', 'Proj', 'u1', 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO tasks (id, projectId, title, status, priority, createdBy, createdAt) VALUES ('t1', 'p1', 'Task', 'open', 'high', 'u1', 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, userId, startTime, startType, createdAt) VALUES ('s1', 'u1', 1000, 'manual', 1000)",
            [],
        ).unwrap();

        // Insert session_task with endTime set (60 minutes = 3600 seconds)
        conn.execute(
            "INSERT INTO session_tasks (id, sessionId, taskId, startTime, endTime) VALUES ('st1', 's1', 't1', 1000, 4600)",
            [],
        ).unwrap();

        let minutes: i64 = conn
            .query_row("SELECT minutes FROM session_tasks WHERE id = 'st1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(minutes, 60); // (4600 - 1000) / 60 = 60

        // Insert session_task without endTime — minutes should be NULL
        conn.execute(
            "INSERT INTO session_tasks (id, sessionId, taskId, startTime) VALUES ('st2', 's1', 't1', 2000)",
            [],
        ).unwrap();

        let minutes: Option<i64> = conn
            .query_row("SELECT minutes FROM session_tasks WHERE id = 'st2'", [], |row| row.get(0))
            .unwrap();
        assert!(minutes.is_none());
    }

    #[test]
    fn test_tasks_priority_check_constraint() {
        let conn = setup_in_memory();
        conn.execute(
            "INSERT INTO users (id, name, email, createdAt) VALUES ('u1', 'Test', 'test@test.com', 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, createdBy, createdAt) VALUES ('p1', 'Proj', 'u1', 1000)",
            [],
        ).unwrap();

        // All valid priorities should succeed
        for (id, priority) in [("t1", "high"), ("t2", "medium"), ("t3", "low")] {
            let result = conn.execute(
                "INSERT INTO tasks (id, projectId, title, status, priority, createdBy, createdAt) VALUES (?1, 'p1', 'Task', 'open', ?2, 'u1', 1000)",
                rusqlite::params![id, priority],
            );
            assert!(result.is_ok(), "priority '{}' should be accepted", priority);
        }

        // Invalid priority should fail
        let result = conn.execute(
            "INSERT INTO tasks (id, projectId, title, status, priority, createdBy, createdAt) VALUES ('t4', 'p1', 'Task', 'open', 'critical', 'u1', 1000)",
            [],
        );
        assert!(result.is_err(), "priority 'critical' should be rejected");
    }

    #[test]
    fn test_users_email_unique_constraint() {
        let conn = setup_in_memory();
        conn.execute(
            "INSERT INTO users (id, name, email, createdAt) VALUES ('u1', 'Alice', 'alice@test.com', 1000)",
            [],
        ).unwrap();

        // Duplicate email should fail
        let result = conn.execute(
            "INSERT INTO users (id, name, email, createdAt) VALUES ('u2', 'Bob', 'alice@test.com', 1000)",
            [],
        );
        assert!(result.is_err(), "duplicate email should be rejected");

        // Different email should succeed
        let result = conn.execute(
            "INSERT INTO users (id, name, email, createdAt) VALUES ('u3', 'Carol', 'carol@test.com', 1000)",
            [],
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_fk_session_tasks_session_id() {
        let conn = setup_in_memory();
        conn.execute(
            "INSERT INTO users (id, name, email, createdAt) VALUES ('u1', 'Test', 'test@test.com', 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, createdBy, createdAt) VALUES ('p1', 'Proj', 'u1', 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO tasks (id, projectId, title, status, priority, createdBy, createdAt) VALUES ('t1', 'p1', 'Task', 'open', 'high', 'u1', 1000)",
            [],
        ).unwrap();

        // session_task referencing non-existent session should fail
        let result = conn.execute(
            "INSERT INTO session_tasks (id, sessionId, taskId, startTime) VALUES ('st1', 'no_session', 't1', 1000)",
            [],
        );
        assert!(result.is_err(), "session_tasks.sessionId FK should be enforced");
    }

    #[test]
    fn test_fk_breaks_session_id() {
        let conn = setup_in_memory();

        // break referencing non-existent session should fail
        let result = conn.execute(
            "INSERT INTO breaks (id, sessionId, startTime, type) VALUES ('b1', 'no_session', 1000, 'lunch')",
            [],
        );
        assert!(result.is_err(), "breaks.sessionId FK should be enforced");
    }

    #[test]
    fn test_fk_tasks_project_id() {
        let conn = setup_in_memory();
        conn.execute(
            "INSERT INTO users (id, name, email, createdAt) VALUES ('u1', 'Test', 'test@test.com', 1000)",
            [],
        ).unwrap();

        // task referencing non-existent project should fail
        let result = conn.execute(
            "INSERT INTO tasks (id, projectId, title, status, priority, createdBy, createdAt) VALUES ('t1', 'no_project', 'Task', 'open', 'high', 'u1', 1000)",
            [],
        );
        assert!(result.is_err(), "tasks.projectId FK should be enforced");
    }

    #[test]
    fn test_table_column_counts() {
        let conn = setup_in_memory();

        let expected_columns: Vec<(&str, usize)> = vec![
            ("users", 6),
            ("projects", 6),
            ("tasks", 12),
            ("sessions", 10),
            ("session_tasks", 5),  // includes generated 'minutes'
            ("breaks", 6),
            ("idle_events", 5),
            ("git_events", 7),
            ("weekly_reviews", 8),
            ("settings", 14),
            ("sync_queue", 7),
            ("sync_dead_letter", 9),
            ("teams", 5),
            ("team_members", 3),
            ("leave_requests", 11),
            ("public_holidays", 5),
            ("milestones", 7),
            ("milestone_tasks", 2),
            ("daily_reports", 6),
            ("focus_score_history", 5),
            // v3 Governance tables
            ("review_cycles", 7),
            ("founder_reviews", 8),
            ("accountability_warnings", 5),
            ("equity_stakes", 9),
            ("dilution_events", 8),
            ("decisions", 5),
            ("startup_health_config", 5),
        ];

        for (table, expected_count) in expected_columns {
            let count: i64 = conn
                .prepare(&format!("SELECT COUNT(*) FROM pragma_table_info('{}')", table))
                .unwrap()
                .query_row([], |row| row.get(0))
                .unwrap();
            assert_eq!(
                count as usize, expected_count,
                "table '{}' should have {} columns, got {}",
                table, expected_count, count
            );
        }
    }
}
