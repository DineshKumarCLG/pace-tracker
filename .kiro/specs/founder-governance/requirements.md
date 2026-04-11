# Requirements Document

## Introduction

Founder Governance is a feature set for PACE that adds structured accountability, equity tracking, and startup health monitoring for the Kenesis Labs founding team (3–5 founders). It introduces five interconnected systems: biweekly anonymous peer review with equity consequences, a weekly performance leaderboard, a real-time equity dashboard with vesting and dilution tracking, tiered data visibility controls, and a startup health dashboard with runway and balance indicators.

This feature set intentionally shifts PACE's philosophy from "no comparative rankings" to "structured founder accountability with transparent consequences." Peer reviews produce rankings. The leaderboard scores founders. Equity dilution is a real consequence. This is a deliberate, opt-in governance layer for founding teams that want hard accountability — not a change to how PACE treats regular team members.

Additionally, this spec covers the removal of five legacy features that are being superseded or deprecated: mood check-ins, meeting logger, morning digest, standup prompt, and monthly digest PDF.

All new features build on the existing PACE infrastructure: Tauri v2 desktop app, React 19 + TypeScript frontend, Rust backend, SQLite local-first storage, PocketBase cloud sync, and LiteLLM AI layer.

## Glossary

- **PACE_App**: The Tauri v2 desktop application encompassing the React frontend and Rust backend
- **Peer_Review_Engine**: The system responsible for managing biweekly anonymous founder peer review cycles, collecting rankings, computing results, and triggering accountability actions
- **Founder_Leaderboard**: The scoring system that computes weekly composite scores from hours, tasks, and peer review data, displayed only to founders
- **Equity_Dashboard**: The screen and data system that displays current equity stakes, vesting progress, cliff status, dilution history, and financial projections for each founder
- **Visibility_Controller**: The authorization layer that enforces four-tier data access rules across all PACE screens and API endpoints
- **Health_Dashboard**: The startup health monitoring screen that displays runway, founder balance, decision velocity, burn rate, and generates investor-ready summaries
- **Review_Cycle**: A single biweekly peer review period during which all founders submit anonymous rankings of each other
- **Accountability_Warning**: A formal record issued to the lowest-ranked founder in a completed Review_Cycle
- **Dilution_Event**: A record of equity dilution triggered when a founder receives two consecutive Accountability_Warnings
- **Equity_Stake**: A record representing a founder's current ownership percentage, vesting schedule, and cliff status
- **Cap_Table**: The complete table of all founders' equity stakes, used for pie chart visualization and projection calculations
- **Founder_Score**: The weekly composite score computed as (hours × 0.3) + (tasks × 0.4) + (peer_review × 0.3)
- **Runway_Indicator**: A computed metric showing months of remaining operating capital based on current burn rate
- **Decision_Velocity**: A metric measuring the average time from decision proposal to resolution across the founding team
- **Burn_Rate_Alignment**: A comparison of actual monthly spend against planned budget
- **Founder_Balance**: A metric detecting hour gaps between founders, flagging when one founder's weekly hours deviate significantly from the team average
- **Visibility_Tier**: One of four access levels — Everyone, Founders_Only, Admin_Only, or Individual_Only — that controls who can see specific data
- **Sync_Service**: The existing frontend background service that flushes local SQLite changes to PocketBase (inherited from v1)
- **CEO_User**: The founder designated as CEO in team settings, who has tie-breaking authority in peer reviews

## Requirements

### Requirement 1: Peer Review Cycle Management

**User Story:** As a founder, I want biweekly anonymous peer review cycles, so that the team maintains structured accountability with transparent feedback.

#### Acceptance Criteria

1. THE Peer_Review_Engine SHALL create a new Review_Cycle every 14 calendar days, starting from the date the feature is enabled for the company
2. WHEN a Review_Cycle begins, THE Peer_Review_Engine SHALL notify all founders via OS notification that a new review cycle is open for submission
3. THE Peer_Review_Engine SHALL allow each founder to submit exactly one anonymous ranking per Review_Cycle for every other founder on the team
4. THE Peer_Review_Engine SHALL collect rankings on a 1-to-5 integer scale across three dimensions: output, reliability, and initiative
5. WHEN a founder submits a ranking, THE Peer_Review_Engine SHALL store the ranking without associating the reviewer identity in any user-visible interface
6. THE Peer_Review_Engine SHALL enforce a 48-hour submission window from the start of each Review_Cycle, after which unsubmitted reviews are marked as missed
7. WHEN the submission window closes, THE Peer_Review_Engine SHALL compute the average score per founder across all three dimensions from all submitted rankings

### Requirement 2: Peer Review Results and Accountability

**User Story:** As a founder, I want peer review results to have real consequences, so that low performance is addressed transparently.

#### Acceptance Criteria

1. WHEN a Review_Cycle completes, THE Peer_Review_Engine SHALL identify the founder with the lowest average score across all three dimensions
2. WHEN two or more founders tie for the lowest average score, THE Peer_Review_Engine SHALL request the CEO_User to cast a tie-breaking vote within 24 hours
3. IF the CEO_User does not cast a tie-breaking vote within 24 hours, THEN THE Peer_Review_Engine SHALL select the tied founder with the fewer total hours logged in the review period
4. WHEN the lowest-ranked founder is identified, THE Peer_Review_Engine SHALL create an Accountability_Warning record linked to that founder and the Review_Cycle
5. WHEN a founder receives two consecutive Accountability_Warnings (from two consecutive Review_Cycles), THE Peer_Review_Engine SHALL trigger a Dilution_Event of 1% equity reduction for that founder
6. WHEN a Review_Cycle completes, THE Peer_Review_Engine SHALL make the aggregated results (average scores per founder per dimension) visible to all founders on the /founder-review screen
7. THE Peer_Review_Engine SHALL NOT reveal which specific founder submitted which individual ranking

### Requirement 3: Peer Review Data Model

**User Story:** As a founder, I want peer review data stored reliably and synced across devices, so that review history is consistent for all founders.

#### Acceptance Criteria

1. THE Peer_Review_Engine SHALL store each Review_Cycle with fields: id, startDate, endDate, submissionDeadline, status (open, closed, resolved), and resolvedAt
2. THE Peer_Review_Engine SHALL store each individual review submission with fields: id, cycleId, reviewerId, revieweeId, outputScore (1-5), reliabilityScore (1-5), initiativeScore (1-5), and submittedAt
3. THE Peer_Review_Engine SHALL store each Accountability_Warning with fields: id, founderId, cycleId, issuedAt, and acknowledged (boolean)
4. THE Sync_Service SHALL sync Review_Cycle, review submission, and Accountability_Warning records to PocketBase following the existing offline-first pattern
5. THE PACE_App SHALL store all peer review timestamps as UTC, performing local timezone conversion only in the display layer

### Requirement 4: Founder Leaderboard Score Computation

**User Story:** As a founder, I want a weekly leaderboard score computed from hours, tasks, and peer review, so that I can track my relative contribution.

#### Acceptance Criteria

1. THE Founder_Leaderboard SHALL compute each founder's weekly Founder_Score using the formula: (normalized_hours × 0.3) + (normalized_tasks × 0.4) + (normalized_peer_review × 0.3)
2. THE Founder_Leaderboard SHALL normalize hours as the founder's total session hours for the week divided by the maximum hours logged by any founder that week, producing a value between 0.0 and 1.0
3. THE Founder_Leaderboard SHALL normalize tasks as the founder's completed task count for the week divided by the maximum completed task count by any founder that week, producing a value between 0.0 and 1.0
4. THE Founder_Leaderboard SHALL normalize peer review as the founder's most recent Review_Cycle average score divided by 5.0, producing a value between 0.0 and 1.0
5. WHEN no Review_Cycle results exist for a founder, THE Founder_Leaderboard SHALL use a default peer review score of 0.6 (3.0 / 5.0) for the normalization
6. WHEN no founder has logged hours or completed tasks in a given week, THE Founder_Leaderboard SHALL set the respective normalized component to 0.0 for all founders

### Requirement 5: Founder Leaderboard Display

**User Story:** As a founder, I want to see the weekly leaderboard with scores and a "Founder of the Week" badge, so that top contribution is recognized.

#### Acceptance Criteria

1. THE Founder_Leaderboard SHALL display a ranked list of all founders sorted by Founder_Score in descending order on the /leaderboard screen
2. THE Founder_Leaderboard SHALL display each founder's Founder_Score, hours logged, tasks completed, and peer review average for the current week
3. THE Founder_Leaderboard SHALL award a "Founder of the Week" badge to the founder with the highest Founder_Score for the completed week
4. WHEN two or more founders tie for the highest Founder_Score, THE Founder_Leaderboard SHALL award the badge to the founder with the higher task completion count
5. THE Founder_Leaderboard SHALL be visible only to users with the Founders_Only Visibility_Tier or higher
6. THE Founder_Leaderboard SHALL NOT trigger any equity consequences, warnings, or penalties based on leaderboard rankings
7. THE Founder_Leaderboard SHALL be an opt-in feature configurable per company from the Settings screen

### Requirement 6: Equity Stake Tracking

**User Story:** As a founder, I want to see my current equity stake with vesting progress and cliff status, so that I understand my ownership position.

#### Acceptance Criteria

1. THE Equity_Dashboard SHALL display each founder's current equity stake as a percentage of total company ownership
2. THE Equity_Dashboard SHALL display each founder's vesting progress as a percentage of total vested shares out of granted shares
3. THE Equity_Dashboard SHALL display each founder's cliff status as one of: "Pre-cliff" (with days remaining), "Cliff passed" (with cliff date), or "Fully vested"
4. THE Equity_Dashboard SHALL store Equity_Stake records with fields: id, founderId, initialStakePct, currentStakePct, vestingStartDate, cliffDate, vestingEndDate, vestingScheduleMonths, and updatedAt
5. THE Equity_Dashboard SHALL recompute currentStakePct after each Dilution_Event by reducing the affected founder's stake by 1 percentage point and redistributing the diluted amount proportionally among the remaining founders

### Requirement 7: Dilution History and Projections

**User Story:** As a founder, I want to see my dilution history and financial projections, so that I understand the impact of governance actions on my equity.

#### Acceptance Criteria

1. THE Equity_Dashboard SHALL display a chronological list of all Dilution_Events with fields: date, affected founder, dilution percentage, triggering Review_Cycle, and resulting stake percentages
2. THE Equity_Dashboard SHALL store each Dilution_Event with fields: id, founderId, cycleId, dilutionPct, previousStakePct, newStakePct, redistributionDetails (JSON), and createdAt
3. WHEN a founder enters a hypothetical company valuation amount, THE Equity_Dashboard SHALL compute and display the founder's projected payout as: valuation × currentStakePct / 100
4. THE Equity_Dashboard SHALL display a Cap_Table pie chart showing all founders' current equity stakes with percentage labels
5. THE Equity_Dashboard SHALL be visible only to users with the Founders_Only Visibility_Tier or higher

### Requirement 8: Visibility Tier — Everyone Level

**User Story:** As a team member, I want to see shared team data like hours, tasks, and attendance, so that I have operational awareness.

#### Acceptance Criteria

1. THE Visibility_Controller SHALL classify the following data at the Everyone tier: team member session hours, task completion counts, attendance records, check-in streaks, and leave/WFH status
2. THE Visibility_Controller SHALL allow all authenticated team members to read data classified at the Everyone tier
3. THE Visibility_Controller SHALL enforce the Everyone tier classification on the Team, Attendance, Tasks, and Leave screens

### Requirement 9: Visibility Tier — Founders Only Level

**User Story:** As a founder, I want sensitive governance data restricted to founders, so that non-founder team members do not see rankings, equity, or peer reviews.

#### Acceptance Criteria

1. THE Visibility_Controller SHALL classify the following data at the Founders_Only tier: peer review results, Accountability_Warnings, Dilution_Events, Equity_Stakes, Founder_Scores, leaderboard rankings, and startup health metrics
2. THE Visibility_Controller SHALL allow only users with the "founder" role to read data classified at the Founders_Only tier
3. THE Visibility_Controller SHALL deny access and display a "Founders only" message when a non-founder user attempts to navigate to /founder-review, /leaderboard, /equity, or /startup-health
4. THE Visibility_Controller SHALL enforce the Founders_Only tier on all API endpoints that return governance data

### Requirement 10: Visibility Tier — Admin Only Level

**User Story:** As the CEO, I want payroll and dilution trigger data restricted to admin users, so that sensitive financial operations are protected.

#### Acceptance Criteria

1. THE Visibility_Controller SHALL classify the following data at the Admin_Only tier: payroll records, dilution trigger configurations, and equity redistribution parameters
2. THE Visibility_Controller SHALL allow only users with the "admin" role to read and modify data classified at the Admin_Only tier
3. IF a non-admin user attempts to access Admin_Only data, THEN THE Visibility_Controller SHALL deny the request and log the access attempt

### Requirement 11: Visibility Tier — Individual Only Level

**User Story:** As a founder, I want my private metrics visible only to me, so that personal data remains confidential.

#### Acceptance Criteria

1. THE Visibility_Controller SHALL classify the following data at the Individual_Only tier: Focus_Score and mood check-in data
2. THE Visibility_Controller SHALL allow only the owning user to read data classified at the Individual_Only tier
3. THE PACE_App SHALL NOT sync Individual_Only data to PocketBase under any circumstance
4. THE PACE_App SHALL store Individual_Only data in local SQLite only, excluded from the Sync_Service queue

### Requirement 12: Startup Health — Runway Indicator

**User Story:** As a founder, I want to see how many months of runway remain, so that I can plan fundraising and spending decisions.

#### Acceptance Criteria

1. THE Health_Dashboard SHALL compute the Runway_Indicator as: current cash balance divided by average monthly burn rate over the past 3 months
2. THE Health_Dashboard SHALL display the Runway_Indicator in months with one decimal place on the /startup-health screen
3. WHEN the Runway_Indicator falls below 6 months, THE Health_Dashboard SHALL display an amber warning indicator next to the runway value
4. WHEN the Runway_Indicator falls below 3 months, THE Health_Dashboard SHALL display a red critical indicator next to the runway value
5. THE Health_Dashboard SHALL allow founders to manually input current cash balance and monthly expenses from the Settings screen

### Requirement 13: Startup Health — Founder Balance

**User Story:** As a founder, I want to detect hour gaps between founders, so that workload imbalances are surfaced early.

#### Acceptance Criteria

1. THE Health_Dashboard SHALL compute Founder_Balance as the standard deviation of all founders' weekly session hours for the current week
2. WHEN any single founder's weekly hours deviate by more than 30% from the team weekly average, THE Health_Dashboard SHALL flag that founder with a "Balance alert" indicator
3. THE Health_Dashboard SHALL display each founder's weekly hours alongside the team average on the /startup-health screen
4. THE Health_Dashboard SHALL use neutral language for balance alerts (e.g., "Hours gap detected" rather than "Underperforming")

### Requirement 14: Startup Health — Decision Velocity and Burn Rate

**User Story:** As a founder, I want to track decision speed and budget alignment, so that the team stays operationally efficient.

#### Acceptance Criteria

1. THE Health_Dashboard SHALL compute Decision_Velocity as the average number of calendar days between decision creation and resolution for all decisions logged in the past 30 days
2. THE Health_Dashboard SHALL display Decision_Velocity in days with one decimal place on the /startup-health screen
3. THE Health_Dashboard SHALL compute Burn_Rate_Alignment as: (actual monthly spend / planned monthly budget) × 100, expressed as a percentage
4. WHEN Burn_Rate_Alignment exceeds 110%, THE Health_Dashboard SHALL display an amber warning indicator
5. WHEN Burn_Rate_Alignment exceeds 130%, THE Health_Dashboard SHALL display a red critical indicator
6. THE Health_Dashboard SHALL allow founders to log decisions with fields: title, description, createdAt, and resolvedAt

### Requirement 15: Investor-Ready Summary PDF

**User Story:** As a founder, I want to generate an investor-ready summary PDF, so that I can share startup health data with potential investors.

#### Acceptance Criteria

1. WHEN a founder requests an investor summary, THE Health_Dashboard SHALL generate a PDF containing: runway months, burn rate alignment, founder hours summary, decision velocity, task completion velocity, and team size
2. THE Health_Dashboard SHALL format the investor summary PDF with PACE branding (indigo accent, Geist typography)
3. THE Health_Dashboard SHALL allow the founder to select a date range for the summary data
4. THE Health_Dashboard SHALL provide a "Save As" dialog for the founder to choose the PDF export location
5. THE Health_Dashboard SHALL be visible only to users with the Founders_Only Visibility_Tier or higher

### Requirement 16: Founder Governance Screen Navigation

**User Story:** As a founder, I want the new governance screens accessible from the sidebar, so that I can navigate to all governance features.

#### Acceptance Criteria

1. THE PACE_App SHALL add the following screens to the sidebar navigation under a "Governance" section: Founder Review (/founder-review), Leaderboard (/leaderboard), Equity (/equity), and Startup Health (/startup-health)
2. THE PACE_App SHALL display the Governance section in the sidebar only to users with the "founder" role
3. WHEN a founder clicks a Governance sidebar item, THE PACE_App SHALL navigate to the corresponding screen within 200 milliseconds
4. THE PACE_App SHALL maintain all existing sidebar items (v1 and v2 Team Ops) in their current positions

### Requirement 17: Founder Review Screen

**User Story:** As a founder, I want a dedicated screen to view and submit peer reviews, so that the review process is centralized.

#### Acceptance Criteria

1. WHEN a founder navigates to /founder-review, THE PACE_App SHALL display the current Review_Cycle status (open, closed, or resolved) and submission deadline
2. WHILE a Review_Cycle is open, THE PACE_App SHALL display a submission form for each other founder with three 1-to-5 scale inputs (output, reliability, initiative)
3. WHEN a founder has already submitted reviews for the current cycle, THE PACE_App SHALL display a confirmation message and disable the submission form
4. THE PACE_App SHALL display a history of past Review_Cycles with aggregated scores per founder per dimension
5. THE PACE_App SHALL display each founder's current Accountability_Warning count and consecutive warning status

### Requirement 18: Legacy Feature Removal — Mood Check-ins

**User Story:** As a developer, I want mood check-in code removed, so that the codebase is clean and does not contain deprecated features.

#### Acceptance Criteria

1. THE PACE_App SHALL remove the mood check-in module (src/lib/mood.ts) and its associated test file (src/lib/mood.test.ts)
2. THE PACE_App SHALL remove the mood_checks table from the database schema
3. THE PACE_App SHALL remove all UI components and prompts related to mood check-in from session start and end flows
4. THE PACE_App SHALL remove the mood-dismissal-no-record property test file

### Requirement 19: Legacy Feature Removal — Meeting Logger

**User Story:** As a developer, I want meeting logger code removed, so that the codebase is clean and does not contain deprecated features.

#### Acceptance Criteria

1. THE PACE_App SHALL remove the meeting logger module (src/lib/meetings.ts) and its associated test file (src/lib/meetings.test.ts)
2. THE PACE_App SHALL remove the meetings table from the database schema
3. THE PACE_App SHALL remove the "Meeting" option from the Idle Modal resolution choices
4. THE PACE_App SHALL remove the meeting-record-linkage property test file
5. THE PACE_App SHALL remove meeting details from the end-of-day report generation

### Requirement 20: Legacy Feature Removal — Morning Digest, Standup Prompt, and Monthly Digest PDF

**User Story:** As a developer, I want morning digest, standup prompt, and monthly digest PDF code removed, so that the codebase is clean and does not contain deprecated features.

#### Acceptance Criteria

1. THE PACE_App SHALL remove the morning digest generation logic from src/lib/monthlyDigest.ts
2. THE PACE_App SHALL remove the standup prompt module (src/lib/standup.ts) and its associated test file (src/lib/standup.test.ts)
3. THE PACE_App SHALL remove the standup_responses table from the database schema
4. THE PACE_App SHALL remove the Monthly Digest PDF screen (src/screens/Monthly/index.tsx) and its /monthly route
5. THE PACE_App SHALL remove the standup-once-per-day property test file and the morning-digest-content property test file
6. THE PACE_App SHALL remove the monthly-digest-content property test file
7. THE PACE_App SHALL remove the "Monthly" sidebar navigation item

### Requirement 21: Governance Data Integrity

**User Story:** As a founder, I want governance data to be consistent and synced, so that all founders see the same review results, equity stakes, and health metrics.

#### Acceptance Criteria

1. THE Sync_Service SHALL sync founder_reviews, equity_stakes, dilution_events, accountability_warnings, and review_cycles collections to PocketBase following the existing offline-first pattern
2. THE PACE_App SHALL store all governance-related dates as UTC timestamps, performing local timezone conversion only in the display layer
3. IF a sync conflict occurs on a governance record, THEN THE Sync_Service SHALL apply last-write-wins resolution and notify the affected founders via OS notification
4. THE PACE_App SHALL validate that equity stake percentages across all founders sum to 100% (within 0.01% tolerance) after every Dilution_Event

### Requirement 22: Equity Dashboard Cap Table Visualization

**User Story:** As a founder, I want a pie chart of the cap table, so that I can visually understand ownership distribution.

#### Acceptance Criteria

1. THE Equity_Dashboard SHALL display a pie chart with one segment per founder, sized proportionally to currentStakePct
2. THE Equity_Dashboard SHALL label each pie chart segment with the founder's name and percentage
3. WHEN a Dilution_Event occurs, THE Equity_Dashboard SHALL update the pie chart within 3 seconds via PocketBase realtime subscriptions
4. THE Equity_Dashboard SHALL use distinct colors for each founder's segment, consistent with the founder's avatarColor from their user profile
