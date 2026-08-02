# PACE ship/debug loop

Use this loop for every release candidate. Stop only when the same commit passes the code, runtime, visual, and packaging gates.

```mermaid
flowchart TD
  A[Change or bug report] --> B[Trace route, store, lib, and Tauri boundary]
  B --> C[Write or update the smallest regression test]
  C --> D[Run TypeScript build and focused Vitest/property tests]
  D -->|fail| E[Fix source or test contract]
  E --> C
  D -->|pass| F[Start Vite with controlled dev auth]
  F --> G[Playwright desktop smoke + console scan]
  G --> H[Playwright mobile smoke + drawer/navigation scan]
  H -->|fail| E
  H -->|pass| I[Inspect screenshot and responsive states]
  I -->|visual defect| E
  I -->|pass| J[Run full Vitest suite and production build]
  J -->|fail| E
  J -->|pass| K[Run cargo check / tauri build in a Rust-enabled CI runner]
  K -->|fail| E
  K -->|pass| L[Ship candidate]
```

## Local gates

```bash
npm ci --no-audit --no-fund
npm test
npm run build
npm run test:e2e
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

The E2E command is intentionally scoped to `e2e/**/*.spec.ts` by `playwright.config.ts`; it must not discover Vitest files under `src/`.

## Debug order

1. Reproduce the smallest failing state and capture the route, viewport, console output, and data shape.
2. Trace the state transition through the store/lib boundary before changing UI code.
3. Add a deterministic regression test. Time-based fixtures must be relative to the current UTC clock.
4. Run focused checks, then the full suite and production build.
5. Recheck the same flow in the authenticated desktop shell and at the narrowest supported viewport.
6. Treat console errors, clipped content, unreachable navigation, missing empty/loading/error states, and native build failures as ship blockers.
