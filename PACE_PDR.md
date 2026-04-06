# PACE — Product Design & Requirements Document
**Version:** 1.0  
**Date:** April 2026  
**Author:** Kenesis Labs  
**Status:** Implementation Complete, Deployment In Progress

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Solution](#3-solution)
4. [Target Users](#4-target-users)
5. [Core Philosophy](#5-core-philosophy)
6. [Feature Specification](#6-feature-specification)
7. [Screen Inventory](#7-screen-inventory)
8. [Design System](#8-design-system)
9. [Tech Stack](#9-tech-stack)
10. [Architecture](#10-architecture)
11. [Privacy & Data](#11-privacy--data)
12. [Deployment](#12-deployment)
13. [Test Coverage](#13-test-coverage)
14. [Build Status](#14-build-status)

---

## 1. Executive Summary

PACE is a desktop-first work tracking and team operations platform built for Kenesis Labs — a small, fast-moving AI startup. It tracks the honest shape of a workday: when people start, what they work on, when they take breaks, and what they actually ship. It surfaces this data through daily reports, weekly reviews, team analytics, and a founder dashboard that tells the team where their collective effort is going.

Beyond individual session tracking, PACE handles the full operational loop for a small founding team: attendance logging, leave and WFH management, request/approval workflows, workspace access proof, and AI-powered insights — all from a single desktop app with cloud sync.

PACE is not a time surveillance tool. It is a shared accountability layer built on trust and transparency. Every team member's session, task progress, and daily output is visible to everyone on the team in real time — not to judge, but to maintain shared rhythm across an async, founder-led team. Private data (focus scores, mood check-ins) stays local and is never synced.


## 2. Problem Statement

### Visibility Gap
Small founding teams operate in a fog. No one knows who's working on what, how many hours went into a project, or whether the team is collectively drifting. Existing tools (Toggl, Clockify) track time but don't surface patterns, and they require manual discipline that erodes within weeks.

### Session Discipline Gap
Founders forget to start timers, forget to stop them, and lose data to crashes. The result is inaccurate records that no one trusts. A work tracker that can't survive a laptop crash or a forgotten logout is useless.

### Output vs. Activity Gap
Hours logged ≠ work shipped. Most trackers measure input (time) without connecting it to output (tasks completed, code committed, notes written). The team needs a system that ties sessions to deliverables.

### Operational Overhead Gap
A 3–5 person team still needs attendance records, leave tracking, request approvals, and team coordination — but enterprise HR tools are overkill. These operational tasks get handled in Slack threads and spreadsheets, creating fragmented records and missed approvals.

---

## 3. Solution

PACE solves both gaps through two interlocking loops:

### Daily Loop (Individual)
Start session → set task → work → idle detection handles breaks automatically → switch tasks via Cmd+K → write output note → end day with summary → auto-generated EOD report. Crash recovery ensures no data loss. Workspace proof captures check-in/check-out evidence.

### Team Ops Loop (Collective)
Morning digest summarizes yesterday → async standup captures today's plan → founder dashboard shows live team status → leave/WFH requests flow through approval → attendance log derives records from sessions → weekly review reflects on output → team analytics surface patterns → monthly PDF archives the month.

Both loops feed the same data layer: SQLite local-first, PocketBase cloud sync, real-time WebSocket updates. AI reflects on completed work — it never interrupts live sessions.

---

## 4. Target Users

| Role | Count | Primary Use |
|------|-------|-------------|
| Founding team members | 3–5 | Daily session tracking, task management, output logging |
| Team lead / CEO | 1 | Founder dashboard, approvals, team analytics, monthly reports |

### Platforms
- **Primary**: macOS (Apple Silicon + Intel), Windows 10/11
- **Secondary**: Linux (Ubuntu 22.04+)
- **Cloud**: AWS Lightsail (PocketBase + LiteLLM + Caddy)

---

## 5. Core Philosophy

### Governing Principles

1. **Invisible during deep work** — No popups, no badges, no interruptions while you're in flow. The app tracks silently via system-level idle detection and heartbeat.

2. **Max 3 taps for any action** — Start session, switch task, take break, end day — every core action completes in ≤3 interactions.

3. **Offline-first, always** — All writes hit SQLite before any network call. The app works fully offline; sync happens in the background within 60 seconds.

4. **Output over activity** — The system connects sessions to tasks, tasks to projects, and surfaces what was shipped — not just how long someone sat at their desk.

5. **AI reflects, never interrupts** — AI operates only on completed session data. It generates weekly narratives, suggests leave timing, and parses tasks — but never during a live session.

6. **Mutual transparency, not surveillance** — Every team member sees the same data: sessions, tasks, hours, output notes, streaks, attendance. The system builds shared accountability through visibility.

7. **No surveillance** — No comparative rankings, no productivity scores between members. The system never ranks one founder against another.

8. **Privacy boundary** — Focus scores and mood check-ins are local-only. They are stored in SQLite, never synced to PocketBase, and never visible to any other team member.

---

## 6. Feature Specification

### 6.1 Authentication & Onboarding

**Sign Up / Login**: Full-screen auth screen with email + password. PocketBase `users` collection handles auth. Token stored in Tauri secure storage, persists across restarts.

**Team Invite System**: First user creates a team (generates 8-character invite code). Subsequent users join via invite code. All data scoped to team.

**Onboarding Flow** (4 steps, <60 seconds):
1. Welcome — PACE logo + "Track work, not people."
2. Profile — Avatar color picker, role/title
3. Team — Create team (generates invite code) or join team (paste code)
4. First Project — Project name → navigate to Dashboard with session started

**Auth Guard**: All routes require authentication. Unauthenticated → `/auth`. Authenticated but no team → `/onboarding`.

### 6.2 Session Management

| Feature | Behavior |
|---------|----------|
| Start session | "Start day" from menubar or Today view. Optional backfill up to 4 hours. Claims before device wake → `startVerified: false` |
| Heartbeat | Rust thread writes `lastHeartbeat` to SQLite every 10 seconds |
| End session | Two-step flow: day summary → output note → confirm. Closes all open session_tasks and breaks |
| Auto-close | 2+ hours system idle → auto-close at last activity timestamp |
| Crash recovery | On launch: if `endTime = null` and `lastHeartbeat > 30s` → recovery prompt. User confirms end time, session marked `startType: "recovered"` |
| Single active | At most one session per user with `endTime = null`. Starting a second is rejected |

### 6.3 Idle Detection & Breaks

| Idle Duration | Behavior |
|---------------|----------|
| < 8 minutes | Silently absorbed. No event, no record, no UI |
| 8–20 minutes | Micro-pause recorded in timeline. No user prompt |
| ≥ 20 minutes | Idle Modal on return: Lunch / Short break / Meeting / Discard |

**Auto-pause triggers**: Screen lock, sleep, lid close → session timer pauses silently.

**Break management**: Manual break via session card or menubar. Session card turns amber with break timer. 90-minute break → OS notification. 105 minutes no response → auto-close session at break start time. Breaks under 8 minutes hidden from all UI.

**Soft nudge**: After configurable continuous work (default 90 min, range 30–180), OS notification: "Still working on [task]?" No response in 5 min → pause timer → Idle Modal on return.

### 6.4 Task Management

**Two-layer structure**: Projects → Tasks. No sub-tasks, no additional nesting.

**Inline creation**: Title + project required. Assignee, priority, due date optional. Enter to create — no modal, no navigation.

**Natural language AI creation**: Submit free text → AI parses to structured fields (title, project, assignee, priority, due date) → pre-fill form for confirmation. Fallback: raw text as title if AI fails.

**Cmd+K Task Switcher**: Global keyboard shortcut opens command palette. All open tasks grouped by project. Arrow keys + Enter to select, type to filter. On switch: close current session_task, create new one, auto-transition target from "open" → "inprogress".

**Task statuses**: Open, InProgress, Done, Blocked. Tasks with no logged time for 7+ days (and not Blocked) flagged as stale in weekly review.

### 6.5 Attendance Logging

Attendance is derived from session data — no manual entry required.

| Field | Derivation |
|-------|-----------|
| Login time | Earliest session `startTime` for user on that day |
| Logout time | Latest session `endTime` for user on that day |
| Total hours | Sum of (session duration − break duration) across all sessions |
| Break minutes | Sum of all break durations |
| Output note | From the last closed session of the day |

**Filters**: Person, date range, project. All filters apply simultaneously.

**CSV Export**: Columns — date, person, login time, logout time, total hours, break minutes, output note. Round-trip verified (export → parse → identical values).

### 6.6 Leave Management

**Leave balances** (per person per calendar year):
- Annual leave: 20 days allocated
- Sick leave: 10 days allocated
- WFH: no balance impact

**Public holidays**: Pre-loaded calendar entries. Holidays within a leave range are not counted as leave days. Founders can add/edit/remove holidays from Settings.

**Team leave calendar**: Monthly grid — team members as rows, days as columns. Color-coded: annual (blue), sick (red), WFH (green), holiday (gray). Summary bar: available / on-leave / WFH counts.

**Request/Approval workflow**:
- Submit: type (annual/sick/wfh), start date, end date, reason
- Sick leave: auto-approved immediately
- Annual/WFH: status = "pending", OS notification to all other founders
- Approval: updates calendar, deducts annual balance
- Decline: requires reason, OS notification to requester
- Self-approval prevention: cannot approve/decline own request
- Balance validation: annual leave rejected if requested days > remaining balance

### 6.7 Founder Dashboard

The command centre for operational awareness. All data updates within 3 seconds via PocketBase realtime subscriptions.

| Section | Content |
|---------|---------|
| Live team status | Each member: Active / On Break / Away / Offline / On Leave / WFH. Current task and session duration |
| Today's hours | Combined team session hours for the current day |
| Pending approvals | Count of pending leave/WFH requests with link to Requests screen |
| Project health | Per project: open tasks, overdue tasks, hours this week |
| Weekly velocity | Tasks completed this week vs. previous week |
| Upcoming leave | Approved leave/WFH in the next 14 calendar days |
| Attendance alerts | Members with no session by 12 PM (excludes leave, holidays, weekends). WFH users get "WFH — not yet logged in" label |
| Milestone warnings | Milestones with deadline within 3 days and not complete |
| Overwork signals | Members with 3+ days of 10+ hours in rolling 7-day window. Supportive language only |

### 6.8 Team Analytics

**Individual metrics** (4-week rolling window):
- Average daily hours
- Most productive day of week
- Peak focus time (hour range with longest uninterrupted segments)
- Task completion rate (done / assigned, 0–100%)
- Output consistency (std dev of daily hours — lower = more consistent)

**Team metrics**:
- Combined hours per project
- Velocity trend (8-week line chart of tasks completed per week)
- Availability heatmap (members × days, logged hours per cell)
- Leave impact (% reduction in team hours during leave weeks)

**Focus score** (private, local-only):
- Composite = (session_continuity × 0.4 + min(avg_uninterrupted_min / 60, 1.0) × 0.3 + task_completion_rate × 0.3) × 100
- Range: 0–100. Stored in `focus_score_history`. Never synced.

**Overwork detection**: >10 hours/day flagged. 3+ flagged days in 7-day window → overwork signal with supportive message.

**No comparative rankings**: The system never ranks, scores, or compares individual members against each other.

### 6.9 Daily Reports & Digest

**End-of-day report** (auto-generated on session close):
- Total session time, tasks worked with time per task, breaks with durations, meetings with titles, output note, git commits
- Stored in `daily_reports`, visible to all team members on Digest screen

**Morning digest** (generated at 8:00 AM local time on workdays):
- Per-member summary: yesterday's hours, tasks completed, output note
- Who's on leave or WFH today
- OS notification at 8 AM. Banner on Today screen if unviewed before noon

**Async standup prompt**: On first session start of each workday — "What are you working on today?" Submit or dismiss (no re-prompt). Responses visible on Digest screen.

### 6.10 Workspace Access Proof

Mandatory photo + location capture on every session start (check-in) and session end (check-out). No skip, no bypass.

**Geolocation capture**: Browser geolocation API via WebView. Returns lat/lng/accuracy. Fallback: manual selection from saved locations if permissions denied.

**Auto-tagging**: Compare current coordinates against saved `workspace_locations` using Haversine distance. Within 200m → auto-tag with location name. New location → prompt to name and save. Also checks team `office_zones` (500m default radius).

**Photo capture**: Webcam capture (compressed JPEG, max 500KB) or file upload. Uploaded files: EXIF timestamp validated — reject if older than 5 minutes. No EXIF → accepted with "unverified timestamp" flag.

**AI verification** (advisory only):
- PocketBase hook sends photo to LiteLLM vision endpoint
- Prompt: "Is this a photo of a workspace, desk, or office environment?"
- Result: `aiVerified` = yes / no / unavailable. Flagged photos get amber badge in attendance log
- AI never blocks session start or end. Verification is informational only

**Crash recovery**: If app crashed without checkout, next launch prompts "You missed your checkout — please provide proof now."

### 6.11 AI Integration

All AI features route through PocketBase JS hooks → LiteLLM proxy. API keys resolved server-side, never transmitted to desktop client.

| Feature | Trigger | Fallback |
|---------|---------|----------|
| NL task parsing | User submits free text in task creation | Raw text as title, manual field entry |
| Smart leave suggestions | Leave request form opens | Calendar-based conflict detection only (no AI suggestions) |
| Weekly review narrative | Weekly review screen loads | Data displayed without narrative |
| Workspace photo verification | Proof record created | `aiVerified = "unavailable"`, no blocking |
| Task time estimation | Task detail view | No estimate shown |
| Team health summary | Dashboard loads | Dashboard data without AI summary |

**Constraints**:
- AI operates only on completed session data — never on active sessions
- No productivity scores, rankings, or comparative assessments
- All AI features can be fully disabled from Settings
- LiteLLM proxy supports multiple providers: OpenAI, Anthropic, Gemini, OpenRouter, AWS Bedrock, Ollama

### 6.12 Quality of Life

**Check-in streaks**: Consecutive workdays with at least one session. Weekends, holidays, and approved leave are skipped (not streak-breaking). Displayed on Team view member cards, visible to all.

**Milestones**: Named checkpoints on projects with deadline dates. Sorted by deadline. Warning on Dashboard/Tasks when deadline within 3 days. Completion gate: can only mark complete when all associated tasks are "done."

**Mood check-in**: Optional 5-point energy scale + one-word mood tag on session start/end. Local-only, never synced. Trends visible on private analytics view. Dismiss = no record.

**Meeting logger**: When "Meeting" selected in Idle Modal, additional fields: title (required), attendees (optional). Stored linked to break and session. Included in EOD report.

**Monthly digest PDF**: Generated via jsPDF. Contains: total team hours, hours per person/project, tasks completed, leave days per person, weekly output summaries. PACE branding (indigo accent, Geist typography). Any past month selectable. Save As dialog for export.

**Git integration**: On session end, `git log` executed for configured repo paths filtered to session time range. Commits stored as `git_event` records linked to session. Displayed in session timeline and EOD report.

---

## 7. Screen Inventory

| # | Screen | Route | Type | Purpose |
|---|--------|-------|------|---------|
| 1 | Auth | `/auth` | Full-screen | Sign up / login |
| 2 | Onboarding | `/onboarding` | Full-screen | Profile, team, first project setup |
| 3 | Today | `/` | App (sidebar) | Active session, timer, timeline, output note |
| 4 | Team | `/team` | App (sidebar) | Live team member cards with status, streaks |
| 5 | Tasks | `/tasks` | App (sidebar) | Project list, task list, inline creation, detail panel |
| 6 | Review | `/review` | App (sidebar) | Weekly summary, hours chart, AI narrative, team tab |
| 7 | Settings | `/settings` | App (sidebar) | Idle thresholds, AI config, git repos, account, team, office zones |
| 8 | Dashboard | `/dashboard` | App (sidebar) | Founder command centre — live status, approvals, health, alerts |
| 9 | Attendance | `/attendance` | App (sidebar) | Historical calendar of login/logout/hours per person |
| 10 | Leave | `/leave` | App (sidebar) | Team leave calendar, balance display, request form |
| 11 | Requests | `/requests` | App (sidebar) | Pending leave/WFH requests, approve/decline actions |
| 12 | Analytics | `/analytics` | App (sidebar) | Individual + team metrics, focus score (private), heatmap |
| 13 | Digest | `/digest` | App (sidebar) | Morning digest, standup responses, EOD reports |
| 14 | Monthly | `/monthly` | App (sidebar) | Monthly digest PDF generation and export |

**Overlays / Modals** (not routed):

| Overlay | Trigger |
|---------|---------|
| Idle Modal | Return from ≥20 min idle |
| Task Switcher (Cmd+K) | Keyboard shortcut |
| Workspace Proof Modal | Session start / end |
| Crash Recovery | App launch with stale session |
| End Day Flow | "End day" action |
| Start Session Flow | "Start day" action |
| Standup Prompt | First session start of workday |
| Mood Check-in | Session start / end (optional) |
| Meeting Logger | "Meeting" selected in Idle Modal |
| Proof Detail Modal | Click proof record in attendance |

---

## 8. Design System

### Visual Identity
Skeuomorphic glass design with golden amber palette. Premium desktop feel — not flat, not Material.

### Color Palette

| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| Primary | `#B8860B` (dark goldenrod) | `#DAA520` (goldenrod) | Buttons, active states, accents |
| Background | `#FFFDF7` (warm cream) | `#0A0A0A` | App background |
| Surface | `rgba(255,255,255,0.7)` | `rgba(255,255,255,0.05)` | Cards, panels |
| Foreground | `#1A1A1A` | `#FAFAFA` | Primary text |
| Muted | `#F5F0E8` | `#262626` | Secondary surfaces |

### Typography
- **Primary**: Geist (variable weight, 300–700)
- **Monospace**: Geist Mono (timers, code, timestamps)
- **Scale**: 12px (caption) → 14px (body) → 16px (subtitle) → 20px (title) → 28px (hero)

### Glass Surfaces
Three levels of glass blur and opacity for depth hierarchy:
- Level 1 (sidebar, cards): `backdrop-blur(12px)`, subtle border
- Level 2 (modals, overlays): `backdrop-blur(20px)`, stronger border
- Level 3 (dropdowns, tooltips): `backdrop-blur(8px)`, minimal

### Interactive Elements
- **3D buttons**: Subtle gradient + shadow, press animation (scale 0.98)
- **Inset wells**: Input fields with inner shadow for depth
- **Glow hover**: Primary color glow on interactive elements
- **Progress bars**: Gradient fill with ambient glow

### Premium Effects
- Ambient gradient blobs (primary/indigo, low opacity, large blur radius)
- Session card ambient glow matching state color (indigo = active, amber = break)
- Smooth transitions: all screen navigations < 200ms

### Themes
- **Light**: Warm cream background, high-contrast text, golden accents
- **Dark**: Near-black background, soft white text, brighter golden accents
- **System**: Follows OS preference

---

## 9. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Desktop shell | Tauri v2 | Native window, system tray, IPC, plugins (idle, power, notification, autostart) |
| Frontend | React 19 + TypeScript | UI rendering, component architecture |
| Styling | Tailwind CSS v4 + shadcn/ui | Utility-first CSS, component primitives |
| State | Zustand | Client-side stores (session, task, team, ui, leave, dashboard, analytics, auth) |
| Data fetching | TanStack Query | SQLite reads, cache management, background refetch |
| Routing | TanStack Router | Type-safe file-based routing |
| Backend | Rust | Session management, idle detection, heartbeat, analytics computation, attendance derivation |
| Local DB | SQLite (via tauri-plugin-sql) | Offline-first storage, all writes go here first |
| Cloud DB | PocketBase | Auth, collections, REST API, WebSocket realtime, file storage |
| AI proxy | LiteLLM | Provider-agnostic AI routing (OpenAI, Anthropic, Gemini, Bedrock, Ollama) |
| Reverse proxy | Caddy v2 | Auto-HTTPS via Let's Encrypt, route `/api/*` → PocketBase, `/llm/*` → LiteLLM |
| Charts | Recharts | Hours charts, velocity trends, heatmaps |
| PDF | jsPDF | Monthly digest PDF generation |
| Animations | Motion (Framer Motion) | Screen transitions, card animations |
| Testing | Vitest + fast-check | Unit tests, property-based tests (100+ iterations per property) |
| E2E | Playwright | End-to-end screenshot tests |
| Fonts | Geist + Geist Mono | Variable-weight sans-serif and monospace |

---

## 10. Architecture

### System Overview

```
┌─────────────────────────────────────────────────┐
│              PACE Desktop App (Tauri v2)         │
│                                                   │
│  ┌──────────────────┐  ┌──────────────────────┐  │
│  │  React Frontend   │  │    Rust Backend       │  │
│  │                    │  │                        │  │
│  │  Screens (14)      │  │  Session Manager       │  │
│  │  Zustand Stores    │  │  Idle Detector         │  │
│  │  TanStack Query    │  │  Heartbeat Thread      │  │
│  │  TanStack Router   │  │  Attendance Computer   │  │
│  │  Sync Service      │  │  Analytics Engine      │  │
│  │  Realtime Client   │  │  Leave Balance Mgr     │  │
│  │  PDF Generator     │  │  Streak Tracker        │  │
│  │  Digest Scheduler  │  │  Overwork Detector     │  │
│  └────────┬───────────┘  └────────┬───────────────┘  │
│           │      Tauri IPC        │                   │
│           └───────────┬───────────┘                   │
│                       │                               │
│              ┌────────▼────────┐                      │
│              │     SQLite      │                      │
│              │  (local-first)  │                      │
│              └────────┬────────┘                      │
└───────────────────────┼───────────────────────────────┘
                        │ Sync (60s interval)
                        ▼
┌─────────────────────────────────────────────────┐
│           AWS Lightsail VPS ($10/mo)             │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  Caddy   │  │PocketBase│  │ LiteLLM  │       │
│  │  :80/443 │  │  :8090   │  │  :4000   │       │
│  │          │  │          │  │          │       │
│  │ auto-TLS │  │ Auth     │  │ OpenAI   │       │
│  │ reverse  │──│ REST API │  │ Anthropic│       │
│  │ proxy    │  │ Realtime │  │ Gemini   │       │
│  │          │  │ Files    │  │ Bedrock  │       │
│  │          │  │ JS Hooks │──│ Ollama   │       │
│  └──────────┘  └──────────┘  └──────────┘       │
│                                                   │
│  Docker Compose orchestration                     │
└─────────────────────────────────────────────────┘
```

### Docker Compose Services

| Service | Image | Port | Health Check | Depends On |
|---------|-------|------|-------------|------------|
| PocketBase | Custom (./pocketbase/Dockerfile) | 8090 | HTTP `/api/health` every 30s | — |
| LiteLLM | Custom (./litellm/Dockerfile) | 4000 | Python urllib health check every 30s | PocketBase (healthy) |
| Caddy | caddy:2-alpine | 80, 443 | — | PocketBase + LiteLLM (healthy) |

### Caddy Routing

| Path | Upstream |
|------|----------|
| `/api/*` | PocketBase :8090 |
| `/_/*` | PocketBase :8090 (admin UI) |
| `/llm/*` | LiteLLM :4000 (prefix stripped) |

### Offline-First Data Flow

1. All writes go to SQLite first — never fails unless disk full
2. Write queued in `sync_queue` table with collection name, operation, and data
3. Sync service flushes queue to PocketBase every 60 seconds (max 50 ops per cycle)
4. Failed syncs retry with exponential backoff (1s, 2s, 4s, 8s, 16s)
5. After 5 retries → dead letter queue for manual review
6. Sync queue persists across app restarts
7. On reconnect: full state refresh from PocketBase

### Realtime Updates
PocketBase WebSocket subscriptions for: sessions, session_tasks, breaks, leave_requests, standup_responses. Team view and Dashboard update within 3 seconds of any data change.

---

## 11. Privacy & Data

### Private Data (Local-Only, Never Synced)

| Data | Storage | Visibility |
|------|---------|-----------|
| Focus score | `focus_score_history` (SQLite) | Individual user only |
| Mood check-in | `mood_checks` (SQLite) | Individual user only |
| Energy trends | Derived from `mood_checks` | Individual user only |

These tables are explicitly excluded from the sync service's collection list. No `sync_queue` entry is ever created for writes to these tables.

### Team-Visible Data (Synced to PocketBase)

| Data | Visibility |
|------|-----------|
| Session hours, start/end times | All team members |
| Task completion, time per task | All team members |
| Output notes | All team members |
| Check-in streaks | All team members |
| Attendance records (derived) | All team members |
| Leave balances and requests | All team members |
| Standup responses | All team members |
| Meeting logs | All team members |
| Daily/morning reports | All team members |
| Workspace proofs (photo + location) | All team members |
| Milestones | All team members |

### Privacy Rules
- No comparative rankings between members — ever
- No productivity scores comparing individuals
- Overwork signals use supportive language ("Consider taking a break"), never punitive
- AI never produces member comparisons or performance ratings
- Workspace proof AI verification is advisory only — never blocks

---

## 12. Deployment

### Infrastructure
- **Provider**: AWS Lightsail
- **Instance**: $10/month VPS
- **OS**: Ubuntu 22.04 LTS
- **Domain**: Custom domain with Caddy auto-HTTPS (Let's Encrypt)

### Container Stack
```
docker-compose.yml
├── pocketbase (custom Dockerfile)
│   ├── pb_migrations/ (auto-applied on start)
│   │   ├── initial_schema.js
│   │   └── v2_team_ops_schema.js
│   └── pb_hooks/ (8 JS hooks)
│       ├── ai-smart-leave.js
│       ├── ai-standup.js
│       ├── ai-task-estimate.js
│       ├── ai-task-parse.js
│       ├── ai-team-health.js
│       ├── ai-weekly-review.js
│       ├── ai-workspace-verify.js
│       └── sync-validator.js
├── litellm (custom Dockerfile)
│   └── litellm_config.yaml
└── caddy (caddy:2-alpine)
    └── Caddyfile
```

### Deployment Scripts
- `deploy/setup.sh` — Initial server provisioning
- `deploy/update.sh` — Rolling update (pull, rebuild, restart)

### Volumes
- `pb_data` — PocketBase data (SQLite + uploaded files)
- `caddy_data` — TLS certificates
- `caddy_config` — Caddy configuration cache

### Environment Variables
Managed via `.env` file: PocketBase admin credentials, LiteLLM master key, AI provider API keys (OpenAI, Anthropic, Gemini, OpenRouter, AWS), Ollama base URL, domain name.

---

## 13. Test Coverage

### Summary

| Metric | Count |
|--------|-------|
| Total test files | 118 |
| Property-based test files | 64 |
| Unit + integration test files | 54 |
| Property-based iterations | 100+ per property |
| Test framework | Vitest + fast-check |

### Property-Based Tests (Correctness Properties)

Property tests verify universal invariants across randomized inputs. Each property maps to specific requirements.

| # | Property | Validates |
|---|----------|-----------|
| 1 | Single active session invariant | Session start rules |
| 2 | Session start classification (backfill/verified) | Start type assignment |
| 3 | Crash recovery classification | Heartbeat age → recovery decision |
| 4 | Session end closes all children | session_tasks + breaks closed |
| 5 | Idle duration classification | <8m / 8–20m / ≥20m behavior |
| 6 | Idle resolution creates correct records | Break type or discard |
| 7 | Task switch maintains single active task | One open session_task |
| 8 | Temporal containment | Children within parent time bounds |
| 9 | Sync queue durability | Queue persists across restarts |
| 10 | Sync batch size limit | Max 50 ops per cycle |
| 11 | Offline-first write ordering | Timestamp-ordered flush |
| 12 | UTC timestamp consistency | All storage in UTC |
| 13 | Output note round-trip | Pre-fill → save → query unchanged |
| 14 | Day summary computation | Time/tasks/breaks math |
| 15 | Attendance filter correctness | Combined filter logic |
| 16 | Attendance login/logout derivation | Min start / max end |
| 17 | Attendance hours and breaks | Session − break durations |
| 18 | Attendance output note | Last session's note |
| 19 | CSV export round-trip | Export → parse → identical |
| 20 | Leave balance computation | 20 annual − used, 10 sick − used |
| 21 | WFH no balance impact | WFH approval doesn't deduct |
| 22 | Leave request status assignment | Sick → approved, else → pending |
| 23 | Leave balance validation | Reject if exceeds remaining |
| 24 | Self-approval prevention | reviewerId ≠ requesterId |
| 25 | Team availability summary | Available + leave + WFH = total |
| 26 | Streak computation | Consecutive workdays, skip holidays/leave |
| 27 | Focus score bounds | Composite in [0, 100] |
| 28 | No comparative rankings | No ranking fields in output |
| 29 | Average daily hours | Arithmetic mean over 4 weeks |
| 30 | Task completion rate | done / assigned ratio |
| 31 | Output consistency | Std dev of daily hours |
| 32 | Combined hours per project | Sum grouped by projectId |
| 33 | Velocity trend | Week-over-week task count |
| 34 | Overwork detection | 3+ days >10h in 7-day window |
| 35 | Attendance alert exclusions | No alerts on leave/holiday/weekend |
| 36 | EOD report completeness | All session data included |
| 37 | Morning digest content | Per-member summary + leave list |
| 38 | Dashboard combined hours | Sum of all session durations |
| 39 | Dashboard pending approvals | Count of status = "pending" |
| 40 | Milestone completion gate | All tasks done required |
| 41 | Milestone deadline warning | Within 3 days + not complete |
| 42 | Milestone sort order | Sorted by deadline ascending |
| 43 | Standup once per day | No re-prompt after submit/dismiss |
| 44 | Mood dismissal no record | Dismiss → no mood_check row |
| 45 | Meeting record linkage | Valid breakId + sessionId |
| 46 | Smart leave conflict detection | Overlap + milestone + availability |
| 47 | Leave sync offline-first | sync_queue entry created |
| 48 | Monthly digest content | All required aggregations |
| 49 | WFH status indicator | Dashboard shows "WFH" |
| 50 | Upcoming leave window | Next 14 days only |
| 51 | Location auto-tag | Haversine within 200m |
| 52 | EXIF freshness | Within 5 min accepted |
| 53 | AI verification never blocks | Session unaffected by AI result |
| 54 | API key isolation | Keys server-side only |
| 55 | AI completed data only | No active session data to AI |
| 56 | Git event session linkage | Commits within session time range |
| 57 | Weekly review aggregation | Hours + tasks + output correct |
| 58–64 | Additional edge case properties | Break visibility, task validation, stale detection, etc. |

### Unit Test Coverage Areas

- Rust commands: session lifecycle, attendance computation, leave balance, analytics, streak, overwork
- SQLite schema: constraints, indexes, foreign keys, migrations
- Zustand stores: state transitions, isolation, persistence
- React components: screen rendering, modal behavior, form validation
- PocketBase hooks: prompt construction, error handling, fallback behavior
- Sync service: queue management, retry logic, dead letter handling

---

## 14. Build Status

### Implementation Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Authentication, Account Creation & Onboarding | ✅ Complete |
| 1 | Core Foundation — Scaffold, schema, stores, routing, design system | ✅ Complete |
| 2 | Session Core — Start, heartbeat, crash recovery, end day, Today view | ✅ Complete |
| 3 | Idle Detection — Rust idle polling, idle modal, soft nudge, breaks | ✅ Complete |
| 4 | Task Management — Projects, task list, inline creation, Cmd+K switcher | ✅ Complete |
| 5 | PocketBase Sync — Offline-first sync, queue, retry, dead letter | ✅ Complete |
| 6 | Team View — Realtime WebSocket, member cards, status display | ✅ Complete |
| 7 | Weekly Review — Summary screen, charts, AI narrative, team tab | ✅ Complete |
| 8 | Git Integration — Commit linking, session timeline markers | ✅ Complete |
| 9 | AI Layer — LiteLLM proxy, task parsing, weekly narrative | ✅ Complete |
| 10 | Schema Extension — v2 SQLite tables, PocketBase migration | ✅ Complete |
| 11 | Leave Management — Balance, holidays, requests, approval | ✅ Complete |
| 12 | Attendance Log — Computation, display, filtering, CSV export | ✅ Complete |
| 13 | Founder Dashboard — Live status, approvals, health, alerts | ✅ Complete |
| 14 | Team Analytics — Individual metrics, team metrics, focus score | ✅ Complete |
| 15 | Daily Reports — EOD report, morning digest, digest screen | ✅ Complete |
| 16 | Quality of Life — Streaks, milestones, standup, mood, meetings | ✅ Complete |
| 17 | AI Features — Smart leave suggestions, monthly digest PDF | ✅ Complete |
| 18 | Workspace Access Proof — Geolocation, photo, AI verification | ✅ Complete |
| 19 | Navigation & Polish — Sidebar update, WFH expectations, notifications | ✅ Complete |
| 20 | Cloud Deployment — Docker Compose, Caddy, Lightsail | 🔄 In Progress |

---

*End of document.*
