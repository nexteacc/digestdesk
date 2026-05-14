# DigestDesk Agent System Context

Compact AI context: invariants, boundaries, workflows, and checks.

## Purpose

- DigestDesk is a multi-user reading workflow app.
- It aggregates Substack, RSS, Podcast, and YouTube into user-specific daily digests.
- Auth uses Clerk; durable state uses Postgres.

## Runtime Shape

- Frontend: React/Vite SPA.
- Web service: Express API plus SPA serving.
- Scheduler service: long-running worker for digest jobs.
- Database: Postgres for users, content, subscriptions, digests, and jobs.
- AI workflow: article pre-summary plus daily digest assembly.

## Service Boundaries

- Web handles authenticated API requests and user-triggered actions.
- Scheduler creates, claims, and runs due digest jobs.
- Postgres stores durable state; do not rely on process memory for job state.
- Cron-style dispatch belongs in scheduler, not web.
- User-facing, manual, and scheduled digest generation share one executor.

## Critical Entry Point

- Use `executeDailyDigestJob` for digest generation.
- This entry point keeps feed sync, pre-summary, and digest assembly consistent.
- Do not add new route-level direct calls to `generateDaily`.
- Only bypass `executeDailyDigestJob` when intentionally skipping sync and pre-summary.
- If bypassing it, document the reason in code or history.

## Core Data Boundaries

- `users` maps Clerk identities to local business users.
- `feeds` are global shared content sources.
- `articles` are global shared content assets.
- `subscriptions` are user-specific relationships to global feeds.
- `digests` are user-private daily snapshot headers.
- `digest_items` are user-private daily snapshot rows.
- `user_settings` are user-private preferences.
- `digest_jobs` are durable scheduling and execution records.

## Global Assets

- A feed is stored once globally.
- An article is stored once globally.
- Multiple users can reference the same article.
- Article summaries are cached globally by article and language.
- Current summary cache fields are `summary_zh` and `summary_en`.

## User-Specific State

- A subscription links one user to one feed.
- `subscriptions.started_at` controls when content becomes visible to that user.
- `subscriptions.ended_at IS NULL` means the subscription is active.
- Unsubscribe soft-deletes by setting `ended_at`.
- Resubscribe starts a new effective subscription window.
- Digests belong to users; digest items belong to digest snapshots.

## Digest Semantics

- Digest dates are content dates, not generation dates.
- `digests.date` means the natural day being summarized.
- `generated_at` means when the digest was produced.
- Scheduled morning digests generated on day D summarize day D-1.
- Natural days are computed in the user's timezone.
- `digest_time` controls generation timing, not content date.
- Each user should have at most one digest per `(type, date)`.

## Subscription Semantics

- Subscription success means the relationship row was written.
- Feed sync, article ingest, and digest refresh are follow-up work.
- Do not roll back a successful subscription because later sync failed.
- Users must not receive articles published before `started_at`.
- New subscriptions may trigger digest refresh through `executeDailyDigestJob`.
- The same semantics apply to Substack, RSS, YouTube, and Podcast sources.

## Digest Job Semantics

- `pending`: created and waiting.
- `running`: claimed by an executor.
- `succeeded`: digest generated.
- `skipped`: execution completed but no digest content was available.
- `failed`: execution failed and may be retried or inspected.
- `cancelled`: superseded, usually by a forced recalculation.
- Jobs are unique by user, job type, and target date.
- Due jobs should be backfilled, not silently missed.

## Main Execution Flow

1. User edits subscriptions or settings.
2. Scheduler runs `dispatchDigestJobs` for due users and dates.
3. Scheduler runs `runPendingDigestJobs`.
4. Runner claims `digest_jobs` rows.
5. Runner calls `executeDailyDigestJob`.
6. Executor syncs the user's active feeds.
7. Executor runs `presummarizeForUser` for target date and language.
8. Executor calls `generateDaily` to assemble the digest snapshot.
9. Runner marks the job `succeeded`, `skipped`, or `failed`.

## API Boundaries

- Auth APIs resolve Clerk user IDs to local `users.id`.
- Subscription list APIs query `subscriptions` joined to `feeds`.
- Digest list APIs filter by `digests.user_id`.
- Digest detail APIs must verify digest ownership first.
- Settings APIs read and write by `user_settings.user_id`.
- Digest generation must filter articles by active subscriptions and `started_at`.

## Content Fetch and AI Cost Rules

- Prefer RSS/feed-provided content when available.
- Use Jina Reader only as fallback.
- Limit AI input length before summarization.
- Pre-summary should happen before daily assembly when possible.
- `generateDaily` should prefer cached article summaries.
- AI fallback during digest generation is acceptable only for cache misses.
- Avoid changes that increase duplicate model calls across users.

## Query and Constraint Expectations

- `feeds.feed_url` should be globally unique.
- `articles.url` should be globally unique.
- Active subscriptions should be unique by user and feed.
- Digests should be unique by user, type, and date.
- User settings should be unique by user and key.
- Queries must preserve tenant boundaries through `user_id` checks.

## Before Changing These Areas

- Digest generation: read `AGENTS.md` and latest `docs/history.md` section.
- Scheduler/job code: preserve `scheduler` plus `digest_jobs` ownership.
- Subscription code: preserve global asset reuse and user-specific windows.
- Feed fetching: preserve RSS-first and fallback-only Jina behavior.
- AI summarization: check for duplicate calls and cache reuse.
- Deployment behavior: read `docs/operations.md` if the task is operational.

## Pending Verification Habits

- Verify manual digest still uses `executeDailyDigestJob`.
- Verify scheduled digest still uses `executeDailyDigestJob`.
- Verify new subscriptions do not expose pre-subscription articles.
- Verify unsubscribe does not delete global feeds or articles.
- Verify digest jobs move through expected statuses.
- Verify summary cache hits prevent repeated AI calls.
- Record important follow-up checks in `docs/history.md`.
