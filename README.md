<p align="center">
  <img src="public/vite.svg" width="60" alt="PACE logo" />
</p>

<h1 align="center">PACE — Productivity, Accountability, Collaboration Engine</h1>

<p align="center">
  A local-first desktop app for startup teams to track work sessions, manage tasks, and govern founder accountability — built with Tauri v2, React 19, Rust, and SQLite.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-blue?logo=tauri" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Rust-backend-orange?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tests-1350_passing-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/License-Private-lightgrey" alt="License" />
</p>

---

## Overview

PACE is a Tauri v2 desktop application designed for small startup teams (3–5 founders + team members). It combines session tracking, task management, team operations, and founder governance into a single offline-first app that syncs to the cloud via PocketBase.

### Key Principles

- **Local-first**: All data lives in SQLite on the user's machine. Cloud sync is background and non-blocking.
- **Offline-capable**: Full functionality without internet. Changes queue and sync when connectivity returns.
- **Privacy-aware**: Four-tier visibility system (Everyone → Founders Only → Admin Only → Individual Only).
- **AI-assisted**: LiteLLM proxy routes to multiple AI providers for task parsing, weekly reviews, and team health insights.

---

## Features

### v1 — Work Tracker
| Screen | Description |
|--------|-------------|
| **Today** | Active session timer, break tracking, output notes, crash recovery |
| **Team** | Real-time team status via PocketBase WebSocket subscriptions |
| **Tasks** | Project-scoped task management with inline creation and switching |
| **Review** | AI-assisted weekly review drafts with git integration |

### v2 — Team Ops
| Screen | Description |
|--------|-------------|
| **Dashboard** | Combined hours, pending approvals, WFH status, overwork detection |
| **Attendance** | Login/logout records, CSV export, output notes, filtering |
| **Leave** | Leave requests with balance tracking, WFH support, approval workflow |
| **Requests** | Admin approval queue with self-approval prevention |
| **Analytics** | Focus scores, velocity trends, task completion rates, per-project hours |
| **Digest** | Team digest with streaks, milestones, and AI-generated insights |

### v3 — Founder Governance
| Screen | Description |
|--------|-------------|
| **Founder Review** | Biweekly anonymous peer review (1–5 scale: output, reliability, initiative) |
| **Leaderboard** | Weekly composite scoring with "Founder of the Week" badge |
| **Equity** | Cap table pie chart, vesting progress, dilution history, payout projections |
| **Startup Health** | Runway indicator, founder balance detection, decision velocity, burn rate alignment |


---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop runtime | [Tauri v2](https://v2.tauri.app/) |
| Frontend | React 19, TypeScript 5.7, TanStack Router + Query |
| Styling | Tailwind CSS 4, Geist font, Lucide icons |
| State management | Zustand 5 |
| Backend | Rust (Tauri commands for computation) |
| Database | SQLite (local-first) |
| Cloud sync | [PocketBase](https://pocketbase.io/) with realtime subscriptions |
| AI proxy | [LiteLLM](https://github.com/BerriAI/litellm) (OpenAI, Anthropic, Gemini, Bedrock, Ollama) |
| Reverse proxy | Caddy 2 (auto HTTPS) |
| Testing | Vitest, Testing Library, fast-check (property-based testing) |
| E2E | Playwright |
| Charts | Recharts |
| PDF export | jsPDF |
| Animations | Motion |

---

## Project Structure

```
pace/
├── src/                        # React frontend
│   ├── screens/                # Page components (Today, Team, Tasks, etc.)
│   ├── components/             # Shared UI components (Sidebar, Guards, Modals)
│   ├── stores/                 # Zustand state stores
│   ├── lib/                    # Business logic (pure functions, utilities)
│   ├── hooks/                  # Custom React hooks
│   ├── queries/                # TanStack Query definitions
│   ├── types/                  # TypeScript type definitions
│   └── __tests__/              # Unit + property-based tests
├── src-tauri/                  # Rust backend
│   └── src/
│       ├── commands.rs         # Tauri IPC commands
│       ├── db.rs               # SQLite schema + connection
│       ├── idle.rs             # Idle detection
│       ├── heartbeat.rs        # Session heartbeat
│       ├── power.rs            # Power state monitoring
│       └── git.rs              # Git event tracking
├── pocketbase/                 # PocketBase config
│   ├── pb_hooks/               # Server-side AI hooks
│   └── pb_migrations/          # Schema migrations (v1, v2, v3)
├── litellm/                    # LiteLLM proxy config
├── deploy/                     # Deployment scripts
├── e2e/                        # Playwright E2E tests
└── docker-compose.yml          # Cloud services orchestration
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- Docker & Docker Compose (for cloud services)

### Installation

```bash
# Clone the repository
git clone https://github.com/DineshKumarCLG/pace-tracker.git
cd pace-tracker

# Install frontend dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your values
```

### Development

```bash
# Start the Tauri desktop app (frontend + Rust backend)
npm run tauri dev

# Or run just the frontend (Vite dev server)
npm run dev
```

### Cloud Services

```bash
# Start PocketBase + LiteLLM + Caddy
docker compose up -d
```

This starts:
- **PocketBase** on port `8090` — data sync and realtime subscriptions
- **LiteLLM** on port `4000` — AI proxy for multiple LLM providers
- **Caddy** on ports `80`/`443` — reverse proxy with automatic HTTPS

---

## Testing

PACE uses a dual testing strategy: unit tests for specific behavior and property-based tests (via fast-check) for universal correctness properties.

```bash
# Run all tests (1350 tests across 142 files)
npm test

# Run tests in watch mode
npm run test:watch

# Run E2E tests
npm run test:e2e
```

### Property-Based Tests

Property tests validate invariants that must hold for all inputs:

| Property | What it validates |
|----------|-------------------|
| Single active session | Only one session can be active at a time |
| UTC timestamps | All timestamps stored as UTC |
| Equity dilution cap table | Cap table sums to 100% after dilution |
| Vesting progress bounds | Vesting progress always in [0.0, 1.0] |
| Leaderboard score bounds | Composite scores always in [0.0, 1.0] |
| Review submission validation | No self-reviews, scores in [1,5], no duplicates |
| Runway computation | Correct threshold classification (normal/amber/red) |
| Founder balance detection | Alert triggers at >30% deviation from team average |
| Leave balance computation | Balances never go negative |
| Sync queue durability | Offline writes preserved and ordered |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PB_ADMIN_EMAIL` | Yes | PocketBase admin email |
| `PB_ADMIN_PASSWORD` | Yes | PocketBase admin password |
| `LITELLM_MASTER_KEY` | Yes | LiteLLM API key |
| `OPENAI_API_KEY` | No | OpenAI API key |
| `ANTHROPIC_API_KEY` | No | Anthropic API key |
| `GEMINI_API_KEY` | No | Google Gemini API key |
| `OPENROUTER_API_KEY` | No | OpenRouter API key |
| `AWS_ACCESS_KEY_ID` | No | AWS Bedrock access key |
| `AWS_SECRET_ACCESS_KEY` | No | AWS Bedrock secret key |
| `AWS_REGION` | No | AWS region (default: `ap-south-1`) |
| `OLLAMA_BASE_URL` | No | Local Ollama URL |
| `DOMAIN` | Yes | Domain for Caddy reverse proxy |

---

## Build

```bash
# Build the frontend
npm run build

# Build the Tauri desktop app
npm run tauri build
```

The Tauri build produces platform-specific installers in `src-tauri/target/release/bundle/`.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 PACE Desktop App                 │
│  ┌───────────────────┐  ┌────────────────────┐  │
│  │   React Frontend   │  │   Rust Backend     │  │
│  │  ┌──────────────┐  │  │  ┌──────────────┐ │  │
│  │  │   Screens    │  │  │  │  Commands    │ │  │
│  │  │   Stores     │◄─┼──┼─►│  SQLite DB   │ │  │
│  │  │   Hooks      │  │  │  │  Idle/Power  │ │  │
│  │  └──────────────┘  │  │  └──────────────┘ │  │
│  └───────────────────┘  └────────────────────┘  │
│            │                                     │
│            ▼                                     │
│     Background Sync                              │
└────────────┬────────────────────────────────────┘
             │ WebSocket + REST
             ▼
┌─────────────────────────────────────────────────┐
│              Cloud (Docker Compose)               │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │PocketBase│  │ LiteLLM  │  │    Caddy     │  │
│  │  (Sync)  │  │(AI Proxy)│  │(Reverse Proxy)│  │
│  └──────────┘  └──────────┘  └──────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Governance Model (v3)

The founder governance layer introduces structured accountability for founding teams:

1. **Peer Review** — Biweekly anonymous reviews across 3 dimensions (output, reliability, initiative). Lowest-ranked founder receives an accountability warning.
2. **Dilution Trigger** — Two consecutive warnings trigger a 1% equity dilution, redistributed proportionally among other founders.
3. **Leaderboard** — Weekly composite score: `(hours × 0.3) + (tasks × 0.4) + (peer review × 0.3)`. No equity consequences.
4. **Equity Dashboard** — Real-time cap table, vesting progress, cliff status, dilution history, and projected payouts.
5. **Startup Health** — Runway monitoring, founder hour balance detection, decision velocity tracking, and burn rate alignment.
6. **Investor PDF** — One-click branded PDF export with key startup metrics for investor sharing.

All governance features are gated behind the `founder` role and invisible to regular team members.

---

## Deployment

```bash
# SSH into your server
ssh user@your-server

# Clone and configure
git clone https://github.com/DineshKumarCLG/pace-tracker.git
cd pace-tracker
cp .env.example .env
# Edit .env with production values

# Deploy cloud services
bash deploy/setup.sh

# Update existing deployment
bash deploy/update.sh
```

---

<p align="center">
  Built with ☕ by the Kenesis Labs team
</p>
