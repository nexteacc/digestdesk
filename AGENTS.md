# AGENTS.md

## Scope
DigestDesk is a React/Vite + Express/Postgres reading workflow app. Keep this file for agent-only operating rules; use docs/context.md, docs/operations.md, and docs/history.md as the human-facing source of truth.

## Commands
Use pnpm: `pnpm dev`, `pnpm build`, `pnpm --filter substack-digest-server build`, `pnpm --filter substack-digest-server dev`, `pnpm --filter substack-digest-server dev:scheduler`, `pnpm --filter substack-digest-server smoke:structured-output`, `pnpm lint`.
Server unit tests use vitest: `pnpm --filter substack-digest-server test` (test files live next to sources as `*.test.ts`; the build excludes them).

## Non-Obvious Rules
- User-facing, manual, and scheduled digest generation must use `executeDailyDigestJob` so feed sync, pre-summarization, and digest assembly stay consistent.
- Avoid new route-level direct calls to `generateDaily` unless intentionally bypassing sync and pre-summary behavior.
- Scheduled work belongs to the `scheduler` service and `digest_jobs`; do not move cron-style dispatch back into the web service without an explicit architecture change.

## Commit Messages
- For non-trivial fixes, write a commit body, not only a subject line.
- Include the user-visible symptom, root cause, key implementation decision, and verification commands/results.
- For AI/model/provider changes, explicitly mention the model/provider behavior being adapted and the follow-up monitoring signal.
- Keep the subject concise, then use 3-6 body bullets when the change affects scheduling, digest generation, model routing, deployment, or monitoring.

## Docs Map
- AI system context, invariants, data boundaries, API chains: `docs/context.md`
- Deployment, scheduler, env vars: `docs/operations.md`
- Project history, diagnostics, decisions, and follow-up checks: `docs/history.md`

## Boundaries
- Read relevant file context before edits and avoid unnecessary new files.
- Before non-trivial changes, read the latest relevant section of `docs/history.md`.
- Follow existing code style, naming, libraries, and structure.
- Do not read private keys, tokens, `.env` files, or other secret-bearing files unless the user explicitly asks and the task cannot be completed with metadata-only checks; never output their contents.
- Do not write, output, or log secrets.
- Before proposing external platforms, deployment features, third-party services, or developer tools, verify the capability through explicit research or documentation lookup.

## Change Safety
- For behavior-changing fixes, identify the behavior contract before editing and search for adjacent paths that may still enforce or assume the old behavior: validation, schemas/types, retries/fallbacks, cache/persistence, logs/metrics, and relevant docs/history.
- For AI/model/prompt/output changes, verify that prompt instructions, structured-output schema, post-validation, retry/fallback behavior, cache reuse, and failure observability still agree. Treat relevant incidents in `docs/history.md` as risks to verify, not only background to read.
- Keep fixes proportional. Report which adjacent paths were checked and which were intentionally left unchanged.
