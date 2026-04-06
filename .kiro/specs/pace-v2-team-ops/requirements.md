# Requirements Document

## Introduction

PACE v2 Team Ops is a major feature expansion to the existing PACE work tracker, adding team-oriented operational systems for Kenesis Labs (3–5 founders). It introduces attendance logging, leave management, request/approval workflows, team analytics, daily reports, a founder dashboard, and a set of quality-of-life improvements. All new features build on top of the existing PACE v1 infrastructure: Tauri v2 desktop app, React 19 + TypeScript frontend, Rust backend, SQLite local-first storage, PocketBase cloud sync, and LiteLLM AI layer. The design philosophy remains unchanged: no surveillance language, no productivity rankings between members, full mutual transparency, and AI that reflects rather than interrupts.

## Glossary

- **PACE_App**: The Tauri v2 desktop application encompassing the React frontend and Rust backend
- **Attendance_Log**: The screen and data system that records and displays historical login/logout times, hours, breaks, and output notes per person per day
- **Leave_Manager**: The system responsible for tracking leave balances, leave types, public holidays, and WFH status for each team member
- **Request_Flow**: The workflow system handling submission, notification, and approval/decline of WFH and leave requests between founders
- **Analytics_Engine**: The computation layer that derives individual and team performance metrics from session, task, and break data
- **Report_Generator**: The system that auto-generates end-of-day reports on logout and morning digest summaries
- **Founder_Dashboard**: The command centre screen providing a real-time overview of team status, approvals, project health, and alerts
- **Streak_Tracker**: The component that calculates and displays consecutive check-in day counts per team member
- **Focus_Score**: A private-only metric computed from session continuity, break patterns, and task completion, visible only to the individual user
- **Standup_Prompt**: An async daily prompt asking each founder what they are working on today
- **Mood_Check**: An optional, private-only energy/mood self-assessment captured during session start or end
- **Meeting_Logger**: A feature within the idle resolution modal that allows logging meeting details when "Meeting" is selected
- **Smart_Leave_Suggester**: An AI-powered system that detects scheduling conflicts and suggests optimal leave timing
- **Monthly_Digest**: A PDF report summarizing one calendar month of team activity, hours, and output
- **Leave_Request**: A record representing a founder's request for leave or WFH, including type, dates, reason, and approval status
- **Public_Holiday**: A pre-loaded calendar entry representing a national or company holiday where no session is expected
- **Availability_Heatmap**: A visual grid showing team member availability across days and hours
- **Session_Manager**: The existing Rust-side component responsible for session lifecycle (inherited from v1)
- **Sync_Service**: The existing frontend background service that flushes local SQLite changes to PocketBase (inherited from v1)
- **AI_Dispatcher**: The existing PocketBase JS hooks that route AI requests to LiteLLM proxy (inherited from v1)
- **Milestone**: A named checkpoint within a project with an associated deadline date

## Requirements

### Requirement 1: Attendance Log Display

**User Story:** As a founder, I want to view a historical calendar of login/logout times per person, so that I can understand work patterns over time.

#### Acceptance Criteria

1. WHEN a founder navigates to the Attendance_Log screen, THE PACE_App SHALL display a calendar view showing one row per day with columns for login time, logout time, total hours, break duration, and output note for the selected person
2. WHEN a founder selects a person filter, THE Attendance_Log SHALL display attendance records only for the selected team member
3. WHEN a founder selects a date range filter, THE Attendance_Log SHALL display attendance records only within the specified start and end dates
4. WHEN a founder selects a project filter, THE Attendance_Log SHALL display attendance records only for days where the selected project had logged session time
5. WHEN a founder clicks "Export CSV," THE Attendance_Log SHALL generate a CSV file containing all currently filtered attendance records with columns: date, person, login time, logout time, total hours, break minutes, and output note
6. WHEN no attendance records exist for the selected filters, THE Attendance_Log SHALL display an empty state message indicating no records match the current filters

### Requirement 2: Attendance Data Computation

**User Story:** As a founder, I want attendance data derived accurately from session records, so that the attendance log reflects reality.

#### Acceptance Criteria

1. THE Attendance_Log SHALL compute daily login time as the earliest session start time for a user on a given calendar day
2. THE Attendance_Log SHALL compute daily logout time as the latest session end time for a user on a given calendar day
3. THE Attendance_Log SHALL compute total hours as the sum of all session durations (end time minus start time minus break durations) for a user on a given calendar day
4. THE Attendance_Log SHALL compute break duration as the sum of all break records within sessions for a user on a given calendar day
5. THE Attendance_Log SHALL display the output note from the last closed session of the day for each user

### Requirement 3: Leave Balance Tracking

**User Story:** As a founder, I want to track my annual leave balance, so that I know how many leave days I have remaining.

#### Acceptance Criteria

1. THE Leave_Manager SHALL allocate 20 annual leave days per person per calendar year
2. THE Leave_Manager SHALL allocate 10 sick leave days per person per calendar year
3. WHEN a leave request of type "annual" is approved, THE Leave_Manager SHALL deduct the number of requested days from the person's annual leave balance
4. WHEN a leave request of type "sick" is submitted, THE Leave_Manager SHALL deduct the number of requested days from the person's sick leave balance without requiring approval
5. WHEN a WFH request is approved, THE Leave_Manager SHALL NOT deduct any days from the person's leave balance
6. THE Leave_Manager SHALL display each person's current balance for annual leave and sick leave as: allocated days minus used days

### Requirement 4: Public Holiday Calendar

**User Story:** As a founder, I want public holidays pre-loaded in the calendar, so that the team knows which days are off without manual entry.

#### Acceptance Criteria

1. THE Leave_Manager SHALL store a list of public holidays with date and name fields for the current calendar year
2. WHEN a day is marked as a public holiday, THE Leave_Manager SHALL display the holiday name on that date in the team leave calendar
3. WHEN a day is a public holiday, THE Leave_Manager SHALL NOT deduct leave balance for that day even if it falls within a leave request date range
4. THE Leave_Manager SHALL allow a founder to add, edit, or remove public holidays from the Settings screen

### Requirement 5: Team Leave Calendar

**User Story:** As a founder, I want a visual calendar showing who is on leave, WFH, or on holiday, so that I can see team availability at a glance.

#### Acceptance Criteria

1. THE Leave_Manager SHALL display a monthly calendar view with each team member as a row and each day as a column
2. THE Leave_Manager SHALL color-code calendar cells by status: annual leave, sick leave, WFH, and public holiday using distinct visual indicators
3. WHEN a founder navigates between months, THE Leave_Manager SHALL load and display leave data for the selected month
4. THE Leave_Manager SHALL display a summary bar showing the count of team members available, on leave, and on WFH for the current day

### Requirement 6: Leave and WFH Request Submission

**User Story:** As a founder, I want to submit a leave or WFH request with type, dates, and reason, so that my team is informed and can approve it.

#### Acceptance Criteria

1. WHEN a founder opens the request form, THE Request_Flow SHALL display fields for: request type (annual leave, sick leave, or WFH), start date, end date, and reason
2. WHEN a founder submits a leave or WFH request, THE Request_Flow SHALL create a Leave_Request record in SQLite with status set to "pending"
3. WHEN a founder submits a sick leave request, THE Request_Flow SHALL create the Leave_Request record with status set to "approved" immediately without requiring another founder's approval
4. WHEN a leave or WFH request is submitted with status "pending," THE Request_Flow SHALL send an OS notification to all other founders indicating the request details
5. IF a founder attempts to submit a request that would exceed the available leave balance, THEN THE Request_Flow SHALL reject the submission and display the remaining balance

### Requirement 7: Leave and WFH Request Approval

**User Story:** As a founder, I want to approve or decline a teammate's leave or WFH request, so that the team calendar stays accurate and conflicts are managed.

#### Acceptance Criteria

1. WHEN a founder views a pending Leave_Request, THE Request_Flow SHALL display the request details and provide "Approve" and "Decline" actions
2. WHEN a founder approves a Leave_Request, THE Request_Flow SHALL update the request status to "approved" and update the team leave calendar to reflect the approved dates
3. WHEN a founder declines a Leave_Request, THE Request_Flow SHALL update the request status to "declined," require a reason for the decline, and send an OS notification to the requester with the decline reason
4. THE Request_Flow SHALL NOT allow a founder to approve or decline a Leave_Request that the founder submitted
5. WHEN a Leave_Request is approved and the type is "annual leave," THE Leave_Manager SHALL deduct the corresponding days from the requester's annual leave balance
6. WHEN a Leave_Request is approved and the type is "WFH," THE Session_Manager SHALL expect normal session logging from the requester on WFH days

### Requirement 8: WFH Session Expectations

**User Story:** As a founder, I want WFH days to still expect session logging, so that remote work is tracked the same as office work.

#### Acceptance Criteria

1. WHILE a founder is on an approved WFH day, THE Session_Manager SHALL expect the founder to start and end sessions as on a normal work day
2. WHILE a founder is on an approved leave day, THE Session_Manager SHALL NOT expect any session activity from the founder
3. WHEN the Founder_Dashboard displays team status on a WFH day, THE PACE_App SHALL show a "WFH" indicator next to the founder's name

### Requirement 9: Individual Analytics

**User Story:** As a founder, I want to see my personal work analytics, so that I can understand my own patterns and improve.

#### Acceptance Criteria

1. THE Analytics_Engine SHALL compute average daily hours as a 4-week rolling average of total session hours per day for the selected user
2. THE Analytics_Engine SHALL compute the most productive day of the week as the weekday with the highest average session hours over the past 4 weeks
3. THE Analytics_Engine SHALL compute peak focus time as the hour-of-day range with the longest average uninterrupted session segments over the past 4 weeks
4. THE Analytics_Engine SHALL compute task completion rate as the number of tasks moved to "done" divided by the total number of tasks assigned to the user in the past 4 weeks, expressed as a percentage
5. THE Analytics_Engine SHALL compute output consistency as the standard deviation of daily session hours over the past 4 weeks, where a lower value indicates higher consistency
6. THE PACE_App SHALL display individual analytics on the Team Analytics screen with clearly labeled metrics and time period

### Requirement 10: Team Analytics

**User Story:** As a founder, I want to see combined team analytics, so that I can understand how the team is performing collectively.

#### Acceptance Criteria

1. THE Analytics_Engine SHALL compute combined hours per project as the sum of all team members' session hours grouped by project for the selected time period
2. THE Analytics_Engine SHALL compute velocity trend as the week-over-week change in total tasks completed by the team, displayed as a line chart over the past 8 weeks
3. THE Analytics_Engine SHALL display an Availability_Heatmap showing each team member's logged hours per day across a 4-week grid
4. THE Analytics_Engine SHALL compute leave impact as the percentage reduction in total team hours during weeks containing approved leave compared to the 4-week average
5. WHEN any team member's daily session hours exceed 10 hours on 3 or more days within a rolling 7-day window, THE Analytics_Engine SHALL display an overwork signal for that member
6. THE Analytics_Engine SHALL NOT display comparative rankings or productivity scores between individual team members

### Requirement 11: End-of-Day Report Generation

**User Story:** As a founder, I want an automatic end-of-day report generated when I log out, so that my daily work is summarized without manual effort.

#### Acceptance Criteria

1. WHEN a founder completes the "End day" flow, THE Report_Generator SHALL create an end-of-day report containing: total session time, tasks worked on with time per task, breaks taken with durations, the output note, and git commits from the session
2. THE Report_Generator SHALL store the end-of-day report in SQLite linked to the session record
3. THE Report_Generator SHALL make the end-of-day report visible to all team members via the Daily Digest screen
4. WHEN no tasks were logged during the session, THE Report_Generator SHALL include "No tasks logged" in the report instead of an empty task section

### Requirement 12: Morning Digest

**User Story:** As a founder, I want a morning digest summarizing yesterday's team activity, so that I start the day informed.

#### Acceptance Criteria

1. THE Report_Generator SHALL generate a morning digest at 8:00 AM local time each workday
2. THE Report_Generator SHALL include in the morning digest: each team member's total hours from the previous workday, tasks completed, and output notes
3. THE Report_Generator SHALL include in the morning digest a list of team members on leave or WFH for the current day
4. WHEN the PACE_App is running at 8:00 AM, THE PACE_App SHALL send an OS notification prompting the founder to view the morning digest
5. WHEN the PACE_App is launched after 8:00 AM and before noon, THE PACE_App SHALL display the morning digest as a banner on the Today screen if the digest has not been viewed

### Requirement 13: Founder Dashboard — Live Status

**User Story:** As a founder, I want a command centre showing live team status, so that I have a single screen for operational awareness.

#### Acceptance Criteria

1. WHEN a founder navigates to the Founder_Dashboard, THE PACE_App SHALL display each team member's current status (Active, On Break, Away, Offline, On Leave, WFH) with real-time updates via WebSocket
2. THE Founder_Dashboard SHALL display today's combined team hours as the sum of all active and completed session durations for the current day
3. THE Founder_Dashboard SHALL display a count of pending Leave_Requests requiring approval, with a link to the Request/Approval screen
4. THE Founder_Dashboard SHALL display project health as a summary of each active project's open task count, overdue task count, and total hours logged this week

### Requirement 14: Founder Dashboard — Forecasting and Alerts

**User Story:** As a founder, I want to see upcoming leave and attendance alerts, so that I can plan ahead and address issues early.

#### Acceptance Criteria

1. THE Founder_Dashboard SHALL display weekly velocity as the total tasks completed by the team in the current week compared to the previous week
2. THE Founder_Dashboard SHALL display a list of approved leave and WFH entries for the next 14 calendar days
3. WHEN a team member has not started a session by 12:00 PM local time on a workday and is not on approved leave or a public holiday, THE Founder_Dashboard SHALL display an attendance alert for that member
4. THE Founder_Dashboard SHALL update all displayed data within 3 seconds of any underlying data change via PocketBase realtime subscriptions

### Requirement 15: Check-in Streak

**User Story:** As a founder, I want to see my consecutive check-in streak, so that I am motivated to maintain daily consistency.

#### Acceptance Criteria

1. THE Streak_Tracker SHALL compute a check-in streak as the count of consecutive workdays (excluding weekends, public holidays, and approved leave days) on which the user started at least one session
2. THE Streak_Tracker SHALL display the current streak count on the user's Team view card, visible to all team members
3. WHEN a user misses a workday without approved leave, THE Streak_Tracker SHALL reset the streak count to zero
4. THE Streak_Tracker SHALL not count weekends, public holidays, or approved leave days as streak-breaking days

### Requirement 16: Private Focus Score

**User Story:** As a founder, I want a personal focus score that only I can see, so that I can track my own focus quality without team pressure.

#### Acceptance Criteria

1. THE Analytics_Engine SHALL compute the Focus_Score from three weighted factors: session continuity (percentage of session time without breaks or idle events), average uninterrupted work segment length, and task completion rate
2. THE PACE_App SHALL display the Focus_Score only on the individual user's own analytics view
3. THE PACE_App SHALL NOT transmit the Focus_Score to PocketBase or make the Focus_Score visible to any other team member
4. THE PACE_App SHALL store the Focus_Score in local SQLite only, excluded from the sync queue

### Requirement 17: Project Milestones

**User Story:** As a founder, I want to set milestones with deadlines on projects, so that the team has clear checkpoints.

#### Acceptance Criteria

1. WHEN a founder creates a Milestone, THE PACE_App SHALL require a name, associated project, and deadline date
2. THE PACE_App SHALL display milestones on the project detail view sorted by deadline date
3. WHEN a milestone's deadline is within 3 days and the milestone is not marked complete, THE PACE_App SHALL display a warning indicator on the Founder_Dashboard and the Tasks screen
4. WHEN all tasks associated with a milestone are in "done" status, THE PACE_App SHALL allow the founder to mark the milestone as complete

### Requirement 18: Async Standup Prompt

**User Story:** As a founder, I want a daily async standup prompt, so that the team shares what they are working on without a synchronous meeting.

#### Acceptance Criteria

1. WHEN a founder starts a session for the first time on a workday, THE PACE_App SHALL display the Standup_Prompt asking "What are you working on today?"
2. WHEN the founder submits a standup response, THE PACE_App SHALL store the response linked to the user and the current date
3. THE PACE_App SHALL display all team members' standup responses for the current day on the Daily Digest screen
4. WHEN a founder dismisses the Standup_Prompt without responding, THE PACE_App SHALL not prompt again for that day

### Requirement 19: Optional Mood and Energy Check-in

**User Story:** As a founder, I want to optionally log my mood and energy level, so that I can track personal well-being patterns over time.

#### Acceptance Criteria

1. WHEN a founder starts or ends a session, THE PACE_App SHALL optionally display a Mood_Check prompt with a 5-point energy scale and an optional one-word mood tag
2. WHEN the founder submits a Mood_Check, THE PACE_App SHALL store the response in local SQLite only, linked to the session
3. THE PACE_App SHALL NOT transmit Mood_Check data to PocketBase or make Mood_Check data visible to any other team member
4. THE PACE_App SHALL display mood and energy trends on the individual user's private analytics view only
5. WHEN the founder dismisses the Mood_Check prompt, THE PACE_App SHALL not record any mood data for that session

### Requirement 20: Meeting Logger

**User Story:** As a founder, I want to log meeting details when I classify idle time as a meeting, so that meeting time is tracked with context.

#### Acceptance Criteria

1. WHEN a founder selects "Meeting" in the Idle_Modal, THE PACE_App SHALL display additional fields for: meeting title (required) and optional attendees
2. WHEN the founder submits the meeting details, THE Meeting_Logger SHALL store the meeting record linked to the break record and the session
3. THE Meeting_Logger SHALL display logged meetings in the session timeline with the meeting title
4. THE Report_Generator SHALL include meeting details in the end-of-day report

### Requirement 21: Smart Leave Suggestions

**User Story:** As a founder, I want AI-powered leave suggestions that detect scheduling conflicts, so that I can plan leave without disrupting the team.

#### Acceptance Criteria

1. WHEN a founder opens the leave request form, THE Smart_Leave_Suggester SHALL analyze the team calendar for the requested dates and display any detected conflicts (other members on leave, milestone deadlines within 3 days, low team availability)
2. WHERE AI features are enabled, THE Smart_Leave_Suggester SHALL suggest alternative date ranges that minimize team impact based on the team calendar and project deadlines
3. IF the AI_Dispatcher is unavailable, THEN THE Smart_Leave_Suggester SHALL display only the calendar-based conflict detection without AI suggestions
4. THE Smart_Leave_Suggester SHALL NOT block leave submission based on detected conflicts; conflicts are advisory only

### Requirement 22: Monthly Digest PDF

**User Story:** As a founder, I want a monthly PDF report summarizing team activity, so that I have a shareable record of the month's work.

#### Acceptance Criteria

1. WHEN a founder requests a monthly digest, THE Report_Generator SHALL generate a PDF containing: total team hours for the month, hours per person, hours per project, tasks completed, leave days taken per person, and a summary of weekly output notes
2. THE Report_Generator SHALL format the monthly digest PDF with the PACE branding (indigo accent, Geist typography)
3. THE Report_Generator SHALL allow the founder to select any past calendar month for digest generation
4. THE Report_Generator SHALL store the generated PDF locally and provide a "Save As" dialog for the founder to choose the export location

### Requirement 23: New Screen Navigation

**User Story:** As a founder, I want the new screens accessible from the sidebar, so that I can navigate to all v2 features without confusion.

#### Acceptance Criteria

1. THE PACE_App SHALL add the following screens to the sidebar navigation: Founder Dashboard, Attendance Log, Leave Management, Request/Approval, Team Analytics, Daily Digest, and Monthly Report
2. THE PACE_App SHALL maintain the existing sidebar items (Today, Team, Tasks, Review, Settings) in their current positions
3. WHEN a founder clicks a sidebar navigation item, THE PACE_App SHALL navigate to the corresponding screen within 200 milliseconds

### Requirement 24: Leave Request Data Integrity

**User Story:** As a founder, I want leave request data to be consistent and synced, so that all team members see the same leave information.

#### Acceptance Criteria

1. THE Request_Flow SHALL store all Leave_Request records in SQLite with fields: id, requesterId, type (annual, sick, wfh), startDate, endDate, reason, status (pending, approved, declined), reviewerId, reviewReason, createdAt, and updatedAt
2. THE Sync_Service SHALL sync Leave_Request records to PocketBase following the same offline-first pattern as existing data: write to SQLite first, queue for sync, flush within 60 seconds
3. THE PACE_App SHALL store all leave-related dates as UTC timestamps, performing local timezone conversion only in the display layer
4. IF a sync conflict occurs on a Leave_Request record, THEN THE Sync_Service SHALL apply last-write-wins resolution and notify the affected founders via OS notification

### Requirement 25: Analytics Data Privacy

**User Story:** As a founder, I want private metrics to remain private and team metrics to remain transparent, so that the trust-based culture is preserved.

#### Acceptance Criteria

1. THE PACE_App SHALL classify the following as private data visible only to the individual user: Focus_Score, Mood_Check responses, and energy trends
2. THE PACE_App SHALL classify the following as team-visible data: check-in streaks, attendance records, leave balances, session hours, task completion counts, and output notes
3. THE PACE_App SHALL NOT sync private data (Focus_Score, Mood_Check) to PocketBase under any circumstance
4. THE Analytics_Engine SHALL NOT produce comparative rankings, productivity scores, or performance ratings between team members

### Requirement 26: Overwork Detection

**User Story:** As a founder, I want the system to flag potential overwork, so that the team can address burnout risks early.

#### Acceptance Criteria

1. WHEN a team member logs more than 10 hours of session time in a single day, THE Analytics_Engine SHALL flag that day as an overwork day
2. WHEN a team member has 3 or more overwork days within a rolling 7-day window, THE Founder_Dashboard SHALL display an overwork alert for that member
3. THE Analytics_Engine SHALL display overwork signals using supportive language (e.g., "Consider taking a break" rather than "Excessive hours detected")
4. THE PACE_App SHALL NOT use overwork signals for any form of penalty or negative assessment

### Requirement 27: Attendance Alert Logic

**User Story:** As a founder, I want attendance alerts that account for leave and holidays, so that alerts are meaningful and not false positives.

#### Acceptance Criteria

1. WHEN generating attendance alerts, THE Founder_Dashboard SHALL exclude team members who are on approved leave for the current day
2. WHEN generating attendance alerts, THE Founder_Dashboard SHALL exclude days that are public holidays
3. WHEN generating attendance alerts, THE Founder_Dashboard SHALL exclude weekends (Saturday and Sunday)
4. WHEN a team member is on approved WFH and has not started a session by 12:00 PM, THE Founder_Dashboard SHALL display the attendance alert with a "WFH — not yet logged in" label

