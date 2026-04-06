# Requirements Document

## Introduction

PACE is a desktop-first work tracking application for Kenesis Labs (3–5 person team), built as a Tauri v2 app with a React 19 + TypeScript frontend and Rust backend. It implements an honest daily work loop — login, set task, work, break, resume, log output, logout — with system-level idle detection, offline-first SQLite storage, PocketBase cloud sync, full team transparency via realtime WebSockets, and an AI reflection layer powered by LiteLLM. This requirements document is derived from the approved design document and captures all functional and non-functional requirements using EARS patterns.

## Glossary

- **PACE_App**: The Tauri v2 desktop application encompassing the React frontend and Rust backend
- **Session_Manager**: The Rust-side component responsible for session lifecycle — start, heartbeat, pause, resume, close, crash recovery
- **Idle_Detector**: The Rust-side component that polls system idle time via the `user-idle` crate and emits events to the frontend
- **Sync_Service**: The frontend background service that flushes local SQLite changes to PocketBase every 60 seconds
- **Realtime_Manager**: The frontend component managing PocketBase WebSocket subscriptions for live team view
- **AI_Dispatcher**: PocketBase JS hooks that route AI requests to LiteLLM proxy server-side
- **Task_Switcher**: The Cmd+K overlay for switching the active task within a session
- **Idle_Modal**: The overlay presented when a user returns from an idle period exceeding 20 minutes
- **Session**: A continuous work period from login to logout for a single user
- **Session_Task**: A time-bounded record linking a task to a session, tracking time spent on that task
- **Break**: A pause within a session, categorized as lunch, short, meeting, or discarded
- **Idle_Event**: A detected period of system inactivity within a session, pending user resolution
- **Micro_Break**: An idle period under 8 minutes that is silently absorbed without user interaction
- **Heartbeat**: A 10-second interval SQLite write recording the session's last known active timestamp
- **Sync_Queue**: A SQLite-backed queue of local data mutations pending upload to PocketBase
- **Dead_Letter_Queue**: Storage for sync operations that have exhausted retry attempts
- **Output_Note**: A free-text field where the user records what they shipped during the day
- **Weekly_Review**: A weekly summary screen with hours, tasks, charts, output notes, and optional AI narrative
- **PocketBase**: The cloud backend providing auth, collections, REST API, and WebSocket realtime subscriptions
- **LiteLLM**: A provider-agnostic AI proxy that routes requests to configured AI providers
- **Soft_Nudge**: An OS notification sent after configurable continuous active time asking if the user is still working

## Requirements

### Requirement 1: Session Start

**User Story:** As a team member, I want to start my work session with an optional backfill time, so that my session accurately reflects when I began working.

#### Acceptance Criteria

1. WHEN a user clicks "Start day" from the menubar or Today view, THE Session_Manager SHALL create a new session record in SQLite with the user-confirmed start time and set `endTime` to null
2. WHEN a user provides a claimed start time earlier than the current time but within 4 hours, THE Session_Manager SHALL create the session with `startType` set to "backfill"
3. WHEN a user provides a claimed start time earlier than the device wake time, THE Session_Manager SHALL create the session with `startVerified` set to false
4. WHEN a session is created, THE Session_Manager SHALL start the Rust heartbeat thread writing `lastHeartbeat` to SQLite every 10 seconds
5. WHEN a session is created, THE Idle_Detector SHALL begin polling system idle time every 30 seconds
6. IF a user attempts to start a session while an active session already exists for that user, THEN THE Session_Manager SHALL reject the request and preserve the existing session

### Requirement 2: Session Heartbeat and Crash Recovery

**User Story:** As a team member, I want my session to be recoverable after a crash or unexpected shutdown, so that I do not lose tracked work time.

#### Acceptance Criteria

1. WHILE a session is active, THE Session_Manager SHALL write the current Unix timestamp to the session's `lastHeartbeat` field in SQLite every 10 seconds
2. WHEN the PACE_App launches and detects a session with `endTime` equal to null and `lastHeartbeat` older than 30 seconds, THE PACE_App SHALL display a recovery prompt showing the last known session state
3. WHEN the user confirms a recovered session's end time, THE Session_Manager SHALL close the session with `startType` set to "recovered" and the user-confirmed end time
4. WHEN the PACE_App launches and detects a session with `endTime` equal to null and `lastHeartbeat` within 30 seconds, THE Session_Manager SHALL resume the session normally

### Requirement 3: Session End

**User Story:** As a team member, I want to end my day with a two-step flow that captures my output, so that my daily contribution is recorded.

#### Acceptance Criteria

1. WHEN a user initiates "End day," THE PACE_App SHALL display a day summary showing total session time, tasks closed, and breaks taken
2. WHEN the user confirms the end-of-day summary with an output note, THE Session_Manager SHALL update the session record with `endTime` and `outputNote`
3. WHEN a session ends, THE Session_Manager SHALL close all open session_tasks and breaks with `endTime` set to the session end time
4. WHEN a session ends, THE Session_Manager SHALL stop the heartbeat thread and idle detection polling
5. WHEN a session ends, THE Sync_Service SHALL queue all modified records for PocketBase sync

### Requirement 4: Auto-Session Pause and Close

**User Story:** As a team member, I want my session to pause automatically on screen lock or sleep, so that idle time is not counted as work.

#### Acceptance Criteria

1. WHEN the operating system reports a screen lock event, THE Session_Manager SHALL pause the session timer silently
2. WHEN the operating system reports a sleep or lid-close event, THE Session_Manager SHALL pause the session timer silently
3. WHEN the system has been idle for 2 or more hours, THE Session_Manager SHALL auto-close the session at the last activity timestamp
4. WHEN a user logs in the next morning and an unclosed session is detected, THE PACE_App SHALL prompt the user to confirm the end time of the previous session

### Requirement 5: Idle Detection

**User Story:** As a team member, I want the app to detect when I step away and classify that time on my return, so that my session accurately reflects work versus away time.

#### Acceptance Criteria

1. WHILE a session is active, THE Idle_Detector SHALL poll system idle time via the `user-idle` crate every 30 seconds
2. WHEN system idle time reaches the user-configured threshold (default 15 minutes, range 5–60 minutes), THE Idle_Detector SHALL pause the session timer and emit an `idle_threshold` event to the frontend
3. WHEN the user returns after an idle period of 20 or more minutes, THE PACE_App SHALL display the Idle_Modal with four resolution options: Lunch break, Short break, Meeting, and Discard
4. WHEN the user selects a resolution other than "Discard," THE Session_Manager SHALL create a break record with the corresponding type and the idle period's time range
5. WHEN the user selects "Discard," THE Session_Manager SHALL remove the idle gap from session time without creating a break record
6. WHEN an idle period is under 8 minutes, THE Idle_Detector SHALL absorb the period silently without emitting any user-visible event or creating any record
7. WHEN an idle period is between 8 and 20 minutes, THE Idle_Detector SHALL record a micro-pause in the session timeline without prompting the user

### Requirement 6: Soft Nudge

**User Story:** As a team member, I want a gentle reminder after long continuous work, so that I can confirm I am still actively working.

#### Acceptance Criteria

1. WHEN continuous active session time reaches the user-configured nudge interval (default 90 minutes, range 30–180 minutes), THE PACE_App SHALL send an OS notification asking "Still working on [current task]?"
2. WHEN the user does not respond to the soft nudge within 5 minutes, THE Session_Manager SHALL pause the session timer
3. WHEN the user returns after a nudge-triggered pause, THE PACE_App SHALL display the Idle_Modal for resolution

### Requirement 7: Break Management

**User Story:** As a team member, I want to take manual or automatic breaks with clear visual feedback, so that break time is tracked separately from work time.

#### Acceptance Criteria

1. WHEN a user clicks the Break button in the session card or menubar dropdown, THE PACE_App SHALL display a break type selector with options: Lunch, Short, and Meeting
2. WHEN a break is started, THE Session_Manager SHALL pause the session timer and create a break record in SQLite with the selected type
3. WHILE a break is active, THE PACE_App SHALL display the session card in amber state with a break timer counting up
4. WHEN a break exceeds 90 minutes, THE PACE_App SHALL send an OS notification: "Still on break? Resume or end your day."
5. WHEN a break exceeds 105 minutes with no user response, THE Session_Manager SHALL auto-close the session at the break start time
6. THE PACE_App SHALL not surface breaks under 8 minutes in the user interface

### Requirement 8: Task Management

**User Story:** As a team member, I want to manage tasks within a two-layer project/task structure, so that I can track time against specific work items.

#### Acceptance Criteria

1. THE PACE_App SHALL enforce a two-layer hierarchy: Projects contain Tasks, with no sub-tasks or additional nesting levels
2. WHEN a user creates a task inline, THE PACE_App SHALL require a title and project association, with optional assignee, priority, and due date fields
3. WHEN a user presses Enter after filling inline task fields, THE PACE_App SHALL create the task record in SQLite immediately without navigation or modal dialogs
4. THE PACE_App SHALL support task statuses of Open, InProgress, Done, and Blocked
5. WHEN a task has no logged time for 7 or more days and the task status is not Blocked, THE PACE_App SHALL flag the task as stale in the weekly review

### Requirement 9: Task Switching

**User Story:** As a team member, I want to switch tasks quickly via a keyboard shortcut, so that task time is logged accurately without interrupting my flow.

#### Acceptance Criteria

1. WHEN the user presses Cmd+K (or Ctrl+K on Windows/Linux), THE Task_Switcher SHALL appear as a command palette overlay showing all open tasks grouped by project
2. WHEN the user selects a task in the Task_Switcher, THE Session_Manager SHALL close the current session_task with `endTime` set to the current timestamp and create a new session_task for the selected task
3. WHEN a task switch occurs and the target task has status "open," THE PACE_App SHALL update the task status to "inprogress"
4. THE Task_Switcher SHALL support keyboard navigation with arrow keys and Enter to select, and text filtering to search tasks

### Requirement 10: Natural Language Task Creation

**User Story:** As a team member, I want to create tasks using natural language, so that I can quickly capture work items without filling out individual fields.

#### Acceptance Criteria

1. WHEN a user submits a natural language task description, THE AI_Dispatcher SHALL parse the text and return structured fields: title, projectId, assigneeId, priority, and dueDate
2. WHEN the AI_Dispatcher returns parsed task fields, THE PACE_App SHALL pre-fill the task creation form and require user confirmation before saving
3. IF the AI_Dispatcher fails to parse the input, THEN THE PACE_App SHALL display the raw text as the task title and allow manual field entry

### Requirement 11: Git Integration

**User Story:** As a developer, I want my git commits linked to my session timeline, so that I have context about what code changes happened during my work.

#### Acceptance Criteria

1. WHEN a session ends and the user has configured git repo paths, THE PACE_App SHALL execute `git log` for each configured repo path filtered to the session's time range
2. WHEN git commits are found within the session time range, THE PACE_App SHALL store them as git_event records linked to the session
3. THE PACE_App SHALL display git commits in the session timeline as context markers showing commit message and timestamp only

### Requirement 12: Output Notes

**User Story:** As a team member, I want to write a daily output note visible to my team, so that everyone knows what I shipped.

#### Acceptance Criteria

1. THE PACE_App SHALL display a free-text output note field at the bottom of the Today view, editable at any time during an active session
2. WHEN the user initiates "End day," THE PACE_App SHALL pre-fill the end-of-day output note with any text written during the session
3. WHEN a session is closed, THE Session_Manager SHALL store the output note in the session record
4. THE PACE_App SHALL display each team member's most recent output note in the Team view

### Requirement 13: Offline-First Data Persistence

**User Story:** As a team member, I want the app to work fully offline, so that network issues never interrupt my work tracking.

#### Acceptance Criteria

1. THE PACE_App SHALL write all data mutations to SQLite before initiating any network call
2. WHILE the network is unavailable, THE Sync_Service SHALL retain all pending operations in the SQLite-backed sync queue
3. WHEN the network becomes available, THE Sync_Service SHALL flush the sync queue to PocketBase in timestamp order within the next 60-second sync cycle
4. IF a sync operation fails after 5 retry attempts with exponential backoff, THEN THE Sync_Service SHALL move the operation to the dead letter queue for manual review
5. THE Sync_Service SHALL persist the sync queue across app restarts

### Requirement 14: Background Sync

**User Story:** As a team member, I want my local data synced to the cloud automatically, so that my team can see my status and my data is backed up.

#### Acceptance Criteria

1. WHILE the PACE_App is running and the network is available, THE Sync_Service SHALL flush pending sync operations to PocketBase every 60 seconds
2. WHEN a sync cycle completes, THE PACE_App SHALL update the UI sync status indicator with the last successful sync timestamp
3. THE Sync_Service SHALL process a maximum of 50 operations per sync cycle, ordered by timestamp
4. WHILE the network is unavailable, THE PACE_App SHALL display an "Offline" indicator in the UI

### Requirement 15: Realtime Team View

**User Story:** As a team member, I want to see my teammates' live session status, so that I know who is working, on break, or away.

#### Acceptance Criteria

1. WHEN the Team view is active, THE Realtime_Manager SHALL maintain WebSocket subscriptions to PocketBase for active sessions, session_tasks, and breaks
2. WHEN a team member's session, task, or break status changes, THE Realtime_Manager SHALL update the Team view within 3 seconds of the PocketBase broadcast
3. THE PACE_App SHALL display each team member's status using the labels: "Active," "On Break," "Away," or "Offline"
4. THE PACE_App SHALL display "Away" for idle team members and SHALL NOT use the term "Idle" or surveillance-related language in any team-visible status
5. WHEN the WebSocket connection drops, THE Realtime_Manager SHALL display a "Last updated X ago" indicator and auto-reconnect with exponential backoff

### Requirement 16: Weekly Review

**User Story:** As a team member, I want a weekly summary of my work with optional AI narrative, so that I can reflect on my output and plan the next week.

#### Acceptance Criteria

1. WHEN the user-configured weekly review time arrives (default Friday 5:00 PM), THE PACE_App SHALL send an OS notification prompting the user to open the Review screen
2. THE PACE_App SHALL display the weekly review with: total hours (weekday and weekend separated), tasks closed with time logged, daily hours chart, per-project time breakdown, all daily output notes, stale task alerts, and git commits
3. WHERE AI features are enabled, THE AI_Dispatcher SHALL generate a narrative draft containing top project by time, tasks closed, gaps, a pattern observation, and a suggested priority
4. THE PACE_App SHALL allow the user to edit the AI-generated narrative before saving
5. THE PACE_App SHALL provide a "One priority for next week" free-text field in the weekly review
6. THE PACE_App SHALL display a Team tab in the weekly review showing each member's hours, tasks closed, and active days without comparison rankings or productivity scores

### Requirement 17: AI Integration Constraints

**User Story:** As a team member, I want AI features that reflect on completed work without interrupting live sessions, so that AI adds value without creating pressure.

#### Acceptance Criteria

1. THE AI_Dispatcher SHALL operate only on completed session data and SHALL NOT process or analyze data from active sessions
2. THE AI_Dispatcher SHALL route all AI requests through PocketBase JS hooks to the LiteLLM proxy, ensuring API keys are resolved server-side and never transmitted to the desktop client
3. THE AI_Dispatcher SHALL NOT produce productivity scores, member rankings, or comparative assessments between team members
4. THE PACE_App SHALL allow the user to fully disable all AI features from the Settings screen
5. IF the LiteLLM proxy returns an error, THEN THE PACE_App SHALL display the weekly review data without the AI narrative and show a toast notification indicating AI is unavailable

### Requirement 18: Onboarding

**User Story:** As a new team member, I want a minimal onboarding flow, so that I can start tracking work within seconds of first launch.

#### Acceptance Criteria

1. WHEN the PACE_App launches for the first time, THE PACE_App SHALL display a three-step onboarding flow: Welcome, Profile (name and role), and First Project (project name)
2. WHEN the user completes the onboarding flow, THE PACE_App SHALL navigate to the Today view with a session already started
3. THE PACE_App SHALL complete the onboarding flow in 3 or fewer user interactions

### Requirement 19: Settings Management

**User Story:** As a team member, I want to configure idle thresholds, nudge intervals, AI settings, and git repos, so that the app adapts to my work style.

#### Acceptance Criteria

1. THE PACE_App SHALL provide configurable settings for: theme (light, dark, system), idle threshold (5–60 minutes), nudge interval (30–180 minutes), break cap (30–180 minutes), weekly review day and time, auto-pause triggers (screen lock, sleep, system idle), AI enable/disable, LiteLLM URL, model, and API key, and git repo paths
2. WHEN the user changes a setting, THE PACE_App SHALL persist the change to SQLite immediately and apply the change without requiring an app restart
3. WHEN the user clicks "Test connection" for AI settings, THE PACE_App SHALL verify connectivity to the configured LiteLLM proxy and display the result

### Requirement 20: Data Integrity Invariants

**User Story:** As a team member, I want the app to enforce data consistency rules, so that my tracked time is always accurate and trustworthy.

#### Acceptance Criteria

1. THE Session_Manager SHALL enforce that at most one session per user has `endTime` equal to null at any point in time
2. THE Session_Manager SHALL enforce that at most one session_task per session has `endTime` equal to null at any point in time
3. THE Session_Manager SHALL enforce that all session_task start and end times fall within the parent session's start and end times
4. THE Session_Manager SHALL enforce that all break start and end times fall within the parent session's start and end times
5. THE PACE_App SHALL store all timestamps as Unix timestamps in UTC, performing local timezone conversion only in the display layer
6. THE Session_Manager SHALL enforce that a session's `endTime` is greater than or equal to the session's `startTime`

### Requirement 21: Menubar and System Tray

**User Story:** As a team member, I want a persistent menubar icon with quick actions, so that I can interact with PACE without opening the full window.

#### Acceptance Criteria

1. THE PACE_App SHALL display a system tray icon reflecting the current state: gray when not logged in, indigo pulse when session is active, amber when on break, red pulse when idle is detected, and muted when offline
2. WHEN the user clicks the system tray icon during an active session, THE PACE_App SHALL display a dropdown showing session duration, current task, and quick actions: End Day, Take a Break, Open PACE, and Settings
3. THE PACE_App SHALL auto-start on system startup via the autostart plugin

### Requirement 22: Error Recovery

**User Story:** As a team member, I want the app to handle errors gracefully, so that I never lose tracked data.

#### Acceptance Criteria

1. IF a SQLite write fails, THEN THE PACE_App SHALL display a toast notification describing the error and retain the data in Zustand memory as a fallback
2. IF the PocketBase WebSocket disconnects, THEN THE Realtime_Manager SHALL auto-reconnect with exponential backoff and refresh full state on reconnection
3. IF a concurrent session conflict is detected (active session on another device), THEN THE PACE_App SHALL notify the user and offer to close the remote session or switch devices
