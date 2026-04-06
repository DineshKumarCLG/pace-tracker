# Implementation Plan: PACE Work Tracker

## Overview

PACE is a Tauri v2 desktop work tracker with React 19 + TypeScript frontend and Rust backend. Implementation follows the PDR's 10-phase build order: Core Foundation → Session Core → Idle Detection → Tasks → PocketBase Sync → Team View → Weekly Review → Git Integration → AI Layer → Polish. Each phase builds incrementally on the previous, with no orphaned code. Comprehensive testing is integrated at every phase — unit tests, integration tests, property-based tests, and end-to-end tests.

## Tasks

- [x] 1. Core Foundation — Project scaffold, schema, stores, routing, and design system
  - [x] 1.1 Scaffold Tauri v2 project with React 19 + Vite + TypeScript
    - Initialize Tauri v2 app with `create-tauri-app`
    - Configure `tauri.conf.json` with app name "PACE", identifier, and window settings
    - Add Rust dependencies to `Cargo.toml`: `user-idle`, `tauri-plugin-sql` (sqlite), `tauri-plugin-notification`, `tauri-plugin-shell`, `tauri-plugin-autostart`, `tauri-plugin-single-instance`, `tauri-plugin-power-monitor`
    - Add frontend dependencies: `zustand`, `@tanstack/react-query`, `@tanstack/react-router`, `recharts`, `motion`, `sonner`, `lucide-react`
    - Add test dependencies: `vitest`, `@testing-library/react`, `@testing-library/user-event`, `fast-check`, `msw`, `playwright` (or `@playwright/test`), `happy-dom`
    - _Requirements: 19.1 (tech stack foundation)_

  - [x] 1.2 Set up Tailwind v4 + shadcn/ui + Geist fonts + CSS custom properties
    - Install and configure Tailwind CSS v4
    - Initialize shadcn/ui with project defaults
    - Add Geist and Geist Mono font files, configure `@font-face` declarations
    - Create `src/styles/globals.css` with all light and dark mode CSS custom property tokens from the design system
    - _Requirements: 19.1 (theme support)_

  - [x] 1.3 Create SQLite schema and migration system
    - Create `src-tauri/src/db.rs` with schema initialization function
    - Implement all CREATE TABLE statements from the data model: `users`, `projects`, `tasks`, `sessions`, `session_tasks`, `breaks`, `idle_events`, `git_events`, `weekly_reviews`, `settings`, `sync_queue`, `sync_dead_letter`
    - Create all indexes: `idx_sessions_user_start`, `idx_session_tasks_session`, `idx_tasks_project`, `idx_git_events_session`, `idx_breaks_session`
    - Expose a `initialize_db` Tauri command that runs on app launch
    - _Requirements: 13.1, 20.5 (all timestamps as Unix UTC integers)_

  - [x] 1.4 Create Zustand stores: sessionStore, taskStore, teamStore, uiStore
    - `src/stores/sessionStore.ts`: active session, paused state, break state, idle modal visibility
    - `src/stores/taskStore.ts`: active task, task list cache
    - `src/stores/teamStore.ts`: team members' live status from WebSocket
    - `src/stores/uiStore.ts`: sidebar state, modals, sync status, last sync time, theme
    - _Requirements: 19.2 (settings apply without restart)_

  - [x] 1.5 Set up TanStack Router with screen stubs and Sidebar layout
    - Create `src/router.tsx` with route definitions for: Today, Team, Tasks, Review, Settings, Onboarding
    - Create stub `index.tsx` for each screen under `src/screens/`
    - Implement `src/components/Sidebar.tsx` with nav items, active state (indigo left border), logo area, and user avatar area
    - Wire router into `App.tsx` with sidebar layout wrapper
    - _Requirements: 18.1 (onboarding route), 21.2 (navigation structure)_

  - [x] 1.6 Write property test for UTC timestamp consistency
    - **Property 13: UTC Timestamp Consistency**
    - Verify that all timestamp fields stored via any write function are Unix timestamps in UTC, and that no local timezone conversion occurs in storage or business logic layers
    - **Validates: Requirement 20.5**

- [x] 2. Testing — Core Foundation
  - [x] 2.1 Unit tests for SQLite schema and migrations
    - Test that `initialize_db` creates all 12 tables with correct columns and types
    - Test all indexes are created and queryable
    - Test CHECK constraints: `sessions.startType` only accepts 'manual'/'backfill'/'recovered', `tasks.status` only accepts 'open'/'inprogress'/'done'/'blocked', `tasks.priority` only accepts 'high'/'medium'/'low', `breaks.type` only accepts 'lunch'/'short'/'meeting'/'discarded'
    - Test UNIQUE constraint on `users.email`
    - Test FOREIGN KEY constraints: session_tasks.sessionId → sessions, breaks.sessionId → sessions, tasks.projectId → projects
    - Test `session_tasks.minutes` virtual column computes correctly from startTime/endTime
    - _Validates: Requirement 20.5, data model integrity_

  - [x] 2.2 Unit tests for Zustand stores
    - Test sessionStore: setSession, clearSession, setPaused, setBreakState, setIdleModalVisible — verify state transitions and no stale state leaks
    - Test taskStore: setActiveTask, updateTaskList — verify active task is always singular
    - Test teamStore: updateMember, removeMember — verify member status updates correctly
    - Test uiStore: setTheme, setSyncStatus, setLastSyncTime — verify theme applies, sync status reflects correctly
    - Test store isolation: mutations in one store do not affect others
    - _Validates: Requirements 19.2, state management correctness_

  - [x] 2.3 Unit tests for TanStack Router and navigation
    - Test all route definitions resolve to correct screen components
    - Test sidebar navigation: clicking each nav item navigates to correct route
    - Test active state: current route highlights correct sidebar item with indigo border
    - Test onboarding route guard: first-launch redirects to onboarding, subsequent launches skip it
    - _Validates: Requirements 18.1, 21.2_

  - [x] 2.4 Unit tests for design system tokens and theming
    - Test all CSS custom properties exist in both light and dark mode
    - Test theme switching: toggling light/dark/system applies correct token set
    - Test Geist and Geist Mono fonts load and apply to correct elements
    - Test component styles match design system specs: session card border-radius 16px, KPI card border-radius 12px, idle modal border-radius 20px
    - _Validates: Requirement 19.1_

- [x] 3. Checkpoint — Core foundation verified
  - Ensure the Tauri app launches, SQLite schema initializes, all routes render stubs, sidebar navigation works, Zustand stores are accessible, and all core foundation tests pass. Ask the user if questions arise.

- [x] 4. Session Core — Start, heartbeat, crash recovery, end day, and Today view
  - [x] 4.1 Implement Rust heartbeat thread and session Tauri commands
    - Create `src-tauri/src/heartbeat.rs`: `spawn_heartbeat(session_id, db_path)` that writes `lastHeartbeat` to SQLite every 10 seconds in a background thread
    - Create `src-tauri/src/commands.rs` with Tauri commands: `start_session`, `end_session`, `get_active_session`, `recover_stale_session`, `get_device_wake_time`
    - `start_session`: validate no active session exists for user, insert session row, spawn heartbeat thread, return session
    - `end_session`: close session_tasks and breaks with endTime, stop heartbeat, update session with endTime and outputNote
    - Wire commands in `main.rs` via `tauri::generate_handler!`
    - _Requirements: 1.1, 1.4, 1.6, 2.1, 3.2, 3.3, 3.4, 20.1_

  - [x] 4.2 Write property test for single active session invariant
    - **Property 1: Single Active Session Invariant**
    - For any user and any sequence of start/stop operations, at most one session has `endTime = null`. Starting a second concurrent session is rejected.
    - **Validates: Requirements 1.6, 20.1**

  - [x] 4.3 Write property test for session start classification
    - **Property 2: Session Start Classification**
    - For any claimed start time: if earlier than now but within 4 hours → `startType = "backfill"`; if earlier than device wake time → `startVerified = false`. Both may apply simultaneously.
    - **Validates: Requirements 1.2, 1.3**

  - [x] 4.4 Implement crash recovery flow on app launch
    - Create `src/lib/db.ts` with SQLite connection helper and typed query functions
    - On app launch, query `sessions WHERE endTime IS NULL` — if `lastHeartbeat` > 30s ago, show recovery prompt; if within 30s, resume normally
    - Build recovery UI component showing last known session state, tasks, breaks
    - On user confirmation, call `recover_stale_session` Tauri command with confirmed end time and `startType = 'recovered'`
    - _Requirements: 2.2, 2.3, 2.4_

  - [x] 4.5 Write property test for crash recovery classification
    - **Property 3: Crash Recovery Classification**
    - For any app launch with a session where `endTime = null`: if `lastHeartbeat` > 30s ago → recovery-needed; if within 30s → resume. Classification determined solely by heartbeat age.
    - **Validates: Requirements 2.2, 2.4**

  - [x] 4.6 Build the Today view with session card, timer, activity timeline, session log, and output note
    - `src/screens/Today/index.tsx`: main layout with session card hero, KPI row, activity timeline, session log, output note
    - `src/screens/Today/SessionCard.tsx`: 3 visual states (active/indigo, break/amber, ended/gray), live timer reading from Zustand `startTime`, break button, task display with switch trigger, ambient glow blob
    - `src/components/Timer.tsx`: 1-second interval timer computing elapsed from `sessionStore.startTime` minus break durations
    - `src/screens/Today/ActivityTimeline.tsx`: horizontal bar showing work (indigo), break (amber), away (gray) segments
    - `src/screens/Today/SessionLog.tsx`: chronological list of session events (start, task switch, break, idle, resume)
    - `src/screens/Today/OutputNote.tsx`: free-text field, always visible, editable during active session
    - _Requirements: 3.1, 12.1, 12.2_

  - [x] 4.7 Implement session start flow with backfill prompt
    - Create start session UI: "When did you start?" prompt with current time default and device wake time suggestion
    - Validate claimed time is within 4 hours of now
    - Call `start_session` Tauri command, update sessionStore, start idle detection
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [x] 4.8 Implement End Day two-step flow
    - `src/components/EndDayFlow.tsx`: Step 1 shows day summary (total time, tasks closed, breaks); Step 2 shows output note pre-filled from Today view, confirm button
    - On confirm: call `end_session` Tauri command, clear sessionStore, queue sync
    - Show goodbye screen with facts (hours, tasks, breaks) and human sign-off — no scores
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 12.2, 12.3_

  - [x] 4.9 Write property test for session end closes all children
    - **Property 4: Session End Closes All Children**
    - For any session with open session_tasks and breaks, when ended, all children have `endTime` set. No child remains with `endTime = null`.
    - **Validates: Requirements 3.2, 3.3**

  - [x] 4.10 Write property test for output note pre-fill round trip
    - **Property 18: Output Note Pre-fill Round Trip**
    - For any output note written during a session, the end-of-day form pre-fills with that text. After close, querying the session returns the note unchanged.
    - **Validates: Requirements 12.2, 12.3**

  - [x] 4.11 Write property test for day summary computation
    - **Property 21: Day Summary Computation**
    - Total time = (now - sessionStart) minus break/discard duration. Tasks closed = count of tasks marked "done" during session. Breaks = count of non-micro break records.
    - **Validates: Requirement 3.1**

- [x] 5. Testing — Session Core
  - [x] 5.1 Unit tests for session Tauri commands (Rust)
    - Test `start_session`: creates session row with correct fields, spawns heartbeat, returns session object
    - Test `start_session` rejects when active session already exists for user (single active session invariant)
    - Test `start_session` with backfill: claimed time 2 hours ago → `startType = "backfill"`
    - Test `start_session` with unverifiable backfill: claimed time before device wake → `startVerified = false`
    - Test `start_session` rejects claimed time > 4 hours in the past
    - Test `end_session`: sets endTime, closes all open session_tasks and breaks, stops heartbeat
    - Test `end_session` stores outputNote correctly
    - Test `get_active_session`: returns session when active, returns null when none
    - Test `recover_stale_session`: sets startType to 'recovered', sets confirmed endTime
    - _Validates: Requirements 1.1–1.6, 2.3, 3.2–3.4, 20.1_

  - [x] 5.2 Unit tests for heartbeat thread (Rust)
    - Test heartbeat writes `lastHeartbeat` to SQLite at 10-second intervals
    - Test heartbeat updates the correct session row by sessionId
    - Test heartbeat thread stops cleanly when session ends
    - Test heartbeat timestamp is always a valid Unix UTC timestamp
    - Stress test: run heartbeat for 60 seconds, verify at least 5 writes occurred with monotonically increasing timestamps
    - _Validates: Requirement 2.1_

  - [x] 5.3 Unit tests for crash recovery logic
    - Test stale session detection: session with lastHeartbeat > 30s ago → recovery-needed
    - Test fresh session detection: session with lastHeartbeat ≤ 30s ago → resume
    - Test no session: no active session → null (no recovery needed)
    - Test recovery data includes session_tasks and breaks for the stale session
    - Test recovery with user-confirmed end time correctly closes session
    - Test multiple stale sessions (edge case): only the most recent is offered for recovery
    - _Validates: Requirements 2.2, 2.3, 2.4_

  - [x] 5.4 Integration tests for session lifecycle (start → work → end)
    - Test full flow: start session → verify SQLite row → verify heartbeat running → end session → verify endTime set → verify heartbeat stopped
    - Test full flow with backfill: start with past time → verify startType and startVerified flags
    - Test session start → task switch → end session → verify session_task endTimes
    - Test session start → break → resume → end session → verify break record and session time calculation
    - _Validates: Requirements 1.1–1.6, 3.2–3.5_

  - [x] 5.5 Component tests for Today view
    - Test SessionCard renders in active state (indigo) with running timer
    - Test SessionCard renders in break state (amber) with break timer
    - Test SessionCard renders in ended state (gray)
    - Test Timer component: verify it increments every second, correctly subtracts break durations
    - Test ActivityTimeline: renders correct colored segments for work/break/away periods
    - Test SessionLog: displays events in chronological order with correct timestamps
    - Test OutputNote: editable during active session, pre-fills at end-of-day
    - Test OutputNote: read-only when no active session
    - _Validates: Requirements 3.1, 12.1, 12.2_

  - [x] 5.6 Component tests for End Day flow
    - Test Step 1 shows correct summary: total time, tasks closed, breaks count
    - Test Step 2 pre-fills output note from Today view text
    - Test confirm button calls end_session and clears session state
    - Test goodbye screen shows facts without scores or ratings
    - Test End Day is blocked if no task was ever set during session
    - _Validates: Requirements 3.1–3.5, 12.2, 12.3_

  - [x] 5.7 Component tests for session start flow
    - Test "When did you start?" prompt defaults to current time
    - Test device wake time shown as suggestion anchor
    - Test backfill validation: rejects times > 4 hours ago
    - Test successful start navigates to Today view with active session
    - _Validates: Requirements 1.1–1.5_

- [x] 6. Checkpoint — Session lifecycle verified
  - Ensure session start (with backfill), heartbeat, crash recovery, end day flow, and Today view all work end-to-end. Timer ticks, session card transitions between states. All session tests pass. Ask the user if questions arise.

- [x] 7. Idle Detection — Rust idle polling, idle modal, soft nudge, break management
  - [x] 7.1 Implement Rust idle detection loop with user-idle crate
    - Create `src-tauri/src/idle.rs`: polling loop using `UserIdle::get_time()` every 30 seconds
    - Implement `IdleConfig` struct with configurable thresholds (micro_break: 8min, idle: 15min default, nudge: 90min default)
    - Emit Tauri events: `idle_threshold_reached`, `user_returned`, `micro_pause`, `soft_nudge`
    - Track `continuous_active_secs` for soft nudge timing, reset after nudge or idle
    - Expose `start_idle_detection` and `stop_idle_detection` Tauri commands
    - _Requirements: 5.1, 5.2, 5.6, 5.7, 6.1_

  - [x] 7.2 Write property test for idle duration classification
    - **Property 5: Idle Duration Classification**
    - For any idle period: <8min → silently absorbed, no event; 8–20min → micro-pause recorded, no prompt; ≥20min → user prompted via Idle_Modal. Soft nudge fires at configured interval and resets.
    - **Validates: Requirements 5.2, 5.3, 5.6, 5.7, 6.1**

  - [x] 7.3 Implement power-monitor hooks for screen lock, sleep, and wake
    - Create `src-tauri/src/power.rs`: listen for `tauri-plugin-power-monitor` events (lock, sleep, wake, resume)
    - On lock/sleep: emit `session_pause` event to frontend
    - On wake/resume: emit `session_resume` event, trigger idle check
    - _Requirements: 4.1, 4.2_

  - [x] 7.4 Build Idle Modal component with resolution options
    - `src/components/IdleModal.tsx`: glass overlay showing away duration and time range
    - Four resolution buttons: Lunch break, Short break, Meeting, Discard
    - On resolution: create break record (or discard gap), update idle_event, resume timer, dismiss modal
    - Listen for `user_returned` Tauri event to trigger modal display
    - _Requirements: 5.3, 5.4, 5.5_

  - [x] 7.5 Write property test for idle resolution creates correct records
    - **Property 6: Idle Resolution Creates Correct Records**
    - If resolution is lunch/short/meeting → break record created with matching type and time range. If discard → no break record, gap excluded from session time. Exactly one outcome per resolution.
    - **Validates: Requirements 5.4, 5.5**

  - [x] 7.6 Implement break management — manual break, break overflow, micro-break filter
    - Break button in session card and menubar dropdown → type selector (Lunch, Short, Meeting)
    - On break start: pause timer, create break record, session card → amber state with break timer counting up
    - Break overflow: 90min → OS notification via `tauri-plugin-notification`; 105min no response → auto-close session at break start time
    - Micro-break filter: breaks under 8 minutes excluded from all UI queries
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 7.7 Write property test for break visibility filtering
    - **Property 22: Break Visibility Filtering**
    - For any break under 8 minutes, it is excluded from all user-facing UI. Only breaks ≥8 minutes appear in timeline and summary.
    - **Validates: Requirement 7.6**

  - [x] 7.8 Implement auto-session pause and close logic
    - On screen lock/sleep events: pause session timer silently
    - On 2+ hours system idle: auto-close session at last activity timestamp
    - On next-morning login with unclosed session: prompt user to confirm end time
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 7.9 Implement soft nudge system
    - After configurable continuous active time (default 90min), send OS notification: "Still working on [task]?"
    - If no response in 5 minutes, pause session timer
    - On return after nudge-triggered pause, show Idle Modal for resolution
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 8. Testing — Idle Detection and Break Management
  - [x] 8.1 Unit tests for idle detection logic (Rust)
    - Test idle classification: 0–7min59s → no event emitted (silently absorbed)
    - Test idle classification: 8min–19min59s → `micro_pause` event emitted, no prompt
    - Test idle classification: 20min+ → `user_returned` event emitted with away duration
    - Test idle threshold: configurable from 5–60 minutes, default 15 minutes
    - Test continuous active tracking: `continuous_active_secs` increments correctly per poll interval
    - Test soft nudge: fires at configured interval (default 90min), resets counter after nudge
    - Test soft nudge: fires again after another full interval of continuous activity
    - Test idle → return → idle cycle: state transitions correctly between idle and active
    - Test boundary conditions: exactly 8 minutes, exactly 20 minutes, exactly threshold value
    - _Validates: Requirements 5.1, 5.2, 5.6, 5.7, 6.1_

  - [x] 8.2 Unit tests for power-monitor event handling (Rust)
    - Test screen lock event → `session_pause` emitted to frontend
    - Test sleep/lid-close event → `session_pause` emitted to frontend
    - Test wake/resume event → `session_resume` emitted, idle check triggered
    - Test rapid lock/unlock cycle: no duplicate events, state consistent
    - _Validates: Requirements 4.1, 4.2_

  - [x] 8.3 Component tests for Idle Modal
    - Test modal appears when `user_returned` event fires with away duration ≥ 20 minutes
    - Test modal does NOT appear for away durations < 20 minutes
    - Test modal displays correct away duration and time range
    - Test "Lunch break" resolution: creates break record with type 'lunch', correct time range
    - Test "Short break" resolution: creates break record with type 'short'
    - Test "Meeting" resolution: creates break record with type 'meeting'
    - Test "Discard" resolution: no break record created, gap excluded from session time
    - Test modal dismisses after resolution and timer resumes
    - Test modal glass overlay styling matches design system (Level 2 Glass)
    - _Validates: Requirements 5.3, 5.4, 5.5_

  - [x] 8.4 Unit tests for break management logic
    - Test manual break: creates break record with selected type, pauses timer
    - Test break timer: counts up from break start time
    - Test break resume: closes break record with endTime, resumes session timer
    - Test break overflow at 90 minutes: OS notification triggered
    - Test break overflow at 105 minutes with no response: session auto-closes at break start time
    - Test micro-break filter: breaks < 8 minutes excluded from UI queries
    - Test micro-break filter: breaks ≥ 8 minutes included in UI queries
    - Test multiple breaks in one session: all tracked independently
    - _Validates: Requirements 7.1–7.6_

  - [x] 8.5 Integration tests for idle → break → resume cycle
    - Test full flow: session active → idle 25 minutes → return → resolve as "Lunch" → break record created → timer resumes with correct elapsed time
    - Test full flow: session active → idle 5 minutes → return → no prompt, no break record (micro-break absorbed)
    - Test full flow: session active → manual break → 30 minutes → resume → correct session time (break excluded)
    - Test full flow: session active → idle → discard → session time excludes gap
    - Test auto-session close: 2+ hours idle → session closed at last activity timestamp
    - Test next-morning recovery: unclosed session from yesterday → prompt to confirm end time
    - _Validates: Requirements 4.1–4.4, 5.1–5.7, 7.1–7.6_

  - [x] 8.6 Stress tests for idle detection timing
    - Test rapid idle/active transitions (every 30 seconds for 10 minutes): no missed events, no duplicate events
    - Test idle detection with varying thresholds (5min, 15min, 30min, 60min): correct classification at each
    - Test soft nudge timing accuracy: fires within ±30 seconds of configured interval over a 3-hour simulated session
    - Test concurrent heartbeat + idle detection: both threads run without interference or deadlocks
    - _Validates: Requirements 5.1, 6.1, performance_

- [x] 9. Checkpoint — Idle detection and break management verified
  - Ensure idle detection fires at threshold, idle modal resolves correctly, breaks transition session card to amber, break overflow triggers notification, micro-breaks are absorbed silently, soft nudge fires after configured interval, and all idle/break tests pass. Ask the user if questions arise.

- [x] 10. Tasks — Projects, task list, inline creation, task detail, Cmd+K switcher
  - [x] 10.1 Implement Projects sidebar and Task list view
    - `src/screens/Tasks/index.tsx`: two-panel layout — projects left, task list right
    - `src/screens/Tasks/ProjectList.tsx`: list of projects with open/closed counts and total time logged, "+ New project" button
    - `src/screens/Tasks/TaskList.tsx`: tasks grouped by status (Open, Closed This Week), each row showing title, assignee, priority, time logged, active indicator
    - `src/screens/Tasks/TaskRow.tsx`: single task row component with status icon, inline fields
    - Create TanStack Query hooks in `src/queries/projects.ts` and `src/queries/tasks.ts` for SQLite reads
    - _Requirements: 8.1, 8.4_

  - [x] 10.2 Implement inline task creation
    - Inline row at top of task list: title input, assignee dropdown, priority dropdown, Enter to create
    - On Enter: insert task into SQLite immediately, no modal or navigation
    - Title and projectId required; assignee, priority, dueDate optional
    - _Requirements: 8.2, 8.3_

  - [x] 10.3 Build Task Detail side panel
    - `src/screens/Tasks/TaskDetail.tsx`: slides in from right on task click
    - Shows: status, assignee, priority, due date, time logged (total/today/sessions), notes field, session history, git context (placeholder for Phase 8)
    - "Mark complete" and "Archive" actions
    - _Requirements: 8.4 (status management)_

  - [x] 10.4 Implement Task Switcher (Cmd+K command palette)
    - `src/components/TaskSwitcher.tsx`: global Cmd+K (Ctrl+K on Windows/Linux) overlay
    - Shows all open tasks grouped by project, current task marked with ●, accumulated time per task
    - Keyboard navigation: ↑↓ to select, Enter to switch, type to filter
    - On select: close current session_task (set endTime), create new session_task, update task status to "inprogress" if was "open", update Zustand
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 10.5 Write property test for task switch maintains single active task
    - **Property 7: Task Switch Maintains Single Active Task**
    - After each switch, exactly one session_task has `endTime = null`. Previous task's endTime = switch timestamp. New task's startTime = same timestamp. Target task transitions open → inprogress.
    - **Validates: Requirements 9.2, 9.3, 20.2**

  - [x] 10.6 Write property test for temporal containment
    - **Property 8: Temporal Containment**
    - For any session_task or break, child's startTime ≥ parent session's startTime, and child's endTime ≤ parent session's endTime. For any closed session, endTime ≥ startTime.
    - **Validates: Requirements 20.3, 20.4, 20.6**

  - [x] 10.7 Write property test for task validation and stale detection
    - **Property 16: Task Validation and Stale Detection**
    - Task status accepts only "open", "inprogress", "done", "blocked". Tasks with no logged time in 7+ days and status ≠ "blocked" are flagged stale.
    - **Validates: Requirements 8.4, 8.5**

- [x] 11. Testing — Task Management
  - [x] 11.1 Unit tests for task CRUD operations
    - Test create task: inserts row with correct fields, auto-generates UUID, sets createdAt
    - Test create task: rejects empty title, rejects missing projectId
    - Test create task: accepts optional fields (assignee, priority, dueDate, notes) as null
    - Test update task status: open → inprogress → done transitions work
    - Test update task status: blocked → open and blocked → inprogress transitions work
    - Test update task status: rejects invalid status values
    - Test archive task: sets archivedAt timestamp
    - Test delete task: cascades or blocks if session_tasks reference it
    - _Validates: Requirements 8.1–8.4_

  - [x] 11.2 Unit tests for project CRUD operations
    - Test create project: inserts with name, auto-assigns color from palette, sets createdBy
    - Test create project: rejects empty name
    - Test archive project: sets archivedAt, tasks remain but project hidden from active list
    - Test project stats: open/closed task counts and total time logged compute correctly
    - _Validates: Requirement 8.1_

  - [x] 11.3 Unit tests for task switching logic
    - Test switch: closes current session_task with endTime = now
    - Test switch: creates new session_task with startTime = now
    - Test switch: only one session_task has endTime = null after switch
    - Test switch: target task status transitions from "open" to "inprogress"
    - Test switch: target task already "inprogress" stays "inprogress"
    - Test switch: target task "blocked" stays "blocked" (no auto-transition)
    - Test switch to same task: rejected (no self-switch)
    - Test rapid switching (10 switches in 5 seconds): all session_tasks have correct non-overlapping time ranges
    - _Validates: Requirements 9.2, 9.3, 20.2_

  - [x] 11.4 Unit tests for stale task detection
    - Test task with no logged time for 7 days → flagged stale
    - Test task with no logged time for 6 days → NOT flagged stale
    - Test blocked task with no logged time for 30 days → NOT flagged stale (excluded)
    - Test task with logged time today → NOT flagged stale
    - Test stale detection returns correct list of stale tasks for weekly review
    - _Validates: Requirement 8.5_

  - [x] 11.5 Component tests for Task Switcher (Cmd+K)
    - Test Cmd+K opens overlay, Escape closes it
    - Test overlay shows all open tasks grouped by project
    - Test current task marked with ● indicator
    - Test keyboard navigation: ↑↓ moves selection, Enter switches task
    - Test text filter: typing narrows task list to matching titles
    - Test accumulated time per task displays correctly
    - Test switch triggers session_task close/open and Zustand update
    - _Validates: Requirements 9.1–9.4_

  - [x] 11.6 Component tests for inline task creation
    - Test inline row appears on "+ Add task" click
    - Test Enter with title creates task immediately in SQLite
    - Test Enter with empty title does nothing (validation)
    - Test assignee and priority dropdowns populate from team/enum data
    - Test created task appears in task list without page refresh
    - _Validates: Requirements 8.2, 8.3_

  - [x] 11.7 Component tests for Task Detail side panel
    - Test panel slides in from right on task click
    - Test panel displays all task metadata correctly
    - Test time logged shows total, today, and session count
    - Test notes field is editable and persists on blur
    - Test "Mark complete" sets status to "done" and closedAt
    - Test "Archive" sets archivedAt and removes from active list
    - Test session history shows all sessions where task was active
    - _Validates: Requirement 8.4_

  - [x] 11.8 Integration tests for task time accumulation
    - Test: start session → switch to task A → work 30 min → switch to task B → work 15 min → end session → task A shows 30 min, task B shows 15 min
    - Test: multiple sessions on same task → time accumulates across sessions
    - Test: task time logged matches sum of all session_task durations for that task
    - _Validates: Requirements 9.2, task time accuracy_

- [x] 12. Checkpoint — Task management verified
  - Ensure projects and tasks CRUD works, inline creation inserts immediately, Cmd+K switches tasks with correct time logging, task detail panel shows accumulated time, stale detection flags correctly, and all task tests pass. Ask the user if questions arise.

- [x] 13. PocketBase Sync — Background sync service, offline queue, auth, realtime subscriptions
  - [x] 13.1 Implement background sync service with offline queue
    - `src/lib/sync.ts`: SyncService class with 60-second interval timer
    - SQLite-backed `sync_queue` table: id, collection, operation (create/update/delete), recordId, data (JSON), timestamp, retryCount
    - On any local write: queue a sync operation in `sync_queue`
    - Each cycle: read up to 50 operations ordered by timestamp, attempt PocketBase REST calls, remove on success
    - On failure: increment retryCount with exponential backoff; after 5 retries move to `sync_dead_letter` table
    - Persist queue across app restarts (SQLite-backed)
    - Update uiStore with last sync time and online/offline status
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 14.1, 14.2, 14.3, 14.4_

  - [x] 13.2 Write property test for offline-first write ordering
    - **Property 10: Offline-First Write Ordering**
    - For any data mutation, the SQLite write completes before any network call is initiated.
    - **Validates: Requirement 13.1**

  - [x] 13.3 Write property test for sync queue durability and ordering
    - **Property 9: Sync Queue Durability and Ordering**
    - Queue persists across restarts, operations flush in timestamp order, no operation is lost — it either syncs or moves to dead letter after 5 retries.
    - **Validates: Requirements 13.2, 13.3, 13.4, 13.5**

  - [x] 13.4 Write property test for sync batch size limit
    - **Property 11: Sync Batch Size Limit**
    - Each sync cycle processes at most 50 operations in timestamp order. Remaining operations stay queued.
    - **Validates: Requirement 14.3**

  - [x] 13.5 Set up PocketBase auth and collections
    - Configure PocketBase client in `src/lib/pocketbase.ts` with email/password auth
    - Create PocketBase collections mirroring SQLite schema: users, projects, tasks, sessions, session_tasks, breaks, idle_events, git_events, weekly_reviews, settings
    - Create `pocketbase/pb_migrations/initial_schema.js` with collection definitions
    - _Requirements: 14.1 (sync target)_

  - [x] 13.6 Implement PocketBase Realtime Manager for team view
    - `src/lib/realtime.ts`: RealtimeManager class managing WebSocket subscriptions
    - Subscribe to: `sessions` (filter: endTime = null), `session_tasks` (filter: endTime = null), `breaks` (filter: endTime = null)
    - On incoming events: update teamStore with member status changes
    - Handle disconnection: show "Last updated X ago" indicator, auto-reconnect with exponential backoff, full state refresh on reconnect
    - _Requirements: 15.1, 15.2, 15.5, 22.2_

- [x] 14. Testing — PocketBase Sync and Realtime
  - [x] 14.1 Unit tests for sync service
    - Test queue operation: local write creates sync_queue entry with correct collection, operation, data, timestamp
    - Test sync cycle: processes up to 50 operations per cycle in timestamp order
    - Test sync cycle: operations beyond 50 remain queued for next cycle
    - Test successful sync: operation removed from queue after PocketBase confirms
    - Test failed sync: retryCount incremented, operation stays in queue
    - Test exponential backoff: retry delays increase correctly (1s, 2s, 4s, 8s, 16s)
    - Test dead letter: operation moved to sync_dead_letter after 5 failed retries
    - Test queue persistence: queue survives simulated app restart (read from SQLite)
    - Test force sync: `forceSync()` flushes immediately without waiting for interval
    - Test sync status: uiStore updated with last sync time after each cycle
    - _Validates: Requirements 13.1–13.5, 14.1–14.3_

  - [x] 14.2 Unit tests for offline behavior
    - Test offline detection: `navigator.onLine = false` → sync cycle skips, queue grows
    - Test offline indicator: uiStore shows "Offline" status
    - Test online recovery: when network returns, next cycle flushes accumulated queue
    - Test offline queue ordering: operations queued offline maintain timestamp order when flushed
    - Test large offline queue: 200+ operations queued offline → flushed in batches of 50 over multiple cycles
    - _Validates: Requirements 13.2, 14.4_

  - [x] 14.3 Unit tests for Realtime Manager
    - Test WebSocket connection: connects to PocketBase on start
    - Test subscriptions: subscribes to sessions, session_tasks, breaks with correct filters
    - Test incoming event: session update → teamStore updated within handler
    - Test incoming event: break created → teamStore member status changes to "On Break"
    - Test disconnection: shows "Last updated X ago" indicator
    - Test reconnection: auto-reconnects with exponential backoff
    - Test reconnection: full state refresh after reconnect (no stale data)
    - Test multiple rapid events: all processed in order, no dropped events
    - _Validates: Requirements 15.1, 15.2, 15.5, 22.2_

  - [x] 14.4 Integration tests for sync round-trip
    - Test: create session locally → sync to PocketBase → verify PocketBase record matches SQLite
    - Test: create task locally → sync → update task locally → sync → PocketBase reflects latest state
    - Test: create session + session_tasks + breaks → sync all → PocketBase has complete session data
    - Test: delete operation syncs correctly (record removed from PocketBase)
    - Test: conflict scenario — local and remote both modified → last-write-wins or appropriate resolution
    - _Validates: Requirements 13.1–13.5, 14.1_

  - [x] 14.5 Stress tests for sync under load
    - Test: 100 rapid local writes → all queued → all synced within 3 sync cycles
    - Test: sync with simulated network latency (500ms per request) → no timeout, no data loss
    - Test: sync with intermittent failures (50% fail rate) → all operations eventually sync or dead-letter
    - Test: concurrent sync + local writes → no race conditions, queue integrity maintained
    - _Validates: Performance, reliability_

- [x] 15. Checkpoint — Sync and realtime verified
  - Ensure background sync flushes to PocketBase every 60 seconds, offline queue persists and retries, dead letter captures exhausted operations, auth works, WebSocket subscriptions deliver team updates, and all sync tests pass. Ask the user if questions arise.

- [x] 16. Team View — Live member cards, activity bars, status badges, week grid
  - [x] 16.1 Build Team screen with live member cards
    - `src/screens/Team/index.tsx`: "Today" and "This Week" tab layout
    - `src/screens/Team/MemberCard.tsx`: avatar, name, status badge, live timer, activity bar, current task, latest output note
    - Cards powered by teamStore (Zustand) updated via WebSocket events
    - _Requirements: 15.2, 15.3, 15.4_

  - [x] 16.2 Write property test for team status label correctness
    - **Property 12: Team Status Label Correctness**
    - Status label is exactly one of "Active", "On Break", "Away", or "Offline". Idle members show "Away", never "Idle" or surveillance language.
    - **Validates: Requirements 15.3, 15.4**

  - [x] 16.3 Implement activity bar and status badge components
    - `src/screens/Team/ActivityBar.tsx`: horizontal bar with indigo (working), amber (break), gray (away) segments proportional to time
    - `src/components/StatusDot.tsx`: colored dots (green active, amber break, gray away, muted offline)
    - `src/components/BadgePill.tsx`: status badge pills with appropriate colors
    - _Requirements: 15.3_

  - [x] 16.4 Build This Week tab with 5-day grid and day drill-down
    - `src/screens/Team/WeekGrid.tsx`: Mon–Fri grid showing each member's daily hours as horizontal bars
    - Team total row at bottom
    - Click any bar → full session timeline for that person that day
    - _Requirements: 15.2_

- [ ] 17. Testing — Team View
  - [x] 17.1 Component tests for MemberCard
    - Test card renders avatar initial, name, and role
    - Test "Active" status: indigo badge, live timer counting, current task displayed
    - Test "On Break" status: amber badge, break duration shown, "☕ ON BREAK · Xm" format
    - Test "Away" status: gray badge, "Away · Since X" format — never "Idle detected"
    - Test "Offline" status: muted badge, no timer, no task
    - Test output note: most recent note displayed below task
    - Test live timer: updates every second for active members
    - _Validates: Requirements 15.2, 15.3, 15.4_

  - [x] 17.2 Component tests for ActivityBar
    - Test bar renders correct proportions: 4h work + 1h break + 30min away → segments proportional
    - Test color mapping: indigo for work, amber for break, gray for away, white for pre-session
    - Test empty state: no session today → empty bar
    - Test full day: 8+ hours → bar fills completely
    - _Validates: Requirement 15.3_

  - [x] 17.3 Component tests for WeekGrid
    - Test grid shows Mon–Fri columns for each team member
    - Test bar widths proportional to hours worked
    - Test team total row sums correctly
    - Test click on bar navigates to full session timeline for that person/day
    - Test empty days show dash or empty state
    - _Validates: Requirement 15.2_

  - [x] 17.4 Integration tests for realtime team updates
    - Test: User A starts session → User B's team view shows A as "Active" within 3 seconds
    - Test: User A takes break → User B's team view shows A as "On Break" within 3 seconds
    - Test: User A goes idle → User B's team view shows A as "Away" (not "Idle")
    - Test: User A ends session → User B's team view shows A as "Offline"
    - Test: 3 team members with different statuses → all render correctly simultaneously
    - _Validates: Requirements 15.2, 15.3, 15.4_

- [x] 18. Weekly Review — Charts, output log, stale tasks, team tab
  - [x] 18.1 Build Weekly Review screen layout
    - `src/screens/Review/index.tsx`: Personal and Team tabs, week navigation (← Week →)
    - KPI row: total hours (weekday/weekend separated), tasks closed, active days, notes count
    - Create TanStack Query hooks in `src/queries/reviews.ts` for aggregating week data from SQLite
    - _Requirements: 16.1, 16.2_

  - [x] 18.2 Implement charts — daily hours area chart and project breakdown bars
    - `src/screens/Review/HoursChart.tsx`: Recharts area chart with smooth curve, indigo fill, Mon–Fri x-axis
    - `src/screens/Review/ProjectBars.tsx`: horizontal bar chart showing per-project time breakdown
    - _Requirements: 16.2_

  - [x] 18.3 Implement output log, needs attention, and next priority sections
    - `src/screens/Review/OutputLog.tsx`: all daily output notes for the week
    - `src/screens/Review/NeedsAttention.tsx`: tasks with no activity 7+ days (stale detection), blocked tasks
    - "One priority for next week" free-text field
    - _Requirements: 16.2, 16.5, 8.5_

  - [x] 18.4 Write property test for weekly review aggregation correctness
    - **Property 17: Weekly Review Aggregation Correctness**
    - Total hours = sum of session durations minus break/discard time. Tasks closed = tasks with closedAt within week. Per-project time = sum of session_task durations grouped by project. Team tab shows no ranking or scoring.
    - **Validates: Requirements 16.2, 16.6**

  - [x] 18.5 Build Team tab in weekly review
    - `src/screens/Review/TeamReview.tsx`: each member's hours, tasks closed, active days for the week
    - No comparison rankings or productivity scores
    - _Requirements: 16.6_

- [ ] 19. Testing — Weekly Review
  - [x] 19.1 Unit tests for weekly review data aggregation
    - Test total hours: sum of session durations minus break/discard time for the week
    - Test total hours: weekday and weekend hours separated correctly
    - Test tasks closed: count matches tasks with closedAt within Monday 00:00 – Sunday 23:59 UTC
    - Test active days: count of days with at least one session
    - Test per-project time: sum of session_task durations grouped by projectId
    - Test output notes: all notes for the week returned in chronological order
    - Test stale tasks: tasks with no logged time 7+ days flagged, blocked excluded
    - Test empty week: all aggregations return zero/empty gracefully
    - Test week boundary: sessions spanning midnight correctly attributed to correct day
    - _Validates: Requirements 16.2, 16.6_

  - [x] 19.2 Component tests for weekly review charts
    - Test HoursChart: renders area chart with correct data points for Mon–Fri
    - Test HoursChart: indigo fill color matches design system accent
    - Test HoursChart: handles zero-hour days gracefully
    - Test ProjectBars: renders horizontal bars proportional to project time
    - Test ProjectBars: project colors match assigned palette colors
    - Test ProjectBars: handles single-project week correctly
    - _Validates: Requirement 16.2_

  - [x] 19.3 Component tests for weekly review sections
    - Test OutputLog: displays all daily notes with correct day labels
    - Test NeedsAttention: shows stale tasks with correct "No activity in X days" message
    - Test NeedsAttention: shows blocked tasks separately
    - Test "One priority" field: editable, persists on save
    - Test week navigation: ← and → buttons change displayed week
    - Test Team tab: shows each member's hours, tasks, active days without rankings
    - _Validates: Requirements 16.2, 16.5, 16.6_

  - [x] 19.4 Integration tests for weekly review end-to-end
    - Test: complete a full week of sessions (5 days, multiple tasks, breaks) → weekly review aggregates all data correctly
    - Test: AI narrative generation → editable draft appears → user edits → saved correctly
    - Test: "Save review" persists weekly_review record with nextPriority and aiNarrative
    - _Validates: Requirements 16.1–16.6_

- [x] 20. Checkpoint — Team view and weekly review verified
  - Ensure team cards update in realtime via WebSocket, activity bars render correctly, weekly review aggregates data accurately, charts render, stale tasks are flagged, team tab shows no rankings, and all team/review tests pass. Ask the user if questions arise.

- [x] 21. Git Integration — Repo config, shell commands, git event storage and display
  - [x] 21.1 Implement git log collection on session end
    - Create `src-tauri/src/git.rs`: function to execute `git log --format="%H %s %ai" --since="{start}" --until="{end}"` via `tauri-plugin-shell` for each configured repo path
    - Expose `collect_git_events` Tauri command
    - On session end: if user has configured repo paths, invoke git log for each repo, parse output, store as `git_events` rows in SQLite linked to session
    - `src/lib/git.ts`: frontend wrapper calling the Tauri command
    - _Requirements: 11.1, 11.2_

  - [x] 21.2 Display git events in session timeline and task detail
    - Add git commit markers to `ActivityTimeline.tsx` showing commit message and timestamp
    - Add git context section to `TaskDetail.tsx` showing commits during sessions where that task was active
    - Display commit message and timestamp only — no commit counts or scores
    - _Requirements: 11.3_

  - [x] 21.3 Write property test for git event session linkage
    - **Property 23: Git Event Session Linkage**
    - For any git commits within a session's time range, each is stored as a git_event linked to that session. Display includes only commit message and timestamp.
    - **Validates: Requirements 11.2, 11.3**

- [ ] 22. Testing — Git Integration
  - [x] 22.1 Unit tests for git log parsing (Rust)
    - Test parse single commit: `"abc1234 Fix bug 2026-04-01 14:30:00 +0000"` → correct hash, message, timestamp
    - Test parse multiple commits: 5 commits → 5 GitEvent records
    - Test parse empty output: no commits in range → empty array
    - Test parse malformed output: gracefully handles unexpected format
    - Test date range filtering: only commits within session start/end included
    - _Validates: Requirement 11.1_

  - [x] 22.2 Unit tests for git event storage
    - Test git events stored with correct sessionId, userId, repoPath, commitHash, message, commitTime
    - Test multiple repos: events from 2 repos stored separately with correct repoPath
    - Test duplicate detection: same commitHash not stored twice for same session
    - _Validates: Requirement 11.2_

  - [x] 22.3 Component tests for git event display
    - Test timeline shows commit markers at correct positions
    - Test commit marker shows message and timestamp only (no count, no score)
    - Test task detail git context: shows commits from sessions where task was active
    - Test no repos configured: git section hidden gracefully
    - _Validates: Requirement 11.3_

  - [x] 22.4 Integration tests for git collection flow
    - Test: configure repo path → start session → make commits → end session → git events collected and stored
    - Test: session with no commits → no git events, no errors
    - Test: invalid repo path → graceful error, no crash, other repos still processed
    - Test: repo path on different OS (macOS/Windows/Linux) → shell command works cross-platform
    - _Validates: Requirements 11.1, 11.2_

- [x] 23. AI Layer — LiteLLM proxy, PocketBase hooks, weekly review draft, NL task creation
  - [x] 23.1 Create LiteLLM proxy configuration and PocketBase JS hooks
    - `litellm/litellm_config.yaml`: model list with all providers (Gemini, Claude, GPT-4o, Qwen, Bedrock, OpenRouter, Ollama)
    - `litellm/Dockerfile` for AWS Lightsail deployment
    - `pocketbase/pb_hooks/ai-weekly-review.js`: POST /api/generate-review endpoint — queries week data, builds prompt, calls LiteLLM, stores narrative
    - `pocketbase/pb_hooks/ai-task-parse.js`: POST /api/parse-task endpoint — parses NL text into structured task fields
    - `pocketbase/pb_hooks/ai-standup.js`: POST /api/generate-standup endpoint
    - `pocketbase/pb_hooks/ai-task-estimate.js`: POST /api/estimate-task endpoint
    - `pocketbase/pb_hooks/ai-team-health.js`: POST /api/team-health endpoint (admin only)
    - `pocketbase/pb_hooks/sync-validator.js`: validates incoming sync data
    - _Requirements: 17.1, 17.2, 17.3_

  - [x] 23.2 Write property test for API key isolation
    - **Property 14: API Key Isolation**
    - For all AI requests from the desktop client, the payload contains no API keys or provider credentials. All key resolution happens server-side in PocketBase JS hooks.
    - **Validates: Requirement 17.2**

  - [x] 23.3 Write property test for AI operates on completed data only
    - **Property 15: AI Operates on Completed Data Only**
    - For all data passed to AI_Dispatcher, every session has a non-null endTime. No active session data is included in any AI request.
    - **Validates: Requirement 17.1**

  - [x] 23.4 Implement AI weekly review draft generation in frontend
    - `src/screens/Review/AIReviewDraft.tsx`: editable AI narrative card in weekly review
    - `src/lib/ai.ts`: `generateWeeklyReview(userId, weekStart)` — calls PocketBase endpoint, receives narrative, displays in editable text area
    - If AI fails: show review data without narrative, display toast "AI unavailable"
    - _Requirements: 16.3, 16.4, 17.4, 17.5_

  - [x] 23.5 Implement natural language task creation
    - In task list input, detect natural language submission
    - Call PocketBase `/api/parse-task` with text, project list, and team list
    - Pre-fill task creation form with parsed fields, require user confirmation
    - If parsing fails: use raw text as title, allow manual field entry
    - _Requirements: 10.1, 10.2, 10.3_

- [ ] 24. Testing — AI Layer
  - [x] 24.1 Unit tests for AI request construction
    - Test weekly review prompt: includes sessions, tasks, breaks, output notes for the week
    - Test weekly review prompt: excludes active sessions (endTime = null)
    - Test weekly review prompt: tone directive present ("direct, non-judgmental, factual")
    - Test weekly review prompt: no productivity scores or member comparisons requested
    - Test task parse prompt: includes project list, team list, today's date
    - Test task parse prompt: returns valid JSON with title, projectId, assigneeId, priority, dueDate
    - Test standup prompt: includes yesterday's sessions, tasks touched, output note
    - Test effort estimate prompt: includes last 30 completed tasks with titles and actual time
    - _Validates: Requirements 17.1, 17.3_

  - [x] 24.2 Unit tests for AI response handling
    - Test successful review response: narrative stored in weekly_reviews.aiNarrative
    - Test successful task parse: structured fields pre-fill form correctly
    - Test malformed AI response: graceful fallback (raw text as title, empty narrative)
    - Test empty AI response: handled without crash, appropriate fallback shown
    - Test AI timeout: 30-second timeout → toast "AI unavailable", data still shown
    - _Validates: Requirements 16.3, 10.2, 10.3, 17.5_

  - [x] 24.3 Unit tests for API key isolation
    - Test: inspect all outgoing requests from desktop client → no API keys in headers or body
    - Test: AI request payload contains only userId, weekStart, model preference — no credentials
    - Test: PocketBase JS hook resolves API key from server environment, not from client request
    - _Validates: Requirement 17.2_

  - [x] 24.4 Component tests for AI features
    - Test AIReviewDraft: renders editable text area with AI narrative
    - Test AIReviewDraft: "Edit draft" button enables editing
    - Test AIReviewDraft: edited narrative persists on save
    - Test AIReviewDraft: loading state shown while AI generates
    - Test AIReviewDraft: error state shows "AI unavailable" with review data still visible
    - Test NL task creation: natural language input → parsed fields pre-fill form → user confirms
    - Test NL task creation: AI failure → raw text becomes title, manual entry available
    - _Validates: Requirements 16.3, 16.4, 10.1–10.3, 17.5_

  - [x] 24.5 Integration tests for AI end-to-end (with mocked LiteLLM)
    - Test: complete week of data → call generate-review → narrative returned and stored → displayed in review screen
    - Test: type "remind arjun to send demo by friday high priority" → parsed to structured task → user confirms → task created
    - Test: AI disabled in settings → no AI requests made, review shows data only
    - Test: LiteLLM proxy down → graceful degradation, toast shown, all non-AI features work
    - Test: switch AI model in settings → next AI request uses new model
    - _Validates: Requirements 10.1–10.3, 16.3, 16.4, 17.1–17.5_

- [x] 25. Checkpoint — Git integration and AI layer verified
  - Ensure git events are collected on session end and displayed in timeline, AI weekly review generates and displays editable narrative, NL task creation parses and pre-fills correctly, AI gracefully degrades on failure, and all git/AI tests pass. Ask the user if questions arise.

- [ ] 26. Polish — Onboarding, menubar/tray, settings, notifications, motion, dark mode, error handling
  - [x] 26.1 Implement 3-step onboarding flow
    - `src/screens/Onboarding/Welcome.tsx`: PACE wordmark + tagline, "Get started →" CTA
    - `src/screens/Onboarding/Profile.tsx`: name and role fields, "Continue →"
    - `src/screens/Onboarding/FirstProject.tsx`: project name field, "Start tracking →"
    - On completion: create user, create project, start session, navigate to Today view — user is tracking before fully understanding the product
    - 3 or fewer user interactions to complete
    - _Requirements: 18.1, 18.2, 18.3_

  - [x] 26.2 Implement system tray icon and menubar dropdown
    - `src-tauri/src/tray.rs`: system tray setup with state-dependent icon colors (gray/indigo pulse/amber/red pulse/muted)
    - Tray dropdown: session duration, current task, quick actions (End Day, Take a Break, Open PACE, Settings)
    - Update tray icon reactively based on session state changes
    - _Requirements: 21.1, 21.2_

  - [x] 26.3 Write property test for tray icon state mapping
    - **Property 20: Tray Icon State Mapping**
    - For any app state, tray icon maps to exactly one visual state: gray (no session), indigo pulse (active), amber (break), red pulse (idle detected), muted (offline). Mapping is deterministic and total.
    - **Validates: Requirement 21.1**

  - [x] 26.4 Implement Settings screen with all configurable options
    - `src/screens/Settings/index.tsx`: sections for General (theme), Session (idle threshold, nudge interval, break cap, auto-pause toggles), Notifications (weekly review time, toggles), AI (enable/disable, LiteLLM URL, model, API key, test connection), Git (repo paths add/remove), Team (profile, members), Data (sync status, PocketBase URL, export, clear cache)
    - On any change: persist to SQLite immediately, apply without restart
    - "Test connection" for AI: verify LiteLLM proxy connectivity, display result
    - _Requirements: 19.1, 19.2, 19.3_

  - [x] 26.5 Write property test for settings persistence round trip
    - **Property 19: Settings Persistence Round Trip**
    - For any settings change, writing to SQLite and reading back produces the original value. Updated setting takes effect immediately without restart.
    - **Validates: Requirement 19.2**

  - [x] 26.6 Implement OS notifications and auto-start
    - Wire `tauri-plugin-notification` for: idle detected, soft nudge, break overflow, weekly review ready
    - Wire `tauri-plugin-autostart` for launch on system startup
    - Wire `tauri-plugin-single-instance` to prevent duplicate windows
    - _Requirements: 21.3, 6.1, 7.4_

  - [x] 26.7 Implement motion system and Sonner toast integration
    - Add Motion (Framer) animations per design system: session start glow bloom (300ms), task switch slide (150ms), break color transition (400ms), idle modal spring (250ms), task close checkmark (300ms), end day collapse (350ms), chart stagger (600ms), side panel slide (250ms)
    - Integrate Sonner for toast notifications: sync errors, AI unavailable, SQLite write failures
    - _Requirements: 22.1 (error toasts)_

  - [x] 26.8 Implement error recovery handlers
    - SQLite write failure: display Sonner toast, retain data in Zustand memory as fallback
    - WebSocket disconnect: auto-reconnect with exponential backoff, refresh full state on reconnect
    - Concurrent session conflict: notify user, offer to close remote session or switch devices
    - _Requirements: 22.1, 22.2, 22.3_

  - [x] 26.9 Dark mode full pass
    - Verify all components render correctly with dark mode CSS custom properties
    - Test theme switching (light/dark/system) applies immediately
    - _Requirements: 19.1_

- [ ] 27. Testing — Polish and Error Handling
  - [x] 27.1 Component tests for onboarding flow
    - Test Welcome screen: renders PACE wordmark, tagline, "Get started →" CTA
    - Test Profile screen: name and role fields required, "Continue →" disabled until filled
    - Test FirstProject screen: project name required, "Start tracking →" creates user + project + session
    - Test flow completion: navigates to Today view with active session
    - Test flow is exactly 3 interactions (click → fill 2 fields → fill 1 field)
    - Test onboarding only shows on first launch, skipped on subsequent launches
    - _Validates: Requirements 18.1, 18.2, 18.3_

  - [x] 27.2 Unit tests for system tray state management (Rust)
    - Test tray icon: gray when no active session
    - Test tray icon: indigo pulse when session active
    - Test tray icon: amber when on break
    - Test tray icon: red pulse when idle detected
    - Test tray icon: muted when offline
    - Test tray dropdown: shows correct session duration, current task, quick actions
    - Test tray state transitions: start session → indigo, take break → amber, resume → indigo, end → gray
    - _Validates: Requirements 21.1, 21.2_

  - [x] 27.3 Unit tests for settings management
    - Test each setting persists to SQLite on change
    - Test each setting reads back correctly after write (round-trip)
    - Test idle threshold: accepts 5–60, rejects out-of-range values
    - Test nudge interval: accepts 30–180, rejects out-of-range values
    - Test break cap: accepts 30–180, rejects out-of-range values
    - Test theme: accepts 'light', 'dark', 'system' only
    - Test git repo paths: add path → stored in JSON array, remove path → removed from array
    - Test AI settings: enable/disable toggle, LiteLLM URL, model, API key persist correctly
    - Test "Test connection": returns success/failure based on LiteLLM proxy reachability
    - Test settings apply without app restart: change idle threshold → idle detection uses new value immediately
    - _Validates: Requirements 19.1, 19.2, 19.3_

  - [x] 27.4 Unit tests for error recovery handlers
    - Test SQLite write failure: Sonner toast displayed with error message, data retained in Zustand
    - Test SQLite write failure: retry on next heartbeat cycle succeeds
    - Test WebSocket disconnect: "Last updated X ago" indicator shown
    - Test WebSocket reconnect: exponential backoff timing correct (1s, 2s, 4s, 8s)
    - Test WebSocket reconnect: full state refresh after reconnect (no stale team data)
    - Test concurrent session conflict: notification shown with correct options
    - Test concurrent session: "Close remote" option closes the other session
    - _Validates: Requirements 22.1, 22.2, 22.3_

  - [x] 27.5 Component tests for motion system
    - Test session start: glow bloom animation fires (300ms ease-out)
    - Test task switch: slide animation fires (150ms ease)
    - Test break transition: indigo → amber color transition (400ms smooth)
    - Test idle modal: spring animation on appearance (250ms)
    - Test task close: checkmark animation fires (300ms)
    - Test end day: session card collapse animation (350ms ease)
    - Test side panel: slide-in from right (250ms ease-out)
    - Test Sonner toast: slide-in bottom-right, auto-dismiss after 4 seconds
    - _Validates: Design system motion specs_

  - [x] 27.6 Dark mode visual regression tests
    - Test all screens render correctly in dark mode: Today, Team, Tasks, Review, Settings
    - Test all components use dark mode tokens: session card, KPI cards, sidebar, modals, badges
    - Test glass morphism effects in dark mode: correct backdrop-filter and border colors
    - Test text contrast: all text meets minimum contrast ratio against dark backgrounds
    - Test theme toggle: switching light → dark → system applies instantly without flicker
    - _Validates: Requirement 19.1_

- [ ] 28. End-to-End Tests — Full Application Flows
  - [x] 28.1 E2E test: Complete daily work loop
    - Launch app → onboarding (first time) → start session → set task → work (simulated timer) → take break → resume → switch task → write output note → end day → verify all data in SQLite
    - Verify: session record, session_tasks, breaks, output note all correct
    - Verify: timer calculations match expected durations
    - _Validates: Full daily loop from PDR_

  - [x] 28.2 E2E test: Crash recovery loop
    - Start session → simulate crash (kill process) → relaunch → verify recovery prompt appears → confirm end time → verify session closed with 'recovered' type → start new session normally
    - _Validates: Requirements 2.1–2.4_

  - [x] 28.3 E2E test: Idle detection and resolution loop
    - Start session → simulate idle (mock user-idle to return 25 minutes) → verify timer pauses → simulate return → verify idle modal appears → resolve as "Meeting" → verify break record created → verify timer resumes with correct elapsed time
    - _Validates: Requirements 5.1–5.5_

  - [x] 28.4 E2E test: Task management full flow
    - Create project → create 3 tasks (inline) → switch between tasks via Cmd+K → mark one complete → verify time logged per task → verify stale detection for untouched task after 7 days
    - _Validates: Requirements 8.1–8.5, 9.1–9.4_

  - [x] 28.5 E2E test: Sync and team visibility
    - User A starts session → syncs to PocketBase → User B's team view shows A as "Active" → A takes break → B sees "On Break" → A ends day → B sees "Offline"
    - Test with simulated network outage: A works offline → queue grows → network returns → queue flushes → B sees updated data
    - _Validates: Requirements 13.1–13.5, 14.1–14.4, 15.1–15.5_

  - [x] 28.6 E2E test: Weekly review generation
    - Complete 5 days of sessions with varied tasks, breaks, and output notes → trigger weekly review → verify all aggregations correct → generate AI narrative (mocked) → edit narrative → save review → verify weekly_review record
    - _Validates: Requirements 16.1–16.6_

  - [x] 28.7 E2E test: Settings persistence and effect
    - Change idle threshold to 30 minutes → verify idle detection uses new threshold → change theme to dark → verify all components render in dark mode → change nudge interval → verify nudge fires at new interval → disable AI → verify no AI requests made
    - _Validates: Requirements 19.1–19.3_

  - [x] 28.8 E2E test: Multi-user concurrent sessions
    - 3 users start sessions simultaneously → each switches tasks independently → one takes a break → team view shows all 3 with correct statuses → one ends day → team view updates → weekly review shows all 3 members' data
    - _Validates: Requirements 15.1–15.4, 16.6_

- [ ] 29. Stress and Edge Case Tests
  - [x] 29.1 Stress test: Rapid task switching
    - Switch tasks 50 times in 60 seconds → verify all session_tasks have correct non-overlapping time ranges → verify only one session_task has endTime = null at any point → verify total task time equals session active time
    - _Validates: Requirements 9.2, 20.2, Property 7_

  - [x] 29.2 Stress test: Large data volume
    - Simulate 90 days of data (90 sessions, 500+ tasks, 1000+ session_tasks, 300+ breaks) → verify weekly review aggregation completes in < 2 seconds → verify task list renders in < 500ms → verify SQLite queries use indexes
    - _Validates: Performance, archive strategy_

  - [x] 29.3 Stress test: Sync queue under pressure
    - Queue 500 sync operations while offline → bring network online → verify all operations sync within 10 cycles (10 minutes) → verify no data loss → verify dead letter queue empty (assuming no server errors)
    - _Validates: Requirements 13.2–13.5, 14.3_

  - [x] 29.4 Edge case test: Session spanning midnight
    - Start session at 11:30 PM → work past midnight → end session at 1:00 AM → verify session not auto-closed at midnight → verify correct total time (1.5 hours) → verify correct day attribution in weekly review
    - _Validates: Edge case from PDR_

  - [x] 29.5 Edge case test: Timezone handling
    - Create sessions with timestamps in different UTC offsets → verify all stored as UTC → verify display layer converts to local timezone correctly → verify weekly review boundaries use UTC Monday 00:00
    - _Validates: Requirement 20.5, Property 13_

  - [x] 29.6 Edge case test: Empty states
    - New user with no data → Today view shows "Start your day" prompt → Team view shows all members as "Offline" → Tasks view shows empty project list → Weekly review shows zero hours, zero tasks → no crashes, no undefined errors
    - _Validates: UI robustness_

  - [x] 29.7 Edge case test: Concurrent session conflict
    - User starts session on Machine A → opens PACE on Machine B → verify conflict detected → choose "Close remote" → verify Machine A's session closed → start new session on Machine B
    - _Validates: Requirement 22.3, edge case from PDR_

  - [x] 29.8 Edge case test: Battery/power loss recovery
    - Start session → simulate power loss (heartbeat stops) → relaunch → verify recovery prompt with last heartbeat timestamp → confirm → session closed within 10 seconds of actual last activity
    - _Validates: Property 7 (crash recovery), edge case from PDR_

- [ ] 30. Security Tests — API key isolation, auth, data protection, input validation, transport
  - [x] 30.1 Security tests for API key isolation
    - Test: inspect all HTTP requests from desktop client to PocketBase → no LiteLLM API keys, no provider credentials in headers, body, or query params
    - Test: inspect Tauri frontend bundle (compiled JS) → no API keys, no secrets, no PocketBase admin credentials embedded
    - Test: PocketBase JS hooks resolve API keys from `process.env` only, never from client request payload
    - Test: LiteLLM proxy master key never transmitted from desktop client
    - Test: settings screen stores `litellmApiKey` locally but never sends it in AI requests (PocketBase hook uses server-side key)
    - _Validates: Requirement 17.2, Property 14_

  - [x] 30.2 Security tests for authentication and authorization
    - Test: unauthenticated requests to PocketBase REST API → rejected with 401
    - Test: unauthenticated WebSocket subscription attempts → rejected
    - Test: auth token expiry → client detects and re-authenticates without data loss
    - Test: user A cannot modify user B's session, task, or settings records via PocketBase API
    - Test: admin-only endpoints (team health analysis) → rejected for non-admin users
    - Test: PocketBase collection rules enforce record-level access (user can only read/write own sessions)
    - _Validates: Auth security, data isolation_

  - [x] 30.3 Security tests for local data protection
    - Test: SQLite database file stored in Tauri's app data directory with OS-level file permissions (not world-readable)
    - Test: auth session tokens stored via Tauri's secure credential storage, not in plaintext SQLite
    - Test: exported data (via "Export all data") does not include auth tokens or API keys
    - Test: "Clear local cache" removes all local data including sync queue and dead letter
    - _Validates: Local data security_

  - [x] 30.4 Security tests for input validation and injection prevention
    - Test: SQL injection via task title → rejected or safely escaped (parameterized queries)
    - Test: SQL injection via output note → rejected or safely escaped
    - Test: SQL injection via project name → rejected or safely escaped
    - Test: XSS via task title (e.g., `<script>alert(1)</script>`) → rendered as text, not executed
    - Test: XSS via output note → rendered as text, not executed
    - Test: XSS via user name/role → rendered as text, not executed
    - Test: oversized input (100KB task title) → rejected with appropriate error
    - Test: unicode/emoji in all text fields → stored and displayed correctly without corruption
    - Test: null bytes in text fields → handled gracefully, no truncation or crash
    - _Validates: Input security, injection prevention_

  - [x] 30.5 Security tests for transport and network
    - Test: all PocketBase communication uses HTTPS (not HTTP)
    - Test: all WebSocket connections use WSS (not WS)
    - Test: all LiteLLM proxy communication from PocketBase uses HTTPS
    - Test: certificate validation is enforced (self-signed certs rejected in production)
    - Test: sync service does not leak data to unintended endpoints (verify request URLs)
    - _Validates: Transport security_

  - [x] 30.6 Security tests for git integration
    - Test: git shell command is constructed with parameterized arguments, not string concatenation
    - Test: repo path with shell metacharacters (e.g., `; rm -rf /`) → safely escaped, no command injection
    - Test: repo path traversal (e.g., `../../etc/passwd`) → rejected or sandboxed
    - Test: git log output contains only commit hash, message, and timestamp — no diffs, no file contents, no credentials
    - _Validates: Shell command security, Requirement 11.1_

  - [x] 30.7 Security tests for AI prompt safety
    - Test: AI prompts contain only work context (task titles, hours, output notes) — no passwords, no personal data beyond work context
    - Test: AI response is treated as untrusted — rendered as text, never executed as code
    - Test: malicious AI response (e.g., containing `<script>` tags or SQL) → safely rendered without execution
    - Test: AI prompt injection via task title or output note (e.g., "ignore previous instructions") → does not alter AI behavior (prompt structure prevents injection)
    - _Validates: AI security, Requirement 17.2_

  - [x] 30.8 Security tests for privacy and surveillance language
    - Test: team view never displays "Idle detected", "Idle time", or "Inactivity" — only "Away"
    - Test: idle gap details (exact idle duration, idle start/end) not visible to other team members
    - Test: no productivity scores, rankings, or comparative metrics visible anywhere in the app
    - Test: admin view shows "unverifiable" flag for backfill sessions but does not expose raw idle data
    - _Validates: Requirements 15.4, design philosophy "Away not Idle"_

- [x] 31. Final checkpoint — Full application verified
  - Ensure all features work end-to-end: onboarding → session lifecycle → idle detection → task management → sync → team view → weekly review → git integration → AI features → settings. All unit tests, integration tests, property-based tests, component tests, E2E tests, stress tests, edge case tests, and security tests pass. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-based tests that can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each major phase
- Testing is integrated at every phase — not deferred to the end
- Test categories: unit tests (logic), component tests (React), integration tests (multi-layer), property-based tests (invariants), E2E tests (full flows), stress tests (performance/limits), edge case tests (boundary conditions), security tests (auth, injection, transport, privacy)
- Property tests validate universal correctness properties from the design document using fast-check
- Implementation follows the PDR's 10-phase build order for incremental progress
- TypeScript (frontend) and Rust (backend) are used throughout — matching the design document
