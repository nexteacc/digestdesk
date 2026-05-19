# AGENTS.md

## Scope
DigestDesk is a React/Vite + Express/Postgres reading workflow app. Keep this file for agent-only operating rules; use README and docs as the human-facing source of truth.

## Commands
Use pnpm: `pnpm dev`, `pnpm build`, `pnpm --filter substack-digest-server build`, `pnpm --filter substack-digest-server dev`, `pnpm --filter substack-digest-server dev:scheduler`, `pnpm --filter substack-digest-server smoke:structured-output`, `pnpm lint`.
No test script is defined. If tests are added, follow existing package scripts and document the command here.

## Non-Obvious Rules
- User-facing, manual, and scheduled digest generation must use `executeDailyDigestJob` so feed sync, pre-summarization, and digest assembly stay consistent.
- Avoid new route-level direct calls to `generateDaily` unless intentionally bypassing sync and pre-summary behavior.
- Scheduled work belongs to the `scheduler` service and `digest_jobs`; do not move cron-style dispatch back into the web service without an explicit architecture change.

## Docs Map
- Human entry point: `README.md`
- AI system context, invariants, data boundaries, API chains: `docs/context.md`
- Deployment, scheduler, env vars: `docs/operations.md`
- Project history, diagnostics, decisions, and follow-up checks: `docs/history.md`

## Boundaries
- Read relevant file context before edits and avoid unnecessary new files.
- Before non-trivial changes, read the latest relevant section of `docs/history.md`.
- Follow existing code style, naming, libraries, and structure.
- Do not write, output, or log secrets.
- Before proposing external platforms, deployment features, third-party services, or developer tools, verify the capability through explicit research or documentation lookup.
