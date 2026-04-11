# Implementation Plan: Founder Governance

## Overview

Incremental implementation of founder governance features for PACE v3. Each phase builds on the previous — legacy removal first, then schema, then core engines, then screens, then polish. All new code follows existing patterns: Rust commands for computation, Zustand stores for state, React screens with TanStack Query for display, and fast-check property tests for correctness. TypeScript for frontend, Rust for backend.

## Tasks

- [x] 1. Legacy Feature Removal — Clean out deprecated code before adding governance
  - [x] 1.1 Remove mood check-in module and references
    - Delete `src/lib/mood.ts`, `src/lib/mood.test.ts`, `src/__tests__/properties/mood-dismissal-no-record.property.test.ts`
    - Remove `MoodCheck` type from `src/types/index.ts`
    - Remove mood prompts from `StartSessionFlow` and `EndDayFlow` components
    - Remove mood option from `IdleModal`
    - _Requirements: 18.1, 18.2, 18.3, 18.4_
  - [x] 1.2 Remove meeting logger module and references
    - Delete `src/lib/meetings.ts`, `src/lib/meetings.test.ts`, `src/__tests__/properties/meeting-record-linkage.property.test.ts`
    - Remove `Meeting` type from `src/types/index.ts`
    - Remove "Meeting" option from `IdleModal` resolution choices
    - Remove meeting entries from EOD report generation in `src/lib/reports.ts`
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_
  - [x] 1.3 Remove morning digest, standup prompt, and monthly digest PDF
    - Delete `src/lib/standup.ts`, `src/lib/standup.test.ts`, `src/__tests__/properties/standup-once-per-day.property.test.ts`
    - Delete `src/__tests__/properties/morning-digest-content.property.test.ts`, `src/__tests__/properties/monthly-digest-content.property.test.ts`
    - Delete `src/screens/Monthly/index.tsx`
    - Remove morning digest logic from `src/lib/monthlyDigest.ts`
    - Remove `StandupResponse` type, standup_responses DDL references
    - Remove `/monthly` route from `src/router.tsx`, remove "Monthly" sidebar item from `src/components/Sidebar.tsx`
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7_

- [x] 2. Checkpoint — Legacy removal verified
  - Ensure all tests pass after legacy removal, ask the user if questions arise.

- [x] 3. Schema Extension — SQLite tables and PocketBase migration for governance
  - [x] 3.1 Create v3 SQLite migration with all governance tables
    - Create `pocketbase/pb_migrations/v3_founder_governance_schema.js`
    - Add tables: `review_cycles`, `founder_reviews`, `accountability_warnings`, `equity_stakes`, `dilution_events`, `decisions`, `startup_health_config`
    - Include all CHECK constraints, indexes, foreign keys, and UNIQUE constraints per design DDL
    - Drop legacy tables: `mood_checks`, `meetings`, `standup_responses`, `morning_digests`
    - Add migration to `src-tauri/src/db.rs` schema initialization
    - _Requirements: 3.1, 3.2, 3.3, 6.4, 7.2, 12.5, 14.6_
  - [x] 3.2 Create PocketBase collections for synced governance data
    - Add collections: `review_cycles`, `founder_reviews`, `accountability_warnings`, `equity_stakes`, `dilution_events`, `decisions`
    - Exclude `startup_health_config` (local-only, never synced)
    - Delete legacy PocketBase collections: `standup_responses`, `meetings`, `morning_digests`
    - _Requirements: 3.4, 21.1_
  - [x] 3.3 Extend sync service with governance collections
    - Add governance collection names to `src/lib/sync.ts` collection list
    - Ensure `startup_health_config` is excluded from sync queue
    - _Requirements: 21.1, 21.3_
  - [x] 3.4 Write property test for governance timestamps stored as UTC
    - **Property 15: Governance timestamps stored as UTC**
    - **Validates: Requirements 3.5, 21.2**

- [x] 4. Checkpoint — Schema verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Visibility Controller — Role checks and route guards
  - [x] 5.1 Implement role utility functions
    - Create `src/lib/roles.ts` with `isFounder()`, `isAdmin()`, and `canAccess()` functions
    - `isFounder`: role contains "founder" or "ceo" (case-insensitive)
    - `isAdmin`: role contains "admin" or "ceo" (case-insensitive)
    - `canAccess`: checks user role against visibility tier (everyone, founders_only, admin_only, individual_only)
    - _Requirements: 8.1, 8.2, 9.1, 9.2, 10.1, 10.2, 11.1, 11.2_
  - [x] 5.2 Write property test for visibility tier access control
    - **Property 10: Visibility tier access control**
    - **Validates: Requirements 8.2, 9.2, 10.2, 11.2**
  - [x] 5.3 Create FounderGuard and AdminGuard components
    - Create `src/components/FounderGuard.tsx`: wraps governance routes, checks `useAuthStore().user.role` via `isFounder()`
    - Renders "Founders only" message for non-founders
    - Create `src/components/AdminGuard.tsx`: same pattern for admin-only routes
    - _Requirements: 9.3, 10.2, 10.3_
  - [x] 5.4 Register governance routes in router
    - Add routes to `src/router.tsx`: `/founder-review`, `/leaderboard`, `/equity`, `/startup-health`
    - Wrap each in `FounderGuard`
    - _Requirements: 16.1, 16.3_

- [x] 6. Checkpoint — Visibility and routing verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Peer Review Engine — Cycle management, scoring, accountability
  - [x] 7.1 Implement review cycle scheduling logic
    - Create `src/lib/reviewScheduler.ts` with `shouldCreateNewCycle()`, `getSubmissionDeadline()`, `isCycleExpired()`
    - New cycle every 14 days from feature enable date
    - Submission deadline = startDate + 48 hours
    - _Requirements: 1.1, 1.6_
  - [x] 7.2 Write property test for review cycle scheduling
    - **Property 1: Review cycle scheduling**
    - **Validates: Requirements 1.1, 1.6**
  - [x] 7.3 Implement review cycle Rust commands
    - Add `create_review_cycle()`, `close_review_cycle()`, `resolve_tie()`, `get_review_history()`, `get_warning_count()` to `src-tauri/src/commands.rs`
    - `create_review_cycle`: inserts cycle with status "open", computes endDate and submissionDeadline
    - `close_review_cycle`: computes average scores per founder per dimension, returns sorted results
    - _Requirements: 1.1, 1.7, 2.1, 2.6_
  - [x] 7.4 Implement review submission Rust command
    - Add `submit_founder_review()` command
    - Validate: cycle is "open", now < submissionDeadline, reviewerId != revieweeId, no duplicate (cycleId, reviewerId, revieweeId), scores in [1,5]
    - _Requirements: 1.3, 1.4, 1.6, 2.7_
  - [x] 7.5 Write property test for review submission validation
    - **Property 2: Review submission validation**
    - **Validates: Requirements 1.3, 1.4, 1.6**
  - [x] 7.6 Write property test for review score averaging
    - **Property 3: Review score averaging**
    - **Validates: Requirements 1.7, 2.1**
  - [x] 7.7 Implement lowest-ranked detection and accountability warning
    - In `close_review_cycle`: identify lowest-ranked founder, handle ties (CEO vote or hours fallback)
    - Insert `accountability_warning` for lowest-ranked founder
    - Check for consecutive warnings → trigger dilution event
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 7.8 Write property test for lowest-ranked identification
    - **Property 4: Lowest-ranked identification and accountability warning**
    - **Validates: Requirements 2.1, 2.3, 2.4**
  - [x] 7.9 Write property test for consecutive warnings trigger dilution
    - **Property 5: Consecutive warnings trigger dilution**
    - **Validates: Requirements 2.5**

- [x] 8. Checkpoint — Peer review engine verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Leaderboard Engine — Weekly scoring and ranking
  - [x] 9.1 Implement leaderboard score computation
    - Create `src/lib/leaderboard.ts` with `computeFounderScores()` and `determineFounderOfWeek()`
    - Composite: (normalizedHours × 0.3) + (normalizedTasks × 0.4) + (normalizedPeerReview × 0.3)
    - Normalize hours/tasks by max across founders (0.0 if max is 0), peer review by 5.0 (default 3.0/5.0 = 0.6)
    - Sort descending, exactly one Founder of the Week (tie-break by tasks)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.3, 5.4_
  - [x] 9.2 Write property test for leaderboard score computation
    - **Property 6: Leaderboard score computation and ranking**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.3, 5.4**

- [x] 10. Equity Engine — Stakes, vesting, dilution
  - [x] 10.1 Implement equity computation functions
    - Create `src/lib/equity.ts` with `computeVestingProgress()`, `computeCliffStatus()`, `applyDilution()`, `computeProjectedPayout()`, `validateCapTableSum()`
    - Vesting: linear progress from vestingStartDate to vestingEndDate, clamped [0.0, 1.0]
    - Cliff: pre_cliff (with daysRemaining), cliff_passed, fully_vested
    - Dilution: reduce target by dilutionPct, redistribute proportionally among others, preserve cap table sum within 0.01%
    - Projected payout: valuation × currentStakePct / 100
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 7.1, 7.2, 7.3, 21.4_
  - [x] 10.2 Write property test for equity dilution preserves cap table sum
    - **Property 7: Equity dilution preserves cap table sum**
    - **Validates: Requirements 6.5, 21.4**
  - [x] 10.3 Write property test for vesting progress and cliff status
    - **Property 8: Vesting progress and cliff status**
    - **Validates: Requirements 6.2, 6.3**
  - [x] 10.4 Write property test for projected payout computation
    - **Property 9: Projected payout computation**
    - **Validates: Requirements 7.3**
  - [x] 10.5 Implement equity Rust commands
    - Add `apply_dilution()` command in Rust for SQLite-level equity updates
    - Validate cap table sum after every dilution event
    - _Requirements: 6.5, 21.4_

- [x] 11. Checkpoint — Leaderboard and equity engines verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Startup Health Engine — Runway, balance, decisions, burn rate
  - [x] 12.1 Implement startup health computation functions
    - Create `src/lib/startupHealth.ts` with `computeRunway()`, `computeFounderBalance()`, `computeDecisionVelocity()`, `computeBurnRateAlignment()`
    - Runway: cashBalance / mean(monthlyExpenses), status thresholds at 3 (red) and 6 (amber) months
    - Founder balance: std dev of weekly hours, alert when deviation > 30% of team average
    - Decision velocity: mean days to resolve decisions in past 30 days
    - Burn rate: (actual / planned) × 100, thresholds at 110% (amber) and 130% (red)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 13.1, 13.2, 13.3, 13.4, 14.1, 14.2, 14.3, 14.4, 14.5_
  - [x] 12.2 Write property test for runway computation
    - **Property 11: Runway computation and thresholds**
    - **Validates: Requirements 12.1, 12.3, 12.4**
  - [x] 12.3 Write property test for founder balance detection
    - **Property 12: Founder balance detection**
    - **Validates: Requirements 13.1, 13.2**
  - [x] 12.4 Write property test for decision velocity
    - **Property 13: Decision velocity computation**
    - **Validates: Requirements 14.1**
  - [x] 12.5 Write property test for burn rate alignment
    - **Property 14: Burn rate alignment and thresholds**
    - **Validates: Requirements 14.3, 14.4, 14.5**
  - [x] 12.6 Implement startup health Rust commands
    - Add `compute_startup_health()` command aggregating runway, balance, velocity, burn rate
    - Read from `startup_health_config` (local), `decisions`, attendance data
    - _Requirements: 12.1, 12.5, 14.6_

- [x] 13. Checkpoint — Startup health engine verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Governance Zustand Stores — State management for all governance screens
  - [x] 14.1 Create reviewStore
    - Create `src/stores/reviewStore.ts` (Zustand)
    - State: currentCycle, results, history, warnings (founderId → count), loading
    - Actions: refresh(), submitReview(revieweeId, output, reliability, initiative)
    - Wire to Rust commands via Tauri IPC
    - _Requirements: 1.3, 1.7, 2.6, 17.1, 17.2, 17.3, 17.4, 17.5_
  - [x] 14.2 Create leaderboardStore
    - Create `src/stores/leaderboardStore.ts` (Zustand)
    - State: scores, currentWeek, loading
    - Actions: refresh()
    - Wire to leaderboard computation functions
    - _Requirements: 4.1, 5.1, 5.2_
  - [x] 14.3 Create equityStore
    - Create `src/stores/equityStore.ts` (Zustand)
    - State: stakes, dilutionHistory, loading
    - Actions: refresh()
    - Wire to equity computation functions and PocketBase realtime subscriptions
    - _Requirements: 6.1, 7.1, 22.3_
  - [x] 14.4 Create healthStore
    - Create `src/stores/healthStore.ts` (Zustand)
    - State: data, config, decisions, loading
    - Actions: refresh(), updateConfig(), logDecision(), resolveDecision()
    - Wire to startup health functions and Rust commands
    - _Requirements: 12.1, 12.5, 14.1, 14.6_

- [x] 15. Founder Review Screen — Submission form, results, history
  - [x] 15.1 Build Founder Review screen
    - Create `src/screens/FounderReview/index.tsx`
    - Display current cycle status (open/closed/resolved) and submission deadline
    - When cycle is open: show submission form for each other founder with three 1-to-5 scale inputs (output, reliability, initiative)
    - When already submitted: show confirmation message, disable form
    - Display history of past cycles with aggregated scores per founder per dimension
    - Display each founder's accountability warning count and consecutive warning status
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_
  - [x] 15.2 Write unit tests for Founder Review screen
    - Test form rendering, submission state, disabled state after submission, history display
    - _Requirements: 17.1, 17.2, 17.3_

- [x] 16. Leaderboard Screen — Scores, ranking, Founder of the Week
  - [x] 16.1 Build Leaderboard screen
    - Create `src/screens/Leaderboard/index.tsx`
    - Ranked list of founders sorted by composite score descending
    - Display per founder: score, hours, tasks completed, peer review average
    - "Founder of the Week" badge on top scorer
    - Visible only to founders (wrapped in FounderGuard)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - [x] 16.2 Write unit tests for Leaderboard screen
    - Test score display, sorting, badge rendering, founder-only visibility
    - _Requirements: 5.1, 5.3_

- [x] 17. Equity Dashboard Screen — Cap table, vesting, dilution, projections
  - [x] 17.1 Build Equity Dashboard screen
    - Create `src/screens/Equity/index.tsx`
    - Cap table pie chart with one segment per founder, sized by currentStakePct, labeled with name and percentage
    - Distinct colors per founder (from avatarColor)
    - Each founder's vesting progress bar and cliff status
    - Dilution history list: date, affected founder, dilution %, triggering cycle, resulting stakes
    - Valuation input field → projected payout display (valuation × currentStakePct / 100)
    - Visible only to founders (wrapped in FounderGuard)
    - _Requirements: 6.1, 6.2, 6.3, 7.1, 7.3, 7.4, 7.5, 22.1, 22.2, 22.4_
  - [x] 17.2 Write unit tests for Equity Dashboard screen
    - Test pie chart data, dilution history list, valuation input, founder-only visibility
    - _Requirements: 22.1, 22.2_

- [x] 18. Checkpoint — Governance screens verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. Startup Health Screen — Runway, balance, decisions, burn rate, investor PDF
  - [x] 19.1 Build Startup Health screen
    - Create `src/screens/StartupHealth/index.tsx`
    - Runway indicator: months with 1 decimal, amber/red color coding at 6/3 month thresholds
    - Founder balance: each founder's weekly hours vs team average, balance alert indicators (neutral language: "Hours gap detected")
    - Decision velocity: days with 1 decimal, decision log with title/description/createdAt/resolvedAt
    - Burn rate alignment: percentage with amber (>110%) / red (>130%) indicators
    - Settings section: cash balance input, monthly expenses (last 3 months), planned monthly budget
    - Log decision form: title, description fields
    - Resolve decision button on open decisions
    - Visible only to founders (wrapped in FounderGuard)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 13.1, 13.2, 13.3, 13.4, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_
  - [x] 19.2 Write unit tests for Startup Health screen
    - Test runway display, balance alerts, decision log, burn rate indicators, settings form
    - _Requirements: 12.2, 13.3, 14.2_
  - [x] 19.3 Implement investor summary PDF generation
    - Create `src/lib/investorPdf.ts` using jsPDF
    - Include: runway months, burn rate alignment, founder hours summary, decision velocity, task completion velocity, team size
    - PACE branding (indigo accent, Geist typography)
    - Date range selector for summary data
    - Tauri save dialog for file location
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

- [x] 20. Checkpoint — Startup health screen and PDF verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Navigation and Polish — Sidebar, realtime, notifications
  - [x] 21.1 Update sidebar with Governance section
    - Add "Governance" section divider to `src/components/Sidebar.tsx`, visible only to founders via `isFounder()` check
    - Add items: Founder Review (/founder-review), Leaderboard (/leaderboard), Equity (/equity), Startup Health (/startup-health)
    - Remove "Monthly" sidebar item (legacy)
    - Keep all existing v1 and Team Ops items in place
    - _Requirements: 16.1, 16.2, 16.3, 16.4_
  - [x] 21.2 Wire PocketBase realtime subscriptions for governance data
    - Extend `src/lib/realtime.ts` with subscriptions for equity_stakes, review_cycles, dilution_events
    - Cap table pie chart updates within 3 seconds of dilution event via realtime
    - _Requirements: 22.3, 21.1_
  - [x] 21.3 Add OS notifications for review cycle events
    - Notification when new review cycle opens (to all founders)
    - Notification when submission deadline approaches (24h before)
    - Notification when review cycle results are available
    - Notification when accountability warning is issued
    - _Requirements: 1.2_
  - [x] 21.4 Wire dilution trigger from peer review to equity engine
    - When consecutive warnings detected in `close_review_cycle`, call `applyDilution()` with 1% dilution
    - Create dilution event record, update equity stakes, notify affected founder
    - Validate cap table sum after dilution
    - _Requirements: 2.5, 6.5, 21.4_

- [x] 22. Final Checkpoint — Full governance feature verified
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (15 properties)
- Unit tests validate specific examples, edge cases, and UI rendering
- Legacy removal happens first to avoid conflicts with new governance code
- Schema is laid down before any business logic to ensure data layer is solid
- Screens are built after all engines are implemented and tested
