# Relay – Codex Instructions

You are working in a TypeScript monorepo (pnpm). Follow the existing architecture exactly.

## Repo architecture (must follow)
- apps/api: control plane (HTTP + scheduler + reaper + queue producer)
- apps/worker: execution plane (queue consumer + providers + validation)
- apps/cli: main UX (init/validate/run/status/logs/approve)
- apps/web: minimal run viewer
- packages/core: DAG + unlock logic (pure functions, no I/O)
- packages/types: shared API/DB types

## Rules
- Never invent new folders unless necessary; prefer existing locations.
- Keep functions small; add types; do not use `any`.
- Add basic tests where it’s cheap (core DAG validation).
- Always run: pnpm -r typecheck && pnpm -r lint (if configured) && unit tests.
- For DB queries used by scheduler/reaper, put them in apps/api/src/orchestrator/sql.ts.
- For JSON-output tasks, always enforce strict JSON via worker exec/promptEnvelope.ts.

## Output requirements
- When implementing an endpoint: include route, service, DB queries, and minimal response types.
- When implementing a worker feature: include DB updates + artifact writes + status transitions.

## Deliverable style
- Make incremental commits; each change should compile and run.
