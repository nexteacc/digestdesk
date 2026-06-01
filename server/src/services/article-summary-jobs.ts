import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import pLimit from "p-limit";
import type { DigestLanguage, DigestSourceType } from "../../../shared/types.js";
import { getDb } from "../db/index.js";
import {
  articleSummaryJobs,
  articleSummaries,
  articles,
  feeds,
  subscriptions,
  userEntitlements,
  userSettings,
  users,
} from "../db/schema.js";
import { getActiveUserSinceIso } from "./active-users.js";
import { parseDigestLanguage } from "./summary-language-profiles.js";
import { classifyAiError, summarizeArticleWithMetadata } from "./summarizer.js";
import { writeArticleSummary } from "./article-summary-cache.js";
import { parseDigestSourceTypes } from "./user-settings.js";

const MIN_CONTENT_LENGTH = 50;
const STALE_RUNNING_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const DEFAULT_RUN_LIMIT = 10;
const DEFAULT_CONCURRENCY = 2;
const RECENT_ARTICLE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETRY_BASE_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

function getRunnerId() {
  return `${process.pid}-${nanoid(6)}`;
}

function getSummaryJobConcurrency() {
  const raw = Number(process.env.ARTICLE_SUMMARY_JOB_CONCURRENCY ?? DEFAULT_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_CONCURRENCY;
}

export function getSummaryJobRunLimit() {
  const raw = Number(process.env.ARTICLE_SUMMARY_JOB_RUN_LIMIT ?? DEFAULT_RUN_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RUN_LIMIT;
}

function getRetryBaseDelayMs() {
  const raw = Number(process.env.ARTICLE_SUMMARY_RETRY_BASE_DELAY_MS ?? DEFAULT_RETRY_BASE_DELAY_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RETRY_BASE_DELAY_MS;
}

function getRetryScheduledFor(attemptCount: number, now = new Date()) {
  const delay = Math.min(getRetryBaseDelayMs() * 2 ** Math.max(0, attemptCount - 1), MAX_RETRY_DELAY_MS);
  return new Date(now.getTime() + delay).toISOString();
}

export async function enqueueArticleSummaryJobsForArticles(articleIds: string[], options?: { reason?: string }) {
  const uniqueArticleIds = Array.from(new Set(articleIds.filter(Boolean)));
  if (uniqueArticleIds.length === 0) return { scannedArticles: 0, created: 0, existing: 0, requeued: 0 };

  const db = getDb();
  const now = new Date().toISOString();
  const activeSince = getActiveUserSinceIso(new Date(now));
  const publishedAfter = new Date(Date.now() - RECENT_ARTICLE_WINDOW_MS).toISOString();
  const rows = await db
    .selectDistinct({
      articleId: articles.id,
      rawLanguage: sql<string>`COALESCE(${userSettings.value}, 'zh')`,
      sourceType: feeds.sourceType,
      rawSourceTypes: sql<string | null>`${sql.identifier("source_settings")}.${sql.identifier("value")}`,
    })
    .from(articles)
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .innerJoin(
      subscriptions,
      and(
        eq(subscriptions.feedId, articles.feedId),
        isNull(subscriptions.endedAt),
        gte(articles.publishedAt, subscriptions.startedAt),
      ),
    )
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .leftJoin(userEntitlements, eq(userEntitlements.userId, subscriptions.userId))
    .leftJoin(
      userSettings,
      and(eq(userSettings.userId, subscriptions.userId), eq(userSettings.key, "digest_language")),
    )
    .leftJoin(
      sql`${userSettings} AS source_settings`,
      sql`source_settings.user_id = ${subscriptions.userId} AND source_settings.key = 'digest_source_types'`,
    )
    .leftJoin(
      articleSummaries,
      and(
        eq(articleSummaries.articleId, articles.id),
        eq(articleSummaries.language, sql`COALESCE(${userSettings.value}, 'zh')`),
      ),
    )
    .where(
      and(
        inArray(articles.id, uniqueArticleIds),
        gte(articles.publishedAt, publishedAfter),
        sql`${articles.contentText} IS NOT NULL`,
        sql`length(${articles.contentText}) >= ${MIN_CONTENT_LENGTH}`,
        gte(users.lastLoginAt, activeSince),
        sql`(${userEntitlements.accessStatus} IS NULL OR ${userEntitlements.accessStatus} <> 'revoked')`,
        isNull(articleSummaries.id),
      ),
    );

  let created = 0;
  let existing = 0;
  let requeued = 0;
  let skippedSourceFilter = 0;
  const candidates = new Map<string, { articleId: string; language: DigestLanguage }>();

  for (const row of rows as unknown as Array<{
    articleId: string;
    rawLanguage: string;
    sourceType: DigestSourceType;
    rawSourceTypes: string | null;
  }>) {
    const enabledSourceTypes = parseDigestSourceTypes(row.rawSourceTypes);
    if (!enabledSourceTypes.includes(row.sourceType)) {
      skippedSourceFilter += 1;
      continue;
    }

    const language = parseDigestLanguage(row.rawLanguage);
    candidates.set(`${row.articleId}:${language}`, { articleId: row.articleId, language });
  }

  for (const candidate of candidates.values()) {
    const result = await db
      .insert(articleSummaryJobs)
      .values({
        id: nanoid(),
        articleId: candidate.articleId,
        language: candidate.language,
        status: "pending",
        scheduledFor: now,
        attemptCount: 0,
        createdAt: now,
      })
      .onConflictDoNothing({
        target: [articleSummaryJobs.articleId, articleSummaryJobs.language],
      })
      .returning({ id: articleSummaryJobs.id });

    if (result.length > 0) created += 1;
    else {
      existing += 1;
      const reset = await db
        .update(articleSummaryJobs)
        .set({
          status: "pending",
          attemptCount: 0,
          scheduledFor: now,
          lastError: `Requeued by ${options?.reason ?? "enqueue"}.`,
          lockedAt: null,
          lockedBy: null,
          startedAt: null,
          finishedAt: null,
        })
        .where(
          and(
            eq(articleSummaryJobs.articleId, candidate.articleId),
            eq(articleSummaryJobs.language, candidate.language),
            inArray(articleSummaryJobs.status, ["failed", "skipped", "cancelled", "succeeded"]),
          ),
        );
      if (reset.count > 0) requeued += reset.count;
    }
  }

  console.log(
    `[summary-jobs] Enqueue complete reason=${options?.reason ?? "unspecified"} scannedArticles=${uniqueArticleIds.length} recentWindowMs=${RECENT_ARTICLE_WINDOW_MS} publishedAfter=${publishedAfter} sourceAllowed=${candidates.size} skippedSourceFilter=${skippedSourceFilter} rawCandidates=${rows.length} created=${created} existing=${existing} requeued=${requeued}`,
  );
  return { scannedArticles: uniqueArticleIds.length, created, existing, requeued };
}

export async function enqueueRecentArticleSummaryBackfill(options?: { limit?: number; reason?: string; now?: Date }) {
  const db = getDb();
  const now = options?.now ?? new Date();
  const activeSince = getActiveUserSinceIso(now);
  const publishedAfter = new Date(now.getTime() - RECENT_ARTICLE_WINDOW_MS).toISOString();
  const limit = options?.limit ?? getSummaryJobRunLimit();

  const rows = await db
    .selectDistinct({ articleId: articles.id })
    .from(articles)
    .innerJoin(subscriptions, and(eq(subscriptions.feedId, articles.feedId), isNull(subscriptions.endedAt)))
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .leftJoin(userEntitlements, eq(userEntitlements.userId, subscriptions.userId))
    .leftJoin(
      userSettings,
      and(eq(userSettings.userId, subscriptions.userId), eq(userSettings.key, "digest_language")),
    )
    .leftJoin(
      articleSummaries,
      and(
        eq(articleSummaries.articleId, articles.id),
        eq(articleSummaries.language, sql`COALESCE(${userSettings.value}, 'zh')`),
      ),
    )
    .where(
      and(
        gte(articles.publishedAt, publishedAfter),
        gte(articles.publishedAt, subscriptions.startedAt),
        sql`${articles.contentText} IS NOT NULL`,
        sql`length(${articles.contentText}) >= ${MIN_CONTENT_LENGTH}`,
        gte(users.lastLoginAt, activeSince),
        sql`(${userEntitlements.accessStatus} IS NULL OR ${userEntitlements.accessStatus} <> 'revoked')`,
        isNull(articleSummaries.id),
      ),
    )
    .orderBy(asc(articles.publishedAt))
    .limit(limit);

  const result = await enqueueArticleSummaryJobsForArticles(
    rows.map((row) => row.articleId),
    { reason: options?.reason ?? "recent_backfill" },
  );

  console.log(
    `[summary-jobs] Backfill enqueue complete reason=${options?.reason ?? "recent_backfill"} scannedRecentArticles=${rows.length} limit=${limit} created=${result.created} existing=${result.existing} requeued=${result.requeued}`,
  );
  return result;
}

export async function reclaimStaleArticleSummaryJobs(now = new Date()) {
  const db = getDb();
  const staleBefore = new Date(now.getTime() - STALE_RUNNING_MS).toISOString();
  const reclaimed = await db
    .update(articleSummaryJobs)
    .set({
      status: "pending",
      lockedAt: null,
      lockedBy: null,
      startedAt: null,
      lastError: "Reclaimed after stale running lock.",
    })
    .where(and(eq(articleSummaryJobs.status, "running"), lte(articleSummaryJobs.lockedAt, staleBefore)));

  if (reclaimed.count > 0) {
    console.warn(`[summary-jobs] Reclaimed stale running jobs count=${reclaimed.count} staleBefore=${staleBefore}`);
  }
  return reclaimed.count;
}

export async function runPendingArticleSummaryJobs(options?: { limit?: number; now?: Date }) {
  const db = getDb();
  const limit = options?.limit ?? getSummaryJobRunLimit();
  const now = options?.now ?? new Date();
  const runnerId = getRunnerId();

  await reclaimStaleArticleSummaryJobs(now);

  const candidates = await db
    .select({
      id: articleSummaryJobs.id,
      articleId: articleSummaryJobs.articleId,
      language: articleSummaryJobs.language,
      attemptCount: articleSummaryJobs.attemptCount,
    })
    .from(articleSummaryJobs)
    .where(
      and(
        inArray(articleSummaryJobs.status, ["pending", "failed"]),
        lte(articleSummaryJobs.scheduledFor, now.toISOString()),
        lte(articleSummaryJobs.attemptCount, MAX_ATTEMPTS - 1),
      ),
    )
    .orderBy(asc(articleSummaryJobs.scheduledFor))
    .limit(limit);

  console.log(
    `[summary-jobs] Runner candidate scan runnerId=${runnerId} now=${now.toISOString()} limit=${limit} candidates=${candidates.length}`,
  );

  const claimed: Array<{ id: string; articleId: string; language: DigestLanguage; attemptCount: number }> = [];

  for (const candidate of candidates) {
    const language = parseDigestLanguage(candidate.language);
    const result = await db
      .update(articleSummaryJobs)
      .set({
        status: "running",
        lockedAt: now.toISOString(),
        lockedBy: runnerId,
        startedAt: now.toISOString(),
      })
      .where(and(eq(articleSummaryJobs.id, candidate.id), inArray(articleSummaryJobs.status, ["pending", "failed"])));

    if (result.count > 0) {
      claimed.push({ ...candidate, language });
      console.log(
        `[summary-jobs] Claimed jobId=${candidate.id} article=${candidate.articleId} language=${language} attempt=${candidate.attemptCount + 1} runnerId=${runnerId}`,
      );
    }
  }

  const summary = {
    claimed: claimed.length,
    succeeded: 0,
    skipped: 0,
    failed: 0,
  };

  const jobLimit = pLimit(getSummaryJobConcurrency());
  const jobResults = await Promise.allSettled(
    claimed.map((job) =>
      jobLimit(async () => {
        const startedAt = Date.now();
        const [existing] = await db
          .select({ id: articleSummaries.id })
          .from(articleSummaries)
          .where(and(eq(articleSummaries.articleId, job.articleId), eq(articleSummaries.language, job.language)));

        if (existing) {
          console.log(
            `[summary-jobs] Job skipped jobId=${job.id} article=${job.articleId} language=${job.language} reason=already_cached durationMs=${Date.now() - startedAt}`,
          );
          return { status: "skipped" as const, reason: "already_cached" };
        }

        const [article] = await db
          .select({ contentText: articles.contentText, url: articles.url })
          .from(articles)
          .where(eq(articles.id, job.articleId));

        const contentLength = article?.contentText?.length ?? 0;
        if (!article?.contentText || contentLength < MIN_CONTENT_LENGTH) {
          console.log(
            `[summary-jobs] Job skipped jobId=${job.id} article=${job.articleId} language=${job.language} reason=content_too_short contentLength=${contentLength} durationMs=${Date.now() - startedAt}`,
          );
          return { status: "skipped" as const, reason: "content_too_short" };
        }

        const result = await summarizeArticleWithMetadata(article.contentText, job.language);
        await writeArticleSummary({
          articleId: job.articleId,
          language: job.language,
          summary: result.summary,
          model: result.metadata.model,
          promptVersion: result.metadata.promptVersion,
          generationAttempt: result.metadata.attempt,
        });
        console.log(
          `[summary-jobs] Job succeeded jobId=${job.id} article=${job.articleId} language=${job.language} model=${result.metadata.model} attempt=${result.metadata.attempt} url=${article.url} durationMs=${Date.now() - startedAt}`,
        );
        return { status: "succeeded" as const };
      }),
    ),
  );

  for (let i = 0; i < jobResults.length; i += 1) {
    const result = jobResults[i];
    const job = claimed[i];
    const finishedAt = new Date().toISOString();
    if (result.status === "fulfilled") {
      await db
        .update(articleSummaryJobs)
        .set({
          status: result.value.status,
          attemptCount: job.attemptCount + 1,
          lastError: null,
          finishedAt,
          lockedAt: null,
          lockedBy: null,
        })
        .where(eq(articleSummaryJobs.id, job.id));
      if (result.value.status === "succeeded") summary.succeeded += 1;
      else summary.skipped += 1;
      continue;
    }

    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    const nextAttemptCount = job.attemptCount + 1;
    const willRetry = nextAttemptCount < MAX_ATTEMPTS;
    await db
      .update(articleSummaryJobs)
      .set({
        status: "failed",
        attemptCount: nextAttemptCount,
        lastError: message,
        scheduledFor: willRetry ? getRetryScheduledFor(nextAttemptCount) : "9999-12-31T23:59:59.999Z",
        finishedAt,
        lockedAt: null,
        lockedBy: null,
      })
      .where(eq(articleSummaryJobs.id, job.id));
    summary.failed += 1;
    console.error(
      `[summary-jobs] Job failed jobId=${job.id} article=${job.articleId} language=${job.language} attempt=${nextAttemptCount}/${MAX_ATTEMPTS} retry=${willRetry} aiErrorCategory=${classifyAiError(result.reason)} error=${message}`,
    );
  }

  return summary;
}
