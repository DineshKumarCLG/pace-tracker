# Implementation Plan: PACE v2 Team Ops

## Overview

Incremental implementation of team-oriented operational features for PACE v2. Each phase builds on the previous — schema first, then core data flows, then screens, then polish. All new code follows existing patterns: Rust commands for computation, Zustand stores for state, React screens with TanStack Query for display, and fast-check property tests for correctness.

## Tasks

- [x] 0. Authentication, Account Creation & Onboarding — The very first thing a user sees
  - [x] 0.1 Build the Sign Up / Login screen
    - `src/screens/Auth/index.tsx`: full-screen auth screen (no sidebar)
    - Two tabs: "Sign Up" and "Log In"
    - **Sign Up fields**: Full name, Email, Password, Confirm password
    - **Log In fields**: Email, Password
    - "Forgot password?" link (sends reset email via PocketBase)
    - Calls PocketBase `users` collection auth: `pb.collection('users').create()` for sign up, `pb.collection('users').authWithPassword()` for login
    - On success: store auth token in Tauri secure storage, navigate to onboarding (new user) or dashboard (returning user)
    - On error: inline validation messages (email taken, password too short, wrong credentials)
    - Skeuomorphic glass card centered on screen, golden accent on primary button
    - _New requirement: Auth is required before any app feature is accessible_
  - [x] 0.2 Implement auth state management
    - Create `src/stores/authStore.ts` (Zustand):
      - `user: { id, name, email, role, avatarColor } | null`
      - `isAuthenticated: boolean`
      - `isLoading: boolean`
      - Actions: `login(email, password)`, `signup(name, email, password)`, `logout()`, `checkAuth()`
    - On app launch: call `checkAuth()` — if PocketBase token is valid, auto-login; if expired, show auth screen
    - Replace hardcoded `CURRENT_USER_ID = "default-user"` everywhere with `authStore.user.id`
    - Wire `logout()` into Settings screen and sidebar user area
    - _Replaces the v1 hardcoded user approach_
  - [x] 0.3 Build the Onboarding flow (replaces v1 stub)
    - `src/screens/Onboarding/index.tsx`: multi-step flow, no sidebar
    - **Step 1 — Welcome**: PACE logo + tagline "Track work, not people." → "Get started"
    - **Step 2 — Profile setup**: Avatar color picker, role/title field (e.g. "Co-founder, Engineering") → "Continue"
    - **Step 3 — Team setup** (first user only):
      - Create or join a team
      - "Create team": Team name field → creates team in PocketBase, generates invite code
      - "Join team": Paste invite code → joins existing team
    - **Step 3 — Join team** (subsequent users):
      - Paste invite code shared by the first founder → auto-joins the team
    - **Step 4 — First project**: Project name field → creates project → "Start tracking"
    - On completion: navigate to Founder Dashboard (v2 landing) with session auto-started
    - 4 steps max, under 60 seconds to complete
    - _Requirements: v1 Req 18.1, 18.2, 18.3 (enhanced)_
  - [x] 0.4 Implement team/invite system
    - New SQLite table `teams`: id, name, inviteCode, createdBy, createdAt
    - New SQLite table `team_members`: teamId, userId, joinedAt
    - New PocketBase collections: teams, team_members (synced)
    - Rust commands: `create_team()`, `join_team(inviteCode)`, `get_team_members()`, `generate_invite_code()`
    - Invite code: 8-character alphanumeric, unique, shareable via copy button
    - All existing queries (sessions, tasks, team view, etc.) scoped to the user's team
    - _New requirement: Multi-user team support replaces single-user hardcoded approach_
  - [x] 0.5 Add auth guard to router
    - Wrap all app routes in an auth check: if not authenticated → redirect to `/auth`
    - If authenticated but not onboarded (no team) → redirect to `/onboarding`
    - If authenticated and onboarded → show app with sidebar
    - Persist auth state across app restarts via PocketBase token in Tauri secure storage
    - _New requirement: No app feature accessible without authentication_
  - [x] 0.6 Build the Settings > Account section
    - Profile editing: name, role, avatar color
    - Change password
    - Team info: team name, invite code (copy button), member list
    - "Invite teammate" button → shows invite code + copy
    - Logout button (clears auth, navigates to auth screen)
    - _Requirements: v1 Req 19.1 (extended)_

- [x] 0.7 Checkpoint — Auth and onboarding verified
  - Ensure: sign up creates PocketBase user, login works, token persists across restart, onboarding creates team + project, invite code joins team, auth guard blocks unauthenticated access, logout clears state

- [x] 1. Schema Extension — SQLite tables and PocketBase migration
  - [x] 1.1 Create v2 SQLite migration with all new tables
    - Add tables: leave_requests, public_holidays, milestones, milestone_tasks, standup_responses, mood_checks, meetings, daily_reports, morning_digests, focus_score_history, teams, team_members
    - Include all CHECK constraints, indexes, and foreign keys per design DDL
    - Add migration to `src-tauri/src/db.rs` schema initialization
    - _Requirements: 24.1, 3.1, 3.2, 4.1, 17.1, 18.2, 19.2, 20.2, 11.2_
  - [x] 1.2 Create PocketBase migration for synced collections
    - Create `pocketbase/pb_migrations/v2_team_ops_schema.js`
    - Add collections: leave_requests, public_holidays, milestones, milestone_tasks, standup_responses, meetings, daily_reports, morning_digests
    - Exclude mood_checks and focus_score_history (private, never synced)
    - _Requirements: 24.2, 25.3_
  - [x] 1.3 Extend sync service with v2 collections
    - Add new collection names to the sync service's collection list in `src/lib/sync.ts`
    - Ensure mood_checks and focus_score_history are excluded from sync queue
    - _Requirements: 24.2, 25.3, 16.3, 16.4_
  - [x] 1.4 Write property test for private data sync exclusion
    - **Property 15: Private data never synced**
    - **Validates: Requirements 16.3, 16.4, 19.3, 25.1, 25.3**
  - [x] 1.5 Write property test for leave dates stored as UTC
    - **Property 36: Leave dates stored as UTC**
    - **Validates: Requirements 24.3**

- [x] 2. Checkpoint — Schema verified
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Leave Management — Balance, holidays, requests, approval
  - [x] 3.1 Implement leave balance computation in Rust
    - Add `compute_leave_balance()` and `validate_leave_request()` commands in Rust
    - Count approved annual/sick leave business days excluding weekends and public holidays
    - Allocate 20 annual, 10 sick per user per year
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.3_
  - [x] 3.2 Write property test for leave balance computation
    - **Property 6: Leave balance computation**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6, 4.3, 7.5**
  - [x] 3.3 Write property test for WFH not affecting balance
    - **Property 7: WFH does not affect leave balance**
    - **Validates: Requirements 3.5**
  - [x] 3.4 Implement leave request creation in Rust
    - Add `create_leave_request()` command
    - Auto-approve sick leave, set pending for annual/wfh
    - Validate balance before annual leave submission
    - Reject past dates, validate startDate < endDate
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 24.1, 24.3_
  - [x] 3.5 Write property test for leave request status assignment
    - **Property 8: Leave request status assignment**
    - **Validates: Requirements 6.2, 6.3**
  - [x] 3.6 Write property test for leave balance validation on submission
    - **Property 9: Leave balance validation on submission**
    - **Validates: Requirements 6.5**
  - [x] 3.7 Implement leave request approval/decline in Rust
    - Add `approve_leave_request()` and `decline_leave_request()` commands
    - Prevent self-approval (reviewerId != requesterId)
    - Require reason on decline
    - Deduct annual leave balance on approval
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 3.8 Write property test for self-approval prevention
    - **Property 10: Self-approval prevention**
    - **Validates: Requirements 7.4**
  - [x] 3.9 Write property test for decline requires reason
    - **Property 11: Decline requires reason**
    - **Validates: Requirements 7.3**
  - [x] 3.10 Implement public holiday CRUD in Rust
    - Add commands for add/edit/remove public holidays
    - Store with date, name, year fields
    - _Requirements: 4.1, 4.2, 4.4_
  - [x] 3.11 Create leaveStore (Zustand)
    - Implement `leaveStore.ts` with state for requests, balances, publicHolidays
    - Actions: submitRequest, approveRequest, declineRequest, loadBalances, loadHolidays
    - Wire to Rust commands via Tauri IPC
    - _Requirements: 6.1, 6.2, 7.1_
  - [x] 3.12 Build Leave Management screen
    - Monthly calendar view with team members as rows, days as columns
    - Color-coded cells: annual leave, sick leave, WFH, public holiday
    - Month navigation, summary bar (available/on-leave/WFH counts)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 3.13 Write property test for team availability summary
    - **Property 12: Team availability summary**
    - **Validates: Requirements 5.4**
  - [x] 3.14 Build Leave Request form
    - Fields: type (annual/sick/wfh), start date, end date, reason
    - Balance validation display, remaining balance shown on rejection
    - OS notification to other founders on submission
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 3.15 Build Request/Approval screen
    - List pending requests with approve/decline actions
    - Decline requires reason input
    - Hide approve/decline on own requests
    - OS notification to requester on decline
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 3.16 Write property test for leave request sync follows offline-first pattern
    - **Property 35: Leave request sync follows offline-first pattern**
    - **Validates: Requirements 24.2**

- [x] 4. Checkpoint — Leave management verified
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Attendance Log — Computation, display, filtering, export
  - [x] 5.1 Implement attendance computation in Rust
    - Add `compute_attendance()` and `get_attendance()` commands
    - Derive login time (earliest session start), logout time (latest session end)
    - Compute total hours (session durations minus break durations)
    - Compute break minutes, extract output note from last closed session
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 5.2 Write property test for attendance login/logout derivation
    - **Property 2: Attendance login/logout derivation**
    - **Validates: Requirements 2.1, 2.2**
  - [x] 5.3 Write property test for attendance hours and break computation
    - **Property 3: Attendance hours and break computation**
    - **Validates: Requirements 2.3, 2.4**
  - [x] 5.4 Write property test for attendance output note from last session
    - **Property 4: Attendance output note from last session**
    - **Validates: Requirements 2.5**
  - [x] 5.5 Implement CSV export in Rust
    - Add `export_attendance_csv()` command
    - Columns: date, person, login time, logout time, total hours, break minutes, output note
    - Return file path after write
    - _Requirements: 1.5_
  - [x] 5.6 Write property test for CSV export round-trip
    - **Property 5: CSV export round-trip**
    - **Validates: Requirements 1.5**
  - [x] 5.7 Build Attendance Log screen
    - Calendar view: one row per day, columns for login/logout/hours/breaks/output note
    - Person filter, date range filter, project filter
    - Export CSV button
    - Empty state when no records match filters
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - [x] 5.8 Write property test for attendance filter correctness
    - **Property 1: Attendance filter correctness**
    - **Validates: Requirements 1.2, 1.3, 1.4**

- [x] 6. Checkpoint — Attendance log verified
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Founder Dashboard — Live status, approvals, health, alerts
  - [x] 7.1 Implement attendance alerts in Rust
    - Add `check_attendance_alerts()` command
    - No alerts on weekends, public holidays, or for users on approved leave
    - Only alert after 12:00 PM local time
    - WFH users get "WFH — not yet logged in" label
    - _Requirements: 14.3, 27.1, 27.2, 27.3, 27.4_
  - [x] 7.2 Write property test for attendance alert exclusions
    - **Property 23: Attendance alert exclusions**
    - **Validates: Requirements 14.3, 27.1, 27.2, 27.3, 27.4**
  - [x] 7.3 Implement overwork detection in Rust
    - Add `detect_overwork()` command
    - Flag days with >10h session time, signal when 3+ in rolling 7-day window
    - Use supportive language in messages
    - _Requirements: 26.1, 26.2, 26.3, 26.4_
  - [x] 7.4 Write property test for overwork detection
    - **Property 22: Overwork detection**
    
    - **Validates: Requirements 10.5, 26.1, 26.2, 26.3**
  - [x] 7.5 Create dashboardStore (Zustand)
    - State: DashboardData, loading flag
    - Refresh action aggregating team status, pending approvals, project health, velocity, upcoming leave, alerts
    - Wire to Rust commands and PocketBase realtime subscriptions
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 14.4_
  - [x] 7.6 Build Founder Dashboard screen
    - Live team status cards (Active/On Break/Away/Offline/On Leave/WFH) via WebSocket
    - Today's combined team hours
    - Pending approval count with link to Requests screen
    - Project health: open tasks, overdue tasks, hours this week per project
    - Weekly velocity (current vs previous week)
    - Upcoming leave (next 14 days)
    - Attendance alerts and overwork signals
    - Milestone deadline warnings
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 14.1, 14.2, 14.3, 14.4_
  - [x] 7.7 Write property test for dashboard combined team hours
    - **Property 26: Dashboard combined team hours**
    - **Validates: Requirements 13.2**
  - [x] 7.8 Write property test for dashboard pending approvals count
    - **Property 27: Dashboard pending approvals count**
    - **Validates: Requirements 13.3**
  - [x] 7.9 Write property test for WFH status indicator
    - **Property 38: WFH status indicator**
    - **Validates: Requirements 8.3**
  - [x] 7.10 Write property test for upcoming leave window
    - **Property 39: Upcoming leave window**
    - **Validates: Requirements 14.2**

- [x] 8. Checkpoint — Dashboard verified
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Team Analytics — Individual metrics, team metrics, focus score
  - [x] 9.1 Implement individual analytics in Rust
    - Add `get_individual_analytics()` command
    - Compute: avg daily hours (4-week rolling), most productive day, peak focus time, task completion rate, output consistency (std dev)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [x] 9.2 Write property test for average daily hours
    - **Property 17: Average daily hours computation**
    - **Validates: Requirements 9.1**
  - [x] 9.3 Write property test for task completion rate
    - **Property 18: Task completion rate computation**
    - **Validates: Requirements 9.4**
  - [x] 9.4 Write property test for output consistency
    - **Property 19: Output consistency computation**
    - **Validates: Requirements 9.5**
  - [x] 9.5 Implement team analytics in Rust
    - Add `get_team_analytics()` command
    - Compute: combined hours per project, velocity trend (8 weeks), availability heatmap, leave impact percentage
    - No comparative rankings between members
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6_
  - [x] 9.6 Write property test for combined hours per project
    - **Property 20: Combined hours per project**
    - **Validates: Requirements 10.1**
  - [x] 9.7 Write property test for velocity trend
    - **Property 21: Velocity trend computation**
    - **Validates: Requirements 10.2, 14.1**
  - [x] 9.8 Write property test for no comparative rankings
    - **Property 16: No comparative rankings**
    - **Validates: Requirements 10.6, 25.4**
  - [x] 9.9 Implement focus score computation in Rust
    - Add `get_focus_score()` command
    - Weighted: session_continuity × 0.4 + min(avg_uninterrupted/60, 1.0) × 0.3 + task_completion × 0.3, scaled to 0–100
    - Store in focus_score_history (local-only, never synced)
    - _Requirements: 16.1, 16.2, 16.3, 16.4_
  - [x] 9.10 Write property test for focus score bounds
    - **Property 14: Focus score computation and bounds**
    - **Validates: Requirements 16.1**
  - [x] 9.11 Create analyticsStore (Zustand) and build Team Analytics screen
    - Individual analytics view with labeled metrics
    - Team analytics view with project hours, velocity chart, availability heatmap, leave impact
    - Focus score displayed only on own analytics view (private)
    - Overwork signals with supportive language
    - _Requirements: 9.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 16.2, 25.1, 25.2_

- [x] 10. Checkpoint — Analytics verified
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Daily Reports — EOD report, morning digest, digest screen
  - [x] 11.1 Implement end-of-day report generation
    - Hook into EndDayFlow to generate report on session close
    - Include: total minutes, tasks with time, breaks with durations, meetings, output note, git commits
    - Store in daily_reports table, handle "No tasks logged" case
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - [x] 11.2 Write property test for end-of-day report completeness
    - **Property 24: End-of-day report completeness**
    - **Validates: Requirements 11.1, 11.2, 20.4**
  - [x] 11.3 Implement morning digest generation
    - Scheduler checks at 8:00 AM local time on workdays
    - Include: per-member hours/tasks/output notes from previous workday, on-leave/WFH list for today
    - Store in morning_digests table
    - OS notification at 8 AM, banner on Today screen if unviewed before noon
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  - [x] 11.4 Write property test for morning digest content
    - **Property 25: Morning digest content**
    - **Validates: Requirements 12.2, 12.3**
  - [x] 11.5 Build Daily Digest screen
    - Display today's standup responses and end-of-day reports from all team members
    - Morning digest view with member summaries and leave/WFH status
    - _Requirements: 11.3, 12.2, 18.3_

- [x] 12. Checkpoint — Reports verified
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Improvements — Streaks, milestones, standup, mood, meetings
  - [x] 13.1 Implement streak computation in Rust
    - Add `compute_streak()` command
    - Walk backwards through workdays, skip weekends/holidays/approved leave
    - Reset on workday with no session and no leave
    - _Requirements: 15.1, 15.2, 15.3, 15.4_
  - [x] 13.2 Write property test for streak computation
    - **Property 13: Streak computation**
    - **Validates: Requirements 15.1, 15.3, 15.4**
  - [x] 13.3 Display streak on Team view MemberCard
    - Show current streak count on each member's card
    - _Requirements: 15.2_
  - [x] 13.4 Implement milestone CRUD
    - Create/edit milestones with name, project, deadline
    - Junction table milestone_tasks for task association
    - Completion gate: only mark complete when all tasks are done
    - Display on project detail view sorted by deadline
    - Deadline warning (within 3 days) on Dashboard and Tasks screen
    - _Requirements: 17.1, 17.2, 17.3, 17.4_
  - [x] 13.5 Write property test for milestone completion gate
    - **Property 28: Milestone completion gate**
    - **Validates: Requirements 17.4**
  - [x] 13.6 Write property test for milestone deadline warning
    - **Property 29: Milestone deadline warning**
    - **Validates: Requirements 17.3**
  - [x] 13.7 Write property test for milestone sort order
    - **Property 30: Milestone sort order**
    - **Validates: Requirements 17.2**
  - [x] 13.8 Implement async standup prompt
    - Show "What are you working on today?" on first session start of workday
    - Store response in standup_responses table
    - Dismiss = no re-prompt for that day
    - Display all responses on Daily Digest screen
    - _Requirements: 18.1, 18.2, 18.3, 18.4_
  - [x] 13.9 Write property test for standup prompt once per day
    - **Property 31: Standup prompt once per day**
    - **Validates: Requirements 18.1, 18.4**
  - [x] 13.10 Implement mood check-in
    - Optional prompt on session start/end with 5-point energy scale and one-word mood tag
    - Store in mood_checks (local-only, never synced)
    - Display trends on private analytics view only
    - Dismiss = no record
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_
  - [x] 13.11 Write property test for mood dismissal produces no record
    - **Property 32: Mood check dismissal produces no record**
    - **Validates: Requirements 19.5**
  - [x] 13.12 Implement meeting logger
    - Extend IdleModal: when "Meeting" selected, show title (required) and attendees (optional) fields
    - Store in meetings table linked to break and session
    - Display in session timeline with meeting title
    - _Requirements: 20.1, 20.2, 20.3_
  - [x] 13.13 Write property test for meeting record linkage
    - **Property 33: Meeting record linkage**
    - **Validates: Requirements 20.2**

- [x] 14. Checkpoint — Improvements verified
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. AI Features — Smart leave suggestions, monthly digest PDF
  - [x] 15.1 Create smart leave suggester PocketBase hook
    - New hook `pocketbase/pb_hooks/ai-smart-leave.js`
    - Detect conflicts: other members on leave, milestone deadlines within 3 days, low availability
    - AI suggestions for alternative dates via LiteLLM (graceful fallback if unavailable)
    - Conflicts are advisory only, never block submission
    - _Requirements: 21.1, 21.2, 21.3, 21.4_
  - [x] 15.2 Write property test for smart leave conflict detection
    - **Property 34: Smart leave conflict detection**
    - **Validates: Requirements 21.1, 21.4**
  - [x] 15.3 Wire smart leave suggestions into leave request form
    - Call hook when form opens, display conflicts and AI suggestions
    - Show conflicts-only fallback when AI unavailable
    - _Requirements: 21.1, 21.2, 21.3_
  - [x] 15.4 Implement monthly digest PDF generation
    - Use jsPDF to generate PDF with: total team hours, hours per person, hours per project, tasks completed, leave days per person, weekly output note summaries
    - PACE branding (indigo accent, Geist typography)
    - Month selector for any past month, Save As dialog
    - _Requirements: 22.1, 22.2, 22.3, 22.4_
  - [x] 15.5 Write property test for monthly digest content
    - **Property 37: Monthly digest PDF content**
    - **Validates: Requirements 22.1**

- [x] 16. Checkpoint — AI features verified
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Navigation and Polish
  - [x] 17.1 Update sidebar navigation
    - Add Team Ops section divider with new items: Dashboard, Attendance, Leave, Requests, Analytics, Digest, Monthly
    - Keep existing v1 items in place
    - Add routes to `src/router.tsx`
    - _Requirements: 23.1, 23.2, 23.3_
  - [x] 17.2 Implement WFH session expectations
    - On WFH days, session logging expected as normal
    - On leave days, no session expected
    - WFH indicator on Dashboard team status
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 17.3 Add OS notifications for leave workflow
    - Notification on leave/WFH request submission to other founders
    - Notification on decline with reason to requester
    - Notification on sync conflict for leave requests
    - Morning digest notification at 8 AM
    - _Requirements: 6.4, 7.3, 12.4, 24.4_
  - [x] 17.4 Responsive layout and animations for new screens
    - Ensure all v2 screens follow existing design system (HeroUI principles, Geist fonts, indigo accent)
    - Smooth transitions between screens (<200ms navigation)
    - _Requirements: 23.3_

- [x] 18. Workspace Access Proof — Geolocation, photo capture, AI verification
  - [x] 18.1 Create workspace proof schema
    - New SQLite table `workspace_proofs`: id, sessionId, userId, type (checkin/checkout), photoPath, photoHash, lat, lng, accuracy, locationId, aiVerified (yes/no/pending/unavailable), aiReason, exifTimestamp, createdAt
    - New SQLite table `workspace_locations`: id, userId, name (e.g. "Kenesis HQ", "Home Office"), lat, lng, radiusMeters (default 200), isOfficeZone (boolean), createdAt
    - New SQLite table `office_zones`: id, teamId, name, lat, lng, radiusMeters (default 500), createdBy, createdAt
    - Add to PocketBase migration: workspace_proofs (synced with photo as file field), workspace_locations (synced), office_zones (synced)
    - Add workspace_proofs to sync service collection list
  - [x] 18.2 Implement geolocation capture in Rust
    - Add `get_current_location()` Tauri command using `navigator.geolocation.getCurrentPosition()` via WebView bridge
    - Return lat, lng, accuracy in meters
    - Fallback: if geolocation unavailable (permissions denied, no WiFi), allow manual location selection from saved locations
    - Store accuracy alongside coordinates — flag low-accuracy readings (>1km) with amber indicator
  - [x] 18.3 Implement auto-tagging location system
    - Add `match_or_create_location()` Rust command
    - On check-in: compare current lat/lng against user's saved `workspace_locations` using Haversine distance
    - If within 200m of a saved location → auto-tag with that location's name
    - If new location → prompt: "Name this workspace?" → save to `workspace_locations`
    - Also check against team `office_zones` — if within zone radius, tag as that office name and set `isInOfficeZone = true`
    - Team sees friendly name ("Kenesis HQ"), not raw coordinates
  - [x] 18.4 Write property test for location auto-tagging
    - **Property 40: Location auto-tag within radius**
    - Generate random lat/lng pairs and saved locations, verify Haversine matching within 200m radius correctly tags, and outside radius prompts for new name
  - [x] 18.5 Implement photo capture and upload
    - Webcam capture: `navigator.mediaDevices.getUserMedia({ video: true })` → capture frame → compress to JPEG (max 500KB)
    - File upload fallback: drag-and-drop zone or file picker accepting JPEG/PNG
    - For uploaded files: extract EXIF timestamp, reject if older than 5 minutes (prevent reusing old photos)
    - If no EXIF data: accept with "unverified timestamp" flag
    - Store photo locally as file in Tauri app data directory, reference path in `workspace_proofs`
    - Sync photo to PocketBase as file attachment on the workspace_proofs record
  - [x] 18.6 Write property test for EXIF timestamp validation
    - **Property 41: EXIF freshness validation**
    - Generate timestamps at various offsets from now, verify: within 5 min → accepted, beyond 5 min → rejected, no EXIF → accepted with flag
  - [x] 18.7 Implement mandatory check-in gate on session start
    - Modify `StartSessionFlow` component: before session starts, show Workspace Proof modal
    - Modal layout: left side = webcam preview (or file drop zone), right side = location info (auto-detected or manual)
    - "Capture & Start" button: takes photo + captures location simultaneously → creates `workspace_proofs` record with type=checkin → then starts session
    - Session CANNOT start without a completed proof record. No skip, no bypass.
    - If webcam unavailable: show file upload zone with instruction "Take a photo on your phone and drop it here"
    - If geolocation unavailable: show dropdown of saved locations + "Add new location" option
    - WFH days: photo still required, location auto-tags as WFH location, no office zone enforcement
    - Loading state while capturing, error states for camera/location failures
  - [x] 18.8 Implement mandatory check-out proof on session end
    - Modify `EndDayFlow` component: before session ends, show Workspace Proof modal (same as check-in)
    - Creates `workspace_proofs` record with type=checkout
    - Session CANNOT end without checkout proof
    - Crash recovery edge case: if app crashed without checkout, on next launch show "You missed your checkout — please provide proof now" with same modal
  - [x] 18.9 Create AI photo verification PocketBase hook
    - New hook `pocketbase/pb_hooks/ai-workspace-verify.js`
    - On workspace_proofs record create: send photo to LiteLLM vision endpoint
    - Prompt: "Is this a photo of a workspace, desk, or office environment? Reply with JSON: {verified: true/false, reason: string}"
    - Update proof record: aiVerified = yes/no, aiReason = LLM response
    - If LLM unavailable: set aiVerified = "unavailable", don't block anything
    - Flagged photos (aiVerified = no) get amber badge in attendance log — advisory only, never blocks
    - Rate limit: max 1 verification per proof record (no retries on failure)
  - [x] 18.10 Write property test for AI verification status transitions
    - **Property 42: AI verification never blocks session**
    - Verify: regardless of AI response (yes/no/unavailable/error), session start and end are never blocked
  - [x] 18.11 Implement office zone management in Settings
    - Settings > Team > Office Zones section
    - Add/edit/remove office zones: name, address (geocoded to lat/lng), radius (default 500m)
    - Map preview showing zone circle (use a simple static map image or Leaflet)
    - Any founder can manage zones
  - [x] 18.12 Create workspaceProofStore (Zustand) and build proof components
    - `src/stores/workspaceProofStore.ts`: current proof state, saved locations, office zones
    - Actions: captureProof, uploadPhoto, getLocation, matchLocation, saveLocation
    - `src/components/WorkspaceProofModal.tsx`: reusable modal for check-in and check-out
    - Webcam preview component with capture button
    - File drop zone component with EXIF validation
    - Location display with auto-tag or manual selection
  - [x] 18.13 Integrate proof data into existing screens
    - Attendance Log: add "Check-in" and "Check-out" columns with photo thumbnails + location tag
    - Click thumbnail → modal with full photo, map pin, timestamp, AI verification status
    - Founder Dashboard: check-in status per member (✅ Verified / 🟡 Unverified / 🟡 AI Flagged / ⬜ Pending)
    - Monthly Report PDF: include check-in compliance rate (% of sessions with verified proofs)
  - [x] 18.14 Write property test for mandatory proof enforcement
    - **Property 43: Session requires proof**
    - Verify: session start always has exactly one checkin proof, session end always has exactly one checkout proof, no session exists without at least a checkin proof

- [ ] 19. AWS Lightsail Deployment — Docker Compose, SSL, CI
  - [x] 19.1 Create `docker-compose.yml` at project root
    - Two services: `pocketbase` and `litellm`
    - PocketBase: build from `pocketbase/Dockerfile`, expose port 8090, volume mount `pb_data` to `/app/pb_data` on 60GB SSD
    - LiteLLM: build from `litellm/Dockerfile`, expose port 4000, depends_on pocketbase
    - Shared Docker network, restart policy `unless-stopped`
    - Environment variables via `.env` file: `LITELLM_MASTER_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD`
    - Health checks for both services
  - [x] 19.2 Create Caddy reverse proxy config for SSL
    - Add `Caddyfile` at project root
    - Auto-HTTPS via Let's Encrypt for the production domain
    - Reverse proxy `/api/*` and `/_/*` to PocketBase :8090
    - Reverse proxy `/llm/*` to LiteLLM :4000
    - Add Caddy as third service in `docker-compose.yml`, expose ports 80 and 443
    - Volume mount for Caddy data (certificates) and config
  - [x] 19.3 Create deployment script
    - `deploy/setup.sh`: provisions a fresh Lightsail instance (ap-south-1 Mumbai, $10/mo plan, 60GB SSD)
    - Installs Docker + Docker Compose on the instance
    - Clones repo, copies `.env`, runs `docker compose up -d`
    - Opens firewall ports 80, 443, 22
    - `deploy/update.sh`: pulls latest, rebuilds containers, runs PocketBase migrations, restarts with zero downtime (`docker compose up -d --build`)
  - [ ] 19.4 Configure PocketBase migration deployment
    - Ensure `pocketbase/pb_migrations/` is volume-mounted so migrations run on container start
    - Both `initial_schema.js` and `v2_team_ops_schema.js` applied automatically
    - Add migration verification step to `deploy/update.sh`
  - [ ] 19.5 Update frontend environment config
    - Add `VITE_PB_URL` and `VITE_LITELLM_URL` to `.env.production`
    - Update `src/lib/pocketbase.ts` to read from `import.meta.env.VITE_PB_URL` (default: `https://your-domain.com`)
    - Update `src/lib/ai.ts` to read from `import.meta.env.VITE_LITELLM_URL` (default: `https://your-domain.com/llm`)
    - Tauri app bundles these URLs for production builds
  - [ ] 19.6 Add health monitoring
    - Docker health checks: PocketBase `/api/health`, LiteLLM `/health`
    - `deploy/health-check.sh`: curl both endpoints, exit 1 on failure (cron-friendly)
    - Optional: UptimeRobot or similar free monitoring on the health endpoints
    - Log rotation for Docker containers (json-file driver, 10MB max, 3 files)
  - [ ] 19.7 Document deployment in README
    - Add `deploy/README.md` with:
      - Prerequisites (AWS account, domain name, SSH key)
      - Step-by-step first deployment guide
      - Environment variable reference
      - Update/rollback procedure
      - Cost breakdown: ~$10/mo Lightsail (covered by AWS credits ~20 months)
      - Backup strategy: daily PocketBase `pb_data` snapshot via Lightsail automatic snapshots

- [ ] 20. Final Checkpoint — All features integrated and deployed
  - Ensure all tests pass, deployment verified, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check with minimum 100 iterations per property
- Checkpoints between phases ensure incremental validation
- Private data (focus score, mood checks) is never synced — enforced at schema and sync service level
- All 43 correctness properties from the design are covered across phases
- Workspace proof photos synced to PocketBase as file attachments, AI verification is advisory-only

## App Flow — Complete User Journeys

### First Launch Flow (New User)

```
Download PACE → Launch app
     │
     ▼
┌─────────────────────────────────────────┐
│  AUTH SCREEN                            │
│                                         │
│  [Sign Up]  [Log In]                    │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │  Full name    [________________]    ││
│  │  Email        [________________]    ││
│  │  Password     [________________]    ││
│  │  Confirm      [________________]    ││
│  │                                     ││
│  │  [Create Account]                   ││
│  │                                     ││
│  │  Already have an account? Log in    ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
     │
     ▼ (account created via PocketBase)
┌─────────────────────────────────────────┐
│  ONBOARDING — Step 1: Welcome           │
│                                         │
│        [PACE Logo]                      │
│   "Track work, not people."             |
│                                         │
│        [Get started →]                  │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│  ONBOARDING — Step 2: Profile            │
│                                          │
│  Pick your color:  🟡 🟢 🔵 🟣 🔴     │
│  Your role:  [Co-founder, Engineering]   │
│                                          │
│        [Continue →]                      │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│  ONBOARDING — Step 3: Team               │
│                                          │
│  [Create a team]    [Join a team]        │
│                                          │
│  Create:                                 │
│  Team name: [Kenesis Labs_________]      │
│  → Generates invite code: KEN-X7F2       │
│  → Share this with your co-founders      │
│                                          │
│  Join:                                   │
│  Invite code: [________]                 │
│  → Joins existing team                   │
│                                          │
│        [Continue →]                      │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│  ONBOARDING — Step 4: First Project     │
│                                         │
│  Project name: [PACE App_____________]  │
│                                         │
│        [Start tracking →]               │
└─────────────────────────────────────────┘
     │
     ▼ (project created, session auto-started)
     │
     ▼
  FOUNDER DASHBOARD (landing screen)
  → Session running, standup prompt shown
```

### Returning User Flow

```
Launch PACE → Auth token found in secure storage
     │
     ▼ (auto-login via PocketBase token validation)
     │
     ├─ Token valid → Founder Dashboard (skip auth + onboarding)
     │
     └─ Token expired → Auth screen (Log In tab)
```

### Invite Flow (Second Founder Joins)

```
First founder shares invite code: KEN-X7F2
     │
Second founder:
  1. Downloads PACE → Launch
  2. Sign Up → Create account
  3. Onboarding Step 3 → "Join a team" → Paste KEN-X7F2
  4. Joins Kenesis Labs team → sees existing projects + team members
  5. Creates first project (or skips if team already has projects)
  6. Lands on Founder Dashboard → sees first founder's live status
```

### Daily Flow (Morning → Evening)

```
8:00 AM  → OS notification: "Morning digest ready"
         → Open PACE → Founder Dashboard is the landing screen
         → See: who's active, who's on leave, pending approvals, project health
         → Tap morning digest banner → read yesterday's team summary

8:05 AM  → Click "Start Session" → WORKSPACE PROOF MODAL appears (mandatory)
         → Left: webcam preview (or file drop zone if no webcam)
         → Right: location auto-detected → "Kenesis HQ" (auto-tagged)
         → Click "Capture & Start" → photo taken + location saved
         → AI verifies photo in background (workspace? ✅)
         → Standup prompt: "What are you working on today?"
         → Type: "Finishing the API integration" → Submit
         → Optional mood check: ⚡ High energy → Submit (or dismiss)
         → Session starts → Timer running → Cmd+K to pick first task

During day → Work on tasks, switch via Cmd+K
           → Idle detection → Meeting resolution → Meeting logger captures title + attendees
           → Manual breaks with type selector
           → Output note updated throughout the day

5:30 PM  → Click "End Day" → WORKSPACE PROOF MODAL appears (mandatory)
         → Same flow: photo + location captured
         → Day summary (hours, tasks, breaks)
         → Output note pre-filled → Confirm
         → EOD report auto-generated: "Kenesis wrapped up — 6h 14m · 3 tasks closed · API integration shipped"
         → Report visible to all team members in Daily Digest
         → Session ends → Timer stops → Goodbye screen
```

### Leave Request Flow

```
Requester:
  1. Open Leave Management screen → Click "Request Leave"
  2. Select type: Annual Leave / Sick Leave / WFH
  3. Pick dates on calendar → See remaining balance
  4. Smart Leave Suggester shows: "Arjun is also off Apr 10–12. 2 high-priority tasks due."
  5. Add reason (optional for annual, not needed for sick)
  6. Submit → OS notification sent to all other founders
  7. If sick leave → auto-approved immediately, balance deducted
  8. If annual/WFH → status = "pending", appears in Requests screen

Approver:
  1. Gets OS notification: "Priya requested annual leave Apr 10–14"
  2. Open Requests screen (or tap notification)
  3. See request details: type, dates, reason, conflicts
  4. Tap "Approve" → Calendar updates, balance deducted, requester notified
  5. OR tap "Decline" → Must enter reason → Requester gets OS notification with reason

Self-approval blocked:
  - Your own requests show "Awaiting approval" — no approve/decline buttons
```

### Founder Dashboard — What You See Every Morning

```
┌─────────────────────────────────────────────────────────┐
│  FOUNDER DASHBOARD                                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  TEAM STATUS (live via WebSocket)                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Kenesis  │ │ Arjun    │ │ Priya    │ │ Sam      │   │
│  │ ● Active │ │ ☕ Break  │ │ 🏠 WFH   │ │ 🌴 Leave │   │
│  │ 2h 14m   │ │ 15m      │ │ 1h 30m   │ │ —        │   │
│  │ API work │ │ —        │ │ Design   │ │ —        │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                          │
│  TODAY'S TEAM: 5.2h combined                             │
│                                                          │
│  ⚠ PENDING APPROVALS (2)                                │
│  • Priya: WFH request Apr 15 → [Approve] [Decline]      │
│  • Sam: Annual leave Apr 20–24 → [Approve] [Decline]    │
│                                                          │
│  PROJECT HEALTH                                          │
│  PACE App     12 open · 0 overdue · 18h this week       │
│  API Gateway   5 open · 2 overdue · 6h this week        │
│                                                          │
│  VELOCITY: 8 tasks this week (↑ from 5 last week)       │
│                                                          │
│  UPCOMING LEAVE (next 14 days)                           │
│  Apr 10–12  Arjun (Annual)                               │
│  Apr 15     Priya (WFH) — pending                        │
│                                                          │
│  ⚠ ALERTS                                                │
│  • Sam hasn't logged in today (12:15 PM)                 │
│  • Arjun: 10+ hours on 3 days this week — take a break  │
│                                                          │
│  🎯 MILESTONES                                           │
│  Demo ready → Due Apr 10 (2 days) · 3 tasks remaining   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Attendance Log — Historical View

```
┌─────────────────────────────────────────────────────────┐
│  ATTENDANCE LOG                                          │
│  [Person ▾] [Date range ▾] [Project ▾] [Export CSV]     │
├─────────────────────────────────────────────────────────┤
│  Date       Login   Logout  Hours  Breaks  Output Note  │
│  ─────────  ──────  ──────  ─────  ──────  ──────────── │
│  Apr 1      9:02    17:45   7.2h   45m     Shipped hero │
│  Apr 2      8:55    18:10   7.8h   30m     API done     │
│  Apr 3      —       —       —      —       (On Leave)   │
│  Apr 4      9:30    16:00   5.5h   60m     Bug fixes    │
│  Apr 5      —       —       —      —       (Weekend)    │
│  Apr 6      —       —       —      —       (Weekend)    │
│  Apr 7      9:15    17:30   6.8h   45m     Tests pass   │
└─────────────────────────────────────────────────────────┘
```

### Leave Management — Team Calendar

```
┌─────────────────────────────────────────────────────────┐
│  LEAVE MANAGEMENT          [← April 2026 →]             │
│  [Request Leave]                                         │
├─────────────────────────────────────────────────────────┤
│           Mon  Tue  Wed  Thu  Fri  Sat  Sun             │
│  Kenesis   ·    ·    ·    ·    ·                        │
│  Arjun     ·    ·   🟡   🟡   🟡                       │
│  Priya     ·   🟢    ·    ·    ·                        │
│  Sam       ·    ·    ·    ·    ·                        │
│                                                          │
│  🟡 = Annual Leave  🔴 = Sick  🟢 = WFH  🔵 = Holiday  │
│                                                          │
│  TODAY: 3 available · 1 on leave · 0 WFH                │
│                                                          │
│  BALANCES                                                │
│  Kenesis: 18/20 annual · 10/10 sick                     │
│  Arjun:   15/20 annual · 9/10 sick                      │
│  Priya:   20/20 annual · 10/10 sick                     │
│  Sam:     17/20 annual · 8/10 sick                      │
└─────────────────────────────────────────────────────────┘
```

### Team Analytics — Deep Patterns

```
┌─────────────────────────────────────────────────────────┐
│  TEAM ANALYTICS     [Individual ▾] [Team ▾]             │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  YOUR ANALYTICS (4-week rolling)                         │
│  Avg daily hours:     6.2h                               │
│  Most productive day: Wednesday                          │
│  Peak focus time:     10:00–12:00                        │
│  Task completion:     78%                                │
│  Output consistency:  ±0.8h (high)                       │
│                                                          │
│  🔒 PRIVATE — Focus Score: 72/100                        │
│  Session continuity: 85%                                 │
│  Avg uninterrupted:  42 min                              │
│  (Only you can see this)                                 │
│                                                          │
│  TEAM VIEW                                               │
│  Hours by project:  PACE 62h · API 18h · Docs 8h        │
│  Velocity trend:    ↗ 8 → 12 → 10 → 14 tasks/week      │
│  Leave impact:      -12% hours in weeks with leave       │
│  ⚠ Overwork: Arjun worked 10+ hours on 3 days           │
│                                                          │
│  AVAILABILITY HEATMAP (4 weeks)                          │
│  [visual grid — who worked when]                         │
└─────────────────────────────────────────────────────────┘
```

### Daily Digest — Morning + EOD Feed

```
┌─────────────────────────────────────────────────────────┐
│  DAILY DIGEST                    Thursday, April 2       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  MORNING STANDUP                                         │
│  Kenesis: "Finishing API integration, then tests"        │
│  Arjun:   "Design review + hero section polish"          │
│  Priya:   "Sprint planning + backlog grooming"           │
│  Sam:     (on leave today)                               │
│                                                          │
│  YESTERDAY'S WRAP-UP                                     │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Kenesis — 6h 14m · 3 tasks · "Shipped API v2"     │  │
│  │ Tasks: API endpoints (2h), Tests (1.5h), Docs (1h)│  │
│  │ Breaks: Lunch 45m · Meeting 30m (with client)      │  │
│  │ Commits: 4 (abc123, def456, ...)                   │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Arjun — 7h 30m · 2 tasks · "Hero section done"    │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Priya — 5h 45m · 1 task · "Sprint retro notes"    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ON LEAVE TODAY: Sam (Annual)                            │
│  ON WFH TODAY: (none)                                    │
└─────────────────────────────────────────────────────────┘
```

### Monthly Report — PDF Export

```
┌─────────────────────────────────────────────────────────┐
│  MONTHLY REPORT              [← March 2026 →]           │
│                              [Generate PDF]              │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  TEAM SUMMARY — March 2026                               │
│  Total team hours:  520h                                 │
│  Tasks completed:   47                                   │
│  Leave days taken:  8                                    │
│                                                          │
│  HOURS PER PERSON                                        │
│  Kenesis  132h  ████████████████                         │
│  Arjun    140h  █████████████████                        │
│  Priya    128h  ███████████████                          │
│  Sam      120h  ██████████████                           │
│                                                          │
│  HOURS PER PROJECT                                       │
│  PACE App      280h  ████████████████████████            │
│  API Gateway   140h  ████████████████                    │
│  Docs           60h  ███████                             │
│  Internal       40h  █████                               │
│                                                          │
│  WEEKLY OUTPUT HIGHLIGHTS                                │
│  Week 1: "Shipped session tracking + idle detection"     │
│  Week 2: "Team view + sync service complete"             │
│  Week 3: "AI layer + git integration"                    │
│  Week 4: "Leave management + dashboard"                  │
│                                                          │
│  [Download PDF]                                          │
└─────────────────────────────────────────────────────────┘
```

### Workspace Proof Modal — Check-in / Check-out

```
┌─────────────────────────────────────────────────────────┐
│  WORKSPACE PROOF — Check In                              │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────────┐  ┌──────────────────────────┐  │
│  │                     │  │  📍 LOCATION              │  │
│  │   [Webcam Preview]  │  │                          │  │
│  │                     │  │  Auto-detected:          │  │
│  │   ┌─────────────┐   │  │  ✅ Kenesis HQ           │  │
│  │   │  📷 Capture  │   │  │  (within 500m zone)     │  │
│  │   └─────────────┘   │  │                          │  │
│  │                     │  │  Accuracy: ±50m          │  │
│  │  ─── OR ───         │  │                          │  │
│  │                     │  │  ── Saved Locations ──   │  │
│  │  ┌─────────────────┐│  │  • Kenesis HQ ✓         │  │
│  │  │ Drop photo here ││  │  • Home Office           │  │
│  │  │ (from phone)    ││  │  • + Add new location    │  │
│  │  │ Max 5 min old   ││  │                          │  │
│  │  └─────────────────┘│  └──────────────────────────┘  │
│  └─────────────────────┘                                 │
│                                                          │
│           [  Capture & Start Session  ]                  │
│                                                          │
│  ⚠ Session cannot start without workspace proof          │
└─────────────────────────────────────────────────────────┘
```

### Attendance Log — With Proof Columns

```
┌─────────────────────────────────────────────────────────────────────┐
│  ATTENDANCE LOG                                                      │
│  [Person ▾] [Date range ▾] [Project ▾] [Export CSV]                 │
├─────────────────────────────────────────────────────────────────────┤
│  Date    Login  Logout Hours Breaks Check-in        Check-out       │
│  ──────  ─────  ────── ───── ────── ──────────────  ──────────────  │
│  Apr 1   9:02   17:45  7.2h  45m   [📷] Kenesis HQ [📷] Kenesis HQ│
│                                     ✅ Verified      ✅ Verified     │
│  Apr 2   8:55   18:10  7.8h  30m   [📷] Home Office [📷] Home Office│
│                                     ✅ Verified      🟡 AI Flagged  │
│  Apr 3   —      —      —     —     (On Leave)       —              │
│  Apr 4   9:30   16:00  5.5h  60m   [📷] Kenesis HQ [📷] Kenesis HQ│
│                                     ✅ Verified      ✅ Verified     │
└─────────────────────────────────────────────────────────────────────┘

Click any [📷] → opens proof detail modal:
┌───────────────────────────────────┐
│  CHECK-IN PROOF — Apr 1, 9:02 AM │
│  ┌─────────────┐  📍 Kenesis HQ  │
│  │             │  Lat: 12.97°N   │
│  │  [Photo]    │  Lng: 77.59°E   │
│  │             │  Accuracy: ±50m │
│  └─────────────┘                  │
│  AI: ✅ "Workspace with desk and  │
│       monitor visible"            │
│  Source: Webcam                   │
│  EXIF: 2026-04-01 09:02:14       │
└───────────────────────────────────┘
```

### Feature Interaction Map

```
First Launch ──→ Auth Screen (Sign Up / Log In)
     │
     ▼
  Onboarding (Welcome → Profile → Team → First Project)
     │
     ▼
  Founder Dashboard (landing screen for authenticated users)
     │
     ├──→ Session Start ──→ WORKSPACE PROOF (mandatory) ──→ Standup Prompt ──→ Mood Check
     │         │              photo + geolocation              │                    │
     │         │              AI verifies in background         │                    │
     │      Timer Running ──→ Cmd+K Task Switch ──→ Idle Detection
     │         │                                      │
     │         │                              ┌───────┴───────┐
     │         │                              ▼               ▼
     │         │                        Idle Modal      Meeting Logger
     │         │                        (4 options)     (title + attendees)
     │         │                              │
     │         ▼                              ▼
     │      End Day Flow ──→ EOD Report Generated ──→ Daily Digest Feed
     │         │                                          │
     │         ▼                                          ▼
     │      Goodbye Screen                         Morning Digest (8 AM next day)
     │                                                    │
     │                                                    ▼
     │                                             Founder Dashboard
     │                                             (live team status)
     │                                                    │
     │                                    ┌───────────────┼───────────────┐
     │                                    ▼               ▼               ▼
     │                              Attendance       Leave Mgmt      Team Analytics
     │                              Log              Calendar        (individual + team)
     │                                    │               │               │
     │                                    ▼               ▼               ▼
     │                              CSV Export       Request/        Focus Score
     │                                              Approval        (private)
     │                                              Flow
     │                                                    │
     │                                                    ▼
     │                                              Smart Leave
     │                                              Suggestions (AI)
     │                                                    │
     │                                                    ▼
     │                                              Monthly Digest PDF
     │
     └──→ Settings ──→ Account (profile, team, invite, logout)
                  ──→ Preferences (theme, idle, nudge, AI, git)
```

### Screen Count Summary

| # | Screen | Type | Status |
|---|--------|------|--------|
| 1 | Auth (Sign Up / Log In) | v2 | 🔲 Phase 0 |
| 2 | Onboarding (4-step) | v2 | 🔲 Phase 0 |
| 3 | Today | v1 | ✅ Built |
| 4 | Team | v1 | ✅ Built |
| 5 | Tasks | v1 | ✅ Built |
| 6 | Review | v1 | ✅ Built |
| 7 | Settings (+ Account section) | v1+v2 | 🔲 Phase 0 |
| 8 | Founder Dashboard | v2 | 🔲 Phase 7 |
| 9 | Attendance Log | v2 | 🔲 Phase 5 |
| 10 | Leave Management | v2 | 🔲 Phase 3 |
| 11 | Request/Approval | v2 | 🔲 Phase 3 |
| 12 | Team Analytics | v2 | 🔲 Phase 9 |
| 13 | Daily Digest | v2 | 🔲 Phase 11 |
| 14 | Monthly Report | v2 | 🔲 Phase 15 |
| 15 | Settings > Office Zones | v2 | 🔲 Phase 18 |

### Overlay/Modal Count

| # | Overlay | Trigger | Status |
|---|---------|---------|--------|
| 1 | Standup Prompt | First session start of day | 🔲 Phase 13 |
| 2 | Mood Check | Session start/end (optional) | 🔲 Phase 13 |
| 3 | Meeting Logger | Idle Modal → "Meeting" | 🔲 Phase 13 |
| 4 | Leave Request Form | "Request Leave" button | 🔲 Phase 3 |
| 5 | Smart Leave Conflicts | Leave form opens | 🔲 Phase 15 |
| 6 | Workspace Proof (Check-in) | Session start (mandatory) | 🔲 Phase 18 |
| 7 | Workspace Proof (Check-out) | Session end (mandatory) | 🔲 Phase 18 |
| 8 | Name This Workspace | New location detected | 🔲 Phase 18 |
| 9 | Proof Detail (photo + map) | Click proof thumbnail | 🔲 Phase 18 |
