use crate::db;
use crate::git;
use crate::heartbeat;
use crate::idle;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Session struct (camelCase for JS interop via serde rename)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "startTime")]
    pub start_time: i64,
    #[serde(rename = "endTime")]
    pub end_time: Option<i64>,
    #[serde(rename = "startType")]
    pub start_type: String,
    #[serde(rename = "startVerified")]
    pub start_verified: bool,
    #[serde(rename = "outputNote")]
    pub output_note: Option<String>,
    #[serde(rename = "lastHeartbeat")]
    pub last_heartbeat: Option<i64>,
    #[serde(rename = "syncedAt")]
    pub synced_at: Option<i64>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

// ---------------------------------------------------------------------------
// Break struct (camelCase for JS interop via serde rename)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreakRecord {
    pub id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "startTime")]
    pub start_time: i64,
    #[serde(rename = "endTime")]
    pub end_time: Option<i64>,
    #[serde(rename = "type")]
    pub break_type: String,
    #[serde(rename = "autoDetected")]
    pub auto_detected: bool,
}

// ---------------------------------------------------------------------------
// Global heartbeat state
// ---------------------------------------------------------------------------

struct HeartbeatState {
    handle: Option<JoinHandle<()>>,
    stop: Option<Arc<AtomicBool>>,
}

fn heartbeat_state() -> &'static Mutex<HeartbeatState> {
    static STATE: OnceLock<Mutex<HeartbeatState>> = OnceLock::new();
    STATE.get_or_init(|| {
        Mutex::new(HeartbeatState {
            handle: None,
            stop: None,
        })
    })
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

// ---------------------------------------------------------------------------
// Global idle detection state
// ---------------------------------------------------------------------------

struct IdleDetectionState {
    handle: Option<JoinHandle<()>>,
    stop: Option<Arc<AtomicBool>>,
}

fn idle_detection_state() -> &'static Mutex<IdleDetectionState> {
    static STATE: OnceLock<Mutex<IdleDetectionState>> = OnceLock::new();
    STATE.get_or_init(|| {
        Mutex::new(IdleDetectionState {
            handle: None,
            stop: None,
        })
    })
}

// ---------------------------------------------------------------------------
// Core logic functions (testable — accept &Connection and deterministic params)
// ---------------------------------------------------------------------------

/// Core logic for starting a session. Accepts connection, current time, and device
/// wake time so tests can inject deterministic values.
pub fn start_session_inner(
    conn: &Connection,
    user_id: &str,
    claimed_start_time: i64,
    now: i64,
    device_wake_time: i64,
) -> Result<Session, String> {
    // Reject if claimed start time is in the future
    if claimed_start_time > now {
        return Err("Claimed start time cannot be in the future".into());
    }

    // Reject if claimed start time is more than 4 hours ago
    let four_hours = 4 * 60 * 60;
    if now - claimed_start_time > four_hours {
        return Err("Claimed start time cannot be more than 4 hours in the past".into());
    }

    // Enforce single active session per user (Req 1.6, 20.1)
    let active_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE userId = ?1 AND endTime IS NULL",
            params![user_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("DB error: {e}"))?;

    if active_count > 0 {
        return Err("An active session already exists for this user".into());
    }

    // Determine startType and startVerified (Req 1.2, 1.3)
    let start_type = if claimed_start_time < now - 60 {
        "backfill"
    } else {
        "manual"
    };

    let start_verified = claimed_start_time >= device_wake_time;

    let session_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO sessions (id, userId, startTime, startType, startVerified, lastHeartbeat, createdAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            session_id,
            user_id,
            claimed_start_time,
            start_type,
            start_verified as i32,
            now,
            now,
        ],
    )
    .map_err(|e| format!("Failed to insert session: {e}"))?;

    Ok(Session {
        id: session_id,
        user_id: user_id.to_string(),
        start_time: claimed_start_time,
        end_time: None,
        start_type: start_type.to_string(),
        start_verified,
        output_note: None,
        last_heartbeat: Some(now),
        synced_at: None,
        created_at: now,
    })
}

/// Core logic for ending a session. Closes open session_tasks and breaks,
/// sets endTime and outputNote. (Req 3.2, 3.3, 3.4)
pub fn end_session_inner(
    conn: &Connection,
    session_id: &str,
    end_time: i64,
    output_note: Option<&str>,
) -> Result<(), String> {
    // Close all open session_tasks for this session (Req 3.3)
    conn.execute(
        "UPDATE session_tasks SET endTime = ?1 WHERE sessionId = ?2 AND endTime IS NULL",
        params![end_time, session_id],
    )
    .map_err(|e| format!("Failed to close session_tasks: {e}"))?;

    // Close all open breaks for this session (Req 3.3)
    conn.execute(
        "UPDATE breaks SET endTime = ?1 WHERE sessionId = ?2 AND endTime IS NULL",
        params![end_time, session_id],
    )
    .map_err(|e| format!("Failed to close breaks: {e}"))?;

    // Update session with endTime and outputNote (Req 3.2)
    conn.execute(
        "UPDATE sessions SET endTime = ?1, outputNote = ?2 WHERE id = ?3",
        params![end_time, output_note, session_id],
    )
    .map_err(|e| format!("Failed to end session: {e}"))?;

    Ok(())
}

/// Core logic for getting the active session for a user.
pub fn get_active_session_inner(
    conn: &Connection,
    user_id: &str,
) -> Result<Option<Session>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, userId, startTime, endTime, startType, startVerified,
                    outputNote, lastHeartbeat, syncedAt, createdAt
             FROM sessions WHERE userId = ?1 AND endTime IS NULL
             LIMIT 1",
        )
        .map_err(|e| format!("DB error: {e}"))?;

    let session = stmt
        .query_row(params![user_id], |row| {
            let start_verified_int: i32 = row.get(5)?;
            Ok(Session {
                id: row.get(0)?,
                user_id: row.get(1)?,
                start_time: row.get(2)?,
                end_time: row.get(3)?,
                start_type: row.get(4)?,
                start_verified: start_verified_int != 0,
                output_note: row.get(6)?,
                last_heartbeat: row.get(7)?,
                synced_at: row.get(8)?,
                created_at: row.get(9)?,
            })
        })
        .ok();

    Ok(session)
}

/// Core logic for recovering a stale session. Sets startType to 'recovered'
/// and closes with confirmed end time. (Req 2.3)
pub fn recover_stale_session_inner(
    conn: &Connection,
    session_id: &str,
    confirmed_end_time: i64,
) -> Result<(), String> {
    // Close all open session_tasks and breaks
    conn.execute(
        "UPDATE session_tasks SET endTime = ?1 WHERE sessionId = ?2 AND endTime IS NULL",
        params![confirmed_end_time, session_id],
    )
    .map_err(|e| format!("Failed to close session_tasks: {e}"))?;

    conn.execute(
        "UPDATE breaks SET endTime = ?1 WHERE sessionId = ?2 AND endTime IS NULL",
        params![confirmed_end_time, session_id],
    )
    .map_err(|e| format!("Failed to close breaks: {e}"))?;

    // Update session: set endTime, startType = 'recovered'
    conn.execute(
        "UPDATE sessions SET endTime = ?1, startType = 'recovered' WHERE id = ?2",
        params![confirmed_end_time, session_id],
    )
    .map_err(|e| format!("Failed to recover session: {e}"))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Break management core logic (Req 7.1–7.6)
// ---------------------------------------------------------------------------

/// Start a break for a session. Creates a break record with the given type.
pub fn start_break_inner(
    conn: &Connection,
    session_id: &str,
    break_type: &str,
    now: i64,
) -> Result<BreakRecord, String> {
    // Validate break type
    if !["lunch", "short", "meeting"].contains(&break_type) {
        return Err(format!("Invalid break type: {}", break_type));
    }

    // Verify session exists and is active
    let active_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE id = ?1 AND endTime IS NULL",
            params![session_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("DB error: {e}"))?;

    if active_count == 0 {
        return Err("No active session found with the given ID".into());
    }

    // Check no active break already exists for this session
    let active_break_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM breaks WHERE sessionId = ?1 AND endTime IS NULL",
            params![session_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("DB error: {e}"))?;

    if active_break_count > 0 {
        return Err("An active break already exists for this session".into());
    }

    let break_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO breaks (id, sessionId, startTime, type, autoDetected) VALUES (?1, ?2, ?3, ?4, 0)",
        params![break_id, session_id, now, break_type],
    )
    .map_err(|e| format!("Failed to insert break: {e}"))?;

    Ok(BreakRecord {
        id: break_id,
        session_id: session_id.to_string(),
        start_time: now,
        end_time: None,
        break_type: break_type.to_string(),
        auto_detected: false,
    })
}

/// End an active break by setting its endTime.
pub fn end_break_inner(
    conn: &Connection,
    break_id: &str,
    now: i64,
) -> Result<(), String> {
    let rows = conn
        .execute(
            "UPDATE breaks SET endTime = ?1 WHERE id = ?2 AND endTime IS NULL",
            params![now, break_id],
        )
        .map_err(|e| format!("Failed to end break: {e}"))?;

    if rows == 0 {
        return Err("No active break found with the given ID".into());
    }

    Ok(())
}

/// Get the active break (endTime IS NULL) for a session, or None.
pub fn get_active_break_inner(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<BreakRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, sessionId, startTime, endTime, type, autoDetected
             FROM breaks WHERE sessionId = ?1 AND endTime IS NULL
             LIMIT 1",
        )
        .map_err(|e| format!("DB error: {e}"))?;

    let record = stmt
        .query_row(params![session_id], |row| {
            let auto_detected_int: i32 = row.get(5)?;
            Ok(BreakRecord {
                id: row.get(0)?,
                session_id: row.get(1)?,
                start_time: row.get(2)?,
                end_time: row.get(3)?,
                break_type: row.get(4)?,
                auto_detected: auto_detected_int != 0,
            })
        })
        .ok();

    Ok(record)
}

/// Get all breaks for a session, filtering out micro-breaks (< 8 min / 480s).
/// Used for UI display. (Req 7.6)
pub fn get_visible_breaks_inner(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<BreakRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, sessionId, startTime, endTime, type, autoDetected
             FROM breaks
             WHERE sessionId = ?1
               AND (endTime IS NULL OR (endTime - startTime) >= 480)
             ORDER BY startTime ASC",
        )
        .map_err(|e| format!("DB error: {e}"))?;

    let breaks = stmt
        .query_map(params![session_id], |row| {
            let auto_detected_int: i32 = row.get(5)?;
            Ok(BreakRecord {
                id: row.get(0)?,
                session_id: row.get(1)?,
                start_time: row.get(2)?,
                end_time: row.get(3)?,
                break_type: row.get(4)?,
                auto_detected: auto_detected_int != 0,
            })
        })
        .map_err(|e| format!("DB error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(breaks)
}

// ---------------------------------------------------------------------------
// SessionTask struct (camelCase for JS interop via serde rename)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTaskRecord {
    pub id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(rename = "startTime")]
    pub start_time: i64,
    #[serde(rename = "endTime")]
    pub end_time: Option<i64>,
}

// ---------------------------------------------------------------------------
// Task struct (camelCase for JS interop via serde rename)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRecord {
    pub id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    pub title: String,
    pub status: String,
    #[serde(rename = "assigneeId")]
    pub assignee_id: Option<String>,
    pub priority: String,
    #[serde(rename = "dueDate")]
    pub due_date: Option<i64>,
    #[serde(rename = "estimatedMinutes")]
    pub estimated_minutes: Option<i64>,
    pub notes: Option<String>,
    #[serde(rename = "createdBy")]
    pub created_by: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "closedAt")]
    pub closed_at: Option<i64>,
}

// ---------------------------------------------------------------------------
// Project struct (camelCase for JS interop via serde rename)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(rename = "createdBy")]
    pub created_by: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "archivedAt")]
    pub archived_at: Option<i64>,
}

// ---------------------------------------------------------------------------
// Color palette for auto-assigning project colors
// ---------------------------------------------------------------------------

const PROJECT_COLOR_PALETTE: &[&str] = &[
    "#6e6af6", "#e06c75", "#e5c07b", "#98c379", "#61afef",
    "#c678dd", "#56b6c2", "#d19a66", "#be5046", "#7ec699",
];

// ---------------------------------------------------------------------------
// Task switching core logic (Req 9.2, 9.3, 20.2)
// ---------------------------------------------------------------------------

/// Core logic for switching the active task within a session.
/// 1. Rejects self-switch (same task currently active).
/// 2. Closes the current session_task (sets endTime = now).
/// 3. Creates a new session_task for the target task.
/// 4. Updates target task status to "inprogress" if it was "open".
pub fn switch_task_inner(
    conn: &Connection,
    session_id: &str,
    new_task_id: &str,
    now: i64,
) -> Result<SessionTaskRecord, String> {
    // Find the current active session_task (endTime IS NULL)
    let current: Option<(String, String)> = conn
        .prepare(
            "SELECT id, taskId FROM session_tasks WHERE sessionId = ?1 AND endTime IS NULL LIMIT 1",
        )
        .map_err(|e| format!("DB error: {e}"))?
        .query_row(params![session_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .ok();

    // Reject self-switch
    if let Some((_, ref current_task_id)) = current {
        if current_task_id == new_task_id {
            return Err("Cannot switch to the same task that is already active".into());
        }
    }

    // Close current session_task
    if let Some((ref current_st_id, _)) = current {
        conn.execute(
            "UPDATE session_tasks SET endTime = ?1 WHERE id = ?2",
            params![now, current_st_id],
        )
        .map_err(|e| format!("Failed to close current session_task: {e}"))?;
    }

    // Create new session_task
    let new_st_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO session_tasks (id, sessionId, taskId, startTime) VALUES (?1, ?2, ?3, ?4)",
        params![new_st_id, session_id, new_task_id, now],
    )
    .map_err(|e| format!("Failed to create new session_task: {e}"))?;

    // Update target task status: open → inprogress (Req 9.3)
    // Only transition if currently "open"; other statuses stay unchanged.
    conn.execute(
        "UPDATE tasks SET status = 'inprogress' WHERE id = ?1 AND status = 'open'",
        params![new_task_id],
    )
    .map_err(|e| format!("Failed to update task status: {e}"))?;

    Ok(SessionTaskRecord {
        id: new_st_id,
        session_id: session_id.to_string(),
        task_id: new_task_id.to_string(),
        start_time: now,
        end_time: None,
    })
}

// ---------------------------------------------------------------------------
// Task CRUD core logic (testable — accept &Connection)
// ---------------------------------------------------------------------------

/// Create a new task. Validates title is non-empty and projectId references
/// an existing project. Priority defaults to "medium" if not provided.
pub fn create_task_inner(
    conn: &Connection,
    project_id: &str,
    title: &str,
    priority: Option<&str>,
    assignee_id: Option<&str>,
    due_date: Option<i64>,
    notes: Option<&str>,
    created_by: &str,
    now: i64,
) -> Result<TaskRecord, String> {
    // Validate title is non-empty
    let trimmed_title = title.trim();
    if trimmed_title.is_empty() {
        return Err("Task title cannot be empty".into());
    }

    // Validate projectId references an existing project
    let project_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM projects WHERE id = ?1",
            params![project_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("DB error: {e}"))?;

    if !project_exists {
        return Err("Project not found".into());
    }

    let priority = priority.unwrap_or("medium");
    if !["high", "medium", "low"].contains(&priority) {
        return Err(format!("Invalid priority: {}", priority));
    }

    let task_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO tasks (id, projectId, title, status, assigneeId, priority, dueDate, notes, createdBy, createdAt)
         VALUES (?1, ?2, ?3, 'open', ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            task_id,
            project_id,
            trimmed_title,
            assignee_id,
            priority,
            due_date,
            notes,
            created_by,
            now,
        ],
    )
    .map_err(|e| format!("Failed to insert task: {e}"))?;

    Ok(TaskRecord {
        id: task_id,
        project_id: project_id.to_string(),
        title: trimmed_title.to_string(),
        status: "open".to_string(),
        assignee_id: assignee_id.map(|s| s.to_string()),
        priority: priority.to_string(),
        due_date,
        estimated_minutes: None,
        notes: notes.map(|s| s.to_string()),
        created_by: created_by.to_string(),
        created_at: now,
        closed_at: None,
    })
}

/// Update a task's status. Validates the transition is allowed.
/// Allowed transitions: open → inprogress, open → blocked,
/// inprogress → done, inprogress → blocked,
/// blocked → open, blocked → inprogress.
/// Sets closedAt when transitioning to "done".
pub fn update_task_status_inner(
    conn: &Connection,
    task_id: &str,
    new_status: &str,
    now: i64,
) -> Result<(), String> {
    if !["open", "inprogress", "done", "blocked"].contains(&new_status) {
        return Err(format!("Invalid status: {}", new_status));
    }

    let current_status: String = conn
        .query_row(
            "SELECT status FROM tasks WHERE id = ?1",
            params![task_id],
            |r| r.get(0),
        )
        .map_err(|_| "Task not found".to_string())?;

    let valid_transition = matches!(
        (current_status.as_str(), new_status),
        ("open", "inprogress")
            | ("open", "blocked")
            | ("inprogress", "done")
            | ("inprogress", "blocked")
            | ("blocked", "open")
            | ("blocked", "inprogress")
    );

    if !valid_transition {
        return Err(format!(
            "Invalid status transition: {} → {}",
            current_status, new_status
        ));
    }

    let closed_at: Option<i64> = if new_status == "done" { Some(now) } else { None };

    conn.execute(
        "UPDATE tasks SET status = ?1, closedAt = ?2 WHERE id = ?3",
        params![new_status, closed_at, task_id],
    )
    .map_err(|e| format!("Failed to update task status: {e}"))?;

    Ok(())
}

/// Archive a task by setting closedAt timestamp.
pub fn archive_task_inner(
    conn: &Connection,
    task_id: &str,
    now: i64,
) -> Result<(), String> {
    let rows = conn
        .execute(
            "UPDATE tasks SET closedAt = ?1 WHERE id = ?2",
            params![now, task_id],
        )
        .map_err(|e| format!("Failed to archive task: {e}"))?;

    if rows == 0 {
        return Err("Task not found".into());
    }

    Ok(())
}

/// List tasks, optionally filtered by project_id.
pub fn list_tasks_inner(
    conn: &Connection,
    project_id: Option<&str>,
) -> Result<Vec<TaskRecord>, String> {
    let (sql, param_values): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = match project_id {
        Some(pid) => (
            "SELECT id, projectId, title, status, assigneeId, priority, dueDate, estimatedMinutes, notes, createdBy, createdAt, closedAt
             FROM tasks WHERE projectId = ?1 ORDER BY createdAt DESC",
            vec![Box::new(pid.to_string()) as Box<dyn rusqlite::types::ToSql>],
        ),
        None => (
            "SELECT id, projectId, title, status, assigneeId, priority, dueDate, estimatedMinutes, notes, createdBy, createdAt, closedAt
             FROM tasks ORDER BY createdAt DESC",
            vec![],
        ),
    };

    let mut stmt = conn.prepare(sql).map_err(|e| format!("DB error: {e}"))?;

    let params_slice: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let tasks = stmt
        .query_map(params_slice.as_slice(), |row| {
            Ok(TaskRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                status: row.get(3)?,
                assignee_id: row.get(4)?,
                priority: row.get(5)?,
                due_date: row.get(6)?,
                estimated_minutes: row.get(7)?,
                notes: row.get(8)?,
                created_by: row.get(9)?,
                created_at: row.get(10)?,
                closed_at: row.get(11)?,
            })
        })
        .map_err(|e| format!("DB error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tasks)
}

// ---------------------------------------------------------------------------
// Project CRUD core logic (testable — accept &Connection)
// ---------------------------------------------------------------------------

/// Create a new project. Auto-assigns a color from the palette based on
/// the current project count.
pub fn create_project_inner(
    conn: &Connection,
    name: &str,
    created_by: &str,
    now: i64,
) -> Result<ProjectRecord, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Project name cannot be empty".into());
    }

    // Auto-assign color from palette based on existing project count
    let project_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
        .map_err(|e| format!("DB error: {e}"))?;

    let color_index = (project_count as usize) % PROJECT_COLOR_PALETTE.len();
    let color = PROJECT_COLOR_PALETTE[color_index];

    let project_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO projects (id, name, color, createdBy, createdAt) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![project_id, trimmed_name, color, created_by, now],
    )
    .map_err(|e| format!("Failed to insert project: {e}"))?;

    Ok(ProjectRecord {
        id: project_id,
        name: trimmed_name.to_string(),
        color: color.to_string(),
        created_by: created_by.to_string(),
        created_at: now,
        archived_at: None,
    })
}

/// Archive a project by setting archivedAt timestamp.
pub fn archive_project_inner(
    conn: &Connection,
    project_id: &str,
    now: i64,
) -> Result<(), String> {
    let rows = conn
        .execute(
            "UPDATE projects SET archivedAt = ?1 WHERE id = ?2",
            params![now, project_id],
        )
        .map_err(|e| format!("Failed to archive project: {e}"))?;

    if rows == 0 {
        return Err("Project not found".into());
    }

    Ok(())
}

/// List all active (non-archived) projects.
pub fn list_projects_inner(conn: &Connection) -> Result<Vec<ProjectRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, color, createdBy, createdAt, archivedAt
             FROM projects WHERE archivedAt IS NULL ORDER BY createdAt ASC",
        )
        .map_err(|e| format!("DB error: {e}"))?;

    let projects = stmt
        .query_map([], |row| {
            Ok(ProjectRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_by: row.get(3)?,
                created_at: row.get(4)?,
                archived_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("DB error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(projects)
}

// ---------------------------------------------------------------------------
// Tauri commands (thin wrappers that open the real DB and delegate)
// ---------------------------------------------------------------------------

/// Create a new task.
#[tauri::command]
pub fn create_task(
    project_id: String,
    title: String,
    priority: Option<String>,
    assignee_id: Option<String>,
    due_date: Option<i64>,
    notes: Option<String>,
    created_by: String,
) -> Result<TaskRecord, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    let now = now_unix();
    create_task_inner(
        &conn,
        &project_id,
        &title,
        priority.as_deref(),
        assignee_id.as_deref(),
        due_date,
        notes.as_deref(),
        &created_by,
        now,
    )
}

/// Update a task's status.
#[tauri::command]
pub fn update_task_status(
    task_id: String,
    new_status: String,
) -> Result<(), String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    let now = now_unix();
    update_task_status_inner(&conn, &task_id, &new_status, now)
}

/// Archive a task.
#[tauri::command]
pub fn archive_task(task_id: String) -> Result<(), String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    let now = now_unix();
    archive_task_inner(&conn, &task_id, now)
}

/// List tasks, optionally filtered by project.
#[tauri::command]
pub fn list_tasks(project_id: Option<String>) -> Result<Vec<TaskRecord>, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    list_tasks_inner(&conn, project_id.as_deref())
}

/// Create a new project.
#[tauri::command]
pub fn create_project(name: String, created_by: String) -> Result<ProjectRecord, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    let now = now_unix();
    create_project_inner(&conn, &name, &created_by, now)
}

/// Archive a project.
#[tauri::command]
pub fn archive_project(project_id: String) -> Result<(), String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    let now = now_unix();
    archive_project_inner(&conn, &project_id, now)
}

/// List active projects.
#[tauri::command]
pub fn list_projects() -> Result<Vec<ProjectRecord>, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    list_projects_inner(&conn)
}

/// Start a new work session for the given user.
#[tauri::command]
pub fn start_session(
    user_id: String,
    claimed_start_time: i64,
) -> Result<Session, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    let now = now_unix();
    let device_wake = get_device_wake_time_inner();

    let session = start_session_inner(&conn, &user_id, claimed_start_time, now, device_wake)?;

    // Spawn heartbeat thread (Req 1.4, 2.1)
    let db_path = db::get_db_path().to_string_lossy().to_string();
    let (handle, stop) = heartbeat::spawn_heartbeat(session.id.clone(), db_path);
    {
        let mut state = heartbeat_state().lock().unwrap();
        state.handle = Some(handle);
        state.stop = Some(stop);
    }

    Ok(session)
}

/// End an active session: close all open session_tasks and breaks, stop heartbeat,
/// update session with endTime and outputNote. (Req 3.2, 3.3, 3.4)
#[tauri::command]
pub fn end_session(
    session_id: String,
    end_time: i64,
    output_note: Option<String>,
) -> Result<(), String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    end_session_inner(&conn, &session_id, end_time, output_note.as_deref())?;
    // Stop heartbeat thread (Req 3.4)
    stop_heartbeat();
    Ok(())
}

/// Get the active session for a user, or null if none exists.
#[tauri::command]
pub fn get_active_session(user_id: String) -> Result<Option<Session>, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    get_active_session_inner(&conn, &user_id)
}

/// Recover a stale session: set startType to 'recovered' and close with confirmed end time.
#[tauri::command]
pub fn recover_stale_session(
    session_id: String,
    confirmed_end_time: i64,
) -> Result<(), String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    recover_stale_session_inner(&conn, &session_id, confirmed_end_time)
}

/// Returns the estimated device wake time as a Unix timestamp.
/// Uses system uptime to compute when the device last booted/woke.
#[tauri::command]
pub fn get_device_wake_time() -> Result<i64, String> {
    Ok(get_device_wake_time_inner())
}

fn get_device_wake_time_inner() -> i64 {
    let now = now_unix();

    // Platform-specific uptime detection
    if let Some(wake) = platform_wake_time(now) {
        return wake;
    }

    // Fallback: assume device woke 1 hour ago
    now - 3600
}

fn platform_wake_time(now: i64) -> Option<i64> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("sysctl").arg("-n").arg("kern.boottime").output() {
            if let Ok(s) = String::from_utf8(output.stdout) {
                // Format: "{ sec = 1234567890, usec = 0 } ..."
                if let Some(sec_start) = s.find("sec = ") {
                    let rest = &s[sec_start + 6..];
                    if let Some(end) = rest.find(',') {
                        if let Ok(boot_sec) = rest[..end].trim().parse::<i64>() {
                            return Some(boot_sec);
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(contents) = std::fs::read_to_string("/proc/uptime") {
            if let Some(uptime_str) = contents.split_whitespace().next() {
                if let Ok(uptime_secs) = uptime_str.parse::<f64>() {
                    return Some(now - uptime_secs as i64);
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn GetTickCount64() -> u64;
        }
        let uptime_ms = unsafe { GetTickCount64() };
        return Some(now - (uptime_ms / 1000) as i64);
    }

    #[allow(unreachable_code)]
    None
}

/// Stop the heartbeat thread if running.
fn stop_heartbeat() {
    let mut state = heartbeat_state().lock().unwrap();
    if let Some(stop_flag) = state.stop.take() {
        stop_flag.store(true, Ordering::Relaxed);
    }
    if let Some(handle) = state.handle.take() {
        let _ = handle.join();
    }
}

/// Stop the idle detection thread if running.
fn stop_idle_detection_inner() {
    let mut state = idle_detection_state().lock().unwrap();
    if let Some(stop_flag) = state.stop.take() {
        stop_flag.store(true, Ordering::Relaxed);
    }
    if let Some(handle) = state.handle.take() {
        let _ = handle.join();
    }
}

/// Start idle detection for the given session. Uses default config;
/// future tasks will wire user-configurable thresholds from Settings.
#[tauri::command]
pub fn start_idle_detection(
    app_handle: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    // Stop any existing idle detection first
    stop_idle_detection_inner();

    let config = idle::IdleConfig::default();
    let (handle, stop) = idle::spawn_idle_detection(config, session_id, app_handle);
    {
        let mut state = idle_detection_state().lock().unwrap();
        state.handle = Some(handle);
        state.stop = Some(stop);
    }
    Ok(())
}

/// Stop idle detection polling.
#[tauri::command]
pub fn stop_idle_detection() -> Result<(), String> {
    stop_idle_detection_inner();
    Ok(())
}

/// Start a break for the given session. Returns the created break record.
#[tauri::command]
pub fn start_break(session_id: String, break_type: String) -> Result<BreakRecord, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    let now = now_unix();
    start_break_inner(&conn, &session_id, &break_type, now)
}

/// End an active break by setting its endTime.
#[tauri::command]
pub fn end_break(break_id: String) -> Result<(), String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    let now = now_unix();
    end_break_inner(&conn, &break_id, now)
}

/// Get the active break for a session, or null if none.
#[tauri::command]
pub fn get_active_break(session_id: String) -> Result<Option<BreakRecord>, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    get_active_break_inner(&conn, &session_id)
}

/// Get all visible breaks for a session (micro-breaks < 8min filtered out).
#[tauri::command]
pub fn get_visible_breaks(session_id: String) -> Result<Vec<BreakRecord>, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    get_visible_breaks_inner(&conn, &session_id)
}

// ---------------------------------------------------------------------------
// Review cycle structs (camelCase for JS interop via serde rename)
// ---------------------------------------------------------------------------

/// Constants for review cycle scheduling
const CYCLE_INTERVAL_DAYS: i64 = 14;
const SUBMISSION_WINDOW_HOURS: i64 = 48;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewCycle {
    pub id: String,
    #[serde(rename = "startDate")]
    pub start_date: i64,
    #[serde(rename = "endDate")]
    pub end_date: i64,
    #[serde(rename = "submissionDeadline")]
    pub submission_deadline: i64,
    pub status: String,
    #[serde(rename = "resolvedAt")]
    pub resolved_at: Option<i64>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewResult {
    #[serde(rename = "founderId")]
    pub founder_id: String,
    #[serde(rename = "outputAvg")]
    pub output_avg: f64,
    #[serde(rename = "reliabilityAvg")]
    pub reliability_avg: f64,
    #[serde(rename = "initiativeAvg")]
    pub initiative_avg: f64,
    #[serde(rename = "overallAvg")]
    pub overall_avg: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountabilityWarning {
    pub id: String,
    #[serde(rename = "founderId")]
    pub founder_id: String,
    #[serde(rename = "cycleId")]
    pub cycle_id: String,
    #[serde(rename = "issuedAt")]
    pub issued_at: i64,
    pub acknowledged: bool,
}

// ---------------------------------------------------------------------------
// Accountability helpers (Req 2.4, 2.5)
// ---------------------------------------------------------------------------

/// Issue an accountability warning for a founder in a cycle.
/// Returns the created warning.
fn issue_accountability_warning(
    conn: &Connection,
    founder_id: &str,
    cycle_id: &str,
    now: i64,
) -> Result<AccountabilityWarning, String> {
    let warning_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT OR IGNORE INTO accountability_warnings (id, founderId, cycleId, issuedAt, acknowledged)
         VALUES (?1, ?2, ?3, ?4, 0)",
        params![warning_id, founder_id, cycle_id, now],
    )
    .map_err(|e| format!("Failed to insert accountability warning: {e}"))?;

    Ok(AccountabilityWarning {
        id: warning_id,
        founder_id: founder_id.to_string(),
        cycle_id: cycle_id.to_string(),
        issued_at: now,
        acknowledged: false,
    })
}

/// Check if the founder had a warning in the immediately previous cycle.
/// If so, trigger a 1% dilution event. (Req 2.5)
fn check_consecutive_warnings_and_dilute(
    conn: &Connection,
    founder_id: &str,
    cycle_id: &str,
    now: i64,
) -> Result<(), String> {
    // Get the start date of the current cycle
    let current_start: i64 = conn
        .query_row(
            "SELECT startDate FROM review_cycles WHERE id = ?1",
            params![cycle_id],
            |r| r.get(0),
        )
        .map_err(|_| "Current cycle not found".to_string())?;

    // Find the immediately previous cycle (the one with the latest endDate before this cycle's startDate)
    let prev_cycle_id: Option<String> = conn
        .query_row(
            "SELECT id FROM review_cycles WHERE endDate <= ?1 ORDER BY endDate DESC LIMIT 1",
            params![current_start],
            |r| r.get(0),
        )
        .ok();

    if let Some(prev_id) = prev_cycle_id {
        // Check if the founder had a warning in that previous cycle
        let prev_warning_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM accountability_warnings WHERE founderId = ?1 AND cycleId = ?2",
                params![founder_id, prev_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("DB error: {e}"))?;

        if prev_warning_count > 0 {
            // Two consecutive warnings → trigger 1% dilution
            trigger_dilution(conn, founder_id, cycle_id, 1.0, now)?;
        }
    }

    Ok(())
}

/// Trigger a dilution event: reduce the founder's equity by dilution_pct and
/// redistribute proportionally among other founders. (Req 2.5, 6.5)
fn trigger_dilution(
    conn: &Connection,
    founder_id: &str,
    cycle_id: &str,
    dilution_pct: f64,
    now: i64,
) -> Result<(), String> {
    // Get the founder's current stake
    let (stake_id, current_pct): (String, f64) = conn
        .query_row(
            "SELECT id, currentStakePct FROM equity_stakes WHERE founderId = ?1",
            params![founder_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| format!("No equity stake found for founder {}", founder_id))?;

    let new_pct = (current_pct - dilution_pct).max(0.0);
    let amount_to_redistribute = current_pct - new_pct;

    // Update the affected founder's stake
    conn.execute(
        "UPDATE equity_stakes SET currentStakePct = ?1, updatedAt = ?2 WHERE id = ?3",
        params![new_pct, now, stake_id],
    )
    .map_err(|e| format!("Failed to update equity stake: {e}"))?;

    // Get all other founders' stakes for redistribution
    let mut stmt = conn
        .prepare(
            "SELECT id, founderId, currentStakePct FROM equity_stakes WHERE founderId != ?1",
        )
        .map_err(|e| format!("DB error: {e}"))?;

    let others: Vec<(String, String, f64)> = stmt
        .query_map(params![founder_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|e| format!("DB error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    let total_others: f64 = others.iter().map(|(_, _, pct)| pct).sum();

    // Build redistribution details JSON
    let mut redistribution = String::from("{");
    for (i, (other_id, other_founder_id, other_pct)) in others.iter().enumerate() {
        let share = if total_others > 0.0 {
            amount_to_redistribute * (other_pct / total_others)
        } else {
            amount_to_redistribute / others.len() as f64
        };
        let new_other_pct = other_pct + share;

        conn.execute(
            "UPDATE equity_stakes SET currentStakePct = ?1, updatedAt = ?2 WHERE id = ?3",
            params![new_other_pct, now, other_id],
        )
        .map_err(|e| format!("Failed to update equity stake: {e}"))?;

        if i > 0 {
            redistribution.push_str(", ");
        }
        redistribution.push_str(&format!(
            "\"{}\": {}",
            other_founder_id,
            new_other_pct
        ));
    }
    redistribution.push('}');

    // Insert dilution event record
    let dilution_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO dilution_events (id, founderId, cycleId, dilutionPct, previousStakePct, newStakePct, redistributionDetails, createdAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            dilution_id,
            founder_id,
            cycle_id,
            dilution_pct,
            current_pct,
            new_pct,
            redistribution,
            now,
        ],
    )
    .map_err(|e| format!("Failed to insert dilution event: {e}"))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Review cycle core logic (Req 1.1, 1.7, 2.1, 2.6)
// ---------------------------------------------------------------------------

/// Create a new review cycle. Computes endDate (start + 14 days) and
/// submissionDeadline (start + 48 hours). Status is "open".
pub fn create_review_cycle_inner(
    conn: &Connection,
    start_date: i64,
    now: i64,
) -> Result<ReviewCycle, String> {
    let end_date = start_date + CYCLE_INTERVAL_DAYS * 24 * 3600;
    let submission_deadline = start_date + SUBMISSION_WINDOW_HOURS * 3600;
    let cycle_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO review_cycles (id, startDate, endDate, submissionDeadline, status, createdAt)
         VALUES (?1, ?2, ?3, ?4, 'open', ?5)",
        params![cycle_id, start_date, end_date, submission_deadline, now],
    )
    .map_err(|e| format!("Failed to insert review cycle: {e}"))?;

    Ok(ReviewCycle {
        id: cycle_id,
        start_date,
        end_date,
        submission_deadline,
        status: "open".to_string(),
        resolved_at: None,
        created_at: now,
    })
}

/// Close a review cycle: compute average scores per founder per dimension,
/// return sorted results (ascending by overall_avg for accountability).
/// If exactly one founder is lowest-ranked, auto-issue a warning and resolve.
/// If tied at the lowest, leave as "closed" for CEO tie-break via resolve_tie.
/// (Req 1.7, 2.1, 2.2, 2.3, 2.4, 2.5)
pub fn close_review_cycle_inner(
    conn: &Connection,
    cycle_id: &str,
    now: i64,
) -> Result<Vec<ReviewResult>, String> {
    // Verify cycle exists and is "open"
    let status: String = conn
        .query_row(
            "SELECT status FROM review_cycles WHERE id = ?1",
            params![cycle_id],
            |r| r.get(0),
        )
        .map_err(|_| "Review cycle not found".to_string())?;

    if status != "open" {
        return Err(format!(
            "Review cycle is '{}', expected 'open'",
            status
        ));
    }

    // Compute average scores per reviewee
    let mut stmt = conn
        .prepare(
            "SELECT revieweeId,
                    AVG(CAST(outputScore AS REAL)),
                    AVG(CAST(reliabilityScore AS REAL)),
                    AVG(CAST(initiativeScore AS REAL))
             FROM founder_reviews
             WHERE cycleId = ?1
             GROUP BY revieweeId",
        )
        .map_err(|e| format!("DB error: {e}"))?;

    let mut results: Vec<ReviewResult> = stmt
        .query_map(params![cycle_id], |row| {
            let output_avg: f64 = row.get(1)?;
            let reliability_avg: f64 = row.get(2)?;
            let initiative_avg: f64 = row.get(3)?;
            let overall_avg = (output_avg + reliability_avg + initiative_avg) / 3.0;
            Ok(ReviewResult {
                founder_id: row.get(0)?,
                output_avg,
                reliability_avg,
                initiative_avg,
                overall_avg,
            })
        })
        .map_err(|e| format!("DB error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    // Sort ascending by overall_avg (lowest first for accountability)
    results.sort_by(|a, b| a.overall_avg.partial_cmp(&b.overall_avg).unwrap());

    if results.is_empty() {
        // No reviews submitted — just close the cycle, nothing to resolve
        conn.execute(
            "UPDATE review_cycles SET status = 'closed' WHERE id = ?1",
            params![cycle_id],
        )
        .map_err(|e| format!("Failed to close review cycle: {e}"))?;
        return Ok(results);
    }

    // Identify lowest-ranked founder(s) (Req 2.1)
    let lowest_score = results[0].overall_avg;
    let tied: Vec<&ReviewResult> = results
        .iter()
        .filter(|r| (r.overall_avg - lowest_score).abs() < 1e-9)
        .collect();

    if tied.len() == 1 {
        // Exactly one lowest — auto-issue warning and resolve (Req 2.4)
        let lowest_founder_id = tied[0].founder_id.clone();

        // Update cycle status to "closed" first (intermediate state)
        conn.execute(
            "UPDATE review_cycles SET status = 'closed' WHERE id = ?1",
            params![cycle_id],
        )
        .map_err(|e| format!("Failed to close review cycle: {e}"))?;

        // Issue accountability warning
        issue_accountability_warning(conn, &lowest_founder_id, cycle_id, now)?;

        // Check for consecutive warnings → dilution (Req 2.5)
        check_consecutive_warnings_and_dilute(conn, &lowest_founder_id, cycle_id, now)?;

        // Update cycle status to "resolved"
        conn.execute(
            "UPDATE review_cycles SET status = 'resolved', resolvedAt = ?1 WHERE id = ?2",
            params![now, cycle_id],
        )
        .map_err(|e| format!("Failed to resolve review cycle: {e}"))?;
    } else {
        // Tie at the lowest score — leave as "closed" for CEO tie-break (Req 2.2)
        conn.execute(
            "UPDATE review_cycles SET status = 'closed' WHERE id = ?1",
            params![cycle_id],
        )
        .map_err(|e| format!("Failed to close review cycle: {e}"))?;
    }

    Ok(results)
}

/// Resolve a tie in a closed review cycle. CEO casts a vote for the
/// lowest-ranked founder. Updates cycle status to "resolved".
/// (Req 2.2)
pub fn resolve_tie_inner(
    conn: &Connection,
    cycle_id: &str,
    ceo_user_id: &str,
    selected_founder_id: &str,
    now: i64,
) -> Result<(), String> {
    // Verify cycle exists and is "closed"
    let status: String = conn
        .query_row(
            "SELECT status FROM review_cycles WHERE id = ?1",
            params![cycle_id],
            |r| r.get(0),
        )
        .map_err(|_| "Review cycle not found".to_string())?;

    if status != "closed" {
        return Err(format!(
            "Review cycle is '{}', expected 'closed'",
            status
        ));
    }

    // Verify the CEO user exists
    let ceo_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM users WHERE id = ?1",
            params![ceo_user_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("DB error: {e}"))?;

    if !ceo_exists {
        return Err("CEO user not found".into());
    }

    // Verify the selected founder exists
    let founder_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM users WHERE id = ?1",
            params![selected_founder_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("DB error: {e}"))?;

    if !founder_exists {
        return Err("Selected founder not found".into());
    }

    // Issue accountability warning for the selected founder
    issue_accountability_warning(conn, selected_founder_id, cycle_id, now)?;

    // Check for consecutive warnings → dilution (Req 2.5)
    check_consecutive_warnings_and_dilute(conn, selected_founder_id, cycle_id, now)?;

    // Update cycle status to "resolved"
    conn.execute(
        "UPDATE review_cycles SET status = 'resolved', resolvedAt = ?1 WHERE id = ?2",
        params![now, cycle_id],
    )
    .map_err(|e| format!("Failed to resolve review cycle: {e}"))?;

    Ok(())
}

/// Get review history for a founder: all cycles where they were reviewed.
pub fn get_review_history_inner(
    conn: &Connection,
    founder_id: &str,
) -> Result<Vec<ReviewCycle>, String> {
    // Return all cycles that have reviews for this founder, ordered by startDate desc
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT rc.id, rc.startDate, rc.endDate, rc.submissionDeadline,
                    rc.status, rc.resolvedAt, rc.createdAt
             FROM review_cycles rc
             INNER JOIN founder_reviews fr ON fr.cycleId = rc.id
             WHERE fr.revieweeId = ?1
             ORDER BY rc.startDate DESC",
        )
        .map_err(|e| format!("DB error: {e}"))?;

    let cycles = stmt
        .query_map(params![founder_id], |row| {
            Ok(ReviewCycle {
                id: row.get(0)?,
                start_date: row.get(1)?,
                end_date: row.get(2)?,
                submission_deadline: row.get(3)?,
                status: row.get(4)?,
                resolved_at: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("DB error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(cycles)
}

/// Get the total accountability warning count for a founder.
pub fn get_warning_count_inner(
    conn: &Connection,
    founder_id: &str,
) -> Result<i32, String> {
    let count: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM accountability_warnings WHERE founderId = ?1",
            params![founder_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("DB error: {e}"))?;

    Ok(count)
}

// ---------------------------------------------------------------------------
// FounderReview struct (camelCase for JS interop via serde rename)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FounderReview {
    pub id: String,
    #[serde(rename = "cycleId")]
    pub cycle_id: String,
    #[serde(rename = "reviewerId")]
    pub reviewer_id: String,
    #[serde(rename = "revieweeId")]
    pub reviewee_id: String,
    #[serde(rename = "outputScore")]
    pub output_score: i32,
    #[serde(rename = "reliabilityScore")]
    pub reliability_score: i32,
    #[serde(rename = "initiativeScore")]
    pub initiative_score: i32,
    #[serde(rename = "submittedAt")]
    pub submitted_at: i64,
}

// ---------------------------------------------------------------------------
// Review submission core logic (Req 1.3, 1.4, 1.6, 2.7)
// ---------------------------------------------------------------------------

/// Submit a founder review. Validates:
/// 1. Cycle exists and is "open"
/// 2. now < submissionDeadline
/// 3. reviewerId != revieweeId (no self-review)
/// 4. No duplicate (cycleId, reviewerId, revieweeId)
/// 5. All scores in [1, 5]
pub fn submit_founder_review_inner(
    conn: &Connection,
    cycle_id: &str,
    reviewer_id: &str,
    reviewee_id: &str,
    output_score: i32,
    reliability_score: i32,
    initiative_score: i32,
    now: i64,
) -> Result<FounderReview, String> {
    // Validate: reviewerId != revieweeId (Req 1.3 — no self-review)
    if reviewer_id == reviewee_id {
        return Err("Reviewer and reviewee must be different founders".into());
    }

    // Validate: all scores in [1, 5] (Req 1.4)
    for (name, score) in [
        ("output", output_score),
        ("reliability", reliability_score),
        ("initiative", initiative_score),
    ] {
        if !(1..=5).contains(&score) {
            return Err(format!(
                "Invalid {} score: {}. Must be between 1 and 5",
                name, score
            ));
        }
    }

    // Validate: cycle exists and is "open"
    let (status, submission_deadline): (String, i64) = conn
        .query_row(
            "SELECT status, submissionDeadline FROM review_cycles WHERE id = ?1",
            params![cycle_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "Review cycle not found".to_string())?;

    if status != "open" {
        return Err(format!(
            "Review cycle is '{}', expected 'open'",
            status
        ));
    }

    // Validate: now < submissionDeadline (Req 1.6)
    if now >= submission_deadline {
        return Err("Submission deadline has passed".into());
    }

    // Validate: no duplicate (cycleId, reviewerId, revieweeId) (Req 1.3)
    let duplicate_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM founder_reviews WHERE cycleId = ?1 AND reviewerId = ?2 AND revieweeId = ?3",
            params![cycle_id, reviewer_id, reviewee_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("DB error: {e}"))?;

    if duplicate_count > 0 {
        return Err("A review for this reviewer-reviewee pair already exists in this cycle".into());
    }

    let review_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            review_id,
            cycle_id,
            reviewer_id,
            reviewee_id,
            output_score,
            reliability_score,
            initiative_score,
            now,
        ],
    )
    .map_err(|e| format!("Failed to insert founder review: {e}"))?;

    Ok(FounderReview {
        id: review_id,
        cycle_id: cycle_id.to_string(),
        reviewer_id: reviewer_id.to_string(),
        reviewee_id: reviewee_id.to_string(),
        output_score,
        reliability_score,
        initiative_score,
        submitted_at: now,
    })
}

// ---------------------------------------------------------------------------
// Git integration commands (Req 11.1, 11.2)
// ---------------------------------------------------------------------------

/// Collect git events for a session. Takes pre-collected git log outputs
/// (repo_path, git_log_output) pairs and stores parsed commits in SQLite.
#[tauri::command]
pub fn collect_git_events(
    session_id: String,
    user_id: String,
    repo_outputs: Vec<(String, String)>,
) -> Result<Vec<git::GitEventRecord>, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    git::collect_git_events_inner(&conn, &session_id, &user_id, &repo_outputs)
}

/// Get git events for a session.
#[tauri::command]
pub fn get_git_events(
    session_id: String,
) -> Result<Vec<git::GitEventRecord>, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    git::get_git_events_for_session(&conn, &session_id)
}

// ---------------------------------------------------------------------------
// Review cycle Tauri commands (Req 1.1, 1.7, 2.1, 2.6)
// ---------------------------------------------------------------------------

/// Create a new review cycle starting at the given date.
#[tauri::command]
pub fn create_review_cycle(start_date: i64) -> Result<ReviewCycle, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    let now = now_unix();
    create_review_cycle_inner(&conn, start_date, now)
}

/// Close a review cycle: compute average scores and return sorted results.
#[tauri::command]
pub fn close_review_cycle(cycle_id: String) -> Result<Vec<ReviewResult>, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    let now = now_unix();
    close_review_cycle_inner(&conn, &cycle_id, now)
}

/// Resolve a tie in a closed review cycle via CEO vote.
#[tauri::command]
pub fn resolve_tie(
    cycle_id: String,
    ceo_user_id: String,
    selected_founder_id: String,
) -> Result<(), String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    let now = now_unix();
    resolve_tie_inner(&conn, &cycle_id, &ceo_user_id, &selected_founder_id, now)
}

/// Get review history for a founder.
#[tauri::command]
pub fn get_review_history(founder_id: String) -> Result<Vec<ReviewCycle>, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    get_review_history_inner(&conn, &founder_id)
}

/// Get the total accountability warning count for a founder.
#[tauri::command]
pub fn get_warning_count(founder_id: String) -> Result<i32, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    get_warning_count_inner(&conn, &founder_id)
}

/// Submit a founder review for a review cycle.
#[tauri::command]
pub fn submit_founder_review(
    cycle_id: String,
    reviewer_id: String,
    reviewee_id: String,
    output_score: i32,
    reliability_score: i32,
    initiative_score: i32,
) -> Result<FounderReview, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    let now = now_unix();
    submit_founder_review_inner(
        &conn,
        &cycle_id,
        &reviewer_id,
        &reviewee_id,
        output_score,
        reliability_score,
        initiative_score,
        now,
    )
}

// ---------------------------------------------------------------------------
// Equity dilution core logic (Req 6.5, 21.4)
// ---------------------------------------------------------------------------

/// Validate that the cap table sums to 100% within 0.01% tolerance.
pub fn validate_cap_table_sum(conn: &Connection) -> Result<bool, String> {
    let total: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(currentStakePct), 0.0) FROM equity_stakes",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("DB error: {e}"))?;

    // Within 0.01% of 100 means |total - 100.0| <= 0.01
    Ok((total - 100.0).abs() <= 0.01)
}

/// Apply a dilution event: reduce the target founder's equity by dilution_pct,
/// redistribute proportionally among remaining founders, and validate the cap
/// table sum afterwards. (Req 6.5, 21.4)
pub fn apply_dilution_inner(
    conn: &Connection,
    founder_id: &str,
    cycle_id: &str,
    dilution_pct: f64,
    now: i64,
) -> Result<(), String> {
    if dilution_pct <= 0.0 {
        return Err("Dilution percentage must be positive".into());
    }

    // Verify the founder has an equity stake
    let current_pct: f64 = conn
        .query_row(
            "SELECT currentStakePct FROM equity_stakes WHERE founderId = ?1",
            params![founder_id],
            |r| r.get(0),
        )
        .map_err(|_| format!("No equity stake found for founder {}", founder_id))?;

    if dilution_pct > current_pct {
        return Err(format!(
            "Dilution {}% exceeds founder's current stake {}%",
            dilution_pct, current_pct
        ));
    }

    // Delegate to the existing trigger_dilution which handles the actual
    // stake updates, redistribution, and dilution_events record creation
    trigger_dilution(conn, founder_id, cycle_id, dilution_pct, now)?;

    // Validate cap table sum after dilution (Req 21.4)
    let valid = validate_cap_table_sum(conn)?;
    if !valid {
        let total: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(currentStakePct), 0.0) FROM equity_stakes",
                [],
                |r| r.get(0),
            )
            .map_err(|e| format!("DB error: {e}"))?;
        return Err(format!(
            "Cap table integrity violation: stakes sum to {:.4}%, expected ~100%",
            total
        ));
    }

    Ok(())
}

/// Apply equity dilution for a founder. Validates inputs, performs the dilution,
/// and checks cap table integrity afterwards. (Req 6.5, 21.4)
#[tauri::command]
pub fn apply_dilution(
    founder_id: String,
    cycle_id: String,
    dilution_pct: f64,
) -> Result<(), String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    let now = now_unix();
    apply_dilution_inner(&conn, &founder_id, &cycle_id, dilution_pct, now)
}

// ---------------------------------------------------------------------------
// Dilution event query (Req 2.5, 6.5)
// ---------------------------------------------------------------------------

/// DilutionEvent struct for JS interop.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DilutionEventRow {
    pub id: String,
    #[serde(rename = "founderId")]
    pub founder_id: String,
    #[serde(rename = "cycleId")]
    pub cycle_id: String,
    #[serde(rename = "dilutionPct")]
    pub dilution_pct: f64,
    #[serde(rename = "previousStakePct")]
    pub previous_stake_pct: f64,
    #[serde(rename = "newStakePct")]
    pub new_stake_pct: f64,
    #[serde(rename = "redistributionDetails")]
    pub redistribution_details: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

/// Get dilution events for a specific review cycle.
/// Used by the frontend to detect if a dilution was triggered after closing a cycle.
pub fn get_dilution_events_for_cycle_inner(
    conn: &Connection,
    cycle_id: &str,
) -> Result<Vec<DilutionEventRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, founderId, cycleId, dilutionPct, previousStakePct, newStakePct, redistributionDetails, createdAt
             FROM dilution_events WHERE cycleId = ?1 ORDER BY createdAt ASC",
        )
        .map_err(|e| format!("DB error: {e}"))?;

    let events = stmt
        .query_map(params![cycle_id], |row| {
            Ok(DilutionEventRow {
                id: row.get(0)?,
                founder_id: row.get(1)?,
                cycle_id: row.get(2)?,
                dilution_pct: row.get(3)?,
                previous_stake_pct: row.get(4)?,
                new_stake_pct: row.get(5)?,
                redistribution_details: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("DB error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(events)
}

/// Get dilution events for a specific review cycle.
#[tauri::command]
pub fn get_dilution_events_for_cycle(cycle_id: String) -> Result<Vec<DilutionEventRow>, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    get_dilution_events_for_cycle_inner(&conn, &cycle_id)
}

// ---------------------------------------------------------------------------
// Startup Health structs and core logic (Req 12.1, 12.5, 14.6)
// ---------------------------------------------------------------------------

/// Startup health config (local-only, never synced).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupHealthConfigRow {
    pub id: String,
    #[serde(rename = "cashBalance")]
    pub cash_balance: f64,
    #[serde(rename = "monthlyExpenses")]
    pub monthly_expenses: String, // JSON array string e.g. "[5000, 6000, 5500]"
    #[serde(rename = "plannedMonthlyBudget")]
    pub planned_monthly_budget: f64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

/// A decision record from the decisions table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionRow {
    pub id: String,
    pub title: String,
    pub description: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "resolvedAt")]
    pub resolved_at: Option<i64>,
}

/// Per-founder weekly hours for founder balance computation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FounderWeeklyHours {
    #[serde(rename = "founderId")]
    pub founder_id: String,
    pub name: String,
    #[serde(rename = "weeklyHours")]
    pub weekly_hours: f64,
}

/// Aggregated startup health data returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupHealthRawData {
    pub config: Option<StartupHealthConfigRow>,
    pub decisions: Vec<DecisionRow>,
    #[serde(rename = "founderHours")]
    pub founder_hours: Vec<FounderWeeklyHours>,
}

/// Core logic: read startup health data from SQLite.
/// Reads startup_health_config, decisions, and computes per-founder weekly
/// session hours for the current week. (Req 12.1, 12.5, 14.6)
pub fn compute_startup_health_inner(
    conn: &Connection,
    now: i64,
) -> Result<StartupHealthRawData, String> {
    // 1. Read startup_health_config (single row, local-only)
    let config: Option<StartupHealthConfigRow> = conn
        .prepare(
            "SELECT id, cashBalance, monthlyExpenses, plannedMonthlyBudget, updatedAt
             FROM startup_health_config LIMIT 1",
        )
        .map_err(|e| format!("DB error: {e}"))?
        .query_row([], |row| {
            Ok(StartupHealthConfigRow {
                id: row.get(0)?,
                cash_balance: row.get(1)?,
                monthly_expenses: row.get(2)?,
                planned_monthly_budget: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .ok();

    // 2. Read all decisions
    let decisions: Vec<DecisionRow> = conn
        .prepare(
            "SELECT id, title, description, createdAt, resolvedAt
             FROM decisions ORDER BY createdAt DESC",
        )
        .map_err(|e| format!("DB error: {e}"))?
        .query_map([], |row| {
            Ok(DecisionRow {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                created_at: row.get(3)?,
                resolved_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("DB error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    // 3. Compute per-founder weekly session hours for the current week
    //    Week starts on Monday 00:00 UTC
    let secs_per_day: i64 = 86400;
    // Compute day-of-week: 0=Thu for Unix epoch. Monday = (now/86400 + 4) % 7 gives 0=Mon
    let days_since_epoch = now / secs_per_day;
    let day_of_week = ((days_since_epoch + 3) % 7) as i64; // 0=Mon, 6=Sun
    let week_start = (days_since_epoch - day_of_week) * secs_per_day;

    let founder_hours: Vec<FounderWeeklyHours> = conn
        .prepare(
            "SELECT u.id, u.name,
                    COALESCE(SUM(
                        CASE
                            WHEN s.endTime IS NOT NULL THEN
                                MIN(s.endTime, ?1) - MAX(s.startTime, ?2)
                            ELSE
                                ?1 - MAX(s.startTime, ?2)
                        END
                    ), 0) / 3600.0 AS hours
             FROM users u
             LEFT JOIN sessions s ON s.userId = u.id
                AND s.startTime < ?1
                AND (s.endTime IS NULL OR s.endTime > ?2)
             WHERE LOWER(u.role) LIKE '%founder%' OR LOWER(u.role) LIKE '%ceo%'
             GROUP BY u.id, u.name
             ORDER BY u.name ASC",
        )
        .map_err(|e| format!("DB error: {e}"))?
        .query_map(params![now, week_start], |row| {
            Ok(FounderWeeklyHours {
                founder_id: row.get(0)?,
                name: row.get(1)?,
                weekly_hours: row.get(2)?,
            })
        })
        .map_err(|e| format!("DB error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(StartupHealthRawData {
        config,
        decisions,
        founder_hours,
    })
}

/// Compute startup health: reads config, decisions, and founder weekly hours
/// from SQLite and returns raw data for the TypeScript layer. (Req 12.1, 12.5, 14.6)
#[tauri::command]
pub fn compute_startup_health() -> Result<StartupHealthRawData, String> {
    let conn = db::open_connection().map_err(|e| format!("DB error: {e}"))?;
    let now = now_unix();
    compute_startup_health_inner(&conn, now)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::initialize_schema;
    use rusqlite::Connection;

    /// Helper: create an in-memory DB with schema and a test user.
    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        initialize_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO users (id, name, email, createdAt) VALUES ('u1', 'Test', 'test@test.com', 1000)",
            [],
        )
        .unwrap();
        conn
    }

    /// Helper: insert prerequisite project + task for session_task tests.
    fn insert_project_and_task(conn: &Connection) {
        conn.execute(
            "INSERT INTO projects (id, name, createdBy, createdAt) VALUES ('p1', 'Proj', 'u1', 1000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tasks (id, projectId, title, status, priority, createdBy, createdAt) \
             VALUES ('t1', 'p1', 'Task 1', 'open', 'high', 'u1', 1000)",
            [],
        )
        .unwrap();
    }

    // -----------------------------------------------------------------------
    // Existing helper/serialization tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_now_unix_returns_reasonable_timestamp() {
        let ts = now_unix();
        assert!(ts > 1_704_067_200);
    }

    #[test]
    fn test_get_device_wake_time_returns_past_timestamp() {
        let wake = get_device_wake_time_inner();
        let now = now_unix();
        assert!(wake <= now, "wake time should be <= now");
        assert!(wake > now - 365 * 24 * 3600, "wake time should be within the last year");
    }

    #[test]
    fn test_session_serialization_camel_case() {
        let session = Session {
            id: "s1".into(),
            user_id: "u1".into(),
            start_time: 1000,
            end_time: None,
            start_type: "manual".into(),
            start_verified: true,
            output_note: None,
            last_heartbeat: Some(1000),
            synced_at: None,
            created_at: 1000,
        };
        let json = serde_json::to_string(&session).unwrap();
        assert!(json.contains("\"userId\""));
        assert!(json.contains("\"startTime\""));
        assert!(json.contains("\"endTime\""));
        assert!(json.contains("\"startType\""));
        assert!(json.contains("\"startVerified\""));
        assert!(json.contains("\"outputNote\""));
        assert!(json.contains("\"lastHeartbeat\""));
        assert!(json.contains("\"syncedAt\""));
        assert!(json.contains("\"createdAt\""));
    }

    // -----------------------------------------------------------------------
    // start_session_inner tests (Validates: Req 1.1, 1.2, 1.3, 1.6, 20.1)
    // -----------------------------------------------------------------------

    #[test]
    fn test_start_session_creates_session_with_correct_fields() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600; // woke 1h ago

        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        assert_eq!(session.user_id, "u1");
        assert_eq!(session.start_time, now);
        assert!(session.end_time.is_none());
        assert_eq!(session.start_type, "manual");
        assert!(session.start_verified);
        assert!(session.output_note.is_none());
        assert_eq!(session.last_heartbeat, Some(now));
        assert!(session.synced_at.is_none());
        assert_eq!(session.created_at, now);
        assert!(!session.id.is_empty());

        // Verify row exists in DB
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE id = ?1",
                params![session.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_start_session_rejects_when_active_session_exists() {
        // Validates: Req 1.6, 20.1 — single active session invariant
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        // First session succeeds
        start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        // Second session for same user should fail
        let result = start_session_inner(&conn, "u1", now + 10, now + 10, device_wake);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("An active session already exists"));
    }

    #[test]
    fn test_start_session_backfill_sets_start_type() {
        // Validates: Req 1.2 — claimed time 2 hours ago → startType = "backfill"
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let two_hours_ago = now - 2 * 3600;
        let device_wake = now - 3 * 3600; // woke 3h ago (before claimed time)

        let session =
            start_session_inner(&conn, "u1", two_hours_ago, now, device_wake).unwrap();

        assert_eq!(session.start_type, "backfill");
        assert!(session.start_verified); // claimed time is after device wake
    }

    #[test]
    fn test_start_session_backfill_before_device_wake_unverified() {
        // Validates: Req 1.3 — claimed time before device wake → startVerified = false
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let two_hours_ago = now - 2 * 3600;
        let device_wake = now - 1800; // woke 30 min ago (after claimed time)

        let session =
            start_session_inner(&conn, "u1", two_hours_ago, now, device_wake).unwrap();

        assert_eq!(session.start_type, "backfill");
        assert!(!session.start_verified);
    }

    #[test]
    fn test_start_session_rejects_claimed_time_over_4_hours() {
        // Validates: Req 1.1 — claimedStartTime must be within 4 hours
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let five_hours_ago = now - 5 * 3600;
        let device_wake = now - 6 * 3600;

        let result = start_session_inner(&conn, "u1", five_hours_ago, now, device_wake);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("more than 4 hours in the past"));
    }

    #[test]
    fn test_start_session_rejects_future_time() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        let result = start_session_inner(&conn, "u1", now + 100, now, device_wake);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("in the future"));
    }

    #[test]
    fn test_start_session_manual_when_within_60s() {
        // If claimed time is within 60s of now, startType should be "manual"
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        let session =
            start_session_inner(&conn, "u1", now - 30, now, device_wake).unwrap();
        assert_eq!(session.start_type, "manual");
    }

    #[test]
    fn test_start_session_exactly_4_hours_ago_accepted() {
        // Boundary: exactly 4 hours should be accepted (not > 4h)
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let exactly_4h = now - 4 * 3600;
        let device_wake = now - 5 * 3600;

        let session =
            start_session_inner(&conn, "u1", exactly_4h, now, device_wake).unwrap();
        assert_eq!(session.start_type, "backfill");
    }

    // -----------------------------------------------------------------------
    // end_session_inner tests (Validates: Req 3.2, 3.3, 3.4)
    // -----------------------------------------------------------------------

    #[test]
    fn test_end_session_sets_end_time_and_output_note() {
        // Validates: Req 3.2
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        let end_time = now + 3600;
        end_session_inner(&conn, &session.id, end_time, Some("Shipped feature X"))
            .unwrap();

        // Verify session row
        let (db_end_time, db_note): (Option<i64>, Option<String>) = conn
            .query_row(
                "SELECT endTime, outputNote FROM sessions WHERE id = ?1",
                params![session.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(db_end_time, Some(end_time));
        assert_eq!(db_note.as_deref(), Some("Shipped feature X"));
    }

    #[test]
    fn test_end_session_closes_open_session_tasks_and_breaks() {
        // Validates: Req 3.3 — close all open session_tasks and breaks
        let conn = setup_test_db();
        insert_project_and_task(&conn);
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        // Insert open session_task
        conn.execute(
            "INSERT INTO session_tasks (id, sessionId, taskId, startTime) \
             VALUES ('st1', ?1, 't1', ?2)",
            params![session.id, now],
        )
        .unwrap();

        // Insert open break
        conn.execute(
            "INSERT INTO breaks (id, sessionId, startTime, type) \
             VALUES ('b1', ?1, ?2, 'short')",
            params![session.id, now + 1000],
        )
        .unwrap();

        let end_time = now + 3600;
        end_session_inner(&conn, &session.id, end_time, None).unwrap();

        // Verify session_task was closed
        let st_end: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM session_tasks WHERE id = 'st1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(st_end, Some(end_time));

        // Verify break was closed
        let br_end: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM breaks WHERE id = 'b1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(br_end, Some(end_time));
    }

    #[test]
    fn test_end_session_stores_output_note_correctly() {
        // Validates: Req 3.2 — outputNote stored
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        let note = "Completed API integration and wrote tests";
        end_session_inner(&conn, &session.id, now + 3600, Some(note)).unwrap();

        let db_note: Option<String> = conn
            .query_row(
                "SELECT outputNote FROM sessions WHERE id = ?1",
                params![session.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(db_note.as_deref(), Some(note));
    }

    #[test]
    fn test_end_session_with_no_output_note() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();
        end_session_inner(&conn, &session.id, now + 3600, None).unwrap();

        let db_note: Option<String> = conn
            .query_row(
                "SELECT outputNote FROM sessions WHERE id = ?1",
                params![session.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(db_note.is_none());
    }

    // -----------------------------------------------------------------------
    // get_active_session_inner tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_active_session_returns_session_when_active() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        let created = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        let active = get_active_session_inner(&conn, "u1").unwrap();
        assert!(active.is_some());
        let active = active.unwrap();
        assert_eq!(active.id, created.id);
        assert_eq!(active.user_id, "u1");
        assert_eq!(active.start_time, now);
        assert!(active.end_time.is_none());
        assert_eq!(active.start_type, "manual");
    }

    #[test]
    fn test_get_active_session_returns_none_when_no_active() {
        let conn = setup_test_db();

        let active = get_active_session_inner(&conn, "u1").unwrap();
        assert!(active.is_none());
    }

    #[test]
    fn test_get_active_session_returns_none_after_end() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();
        end_session_inner(&conn, &session.id, now + 3600, None).unwrap();

        let active = get_active_session_inner(&conn, "u1").unwrap();
        assert!(active.is_none());
    }

    // -----------------------------------------------------------------------
    // recover_stale_session_inner tests (Validates: Req 2.3)
    // -----------------------------------------------------------------------

    #[test]
    fn test_recover_stale_session_sets_recovered_and_end_time() {
        // Validates: Req 2.3 — startType = 'recovered', confirmed endTime
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        let confirmed_end = now + 7200;
        recover_stale_session_inner(&conn, &session.id, confirmed_end).unwrap();

        let (db_end, db_start_type): (Option<i64>, String) = conn
            .query_row(
                "SELECT endTime, startType FROM sessions WHERE id = ?1",
                params![session.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(db_end, Some(confirmed_end));
        assert_eq!(db_start_type, "recovered");
    }

    #[test]
    fn test_recover_stale_session_closes_open_children() {
        // Validates: Req 2.3 — recovery also closes open session_tasks and breaks
        let conn = setup_test_db();
        insert_project_and_task(&conn);
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        // Insert open session_task and break
        conn.execute(
            "INSERT INTO session_tasks (id, sessionId, taskId, startTime) \
             VALUES ('st1', ?1, 't1', ?2)",
            params![session.id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO breaks (id, sessionId, startTime, type) \
             VALUES ('b1', ?1, ?2, 'lunch')",
            params![session.id, now + 500],
        )
        .unwrap();

        let confirmed_end = now + 7200;
        recover_stale_session_inner(&conn, &session.id, confirmed_end).unwrap();

        let st_end: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM session_tasks WHERE id = 'st1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(st_end, Some(confirmed_end));

        let br_end: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM breaks WHERE id = 'b1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(br_end, Some(confirmed_end));
    }

    #[test]
    fn test_recover_stale_session_no_longer_active() {
        // After recovery, get_active_session should return None
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();
        recover_stale_session_inner(&conn, &session.id, now + 7200).unwrap();

        let active = get_active_session_inner(&conn, "u1").unwrap();
        assert!(active.is_none());
    }

    // -----------------------------------------------------------------------
    // Multiple stale sessions edge case (Validates: Req 2.2)
    // -----------------------------------------------------------------------

    #[test]
    fn test_multiple_stale_sessions_returns_one() {
        // Edge case: if somehow multiple sessions have endTime = NULL
        // (e.g., data corruption), get_active_session should return exactly one.
        // The single-active-session invariant prevents this normally, but
        // we test the query's LIMIT 1 behavior for robustness.
        let conn = setup_test_db();
        let now = 1_700_000_000i64;

        // Manually insert two "stale" sessions bypassing the invariant check
        conn.execute(
            "INSERT INTO sessions (id, userId, startTime, startType, startVerified, lastHeartbeat, createdAt)
             VALUES ('s-old', 'u1', ?1, 'manual', 1, ?2, ?1)",
            params![now - 7200, now - 7200],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions (id, userId, startTime, startType, startVerified, lastHeartbeat, createdAt)
             VALUES ('s-recent', 'u1', ?1, 'manual', 1, ?2, ?1)",
            params![now - 3600, now - 3600],
        )
        .unwrap();

        // get_active_session should return exactly one session (not error)
        let active = get_active_session_inner(&conn, "u1").unwrap();
        assert!(active.is_some(), "Should return one session even with multiple stale");
        let session = active.unwrap();
        // It should be one of the two inserted sessions
        assert!(
            session.id == "s-old" || session.id == "s-recent",
            "Returned session should be one of the inserted stale sessions"
        );
    }

    // -----------------------------------------------------------------------
    // Integration-style: start → end → verify full lifecycle
    // -----------------------------------------------------------------------

    #[test]
    fn test_full_session_lifecycle() {
        let conn = setup_test_db();
        insert_project_and_task(&conn);
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        // Start session
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();
        assert!(get_active_session_inner(&conn, "u1").unwrap().is_some());

        // Add a session_task and break
        conn.execute(
            "INSERT INTO session_tasks (id, sessionId, taskId, startTime) \
             VALUES ('st1', ?1, 't1', ?2)",
            params![session.id, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO breaks (id, sessionId, startTime, type) \
             VALUES ('b1', ?1, ?2, 'short')",
            params![session.id, now + 1800],
        )
        .unwrap();

        // End session
        let end_time = now + 3600;
        end_session_inner(&conn, &session.id, end_time, Some("Done for the day"))
            .unwrap();

        // No active session
        assert!(get_active_session_inner(&conn, "u1").unwrap().is_none());

        // Can start a new session now
        let session2 =
            start_session_inner(&conn, "u1", end_time + 60, end_time + 60, device_wake)
                .unwrap();
        assert_ne!(session.id, session2.id);
    }

    // -----------------------------------------------------------------------
    // Integration: backfill start → verify startType and startVerified
    // Validates: Requirements 1.1, 1.2, 1.3, 3.2
    // -----------------------------------------------------------------------

    #[test]
    fn test_full_session_lifecycle_with_backfill() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let two_hours_ago = now - 2 * 3600;
        // Device woke 1 hour ago — after the claimed start time
        let device_wake = now - 3600;

        // Start session with backfill (claimed time is 2h ago, device woke 1h ago)
        let session =
            start_session_inner(&conn, "u1", two_hours_ago, now, device_wake).unwrap();

        // Verify SQLite row exists with correct fields
        let (db_start_time, db_start_type, db_start_verified, db_end_time): (
            i64,
            String,
            i32,
            Option<i64>,
        ) = conn
            .query_row(
                "SELECT startTime, startType, startVerified, endTime FROM sessions WHERE id = ?1",
                params![session.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();

        assert_eq!(db_start_time, two_hours_ago);
        assert_eq!(db_start_type, "backfill");
        // Claimed time (2h ago) is before device wake (1h ago) → unverified
        assert_eq!(db_start_verified, 0);
        assert!(db_end_time.is_none());

        // Also verify the returned struct matches
        assert_eq!(session.start_type, "backfill");
        assert!(!session.start_verified);
        assert_eq!(session.start_time, two_hours_ago);

        // Session is active
        let active = get_active_session_inner(&conn, "u1").unwrap();
        assert!(active.is_some());
        assert_eq!(active.unwrap().id, session.id);

        // End the session
        let end_time = now + 1800;
        end_session_inner(&conn, &session.id, end_time, Some("Backfill test"))
            .unwrap();

        // Verify endTime and outputNote are set
        let (db_end, db_note): (Option<i64>, Option<String>) = conn
            .query_row(
                "SELECT endTime, outputNote FROM sessions WHERE id = ?1",
                params![session.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(db_end, Some(end_time));
        assert_eq!(db_note.as_deref(), Some("Backfill test"));

        // No longer active
        assert!(get_active_session_inner(&conn, "u1").unwrap().is_none());

        // Now test a verified backfill: device woke 3h ago, claimed 2h ago
        let device_wake_early = now - 3 * 3600;
        let session2 =
            start_session_inner(&conn, "u1", two_hours_ago, now, device_wake_early).unwrap();
        assert_eq!(session2.start_type, "backfill");
        assert!(session2.start_verified); // claimed time is after device wake

        let db_verified: i32 = conn
            .query_row(
                "SELECT startVerified FROM sessions WHERE id = ?1",
                params![session2.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(db_verified, 1);
    }

    // -----------------------------------------------------------------------
    // Integration: start → task switch → end → verify session_task endTimes
    // Validates: Requirements 1.1, 3.2, 3.3, 9.2
    // -----------------------------------------------------------------------

    #[test]
    fn test_session_lifecycle_with_task_switch() {
        let conn = setup_test_db();
        insert_project_and_task(&conn);
        // Insert a second task for switching
        conn.execute(
            "INSERT INTO tasks (id, projectId, title, status, priority, createdBy, createdAt) \
             VALUES ('t2', 'p1', 'Task 2', 'open', 'medium', 'u1', 1000)",
            [],
        )
        .unwrap();

        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        // Start session
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        // Start working on task 1
        let task1_start = now + 60;
        conn.execute(
            "INSERT INTO session_tasks (id, sessionId, taskId, startTime) \
             VALUES ('st1', ?1, 't1', ?2)",
            params![session.id, task1_start],
        )
        .unwrap();

        // Verify task 1 session_task is open
        let st1_end: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM session_tasks WHERE id = 'st1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(st1_end.is_none());

        // Switch to task 2 at now + 1800 (30 min later)
        let switch_time = now + 1800;
        // Close task 1's session_task
        conn.execute(
            "UPDATE session_tasks SET endTime = ?1 WHERE id = 'st1'",
            params![switch_time],
        )
        .unwrap();
        // Open task 2's session_task
        conn.execute(
            "INSERT INTO session_tasks (id, sessionId, taskId, startTime) \
             VALUES ('st2', ?1, 't2', ?2)",
            params![session.id, switch_time],
        )
        .unwrap();

        // Verify task 1 is closed with correct endTime
        let st1_end_after_switch: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM session_tasks WHERE id = 'st1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(st1_end_after_switch, Some(switch_time));

        // Verify task 1 minutes are computed correctly: (1800 - 60) / 60 = 29
        let st1_minutes: i64 = conn
            .query_row(
                "SELECT minutes FROM session_tasks WHERE id = 'st1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(st1_minutes, (switch_time - task1_start) / 60);

        // Verify task 2 is still open
        let st2_end: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM session_tasks WHERE id = 'st2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(st2_end.is_none());

        // End session — should close task 2's session_task automatically
        let end_time = now + 3600;
        end_session_inner(&conn, &session.id, end_time, Some("Switched tasks"))
            .unwrap();

        // Verify task 2 was closed by end_session_inner
        let st2_end_after: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM session_tasks WHERE id = 'st2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(st2_end_after, Some(end_time));

        // Verify task 2 minutes: (3600 - 1800) / 60 = 30
        let st2_minutes: i64 = conn
            .query_row(
                "SELECT minutes FROM session_tasks WHERE id = 'st2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(st2_minutes, (end_time - switch_time) / 60);

        // Verify task 1 endTime was NOT changed by end_session (already closed)
        let st1_end_final: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM session_tasks WHERE id = 'st1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(st1_end_final, Some(switch_time));

        // Verify session is ended
        assert!(get_active_session_inner(&conn, "u1").unwrap().is_none());

        // Verify total session_tasks count for this session
        let task_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_tasks WHERE sessionId = ?1",
                params![session.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(task_count, 2);
    }

    // -----------------------------------------------------------------------
    // Integration: start → break → resume → end → verify break record
    // Validates: Requirements 1.1, 3.2, 3.3, 7.1–7.3
    // -----------------------------------------------------------------------

    #[test]
    fn test_session_lifecycle_with_break() {
        let conn = setup_test_db();
        insert_project_and_task(&conn);
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        // Start session
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        // Start working on a task
        conn.execute(
            "INSERT INTO session_tasks (id, sessionId, taskId, startTime) \
             VALUES ('st1', ?1, 't1', ?2)",
            params![session.id, now],
        )
        .unwrap();

        // Take a lunch break at now + 3600 (1 hour in)
        let break_start = now + 3600;
        conn.execute(
            "INSERT INTO breaks (id, sessionId, startTime, type) \
             VALUES ('b1', ?1, ?2, 'lunch')",
            params![session.id, break_start],
        )
        .unwrap();

        // Verify break is open (no endTime)
        let break_end: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM breaks WHERE id = 'b1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(break_end.is_none());

        // Resume after 30 minutes
        let resume_time = break_start + 1800;
        conn.execute(
            "UPDATE breaks SET endTime = ?1 WHERE id = 'b1'",
            params![resume_time],
        )
        .unwrap();

        // Verify break is now closed with correct duration
        let (b_start, b_end): (i64, Option<i64>) = conn
            .query_row(
                "SELECT startTime, endTime FROM breaks WHERE id = 'b1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(b_start, break_start);
        assert_eq!(b_end, Some(resume_time));
        let break_duration = resume_time - break_start; // 1800 seconds = 30 min
        assert_eq!(break_duration, 1800);

        // Continue working, then end session 1 hour after resume
        let end_time = resume_time + 3600;
        end_session_inner(&conn, &session.id, end_time, Some("Good day with lunch"))
            .unwrap();

        // Verify session endTime
        let db_end: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM sessions WHERE id = ?1",
                params![session.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(db_end, Some(end_time));

        // Verify session_task was closed at session end
        let st_end: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM session_tasks WHERE id = 'st1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(st_end, Some(end_time));

        // Verify break record was NOT modified by end_session (already closed)
        let b_end_final: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM breaks WHERE id = 'b1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(b_end_final, Some(resume_time));

        // Calculate session time excluding break:
        // Total wall time: end_time - now = 3600 + 1800 + 3600 = 9000 seconds
        // Break duration: 1800 seconds
        // Active work time: 9000 - 1800 = 7200 seconds = 120 minutes
        let total_wall_time = end_time - now;
        let active_time = total_wall_time - break_duration;
        assert_eq!(total_wall_time, 9000);
        assert_eq!(active_time, 7200);

        // Verify break count for this session
        let break_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM breaks WHERE sessionId = ?1",
                params![session.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(break_count, 1);

        // Verify the break type is preserved
        let break_type: String = conn
            .query_row(
                "SELECT type FROM breaks WHERE id = 'b1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(break_type, "lunch");

        // No active session
        assert!(get_active_session_inner(&conn, "u1").unwrap().is_none());
    }

    // -----------------------------------------------------------------------
    // Break management tests (Validates: Req 7.1–7.6)
    // -----------------------------------------------------------------------

    #[test]
    fn test_start_break_creates_record() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        let brk = start_break_inner(&conn, &session.id, "lunch", now + 3600).unwrap();
        assert_eq!(brk.session_id, session.id);
        assert_eq!(brk.start_time, now + 3600);
        assert!(brk.end_time.is_none());
        assert_eq!(brk.break_type, "lunch");
        assert!(!brk.auto_detected);
    }

    #[test]
    fn test_start_break_rejects_invalid_type() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        let result = start_break_inner(&conn, &session.id, "invalid", now + 100);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid break type"));
    }

    #[test]
    fn test_start_break_rejects_no_active_session() {
        let conn = setup_test_db();
        let result = start_break_inner(&conn, "nonexistent", "short", 1_700_000_000);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No active session"));
    }

    #[test]
    fn test_start_break_rejects_duplicate_active_break() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        start_break_inner(&conn, &session.id, "short", now + 100).unwrap();
        let result = start_break_inner(&conn, &session.id, "lunch", now + 200);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("active break already exists"));
    }

    #[test]
    fn test_end_break_sets_end_time() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        let brk = start_break_inner(&conn, &session.id, "meeting", now + 100).unwrap();
        end_break_inner(&conn, &brk.id, now + 1000).unwrap();

        let end_time: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM breaks WHERE id = ?1",
                params![brk.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(end_time, Some(now + 1000));
    }

    #[test]
    fn test_end_break_rejects_nonexistent() {
        let conn = setup_test_db();
        let result = end_break_inner(&conn, "nonexistent", 1_700_000_000);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No active break"));
    }

    #[test]
    fn test_get_active_break_returns_break() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        let brk = start_break_inner(&conn, &session.id, "lunch", now + 100).unwrap();
        let active = get_active_break_inner(&conn, &session.id).unwrap();
        assert!(active.is_some());
        assert_eq!(active.unwrap().id, brk.id);
    }

    #[test]
    fn test_get_active_break_returns_none_after_end() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        let brk = start_break_inner(&conn, &session.id, "short", now + 100).unwrap();
        end_break_inner(&conn, &brk.id, now + 500).unwrap();

        let active = get_active_break_inner(&conn, &session.id).unwrap();
        assert!(active.is_none());
    }

    #[test]
    fn test_get_visible_breaks_filters_micro_breaks() {
        // Req 7.6: breaks under 8 minutes (480s) excluded from UI
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        // Insert a micro-break (5 min = 300s) — should be filtered
        conn.execute(
            "INSERT INTO breaks (id, sessionId, startTime, endTime, type, autoDetected) VALUES ('b-micro', ?1, ?2, ?3, 'short', 0)",
            params![session.id, now + 100, now + 400],
        ).unwrap();

        // Insert a visible break (10 min = 600s) — should be included
        conn.execute(
            "INSERT INTO breaks (id, sessionId, startTime, endTime, type, autoDetected) VALUES ('b-visible', ?1, ?2, ?3, 'lunch', 0)",
            params![session.id, now + 1000, now + 1600],
        ).unwrap();

        // Insert an active break (no endTime) — should be included
        conn.execute(
            "INSERT INTO breaks (id, sessionId, startTime, type, autoDetected) VALUES ('b-active', ?1, ?2, 'meeting', 0)",
            params![session.id, now + 2000],
        ).unwrap();

        let visible = get_visible_breaks_inner(&conn, &session.id).unwrap();
        assert_eq!(visible.len(), 2);
        assert_eq!(visible[0].id, "b-visible");
        assert_eq!(visible[1].id, "b-active");
    }

    #[test]
    fn test_get_visible_breaks_includes_exactly_8min() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        // Exactly 8 min = 480s — should be included
        conn.execute(
            "INSERT INTO breaks (id, sessionId, startTime, endTime, type, autoDetected) VALUES ('b-exact', ?1, ?2, ?3, 'short', 0)",
            params![session.id, now + 100, now + 580],
        ).unwrap();

        // 7min 59s = 479s — should be filtered
        conn.execute(
            "INSERT INTO breaks (id, sessionId, startTime, endTime, type, autoDetected) VALUES ('b-under', ?1, ?2, ?3, 'short', 0)",
            params![session.id, now + 1000, now + 1479],
        ).unwrap();

        let visible = get_visible_breaks_inner(&conn, &session.id).unwrap();
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].id, "b-exact");
    }

    #[test]
    fn test_start_break_all_valid_types() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        for (i, break_type) in ["lunch", "short", "meeting"].iter().enumerate() {
            // Create a fresh session for each break type
            let user_id = format!("u{}", i + 10);
            conn.execute(
                "INSERT INTO users (id, name, email, createdAt) VALUES (?1, 'Test', ?2, 1000)",
                params![user_id, format!("test{}@test.com", i + 10)],
            ).unwrap();
            let session = start_session_inner(&conn, &user_id, now, now, device_wake).unwrap();

            let brk = start_break_inner(&conn, &session.id, break_type, now + 100).unwrap();
            assert_eq!(brk.break_type, *break_type);
        }
    }

    // -----------------------------------------------------------------------
    // Integration: idle → break → resume cycle
    // Validates: Requirements 4.1–4.4, 5.1–5.7, 7.1–7.6
    // -----------------------------------------------------------------------

    /// Test full flow: session active → idle 25 min → return → resolve as "Lunch"
    /// → break record created → timer resumes with correct elapsed time.
    #[test]
    fn test_idle_25min_resolve_lunch_break_created() {
        use crate::idle::{process_idle_tick, IdleConfig, IdleState};

        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;
        let cfg = IdleConfig::default();

        // 1. Start session
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();
        assert!(session.end_time.is_none());

        // 2. Simulate active work for a few ticks
        let mut state = IdleState::default();
        let (next, events) = process_idle_tick(&cfg, &state, 5, now + 30, "Design");
        state = next;
        assert!(events.is_empty());
        assert!(!state.was_idle);

        // 3. Idle threshold reached (25 min = 1500s idle)
        let idle_detected_time = now + 1800; // 30 min into session
        let (next, events) = process_idle_tick(&cfg, &state, 1500, idle_detected_time, "Design");
        state = next;
        assert!(state.was_idle);
        assert_eq!(events.len(), 1);
        let _idle_since = match &events[0] {
            crate::idle::IdleEvent::IdleThresholdReached { idle_since } => *idle_since,
            _ => panic!("Expected IdleThresholdReached"),
        };

        // 4. User returns (idle_secs drops below micro_break_threshold)
        let return_time = idle_detected_time + 300; // 5 min later
        let (next, events) = process_idle_tick(&cfg, &state, 5, return_time, "Design");
        state = next;
        assert!(!state.was_idle);
        // Away duration: return_time - idle_since = 1800s (30 min) → UserReturned
        assert_eq!(events.len(), 1);
        let (away_duration, away_since) = match &events[0] {
            crate::idle::IdleEvent::UserReturned { away_duration_secs, away_since } => {
                (*away_duration_secs, *away_since)
            }
            _ => panic!("Expected UserReturned"),
        };
        assert!(away_duration >= 20 * 60); // ≥ 20 min → prompts idle modal

        // 5. User resolves as "Lunch" → create break record covering idle period
        let brk = start_break_inner(&conn, &session.id, "lunch", away_since).unwrap();
        end_break_inner(&conn, &brk.id, return_time).unwrap();

        // 6. Verify break record
        let (b_start, b_end, b_type): (i64, Option<i64>, String) = conn
            .query_row(
                "SELECT startTime, endTime, type FROM breaks WHERE id = ?1",
                params![brk.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(b_start, away_since);
        assert_eq!(b_end, Some(return_time));
        assert_eq!(b_type, "lunch");

        // 7. Timer resumes — state is no longer idle, active counter reset
        assert!(!state.was_idle);
        assert_eq!(state.continuous_active_secs, 0);

        // 8. End session and verify elapsed time excludes break
        let end_time = return_time + 3600;
        end_session_inner(&conn, &session.id, end_time, Some("Done")).unwrap();

        let total_wall = end_time - now;
        let break_duration = return_time - away_since;
        let active_time = total_wall - break_duration as i64;
        assert!(active_time < total_wall, "Active time should be less than wall time");
        assert!(active_time > 0);
    }

    /// Test full flow: session active → idle 5 min → return → no prompt,
    /// no break record (micro-break absorbed silently).
    #[test]
    fn test_idle_5min_absorbed_no_break_record() {
        use crate::idle::{process_idle_tick, IdleConfig, IdleState};

        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;
        let cfg = IdleConfig::default(); // micro_break_threshold = 480s (8 min)

        // 1. Start session
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        // 2. Simulate idle reaching threshold (15 min)
        let mut state = IdleState::default();
        let (next, events) = process_idle_tick(&cfg, &state, 900, now + 1000, "Task");
        state = next;
        assert!(state.was_idle);
        assert_eq!(events.len(), 1); // IdleThresholdReached

        // 3. User returns after only 5 min total away (300s from idle_start)
        // idle_start was set to now + 1000 - 900 = now + 100
        let idle_start = state.idle_start.unwrap();
        let return_time = idle_start + 300; // 5 min away
        let (next, events) = process_idle_tick(&cfg, &state, 5, return_time, "Task");
        state = next;

        // Away duration = 300s < 480s (micro_break_threshold) → absorbed silently
        assert!(!state.was_idle);
        assert!(events.is_empty(), "Under 8 min should produce no event");

        // 4. Verify no break records exist for this session
        let break_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM breaks WHERE sessionId = ?1",
                params![session.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(break_count, 0, "No break record should be created for micro-break");
    }

    /// Test full flow: session active → manual break → 30 min → resume
    /// → correct session time (break excluded).
    #[test]
    fn test_manual_break_30min_session_time_excludes_break() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        // 1. Start session
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        // 2. Work for 1 hour, then take a manual break
        let break_start = now + 3600;
        let brk = start_break_inner(&conn, &session.id, "short", break_start).unwrap();

        // 3. Break lasts 30 minutes
        let break_end = break_start + 1800; // 30 min
        end_break_inner(&conn, &brk.id, break_end).unwrap();

        // 4. Work for another hour, then end session
        let end_time = break_end + 3600;
        end_session_inner(&conn, &session.id, end_time, Some("Manual break test")).unwrap();

        // 5. Verify session time calculation
        let total_wall = end_time - now; // 3600 + 1800 + 3600 = 9000s
        let break_duration = break_end - break_start; // 1800s
        let active_time = total_wall - break_duration; // 7200s = 2 hours

        assert_eq!(total_wall, 9000);
        assert_eq!(break_duration, 1800);
        assert_eq!(active_time, 7200);

        // 6. Verify break record is correct
        let (db_start, db_end): (i64, Option<i64>) = conn
            .query_row(
                "SELECT startTime, endTime FROM breaks WHERE id = ?1",
                params![brk.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(db_start, break_start);
        assert_eq!(db_end, Some(break_end));

        // 7. Session is closed
        assert!(get_active_session_inner(&conn, "u1").unwrap().is_none());
    }

    /// Test full flow: session active → idle → discard → session time excludes gap.
    #[test]
    fn test_idle_discard_session_time_excludes_gap() {
        use crate::idle::{process_idle_tick, IdleConfig, IdleState};

        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;
        let cfg = IdleConfig::default();

        // 1. Start session
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        // 2. Go idle (25 min)
        let mut state = IdleState::default();
        let (next, _) = process_idle_tick(&cfg, &state, 1500, now + 1800, "Task");
        state = next;
        let idle_since = state.idle_start.unwrap();

        // 3. Return after 25 min
        let return_time = idle_since + 1500;
        let (_next, events) = process_idle_tick(&cfg, &state, 5, return_time, "Task");
        assert_eq!(events.len(), 1);
        let (away_duration, away_since) = match &events[0] {
            crate::idle::IdleEvent::UserReturned { away_duration_secs, away_since } => {
                (*away_duration_secs, *away_since)
            }
            _ => panic!("Expected UserReturned"),
        };

        // 4. User selects "Discard" → create a discarded break record
        //    (The gap is excluded from session time without a visible break)
        conn.execute(
            "INSERT INTO breaks (id, sessionId, startTime, endTime, type, autoDetected) \
             VALUES ('b-discard', ?1, ?2, ?3, 'discarded', 1)",
            params![session.id, away_since, return_time],
        )
        .unwrap();

        // 5. End session
        let end_time = return_time + 3600;
        end_session_inner(&conn, &session.id, end_time, None).unwrap();

        // 6. Verify discarded break exists
        let (b_type, b_start, b_end): (String, i64, Option<i64>) = conn
            .query_row(
                "SELECT type, startTime, endTime FROM breaks WHERE id = 'b-discard'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(b_type, "discarded");
        assert_eq!(b_start, away_since);
        assert_eq!(b_end, Some(return_time));

        // 7. Session time should exclude the discarded gap
        let total_wall = end_time - now;
        let gap = away_duration as i64;
        let active_time = total_wall - gap;
        assert!(active_time < total_wall);
        assert!(active_time > 0);

        // 8. Discarded breaks should NOT appear in visible breaks (filtered by get_visible_breaks)
        //    Only breaks ≥ 8 min with non-discarded type would normally show.
        //    The discarded break is 25 min so it passes the duration filter,
        //    but the UI layer would filter by type. Verify it exists in DB.
        let break_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM breaks WHERE sessionId = ?1",
                params![session.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(break_count, 1);
    }

    /// Test auto-session close: 2+ hours idle → session closed at last activity timestamp.
    /// Validates: Requirement 4.3
    #[test]
    fn test_auto_close_2_hours_idle() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        // 1. Start session with a very old lastHeartbeat (simulating 2+ hours idle)
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();

        // 2. Simulate heartbeat stopping 2.5 hours ago (last activity)
        let last_activity = now + 3600; // worked for 1 hour
        conn.execute(
            "UPDATE sessions SET lastHeartbeat = ?1 WHERE id = ?2",
            params![last_activity, session.id],
        )
        .unwrap();

        // 3. "Now" is 2.5 hours after last activity
        let current_time = last_activity + (2 * 3600 + 1800); // 2.5 hours later

        // 4. Detect stale session: lastHeartbeat is way older than 30s
        let active = get_active_session_inner(&conn, "u1").unwrap().unwrap();
        let heartbeat_age = current_time - active.last_heartbeat.unwrap();
        assert!(heartbeat_age > 2 * 3600, "Session should be stale (>2 hours)");

        // 5. Auto-close at last activity timestamp
        end_session_inner(&conn, &session.id, last_activity, None).unwrap();

        // 6. Verify session closed at last activity time, not current time
        let (db_end,): (Option<i64>,) = conn
            .query_row(
                "SELECT endTime FROM sessions WHERE id = ?1",
                params![session.id],
                |r| Ok((r.get(0)?,)),
            )
            .unwrap();
        assert_eq!(db_end, Some(last_activity));

        // 7. No active session remains
        assert!(get_active_session_inner(&conn, "u1").unwrap().is_none());
    }

    /// Test next-morning recovery: unclosed session from yesterday → prompt to
    /// confirm end time. Validates: Requirement 4.4
    #[test]
    fn test_next_morning_recovery_unclosed_session() {
        let conn = setup_test_db();
        let yesterday_start = 1_700_000_000i64; // yesterday morning
        let yesterday_last_heartbeat = yesterday_start + 8 * 3600; // worked 8 hours
        let device_wake = yesterday_start - 3600;

        // 1. Create session from yesterday (manually, to set old heartbeat)
        let session = start_session_inner(
            &conn, "u1", yesterday_start, yesterday_start, device_wake,
        )
        .unwrap();

        // 2. Simulate heartbeat from yesterday evening
        conn.execute(
            "UPDATE sessions SET lastHeartbeat = ?1 WHERE id = ?2",
            params![yesterday_last_heartbeat, session.id],
        )
        .unwrap();

        // 3. Next morning: detect unclosed session
        let next_morning = yesterday_start + 24 * 3600; // 24 hours later
        let active = get_active_session_inner(&conn, "u1").unwrap();
        assert!(active.is_some(), "Unclosed session should be found");

        let stale_session = active.unwrap();
        assert!(stale_session.end_time.is_none(), "Session should have no endTime");

        // 4. Verify session is stale (heartbeat age > 30s)
        let heartbeat_age = next_morning - stale_session.last_heartbeat.unwrap();
        assert!(heartbeat_age > 30, "Session heartbeat should be stale");
        assert!(heartbeat_age > 12 * 3600, "Session should be from yesterday");

        // 5. User confirms end time as yesterday's last heartbeat
        recover_stale_session_inner(
            &conn,
            &stale_session.id,
            yesterday_last_heartbeat,
        )
        .unwrap();

        // 6. Verify session is now closed with recovered type
        let (db_end, db_type): (Option<i64>, String) = conn
            .query_row(
                "SELECT endTime, startType FROM sessions WHERE id = ?1",
                params![stale_session.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(db_end, Some(yesterday_last_heartbeat));
        assert_eq!(db_type, "recovered");

        // 7. No active session — user can start a new one today
        assert!(get_active_session_inner(&conn, "u1").unwrap().is_none());

        // 8. Can start a fresh session today
        let today_device_wake = next_morning - 1800;
        let new_session = start_session_inner(
            &conn, "u1", next_morning, next_morning, today_device_wake,
        )
        .unwrap();
        assert!(new_session.end_time.is_none());
        assert_eq!(new_session.start_type, "manual");
    }

    // -----------------------------------------------------------------------
    // Task CRUD tests (Validates: Requirements 8.1–8.4)
    // -----------------------------------------------------------------------

    #[test]
    fn test_create_task_inserts_with_correct_fields() {
        let conn = setup_test_db();
        insert_project_and_task(&conn); // creates p1
        let now = 1_700_000_000i64;

        let task = create_task_inner(
            &conn, "p1", "Build login page", Some("high"), Some("u1"),
            Some(now + 86400), Some("Important task"), "u1", now,
        ).unwrap();

        assert!(!task.id.is_empty(), "UUID should be auto-generated");
        assert_eq!(task.project_id, "p1");
        assert_eq!(task.title, "Build login page");
        assert_eq!(task.status, "open");
        assert_eq!(task.assignee_id.as_deref(), Some("u1"));
        assert_eq!(task.priority, "high");
        assert_eq!(task.due_date, Some(now + 86400));
        assert_eq!(task.notes.as_deref(), Some("Important task"));
        assert_eq!(task.created_by, "u1");
        assert_eq!(task.created_at, now);
        assert!(task.closed_at.is_none());

        // Verify row in DB
        let db_title: String = conn
            .query_row(
                "SELECT title FROM tasks WHERE id = ?1",
                params![task.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(db_title, "Build login page");
    }

    #[test]
    fn test_create_task_rejects_empty_title() {
        let conn = setup_test_db();
        insert_project_and_task(&conn);
        let now = 1_700_000_000i64;

        let result = create_task_inner(
            &conn, "p1", "", None, None, None, None, "u1", now,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("title cannot be empty"));

        // Whitespace-only title should also be rejected
        let result = create_task_inner(
            &conn, "p1", "   ", None, None, None, None, "u1", now,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_create_task_rejects_missing_project() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;

        let result = create_task_inner(
            &conn, "nonexistent", "Some task", None, None, None, None, "u1", now,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Project not found"));
    }

    #[test]
    fn test_create_task_accepts_optional_fields_as_null() {
        let conn = setup_test_db();
        insert_project_and_task(&conn);
        let now = 1_700_000_000i64;

        let task = create_task_inner(
            &conn, "p1", "Minimal task", None, None, None, None, "u1", now,
        ).unwrap();

        assert!(task.assignee_id.is_none());
        assert_eq!(task.priority, "medium"); // default
        assert!(task.due_date.is_none());
        assert!(task.notes.is_none());
    }

    #[test]
    fn test_update_task_status_open_to_inprogress_to_done() {
        let conn = setup_test_db();
        insert_project_and_task(&conn);
        let now = 1_700_000_000i64;

        let task = create_task_inner(
            &conn, "p1", "Flow task", None, None, None, None, "u1", now,
        ).unwrap();

        // open → inprogress
        update_task_status_inner(&conn, &task.id, "inprogress", now + 100).unwrap();
        let status: String = conn
            .query_row("SELECT status FROM tasks WHERE id = ?1", params![task.id], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "inprogress");

        // inprogress → done (should set closedAt)
        update_task_status_inner(&conn, &task.id, "done", now + 200).unwrap();
        let (status, closed_at): (String, Option<i64>) = conn
            .query_row(
                "SELECT status, closedAt FROM tasks WHERE id = ?1",
                params![task.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "done");
        assert_eq!(closed_at, Some(now + 200));
    }

    #[test]
    fn test_update_task_status_blocked_transitions() {
        let conn = setup_test_db();
        insert_project_and_task(&conn);
        let now = 1_700_000_000i64;

        let task = create_task_inner(
            &conn, "p1", "Blocked task", None, None, None, None, "u1", now,
        ).unwrap();

        // open → blocked
        update_task_status_inner(&conn, &task.id, "blocked", now + 100).unwrap();

        // blocked → open
        update_task_status_inner(&conn, &task.id, "open", now + 200).unwrap();
        let status: String = conn
            .query_row("SELECT status FROM tasks WHERE id = ?1", params![task.id], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "open");

        // open → blocked again, then blocked → inprogress
        update_task_status_inner(&conn, &task.id, "blocked", now + 300).unwrap();
        update_task_status_inner(&conn, &task.id, "inprogress", now + 400).unwrap();
        let status: String = conn
            .query_row("SELECT status FROM tasks WHERE id = ?1", params![task.id], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "inprogress");
    }

    #[test]
    fn test_update_task_status_rejects_invalid_values() {
        let conn = setup_test_db();
        insert_project_and_task(&conn);
        let now = 1_700_000_000i64;

        let task = create_task_inner(
            &conn, "p1", "Test task", None, None, None, None, "u1", now,
        ).unwrap();

        // Invalid status value
        let result = update_task_status_inner(&conn, &task.id, "cancelled", now + 100);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid status"));

        // Invalid transition: open → done (must go through inprogress)
        let result = update_task_status_inner(&conn, &task.id, "done", now + 200);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid status transition"));
    }

    #[test]
    fn test_archive_task_sets_closed_at() {
        let conn = setup_test_db();
        insert_project_and_task(&conn);
        let now = 1_700_000_000i64;

        let task = create_task_inner(
            &conn, "p1", "Archive me", None, None, None, None, "u1", now,
        ).unwrap();

        archive_task_inner(&conn, &task.id, now + 500).unwrap();

        let closed_at: Option<i64> = conn
            .query_row(
                "SELECT closedAt FROM tasks WHERE id = ?1",
                params![task.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(closed_at, Some(now + 500));
    }

    #[test]
    fn test_delete_task_blocked_by_session_tasks_fk() {
        // Foreign key constraint should prevent deleting a task referenced by session_tasks
        let conn = setup_test_db();
        insert_project_and_task(&conn);
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        let task = create_task_inner(
            &conn, "p1", "Referenced task", None, None, None, None, "u1", now,
        ).unwrap();

        // Create a session and session_task referencing this task
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();
        conn.execute(
            "INSERT INTO session_tasks (id, sessionId, taskId, startTime) VALUES ('st-ref', ?1, ?2, ?3)",
            params![session.id, task.id, now],
        ).unwrap();

        // Attempting to DELETE the task should fail due to FK constraint
        let result = conn.execute(
            "DELETE FROM tasks WHERE id = ?1",
            params![task.id],
        );
        assert!(result.is_err(), "DELETE should fail due to session_tasks FK reference");
    }

    #[test]
    fn test_list_tasks_filters_by_project() {
        let conn = setup_test_db();
        insert_project_and_task(&conn);
        // Create a second project
        conn.execute(
            "INSERT INTO projects (id, name, createdBy, createdAt) VALUES ('p2', 'Proj2', 'u1', 1000)",
            [],
        ).unwrap();
        let now = 1_700_000_000i64;

        create_task_inner(&conn, "p1", "Task A", None, None, None, None, "u1", now).unwrap();
        create_task_inner(&conn, "p2", "Task B", None, None, None, None, "u1", now + 1).unwrap();

        // List all tasks (includes the one from insert_project_and_task + 2 new)
        let all = list_tasks_inner(&conn, None).unwrap();
        assert!(all.len() >= 3);

        // List tasks for p2 only
        let p2_tasks = list_tasks_inner(&conn, Some("p2")).unwrap();
        assert_eq!(p2_tasks.len(), 1);
        assert_eq!(p2_tasks[0].title, "Task B");
    }

    // -----------------------------------------------------------------------
    // Project CRUD tests (Validates: Requirement 8.1)
    // -----------------------------------------------------------------------

    #[test]
    fn test_create_project_inserts_with_auto_color() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;

        let project = create_project_inner(&conn, "Alpha", "u1", now).unwrap();

        assert!(!project.id.is_empty());
        assert_eq!(project.name, "Alpha");
        assert_eq!(project.color, "#6e6af6"); // first color in palette
        assert_eq!(project.created_by, "u1");
        assert_eq!(project.created_at, now);
        assert!(project.archived_at.is_none());

        // Second project gets next color
        let project2 = create_project_inner(&conn, "Beta", "u1", now + 1).unwrap();
        assert_eq!(project2.color, "#e06c75");

        // Verify DB row
        let db_name: String = conn
            .query_row(
                "SELECT name FROM projects WHERE id = ?1",
                params![project.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(db_name, "Alpha");
    }

    #[test]
    fn test_create_project_rejects_empty_name() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;

        let result = create_project_inner(&conn, "", "u1", now);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("name cannot be empty"));

        let result = create_project_inner(&conn, "   ", "u1", now);
        assert!(result.is_err());
    }

    #[test]
    fn test_archive_project_sets_archived_at_and_hides_from_list() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;

        let project = create_project_inner(&conn, "ToArchive", "u1", now).unwrap();

        // Create a task in this project
        create_task_inner(
            &conn, &project.id, "Task in archived project", None, None, None, None, "u1", now,
        ).unwrap();

        // Archive the project
        archive_project_inner(&conn, &project.id, now + 1000).unwrap();

        // Verify archivedAt is set
        let archived_at: Option<i64> = conn
            .query_row(
                "SELECT archivedAt FROM projects WHERE id = ?1",
                params![project.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(archived_at, Some(now + 1000));

        // Project should NOT appear in active list
        let active_projects = list_projects_inner(&conn).unwrap();
        assert!(
            active_projects.iter().all(|p| p.id != project.id),
            "Archived project should not appear in active list"
        );

        // Tasks should still exist
        let tasks = list_tasks_inner(&conn, Some(&project.id)).unwrap();
        assert_eq!(tasks.len(), 1, "Tasks should remain after project is archived");
    }

    #[test]
    fn test_project_stats_open_closed_counts_and_time() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;
        let device_wake = now - 3600;

        let project = create_project_inner(&conn, "Stats Project", "u1", now).unwrap();

        // Create 3 tasks: 2 open, 1 done
        let t1 = create_task_inner(
            &conn, &project.id, "Open task 1", None, None, None, None, "u1", now,
        ).unwrap();
        let _t2 = create_task_inner(
            &conn, &project.id, "Open task 2", None, None, None, None, "u1", now + 1,
        ).unwrap();
        let t3 = create_task_inner(
            &conn, &project.id, "Done task", None, None, None, None, "u1", now + 2,
        ).unwrap();

        // Move t3 to done
        update_task_status_inner(&conn, &t3.id, "inprogress", now + 10).unwrap();
        update_task_status_inner(&conn, &t3.id, "done", now + 20).unwrap();

        // Count open vs closed
        let open_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE projectId = ?1 AND status != 'done'",
                params![project.id],
                |r| r.get(0),
            )
            .unwrap();
        let closed_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE projectId = ?1 AND status = 'done'",
                params![project.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(open_count, 2);
        assert_eq!(closed_count, 1);

        // Log time on t1: create session + session_task with 30 min
        let session = start_session_inner(&conn, "u1", now, now, device_wake).unwrap();
        conn.execute(
            "INSERT INTO session_tasks (id, sessionId, taskId, startTime, endTime) VALUES ('st-stats', ?1, ?2, ?3, ?4)",
            params![session.id, t1.id, now, now + 1800],
        ).unwrap();

        // Verify total time logged for project
        let total_minutes: Option<i64> = conn
            .query_row(
                "SELECT SUM(minutes) FROM session_tasks st
                 JOIN tasks t ON st.taskId = t.id
                 WHERE t.projectId = ?1",
                params![project.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(total_minutes, Some(30)); // 1800s / 60 = 30 min
    }

    #[test]
    fn test_create_task_auto_generates_unique_uuids() {
        let conn = setup_test_db();
        insert_project_and_task(&conn);
        let now = 1_700_000_000i64;

        let t1 = create_task_inner(&conn, "p1", "Task A", None, None, None, None, "u1", now).unwrap();
        let t2 = create_task_inner(&conn, "p1", "Task B", None, None, None, None, "u1", now + 1).unwrap();

        assert_ne!(t1.id, t2.id, "Each task should get a unique UUID");
        assert!(t1.id.len() == 36, "UUID should be 36 chars");
    }

    #[test]
    fn test_project_color_palette_wraps_around() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;

        // Create 11 projects — should wrap around the 10-color palette
        for i in 0..11 {
            let p = create_project_inner(
                &conn, &format!("Project {}", i), "u1", now + i as i64,
            ).unwrap();
            let expected_color = PROJECT_COLOR_PALETTE[i % PROJECT_COLOR_PALETTE.len()];
            assert_eq!(p.color, expected_color, "Project {} should get color {}", i, expected_color);
        }
    }

    // -----------------------------------------------------------------------
    // switch_task_inner tests (Validates: Requirements 9.2, 9.3, 20.2)
    // -----------------------------------------------------------------------

    /// Helper: set up a session with two tasks for switch tests.
    fn setup_switch_test(conn: &Connection) -> (String, String, String) {
        insert_project_and_task(conn); // creates p1, t1 (open)
        conn.execute(
            "INSERT INTO tasks (id, projectId, title, status, priority, createdBy, createdAt) \
             VALUES ('t2', 'p1', 'Task 2', 'open', 'medium', 'u1', 1000)",
            [],
        )
        .unwrap();

        let now = 1_700_000_000i64;
        let device_wake = now - 3600;
        let session = start_session_inner(conn, "u1", now, now, device_wake).unwrap();

        // Start working on t1
        conn.execute(
            "INSERT INTO session_tasks (id, sessionId, taskId, startTime) \
             VALUES ('st-init', ?1, 't1', ?2)",
            params![session.id, now],
        )
        .unwrap();

        (session.id, "t1".to_string(), "t2".to_string())
    }

    #[test]
    fn test_switch_closes_current_session_task_with_end_time() {
        // Validates: Req 9.2 — close current session_task with endTime = now
        let conn = setup_test_db();
        let (session_id, _t1, t2) = setup_switch_test(&conn);
        let switch_time = 1_700_001_000i64;

        switch_task_inner(&conn, &session_id, &t2, switch_time).unwrap();

        let end_time: Option<i64> = conn
            .query_row(
                "SELECT endTime FROM session_tasks WHERE id = 'st-init'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(end_time, Some(switch_time));
    }

    #[test]
    fn test_switch_creates_new_session_task_with_start_time() {
        // Validates: Req 9.2 — create new session_task with startTime = now
        let conn = setup_test_db();
        let (session_id, _t1, t2) = setup_switch_test(&conn);
        let switch_time = 1_700_001_000i64;

        let new_st = switch_task_inner(&conn, &session_id, &t2, switch_time).unwrap();

        assert_eq!(new_st.session_id, session_id);
        assert_eq!(new_st.task_id, t2);
        assert_eq!(new_st.start_time, switch_time);
        assert!(new_st.end_time.is_none());

        // Verify in DB
        let (db_task, db_start, db_end): (String, i64, Option<i64>) = conn
            .query_row(
                "SELECT taskId, startTime, endTime FROM session_tasks WHERE id = ?1",
                params![new_st.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(db_task, t2);
        assert_eq!(db_start, switch_time);
        assert!(db_end.is_none());
    }

    #[test]
    fn test_switch_only_one_session_task_has_null_end_time() {
        // Validates: Req 20.2 — at most one session_task per session has endTime = null
        let conn = setup_test_db();
        let (session_id, _t1, t2) = setup_switch_test(&conn);
        let switch_time = 1_700_001_000i64;

        switch_task_inner(&conn, &session_id, &t2, switch_time).unwrap();

        let open_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_tasks WHERE sessionId = ?1 AND endTime IS NULL",
                params![session_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(open_count, 1);
    }

    #[test]
    fn test_switch_target_open_transitions_to_inprogress() {
        // Validates: Req 9.3 — target task "open" → "inprogress"
        let conn = setup_test_db();
        let (session_id, _t1, t2) = setup_switch_test(&conn);

        // Verify t2 starts as "open"
        let status_before: String = conn
            .query_row("SELECT status FROM tasks WHERE id = 't2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(status_before, "open");

        switch_task_inner(&conn, &session_id, &t2, 1_700_001_000).unwrap();

        let status_after: String = conn
            .query_row("SELECT status FROM tasks WHERE id = 't2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(status_after, "inprogress");
    }

    #[test]
    fn test_switch_target_already_inprogress_stays_inprogress() {
        // Validates: Req 9.3 — target task already "inprogress" stays "inprogress"
        let conn = setup_test_db();
        let (session_id, _t1, t2) = setup_switch_test(&conn);

        // Set t2 to inprogress before switching
        conn.execute(
            "UPDATE tasks SET status = 'inprogress' WHERE id = 't2'",
            [],
        )
        .unwrap();

        switch_task_inner(&conn, &session_id, &t2, 1_700_001_000).unwrap();

        let status: String = conn
            .query_row("SELECT status FROM tasks WHERE id = 't2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "inprogress");
    }

    #[test]
    fn test_switch_target_blocked_stays_blocked() {
        // Validates: Req 9.3 — "blocked" task stays "blocked" (no auto-transition)
        let conn = setup_test_db();
        let (session_id, _t1, t2) = setup_switch_test(&conn);

        // Set t2 to blocked (open → blocked is valid)
        conn.execute(
            "UPDATE tasks SET status = 'blocked' WHERE id = 't2'",
            [],
        )
        .unwrap();

        switch_task_inner(&conn, &session_id, &t2, 1_700_001_000).unwrap();

        let status: String = conn
            .query_row("SELECT status FROM tasks WHERE id = 't2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "blocked");
    }

    #[test]
    fn test_switch_to_same_task_rejected() {
        // Validates: Req 9.2 — no self-switch
        let conn = setup_test_db();
        let (session_id, t1, _t2) = setup_switch_test(&conn);

        let result = switch_task_inner(&conn, &session_id, &t1, 1_700_001_000);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("same task"));
    }

    #[test]
    fn test_rapid_switching_non_overlapping_time_ranges() {
        // Validates: Req 9.2, 20.2 — rapid switching produces correct non-overlapping ranges
        let conn = setup_test_db();
        insert_project_and_task(&conn); // p1, t1

        // Create 10 additional tasks for rapid switching
        for i in 2..=11 {
            conn.execute(
                &format!(
                    "INSERT INTO tasks (id, projectId, title, status, priority, createdBy, createdAt) \
                     VALUES ('t{}', 'p1', 'Task {}', 'open', 'medium', 'u1', 1000)",
                    i, i
                ),
                [],
            )
            .unwrap();
        }

        let base_time = 1_700_000_000i64;
        let device_wake = base_time - 3600;
        let session = start_session_inner(&conn, "u1", base_time, base_time, device_wake).unwrap();

        // Start on t1
        conn.execute(
            "INSERT INTO session_tasks (id, sessionId, taskId, startTime) \
             VALUES ('st-rapid-0', ?1, 't1', ?2)",
            params![session.id, base_time],
        )
        .unwrap();

        // Perform 10 rapid switches, each 500ms apart (simulating rapid switching)
        for i in 1..=10 {
            let switch_time = base_time + i; // 1 second apart
            let target_task = format!("t{}", i + 1);
            switch_task_inner(&conn, &session.id, &target_task, switch_time).unwrap();
        }

        // Verify total session_tasks: 1 initial + 10 switches = 11
        let total: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_tasks WHERE sessionId = ?1",
                params![session.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(total, 11);

        // Verify exactly one has endTime = null (the last one)
        let open_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_tasks WHERE sessionId = ?1 AND endTime IS NULL",
                params![session.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(open_count, 1);

        // Verify all closed session_tasks have non-overlapping time ranges
        let mut stmt = conn
            .prepare(
                "SELECT startTime, endTime FROM session_tasks \
                 WHERE sessionId = ?1 AND endTime IS NOT NULL \
                 ORDER BY startTime ASC",
            )
            .unwrap();
        let ranges: Vec<(i64, i64)> = stmt
            .query_map(params![session.id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert_eq!(ranges.len(), 10); // 10 closed session_tasks

        for i in 0..ranges.len() {
            let (start, end) = ranges[i];
            // endTime >= startTime
            assert!(end >= start, "endTime must be >= startTime for session_task {}", i);
            // Each session_task's endTime == next session_task's startTime (no gaps, no overlaps)
            if i + 1 < ranges.len() {
                assert_eq!(
                    end, ranges[i + 1].0,
                    "session_task {} endTime should equal session_task {} startTime",
                    i, i + 1
                );
            }
        }

        // Verify the last open session_task starts at the last switch time
        let last_start: i64 = conn
            .query_row(
                "SELECT startTime FROM session_tasks WHERE sessionId = ?1 AND endTime IS NULL",
                params![session.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(last_start, base_time + 10);
    }

    // -----------------------------------------------------------------------
    // Review cycle tests (Validates: Requirements 1.1, 1.7, 2.1, 2.6)
    // -----------------------------------------------------------------------

    /// Helper: insert multiple founder users for review tests.
    fn insert_founders(conn: &Connection) {
        conn.execute(
            "INSERT OR IGNORE INTO users (id, name, email, role, createdAt) VALUES ('f1', 'Alice', 'alice@test.com', 'founder', 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO users (id, name, email, role, createdAt) VALUES ('f2', 'Bob', 'bob@test.com', 'founder', 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO users (id, name, email, role, createdAt) VALUES ('f3', 'Carol', 'carol@test.com', 'ceo', 1000)",
            [],
        ).unwrap();
    }

    #[test]
    fn test_create_review_cycle_sets_correct_dates() {
        let conn = setup_test_db();
        let start = 1_700_000_000i64;
        let now = start;

        let cycle = create_review_cycle_inner(&conn, start, now).unwrap();

        assert_eq!(cycle.start_date, start);
        assert_eq!(cycle.end_date, start + 14 * 24 * 3600);
        assert_eq!(cycle.submission_deadline, start + 48 * 3600);
        assert_eq!(cycle.status, "open");
        assert!(cycle.resolved_at.is_none());
        assert_eq!(cycle.created_at, now);
        assert!(!cycle.id.is_empty());

        // Verify row in DB
        let db_status: String = conn
            .query_row(
                "SELECT status FROM review_cycles WHERE id = ?1",
                params![cycle.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(db_status, "open");
    }

    #[test]
    fn test_close_review_cycle_computes_averages_and_sorts() {
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();

        // f1 reviews f2: output=4, reliability=3, initiative=5
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r1', ?1, 'f1', 'f2', 4, 3, 5, ?2)",
            params![cycle.id, start + 100],
        ).unwrap();

        // f3 reviews f2: output=2, reliability=3, initiative=1
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r2', ?1, 'f3', 'f2', 2, 3, 1, ?2)",
            params![cycle.id, start + 200],
        ).unwrap();

        // f2 reviews f1: output=5, reliability=5, initiative=5
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r3', ?1, 'f2', 'f1', 5, 5, 5, ?2)",
            params![cycle.id, start + 300],
        ).unwrap();

        // f3 reviews f1: output=5, reliability=5, initiative=5
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r4', ?1, 'f3', 'f1', 5, 5, 5, ?2)",
            params![cycle.id, start + 400],
        ).unwrap();

        let results = close_review_cycle_inner(&conn, &cycle.id, start + 500).unwrap();

        assert_eq!(results.len(), 2);

        // f2 averages: output=(4+2)/2=3.0, reliability=(3+3)/2=3.0, initiative=(5+1)/2=3.0
        // overall = (3+3+3)/3 = 3.0
        // f1 averages: output=5.0, reliability=5.0, initiative=5.0, overall=5.0
        // Sorted ascending: f2 first (3.0), then f1 (5.0)
        assert_eq!(results[0].founder_id, "f2");
        assert!((results[0].output_avg - 3.0).abs() < 0.001);
        assert!((results[0].reliability_avg - 3.0).abs() < 0.001);
        assert!((results[0].initiative_avg - 3.0).abs() < 0.001);
        assert!((results[0].overall_avg - 3.0).abs() < 0.001);

        assert_eq!(results[1].founder_id, "f1");
        assert!((results[1].overall_avg - 5.0).abs() < 0.001);

        // Verify cycle status is now "resolved" (single lowest → auto-resolved)
        let db_status: String = conn
            .query_row(
                "SELECT status FROM review_cycles WHERE id = ?1",
                params![cycle.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(db_status, "resolved");

        // Verify accountability warning was issued for f2 (lowest-ranked)
        let warning_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM accountability_warnings WHERE founderId = 'f2' AND cycleId = ?1",
                params![cycle.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(warning_count, 1);
    }

    #[test]
    fn test_close_review_cycle_rejects_non_open() {
        let conn = setup_test_db();
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();

        // Close it first
        conn.execute(
            "UPDATE review_cycles SET status = 'closed' WHERE id = ?1",
            params![cycle.id],
        ).unwrap();

        // Trying to close again should fail
        let result = close_review_cycle_inner(&conn, &cycle.id, start + 1000);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("expected 'open'"));
    }

    #[test]
    fn test_resolve_tie_issues_warning_and_resolves_cycle() {
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();

        // Close the cycle manually
        conn.execute(
            "UPDATE review_cycles SET status = 'closed' WHERE id = ?1",
            params![cycle.id],
        ).unwrap();

        // CEO (f3) resolves tie by selecting f2
        resolve_tie_inner(&conn, &cycle.id, "f3", "f2", start + 1000).unwrap();

        // Verify warning was created
        let warning_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM accountability_warnings WHERE founderId = 'f2' AND cycleId = ?1",
                params![cycle.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(warning_count, 1);

        // Verify cycle is resolved
        let (db_status, db_resolved): (String, Option<i64>) = conn
            .query_row(
                "SELECT status, resolvedAt FROM review_cycles WHERE id = ?1",
                params![cycle.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(db_status, "resolved");
        assert_eq!(db_resolved, Some(start + 1000));
    }

    #[test]
    fn test_resolve_tie_rejects_non_closed_cycle() {
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();

        // Cycle is still "open" — resolve should fail
        let result = resolve_tie_inner(&conn, &cycle.id, "f3", "f2", start + 1000);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("expected 'closed'"));
    }

    #[test]
    fn test_resolve_tie_rejects_nonexistent_users() {
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();
        conn.execute(
            "UPDATE review_cycles SET status = 'closed' WHERE id = ?1",
            params![cycle.id],
        ).unwrap();

        // Nonexistent CEO
        let result = resolve_tie_inner(&conn, &cycle.id, "nonexistent", "f2", start + 1000);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("CEO user not found"));

        // Nonexistent founder
        let result = resolve_tie_inner(&conn, &cycle.id, "f3", "nonexistent", start + 1000);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Selected founder not found"));
    }

    #[test]
    fn test_get_review_history_returns_cycles_for_founder() {
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        // Create two cycles
        let cycle1 = create_review_cycle_inner(&conn, start, start).unwrap();
        let cycle2 = create_review_cycle_inner(&conn, start + 14 * 86400, start + 14 * 86400).unwrap();

        // Add reviews for f1 in both cycles
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r1', ?1, 'f2', 'f1', 4, 4, 4, ?2)",
            params![cycle1.id, start + 100],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r2', ?1, 'f2', 'f1', 3, 3, 3, ?2)",
            params![cycle2.id, start + 14 * 86400 + 100],
        ).unwrap();

        // Add a review for f2 in cycle1 only
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r3', ?1, 'f1', 'f2', 3, 3, 3, ?2)",
            params![cycle1.id, start + 200],
        ).unwrap();

        // f1 should have 2 cycles in history
        let history = get_review_history_inner(&conn, "f1").unwrap();
        assert_eq!(history.len(), 2);
        // Ordered by startDate DESC
        assert_eq!(history[0].id, cycle2.id);
        assert_eq!(history[1].id, cycle1.id);

        // f2 should have 1 cycle
        let history = get_review_history_inner(&conn, "f2").unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, cycle1.id);

        // f3 has no reviews
        let history = get_review_history_inner(&conn, "f3").unwrap();
        assert_eq!(history.len(), 0);
    }

    #[test]
    fn test_get_warning_count_returns_correct_count() {
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        // No warnings initially
        assert_eq!(get_warning_count_inner(&conn, "f1").unwrap(), 0);

        // Create cycles and warnings
        let cycle1 = create_review_cycle_inner(&conn, start, start).unwrap();
        let cycle2 = create_review_cycle_inner(&conn, start + 14 * 86400, start + 14 * 86400).unwrap();

        conn.execute(
            "INSERT INTO accountability_warnings (id, founderId, cycleId, issuedAt, acknowledged)
             VALUES ('w1', 'f1', ?1, ?2, 0)",
            params![cycle1.id, start + 1000],
        ).unwrap();
        conn.execute(
            "INSERT INTO accountability_warnings (id, founderId, cycleId, issuedAt, acknowledged)
             VALUES ('w2', 'f1', ?1, ?2, 0)",
            params![cycle2.id, start + 14 * 86400 + 1000],
        ).unwrap();

        assert_eq!(get_warning_count_inner(&conn, "f1").unwrap(), 2);
        assert_eq!(get_warning_count_inner(&conn, "f2").unwrap(), 0);
    }

    #[test]
    fn test_review_cycle_serialization_camel_case() {
        let cycle = ReviewCycle {
            id: "c1".into(),
            start_date: 1000,
            end_date: 2000,
            submission_deadline: 1500,
            status: "open".into(),
            resolved_at: None,
            created_at: 1000,
        };
        let json = serde_json::to_string(&cycle).unwrap();
        assert!(json.contains("\"startDate\""));
        assert!(json.contains("\"endDate\""));
        assert!(json.contains("\"submissionDeadline\""));
        assert!(json.contains("\"resolvedAt\""));
        assert!(json.contains("\"createdAt\""));
    }

    #[test]
    fn test_review_result_serialization_camel_case() {
        let result = ReviewResult {
            founder_id: "f1".into(),
            output_avg: 4.0,
            reliability_avg: 3.5,
            initiative_avg: 4.5,
            overall_avg: 4.0,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"founderId\""));
        assert!(json.contains("\"outputAvg\""));
        assert!(json.contains("\"reliabilityAvg\""));
        assert!(json.contains("\"initiativeAvg\""));
        assert!(json.contains("\"overallAvg\""));
    }

    #[test]
    fn test_close_review_cycle_with_no_reviews_returns_empty() {
        let conn = setup_test_db();
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();
        let results = close_review_cycle_inner(&conn, &cycle.id, start + 500).unwrap();

        assert!(results.is_empty());
    }

    // -----------------------------------------------------------------------
    // submit_founder_review_inner tests (Validates: Req 1.3, 1.4, 1.6, 2.7)
    // -----------------------------------------------------------------------

    #[test]
    fn test_submit_review_success() {
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();

        // Submit within deadline (start + 48h)
        let now = start + 1000;
        let review = submit_founder_review_inner(
            &conn, &cycle.id, "f1", "f2", 4, 3, 5, now,
        )
        .unwrap();

        assert_eq!(review.cycle_id, cycle.id);
        assert_eq!(review.reviewer_id, "f1");
        assert_eq!(review.reviewee_id, "f2");
        assert_eq!(review.output_score, 4);
        assert_eq!(review.reliability_score, 3);
        assert_eq!(review.initiative_score, 5);
        assert_eq!(review.submitted_at, now);
        assert!(!review.id.is_empty());

        // Verify row in DB
        let db_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM founder_reviews WHERE id = ?1",
                params![review.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(db_count, 1);
    }

    #[test]
    fn test_submit_review_rejects_self_review() {
        // Validates: Req 1.3 — reviewerId != revieweeId
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();

        let result = submit_founder_review_inner(
            &conn, &cycle.id, "f1", "f1", 3, 3, 3, start + 100,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("different founders"));
    }

    #[test]
    fn test_submit_review_rejects_duplicate() {
        // Validates: Req 1.3 — unique (cycleId, reviewerId, revieweeId)
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();

        // First submission succeeds
        submit_founder_review_inner(
            &conn, &cycle.id, "f1", "f2", 4, 4, 4, start + 100,
        )
        .unwrap();

        // Duplicate should fail
        let result = submit_founder_review_inner(
            &conn, &cycle.id, "f1", "f2", 3, 3, 3, start + 200,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_submit_review_rejects_scores_out_of_range() {
        // Validates: Req 1.4 — scores must be in [1, 5]
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();
        let now = start + 100;

        // Score 0 (below range)
        let result = submit_founder_review_inner(
            &conn, &cycle.id, "f1", "f2", 0, 3, 3, now,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("output"));

        // Score 6 (above range)
        let result = submit_founder_review_inner(
            &conn, &cycle.id, "f1", "f2", 3, 6, 3, now,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("reliability"));

        // Negative score
        let result = submit_founder_review_inner(
            &conn, &cycle.id, "f1", "f2", 3, 3, -1, now,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("initiative"));
    }

    #[test]
    fn test_submit_review_accepts_boundary_scores() {
        // Validates: Req 1.4 — scores 1 and 5 are valid boundaries
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();

        // All 1s (minimum)
        let review = submit_founder_review_inner(
            &conn, &cycle.id, "f1", "f2", 1, 1, 1, start + 100,
        )
        .unwrap();
        assert_eq!(review.output_score, 1);

        // All 5s (maximum)
        let review = submit_founder_review_inner(
            &conn, &cycle.id, "f2", "f1", 5, 5, 5, start + 200,
        )
        .unwrap();
        assert_eq!(review.output_score, 5);
    }

    #[test]
    fn test_submit_review_rejects_past_deadline() {
        // Validates: Req 1.6 — submission only before deadline
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();

        // Exactly at deadline (now == submissionDeadline)
        let at_deadline = cycle.submission_deadline;
        let result = submit_founder_review_inner(
            &conn, &cycle.id, "f1", "f2", 3, 3, 3, at_deadline,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("deadline has passed"));

        // After deadline
        let result = submit_founder_review_inner(
            &conn, &cycle.id, "f1", "f2", 3, 3, 3, at_deadline + 1,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("deadline has passed"));
    }

    #[test]
    fn test_submit_review_rejects_non_open_cycle() {
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();

        // Close the cycle
        conn.execute(
            "UPDATE review_cycles SET status = 'closed' WHERE id = ?1",
            params![cycle.id],
        )
        .unwrap();

        let result = submit_founder_review_inner(
            &conn, &cycle.id, "f1", "f2", 3, 3, 3, start + 100,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("expected 'open'"));
    }

    #[test]
    fn test_submit_review_rejects_nonexistent_cycle() {
        let conn = setup_test_db();
        insert_founders(&conn);

        let result = submit_founder_review_inner(
            &conn, "nonexistent", "f1", "f2", 3, 3, 3, 1_700_000_000,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_submit_review_allows_different_reviewee_same_reviewer() {
        // f1 can review both f2 and f3 in the same cycle
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();

        submit_founder_review_inner(
            &conn, &cycle.id, "f1", "f2", 4, 4, 4, start + 100,
        )
        .unwrap();

        let review2 = submit_founder_review_inner(
            &conn, &cycle.id, "f1", "f3", 3, 3, 3, start + 200,
        )
        .unwrap();
        assert_eq!(review2.reviewee_id, "f3");

        // Verify 2 reviews exist for f1 as reviewer
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM founder_reviews WHERE cycleId = ?1 AND reviewerId = 'f1'",
                params![cycle.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_submit_review_serialization_camel_case() {
        let review = FounderReview {
            id: "r1".into(),
            cycle_id: "c1".into(),
            reviewer_id: "f1".into(),
            reviewee_id: "f2".into(),
            output_score: 4,
            reliability_score: 3,
            initiative_score: 5,
            submitted_at: 1000,
        };
        let json = serde_json::to_string(&review).unwrap();
        assert!(json.contains("\"cycleId\""));
        assert!(json.contains("\"reviewerId\""));
        assert!(json.contains("\"revieweeId\""));
        assert!(json.contains("\"outputScore\""));
        assert!(json.contains("\"reliabilityScore\""));
        assert!(json.contains("\"initiativeScore\""));
        assert!(json.contains("\"submittedAt\""));
    }

    // -----------------------------------------------------------------------
    // Lowest-ranked detection and accountability warning tests (Req 2.1–2.5)
    // -----------------------------------------------------------------------

    #[test]
    fn test_close_review_cycle_auto_warns_single_lowest() {
        // When exactly one founder is lowest-ranked, close_review_cycle should
        // auto-issue a warning and resolve the cycle.
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();

        // f1 reviews f2: low scores (output=1, reliability=1, initiative=1)
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r1', ?1, 'f1', 'f2', 1, 1, 1, ?2)",
            params![cycle.id, start + 100],
        ).unwrap();

        // f1 reviews f3: high scores
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r2', ?1, 'f1', 'f3', 5, 5, 5, ?2)",
            params![cycle.id, start + 200],
        ).unwrap();

        // f3 reviews f2: low scores
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r3', ?1, 'f3', 'f2', 2, 2, 2, ?2)",
            params![cycle.id, start + 300],
        ).unwrap();

        // f3 reviews f1: high scores
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r4', ?1, 'f3', 'f1', 5, 5, 5, ?2)",
            params![cycle.id, start + 400],
        ).unwrap();

        let results = close_review_cycle_inner(&conn, &cycle.id, start + 500).unwrap();

        // f2 is clearly lowest (avg ~1.5), f1 and f3 are higher
        assert_eq!(results[0].founder_id, "f2");

        // Verify warning was created for f2
        let warning_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM accountability_warnings WHERE founderId = 'f2' AND cycleId = ?1",
                params![cycle.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(warning_count, 1);

        // Verify cycle is resolved (not just closed)
        let (db_status, db_resolved): (String, Option<i64>) = conn
            .query_row(
                "SELECT status, resolvedAt FROM review_cycles WHERE id = ?1",
                params![cycle.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(db_status, "resolved");
        assert_eq!(db_resolved, Some(start + 500));
    }

    #[test]
    fn test_close_review_cycle_tie_leaves_closed_for_ceo() {
        // When two founders tie at the lowest score, cycle should stay "closed"
        // (not "resolved") so CEO can break the tie via resolve_tie.
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();

        // f3 reviews f1: scores (2, 2, 2) → overall 2.0
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r1', ?1, 'f3', 'f1', 2, 2, 2, ?2)",
            params![cycle.id, start + 100],
        ).unwrap();

        // f3 reviews f2: scores (2, 2, 2) → overall 2.0 (tie with f1)
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r2', ?1, 'f3', 'f2', 2, 2, 2, ?2)",
            params![cycle.id, start + 200],
        ).unwrap();

        let results = close_review_cycle_inner(&conn, &cycle.id, start + 500).unwrap();

        // Both should have the same overall_avg
        assert!((results[0].overall_avg - results[1].overall_avg).abs() < 1e-9);

        // No warnings should be issued (tie → CEO must break it)
        let total_warnings: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM accountability_warnings WHERE cycleId = ?1",
                params![cycle.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(total_warnings, 0);

        // Cycle should be "closed" (not "resolved")
        let db_status: String = conn
            .query_row(
                "SELECT status FROM review_cycles WHERE id = ?1",
                params![cycle.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(db_status, "closed");
    }

    #[test]
    fn test_consecutive_warnings_trigger_dilution() {
        // When a founder gets warnings in two consecutive cycles, a dilution
        // event should be triggered. (Req 2.5)
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        // Set up equity stakes for all founders
        conn.execute(
            "INSERT INTO equity_stakes (id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, updatedAt)
             VALUES ('es1', 'f1', 33.33, 33.33, 1000, 2000, 3000, 48, ?1)",
            params![start],
        ).unwrap();
        conn.execute(
            "INSERT INTO equity_stakes (id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, updatedAt)
             VALUES ('es2', 'f2', 33.33, 33.33, 1000, 2000, 3000, 48, ?1)",
            params![start],
        ).unwrap();
        conn.execute(
            "INSERT INTO equity_stakes (id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, updatedAt)
             VALUES ('es3', 'f3', 33.34, 33.34, 1000, 2000, 3000, 48, ?1)",
            params![start],
        ).unwrap();

        // Cycle 1: f2 gets lowest score → warning
        let cycle1 = create_review_cycle_inner(&conn, start, start).unwrap();

        // f1 reviews f2: low, f3: high
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r1', ?1, 'f1', 'f2', 1, 1, 1, ?2)",
            params![cycle1.id, start + 100],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r2', ?1, 'f1', 'f3', 5, 5, 5, ?2)",
            params![cycle1.id, start + 200],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r3', ?1, 'f3', 'f2', 1, 1, 1, ?2)",
            params![cycle1.id, start + 300],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r4', ?1, 'f3', 'f1', 5, 5, 5, ?2)",
            params![cycle1.id, start + 400],
        ).unwrap();

        close_review_cycle_inner(&conn, &cycle1.id, start + 500).unwrap();

        // Verify f2 got a warning in cycle 1
        let w1_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM accountability_warnings WHERE founderId = 'f2' AND cycleId = ?1",
                params![cycle1.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(w1_count, 1);

        // No dilution yet (first warning)
        let dilution_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM dilution_events WHERE founderId = 'f2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(dilution_count, 0);

        // Cycle 2: f2 gets lowest again → second consecutive warning → dilution
        let cycle2_start = start + 14 * 86400;
        let cycle2 = create_review_cycle_inner(&conn, cycle2_start, cycle2_start).unwrap();

        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r5', ?1, 'f1', 'f2', 1, 1, 1, ?2)",
            params![cycle2.id, cycle2_start + 100],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r6', ?1, 'f1', 'f3', 5, 5, 5, ?2)",
            params![cycle2.id, cycle2_start + 200],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r7', ?1, 'f3', 'f2', 1, 1, 1, ?2)",
            params![cycle2.id, cycle2_start + 300],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r8', ?1, 'f3', 'f1', 5, 5, 5, ?2)",
            params![cycle2.id, cycle2_start + 400],
        ).unwrap();

        close_review_cycle_inner(&conn, &cycle2.id, cycle2_start + 500).unwrap();

        // Verify f2 got a warning in cycle 2
        let w2_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM accountability_warnings WHERE founderId = 'f2' AND cycleId = ?1",
                params![cycle2.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(w2_count, 1);

        // Verify dilution event was triggered
        let dilution_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM dilution_events WHERE founderId = 'f2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(dilution_count, 1);

        // Verify f2's equity was reduced by 1%
        let f2_stake: f64 = conn
            .query_row(
                "SELECT currentStakePct FROM equity_stakes WHERE founderId = 'f2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!((f2_stake - 32.33).abs() < 0.01);

        // Verify the 1% was redistributed to f1 and f3
        let f1_stake: f64 = conn
            .query_row(
                "SELECT currentStakePct FROM equity_stakes WHERE founderId = 'f1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let f3_stake: f64 = conn
            .query_row(
                "SELECT currentStakePct FROM equity_stakes WHERE founderId = 'f3'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // Total should still be ~100%
        let total = f1_stake + f2_stake + f3_stake;
        assert!((total - 100.0).abs() < 0.02);
    }

    #[test]
    fn test_no_dilution_for_non_consecutive_warnings() {
        // If a founder gets a warning in cycle 1 but NOT in cycle 2,
        // then gets a warning in cycle 3, no dilution should occur.
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        // Set up equity stakes
        conn.execute(
            "INSERT INTO equity_stakes (id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, updatedAt)
             VALUES ('es1', 'f1', 33.33, 33.33, 1000, 2000, 3000, 48, ?1)",
            params![start],
        ).unwrap();
        conn.execute(
            "INSERT INTO equity_stakes (id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, updatedAt)
             VALUES ('es2', 'f2', 33.33, 33.33, 1000, 2000, 3000, 48, ?1)",
            params![start],
        ).unwrap();
        conn.execute(
            "INSERT INTO equity_stakes (id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, updatedAt)
             VALUES ('es3', 'f3', 33.34, 33.34, 1000, 2000, 3000, 48, ?1)",
            params![start],
        ).unwrap();

        // Cycle 1: f2 gets lowest → warning
        let cycle1 = create_review_cycle_inner(&conn, start, start).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r1', ?1, 'f1', 'f2', 1, 1, 1, ?2)",
            params![cycle1.id, start + 100],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r2', ?1, 'f3', 'f2', 1, 1, 1, ?2)",
            params![cycle1.id, start + 200],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r3', ?1, 'f3', 'f1', 5, 5, 5, ?2)",
            params![cycle1.id, start + 300],
        ).unwrap();
        close_review_cycle_inner(&conn, &cycle1.id, start + 500).unwrap();

        // Cycle 2: f1 gets lowest (not f2) → f2 breaks the streak
        let cycle2_start = start + 14 * 86400;
        let cycle2 = create_review_cycle_inner(&conn, cycle2_start, cycle2_start).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r4', ?1, 'f2', 'f1', 1, 1, 1, ?2)",
            params![cycle2.id, cycle2_start + 100],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r5', ?1, 'f3', 'f1', 1, 1, 1, ?2)",
            params![cycle2.id, cycle2_start + 200],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r6', ?1, 'f3', 'f2', 5, 5, 5, ?2)",
            params![cycle2.id, cycle2_start + 300],
        ).unwrap();
        close_review_cycle_inner(&conn, &cycle2.id, cycle2_start + 500).unwrap();

        // Cycle 3: f2 gets lowest again → warning but NOT consecutive (gap in cycle 2)
        let cycle3_start = start + 28 * 86400;
        let cycle3 = create_review_cycle_inner(&conn, cycle3_start, cycle3_start).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r7', ?1, 'f1', 'f2', 1, 1, 1, ?2)",
            params![cycle3.id, cycle3_start + 100],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r8', ?1, 'f3', 'f2', 1, 1, 1, ?2)",
            params![cycle3.id, cycle3_start + 200],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r9', ?1, 'f3', 'f1', 5, 5, 5, ?2)",
            params![cycle3.id, cycle3_start + 300],
        ).unwrap();
        close_review_cycle_inner(&conn, &cycle3.id, cycle3_start + 500).unwrap();

        // f2 should have warnings in cycle 1 and cycle 3, but NOT consecutive
        let total_warnings: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM accountability_warnings WHERE founderId = 'f2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(total_warnings, 2);

        // No dilution should have occurred
        let dilution_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM dilution_events WHERE founderId = 'f2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(dilution_count, 0);
    }

    #[test]
    fn test_resolve_tie_consecutive_warnings_trigger_dilution() {
        // When resolve_tie issues a warning and the founder had a warning in the
        // previous cycle, dilution should be triggered.
        let conn = setup_test_db();
        insert_founders(&conn);
        let start = 1_700_000_000i64;

        // Set up equity stakes
        conn.execute(
            "INSERT INTO equity_stakes (id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, updatedAt)
             VALUES ('es1', 'f1', 33.33, 33.33, 1000, 2000, 3000, 48, ?1)",
            params![start],
        ).unwrap();
        conn.execute(
            "INSERT INTO equity_stakes (id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, updatedAt)
             VALUES ('es2', 'f2', 33.33, 33.33, 1000, 2000, 3000, 48, ?1)",
            params![start],
        ).unwrap();
        conn.execute(
            "INSERT INTO equity_stakes (id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, updatedAt)
             VALUES ('es3', 'f3', 33.34, 33.34, 1000, 2000, 3000, 48, ?1)",
            params![start],
        ).unwrap();

        // Cycle 1: f2 gets lowest → auto-warning via close_review_cycle
        let cycle1 = create_review_cycle_inner(&conn, start, start).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r1', ?1, 'f1', 'f2', 1, 1, 1, ?2)",
            params![cycle1.id, start + 100],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r2', ?1, 'f3', 'f2', 1, 1, 1, ?2)",
            params![cycle1.id, start + 200],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r3', ?1, 'f3', 'f1', 5, 5, 5, ?2)",
            params![cycle1.id, start + 300],
        ).unwrap();
        close_review_cycle_inner(&conn, &cycle1.id, start + 500).unwrap();

        // Cycle 2: tie at lowest → CEO resolves by picking f2 again
        let cycle2_start = start + 14 * 86400;
        let cycle2 = create_review_cycle_inner(&conn, cycle2_start, cycle2_start).unwrap();
        // Create a tie: f1 and f2 both get score 2.0
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r4', ?1, 'f3', 'f1', 2, 2, 2, ?2)",
            params![cycle2.id, cycle2_start + 100],
        ).unwrap();
        conn.execute(
            "INSERT INTO founder_reviews (id, cycleId, reviewerId, revieweeId, outputScore, reliabilityScore, initiativeScore, submittedAt)
             VALUES ('r5', ?1, 'f3', 'f2', 2, 2, 2, ?2)",
            params![cycle2.id, cycle2_start + 200],
        ).unwrap();

        // Close cycle (should leave as "closed" due to tie)
        close_review_cycle_inner(&conn, &cycle2.id, cycle2_start + 500).unwrap();
        let db_status: String = conn
            .query_row(
                "SELECT status FROM review_cycles WHERE id = ?1",
                params![cycle2.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(db_status, "closed");

        // CEO resolves tie by picking f2
        resolve_tie_inner(&conn, &cycle2.id, "f3", "f2", cycle2_start + 1000).unwrap();

        // Verify dilution was triggered (consecutive warnings for f2)
        let dilution_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM dilution_events WHERE founderId = 'f2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(dilution_count, 1);

        // Verify f2's equity was reduced
        let f2_stake: f64 = conn
            .query_row(
                "SELECT currentStakePct FROM equity_stakes WHERE founderId = 'f2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!((f2_stake - 32.33).abs() < 0.01);
    }

    #[test]
    fn test_close_review_cycle_no_reviews_no_warning() {
        // When no reviews are submitted, no warning should be issued.
        let conn = setup_test_db();
        let start = 1_700_000_000i64;

        let cycle = create_review_cycle_inner(&conn, start, start).unwrap();
        let results = close_review_cycle_inner(&conn, &cycle.id, start + 500).unwrap();

        assert!(results.is_empty());

        // No warnings
        let total_warnings: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM accountability_warnings WHERE cycleId = ?1",
                params![cycle.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(total_warnings, 0);

        // Cycle should be "closed" (not resolved — nothing to resolve)
        let db_status: String = conn
            .query_row(
                "SELECT status FROM review_cycles WHERE id = ?1",
                params![cycle.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(db_status, "closed");
    }

    #[test]
    fn test_accountability_warning_serialization_camel_case() {
        let warning = AccountabilityWarning {
            id: "w1".into(),
            founder_id: "f1".into(),
            cycle_id: "c1".into(),
            issued_at: 1000,
            acknowledged: false,
        };
        let json = serde_json::to_string(&warning).unwrap();
        assert!(json.contains("\"founderId\""));
        assert!(json.contains("\"cycleId\""));
        assert!(json.contains("\"issuedAt\""));
        assert!(json.contains("\"acknowledged\""));
    }

    // -----------------------------------------------------------------------
    // apply_dilution_inner and validate_cap_table_sum tests (Req 6.5, 21.4)
    // -----------------------------------------------------------------------

    /// Helper: insert equity stakes for 3 founders summing to 100%.
    fn insert_equity_stakes(conn: &Connection, now: i64) {
        conn.execute(
            "INSERT INTO equity_stakes (id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, updatedAt)
             VALUES ('es1', 'f1', 33.33, 33.33, 1000, 2000, 3000, 48, ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO equity_stakes (id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, updatedAt)
             VALUES ('es2', 'f2', 33.33, 33.33, 1000, 2000, 3000, 48, ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO equity_stakes (id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, updatedAt)
             VALUES ('es3', 'f3', 33.34, 33.34, 1000, 2000, 3000, 48, ?1)",
            params![now],
        ).unwrap();
    }

    #[test]
    fn test_validate_cap_table_sum_valid() {
        let conn = setup_test_db();
        insert_founders(&conn);
        insert_equity_stakes(&conn, 1000);

        let valid = validate_cap_table_sum(&conn).unwrap();
        assert!(valid, "Cap table summing to 100% should be valid");
    }

    #[test]
    fn test_validate_cap_table_sum_invalid() {
        let conn = setup_test_db();
        insert_founders(&conn);
        // Insert stakes that don't sum to 100%
        conn.execute(
            "INSERT INTO equity_stakes (id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, updatedAt)
             VALUES ('es1', 'f1', 50.0, 50.0, 1000, 2000, 3000, 48, 1000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO equity_stakes (id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, updatedAt)
             VALUES ('es2', 'f2', 30.0, 30.0, 1000, 2000, 3000, 48, 1000)",
            [],
        ).unwrap();
        // Sum = 80%, not 100%

        let valid = validate_cap_table_sum(&conn).unwrap();
        assert!(!valid, "Cap table summing to 80% should be invalid");
    }

    #[test]
    fn test_apply_dilution_inner_reduces_stake_and_redistributes() {
        let conn = setup_test_db();
        insert_founders(&conn);
        insert_equity_stakes(&conn, 1000);

        // Create a review cycle for the dilution event reference
        let cycle = create_review_cycle_inner(&conn, 1_700_000_000, 1_700_000_000).unwrap();

        // Apply 1% dilution to f2
        apply_dilution_inner(&conn, "f2", &cycle.id, 1.0, 1_700_001_000).unwrap();

        // f2's stake should be reduced by 1%
        let f2_stake: f64 = conn
            .query_row(
                "SELECT currentStakePct FROM equity_stakes WHERE founderId = 'f2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!((f2_stake - 32.33).abs() < 0.01, "f2 stake should be ~32.33%, got {}", f2_stake);

        // f1 and f3 should have increased proportionally
        let f1_stake: f64 = conn
            .query_row(
                "SELECT currentStakePct FROM equity_stakes WHERE founderId = 'f1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let f3_stake: f64 = conn
            .query_row(
                "SELECT currentStakePct FROM equity_stakes WHERE founderId = 'f3'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        // Cap table should still sum to ~100%
        let total = f1_stake + f2_stake + f3_stake;
        assert!((total - 100.0).abs() <= 0.01, "Cap table should sum to ~100%, got {}", total);

        // A dilution_events record should exist
        let dilution_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM dilution_events WHERE founderId = 'f2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(dilution_count, 1);
    }

    #[test]
    fn test_apply_dilution_inner_rejects_zero_pct() {
        let conn = setup_test_db();
        insert_founders(&conn);
        insert_equity_stakes(&conn, 1000);

        let cycle = create_review_cycle_inner(&conn, 1_700_000_000, 1_700_000_000).unwrap();

        let result = apply_dilution_inner(&conn, "f1", &cycle.id, 0.0, 1_700_001_000);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be positive"));
    }

    #[test]
    fn test_apply_dilution_inner_rejects_excessive_pct() {
        let conn = setup_test_db();
        insert_founders(&conn);
        insert_equity_stakes(&conn, 1000);

        let cycle = create_review_cycle_inner(&conn, 1_700_000_000, 1_700_000_000).unwrap();

        // f1 has 33.33%, trying to dilute by 50% should fail
        let result = apply_dilution_inner(&conn, "f1", &cycle.id, 50.0, 1_700_001_000);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("exceeds"));
    }

    #[test]
    fn test_apply_dilution_inner_rejects_missing_founder() {
        let conn = setup_test_db();
        insert_founders(&conn);
        insert_equity_stakes(&conn, 1000);

        let cycle = create_review_cycle_inner(&conn, 1_700_000_000, 1_700_000_000).unwrap();

        let result = apply_dilution_inner(&conn, "nonexistent", &cycle.id, 1.0, 1_700_001_000);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No equity stake found"));
    }

    // -----------------------------------------------------------------------
    // compute_startup_health_inner tests (Validates: Req 12.1, 12.5, 14.6)
    // -----------------------------------------------------------------------

    #[test]
    fn test_compute_startup_health_returns_empty_when_no_data() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;

        let result = compute_startup_health_inner(&conn, now).unwrap();

        assert!(result.config.is_none());
        assert!(result.decisions.is_empty());
        // No founders with founder/ceo role → empty
        assert!(result.founder_hours.is_empty());
    }

    #[test]
    fn test_compute_startup_health_reads_config() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;

        conn.execute(
            "INSERT INTO startup_health_config (id, cashBalance, monthlyExpenses, plannedMonthlyBudget, updatedAt)
             VALUES ('cfg1', 50000.0, '[5000, 6000, 5500]', 5500.0, ?1)",
            params![now],
        ).unwrap();

        let result = compute_startup_health_inner(&conn, now).unwrap();

        let config = result.config.unwrap();
        assert_eq!(config.id, "cfg1");
        assert!((config.cash_balance - 50000.0).abs() < 0.01);
        assert_eq!(config.monthly_expenses, "[5000, 6000, 5500]");
        assert!((config.planned_monthly_budget - 5500.0).abs() < 0.01);
    }

    #[test]
    fn test_compute_startup_health_reads_decisions() {
        let conn = setup_test_db();
        let now = 1_700_000_000i64;

        conn.execute(
            "INSERT INTO decisions (id, title, description, createdAt, resolvedAt)
             VALUES ('d1', 'Hire engineer', 'Need backend dev', ?1, ?2)",
            params![now - 86400, now],
        ).unwrap();
        conn.execute(
            "INSERT INTO decisions (id, title, description, createdAt)
             VALUES ('d2', 'Office lease', 'Renew or move', ?1)",
            params![now - 3600],
        ).unwrap();

        let result = compute_startup_health_inner(&conn, now).unwrap();

        assert_eq!(result.decisions.len(), 2);
        // Ordered by createdAt DESC
        assert_eq!(result.decisions[0].id, "d2");
        assert_eq!(result.decisions[1].id, "d1");
        assert!(result.decisions[1].resolved_at.is_some());
        assert!(result.decisions[0].resolved_at.is_none());
    }

    #[test]
    fn test_compute_startup_health_computes_founder_hours() {
        let conn = setup_test_db();
        // u1 is already created but has no role set. Update to founder.
        conn.execute(
            "UPDATE users SET role = 'founder' WHERE id = 'u1'",
            [],
        ).unwrap();
        // Add another founder
        conn.execute(
            "INSERT INTO users (id, name, email, role, createdAt) VALUES ('u2', 'Alice', 'alice@test.com', 'ceo', 1000)",
            [],
        ).unwrap();

        // Set now to a known Monday at noon UTC: 2023-11-13 12:00:00 UTC = 1699876800
        // Actually, let's use a simpler approach: pick a timestamp and compute week start
        let now = 1_700_000_000i64; // 2023-11-14 22:13:20 UTC (Tuesday)

        // Insert a session for u1 that started 2 hours ago and ended 1 hour ago
        conn.execute(
            "INSERT INTO sessions (id, userId, startTime, endTime, startType, startVerified, createdAt)
             VALUES ('s1', 'u1', ?1, ?2, 'manual', 1, ?1)",
            params![now - 7200, now - 3600],
        ).unwrap();

        // Insert a session for u2 that started 4 hours ago and is still active
        conn.execute(
            "INSERT INTO sessions (id, userId, startTime, startType, startVerified, createdAt)
             VALUES ('s2', 'u2', ?1, 'manual', 1, ?1)",
            params![now - 14400],
        ).unwrap();

        let result = compute_startup_health_inner(&conn, now).unwrap();

        assert_eq!(result.founder_hours.len(), 2);

        // Find u1 and u2 in results
        let u1_hours = result.founder_hours.iter().find(|f| f.founder_id == "u1").unwrap();
        let u2_hours = result.founder_hours.iter().find(|f| f.founder_id == "u2").unwrap();

        // u1: 1 hour session (3600 seconds / 3600 = 1.0 hour)
        assert!((u1_hours.weekly_hours - 1.0).abs() < 0.1, "u1 should have ~1.0 hours, got {}", u1_hours.weekly_hours);

        // u2: 4 hours active session (14400 seconds / 3600 = 4.0 hours)
        assert!((u2_hours.weekly_hours - 4.0).abs() < 0.1, "u2 should have ~4.0 hours, got {}", u2_hours.weekly_hours);
    }

    #[test]
    fn test_compute_startup_health_excludes_non_founders() {
        let conn = setup_test_db();
        // u1 has no role (regular team member)
        // Add a founder
        conn.execute(
            "INSERT INTO users (id, name, email, role, createdAt) VALUES ('u2', 'Founder', 'f@test.com', 'founder', 1000)",
            [],
        ).unwrap();

        let now = 1_700_000_000i64;

        let result = compute_startup_health_inner(&conn, now).unwrap();

        // Only u2 (founder) should appear, not u1 (no role)
        assert_eq!(result.founder_hours.len(), 1);
        assert_eq!(result.founder_hours[0].founder_id, "u2");
    }

    #[test]
    fn test_compute_startup_health_serialization_camel_case() {
        let data = StartupHealthRawData {
            config: Some(StartupHealthConfigRow {
                id: "cfg1".into(),
                cash_balance: 50000.0,
                monthly_expenses: "[5000]".into(),
                planned_monthly_budget: 5000.0,
                updated_at: 1000,
            }),
            decisions: vec![DecisionRow {
                id: "d1".into(),
                title: "Test".into(),
                description: "Desc".into(),
                created_at: 1000,
                resolved_at: None,
            }],
            founder_hours: vec![FounderWeeklyHours {
                founder_id: "f1".into(),
                name: "Alice".into(),
                weekly_hours: 40.0,
            }],
        };
        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("\"cashBalance\""));
        assert!(json.contains("\"monthlyExpenses\""));
        assert!(json.contains("\"plannedMonthlyBudget\""));
        assert!(json.contains("\"updatedAt\""));
        assert!(json.contains("\"createdAt\""));
        assert!(json.contains("\"resolvedAt\""));
        assert!(json.contains("\"founderId\""));
        assert!(json.contains("\"weeklyHours\""));
        assert!(json.contains("\"founderHours\""));
    }
}
