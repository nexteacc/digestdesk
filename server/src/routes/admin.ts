import { Router } from "express";
import type { Request } from "express";
import { getAuth } from "@clerk/express";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { userInvites, users } from "../db/schema.js";
import { getTimeZoneDateLabel, shiftDateLabel } from "../utils/timezone.js";
import {
  createInvite,
  getEffectiveSubscriptionLimit,
  isAdminEmail,
  PLAN_LIMITS,
  upsertUserEntitlement,
  type AccessStatus,
  type AccountPlan,
} from "../services/entitlements.js";
import { ARTICLE_SUMMARY_MAX_ATTEMPTS } from "../services/article-summary-jobs.js";
import { DIGEST_JOB_MAX_ATTEMPTS } from "../services/digest-jobs.js";

export const adminRouter = Router();

const entitlementSchema = z.object({
  accountPlan: z.enum(["free", "test", "admin"]),
  subscriptionLimitOverride: z.number().int().positive().nullable().optional(),
  accessStatus: z.enum(["active", "revoked"]).optional(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  accountPlan: z.enum(["free", "test", "admin"]),
  subscriptionLimitOverride: z.number().int().positive().nullable().optional(),
});

const ADMIN_OPERATIONS_TIMEZONE = process.env.ADMIN_OPERATIONS_TIMEZONE || "Asia/Shanghai";

function getRecentDateLabels(days: number) {
  const safeDays = Math.min(Math.max(days, 1), 30);
  const today = getTimeZoneDateLabel(new Date(), ADMIN_OPERATIONS_TIMEZONE);
  const labels: string[] = [];
  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    labels.push(shiftDateLabel(today, -offset));
  }
  return labels;
}

async function getAdminActor(req: Request) {
  const auth = getAuth(req);
  if (!auth.userId) {
    return null;
  }

  const db = getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, auth.userId));

  if (!user || !isAdminEmail(user.email)) {
    return null;
  }

  return user;
}

adminRouter.use(async (req, res, next) => {
  const actor = await getAdminActor(req);
  if (!actor) {
    res.status(403).json({
      error: "Admin access required.",
      errorZh: "需要管理员权限",
      code: "ADMIN_ACCESS_REQUIRED",
    });
    return;
  }

  req.adminUser = actor;
  next();
});

adminRouter.get("/me", (req, res) => {
  const adminUser = req.adminUser!;
  res.json({
    isAdmin: true,
    user: {
      id: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      avatarUrl: adminUser.avatarUrl,
    },
    plans: PLAN_LIMITS,
  });
});

adminRouter.get("/users", async (_req, res) => {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT
      u.id,
      u.email,
      u.name,
      u.avatar_url AS "avatarUrl",
      u.created_at AS "createdAt",
      u.last_login_at AS "lastLoginAt",
      COALESCE(ue.account_plan, 'free') AS "accountPlan",
      ue.subscription_limit_override AS "subscriptionLimitOverride",
      COALESCE(ue.access_status, 'active') AS "accessStatus",
      COUNT(DISTINCT s.id)::int AS "activeSubscriptions",
      COUNT(DISTINCT d.id)::int AS "digestCount",
      MAX(d.generated_at) AS "lastDigestAt"
    FROM users u
    LEFT JOIN user_entitlements ue ON ue.user_id = u.id
    LEFT JOIN subscriptions s ON s.user_id = u.id AND s.ended_at IS NULL
    LEFT JOIN digests d ON d.user_id = u.id
    GROUP BY
      u.id,
      u.email,
      u.name,
      u.avatar_url,
      u.created_at,
      u.last_login_at,
      ue.account_plan,
      ue.subscription_limit_override,
      ue.access_status
    ORDER BY u.last_login_at DESC
  `);

  const usersPayload = (rows as Array<Record<string, unknown>>).map((row) => {
    const accountPlan = (row.accountPlan as AccountPlan) || "free";
    const subscriptionLimitOverride =
      typeof row.subscriptionLimitOverride === "number"
        ? row.subscriptionLimitOverride
        : row.subscriptionLimitOverride === null
          ? null
          : Number(row.subscriptionLimitOverride);
    const entitlement = {
      accountPlan,
      subscriptionLimitOverride: Number.isFinite(subscriptionLimitOverride)
        ? subscriptionLimitOverride
        : null,
    };
    const effectiveLimit =
      entitlement.subscriptionLimitOverride ?? PLAN_LIMITS[entitlement.accountPlan];

    return {
      id: String(row.id),
      email: String(row.email),
      name: row.name ? String(row.name) : null,
      avatarUrl: row.avatarUrl ? String(row.avatarUrl) : null,
      createdAt: String(row.createdAt),
      lastLoginAt: String(row.lastLoginAt),
      accountPlan,
      accessStatus: (row.accessStatus as AccessStatus) || "active",
      subscriptionLimitOverride: entitlement.subscriptionLimitOverride,
      subscriptionLimit: effectiveLimit,
      activeSubscriptions: Number(row.activeSubscriptions ?? 0),
      digestCount: Number(row.digestCount ?? 0),
      lastDigestAt: row.lastDigestAt ? String(row.lastDigestAt) : null,
    };
  });

  res.json({ users: usersPayload });
});

adminRouter.patch("/users/:id/entitlements", async (req, res) => {
  const parsed = entitlementSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0].message,
      errorZh: "用户权益参数无效",
      code: "INVALID_ENTITLEMENT_PAYLOAD",
    });
    return;
  }

  const db = getDb();
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, req.params.id));
  if (!target) {
    res.status(404).json({ error: "User not found.", errorZh: "用户不存在", code: "USER_NOT_FOUND" });
    return;
  }

  const entitlement = await upsertUserEntitlement({
    userId: req.params.id,
    accountPlan: parsed.data.accountPlan,
    subscriptionLimitOverride: parsed.data.subscriptionLimitOverride ?? null,
    accessStatus: parsed.data.accessStatus ?? "active",
    updatedBy: req.adminUser!.id,
  });

  res.json({
    entitlement: {
      userId: entitlement.userId,
      accountPlan: entitlement.accountPlan,
      accessStatus: entitlement.accessStatus,
      subscriptionLimitOverride: entitlement.subscriptionLimitOverride,
      subscriptionLimit: getEffectiveSubscriptionLimit(entitlement),
    },
  });
});

adminRouter.get("/operations/summary", async (req, res) => {
  const daysParam = Number(req.query.days ?? 7);
  const days = Number.isFinite(daysParam) ? daysParam : 7;
  const dateLabels = getRecentDateLabels(days);
  const startDate = dateLabels[0];
  const now = new Date().toISOString();
  const overdueBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const db = getDb();

  const [jobRows, digestRows, summaryJobRows, digestAnomalyRows, summaryAnomalyRows] = await Promise.all([
    db.execute(sql`
      SELECT
        target_date AS "date",
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE status = 'succeeded')::int AS "succeeded",
        COUNT(*) FILTER (WHERE status = 'skipped')::int AS "skipped",
        COUNT(*) FILTER (
          WHERE status = 'failed' AND attempt_count >= ${DIGEST_JOB_MAX_ATTEMPTS}
        )::int AS "failed",
        COUNT(*) FILTER (
          WHERE status = 'failed' AND attempt_count < ${DIGEST_JOB_MAX_ATTEMPTS}
        )::int AS "retrying",
        COUNT(*) FILTER (WHERE status = 'pending')::int AS "pending",
        COUNT(*) FILTER (WHERE status = 'running')::int AS "running",
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS "cancelled"
      FROM digest_jobs
      WHERE job_type = 'daily_digest'
        AND target_date >= ${startDate}
      GROUP BY target_date
    `),
    db.execute(sql`
      SELECT
        d.date AS "date",
        COUNT(*)::int AS "digests",
        SUM((SELECT COUNT(*) FROM digest_items di WHERE di.digest_id = d.id))::int AS "items",
        COUNT(*) FILTER (WHERE d.eligible_item_count IS NOT NULL)::int AS "qualityTrackedDigests",
        SUM(COALESCE(d.eligible_item_count, 0))::int AS "eligibleItems",
        SUM(COALESCE(d.assembly_retry_count, 0))::int AS "assemblyRetries",
        SUM(COALESCE(d.summary_excluded_count, 0))::int AS "summaryExcluded",
        SUM(COALESCE(d.published_without_summary_count, 0))::int AS "publishedWithoutSummary"
      FROM digests d
      WHERE d.type = 'daily'
        AND d.date >= ${startDate}
      GROUP BY d.date
    `),
    db.execute(sql`
      SELECT
        TO_CHAR(COALESCE(finished_at, created_at)::timestamptz AT TIME ZONE ${ADMIN_OPERATIONS_TIMEZONE}, 'YYYY-MM-DD') AS "date",
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE status = 'succeeded')::int AS "succeeded",
        COUNT(*) FILTER (WHERE status = 'skipped')::int AS "skipped",
        COUNT(*) FILTER (
          WHERE status = 'failed' AND attempt_count >= ${ARTICLE_SUMMARY_MAX_ATTEMPTS}
        )::int AS "failed",
        COUNT(*) FILTER (
          WHERE status = 'failed' AND attempt_count < ${ARTICLE_SUMMARY_MAX_ATTEMPTS}
        )::int AS "retrying",
        COUNT(*) FILTER (WHERE status = 'pending')::int AS "pending",
        COUNT(*) FILTER (WHERE status = 'running')::int AS "running",
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS "cancelled"
      FROM article_summary_jobs
      WHERE COALESCE(finished_at, created_at) >= ${startDate}
      GROUP BY 1
    `),
    db.execute(sql`
      SELECT
        j.id,
        j.user_id AS "userId",
        u.email AS "userEmail",
        j.target_date AS "targetDate",
        j.status,
        j.attempt_count AS "attemptCount",
        j.last_error AS "lastError",
        j.scheduled_for AS "scheduledFor",
        j.started_at AS "startedAt",
        j.finished_at AS "finishedAt"
      FROM digest_jobs j
      INNER JOIN users u ON u.id = j.user_id
      WHERE j.job_type = 'daily_digest'
        AND (
          (j.status = 'failed' AND j.attempt_count >= ${DIGEST_JOB_MAX_ATTEMPTS} AND j.target_date >= ${startDate})
          OR (j.status = 'failed' AND j.attempt_count < ${DIGEST_JOB_MAX_ATTEMPTS} AND j.finished_at <= ${overdueBefore})
          OR (j.status IN ('pending', 'running') AND j.scheduled_for <= ${overdueBefore})
        )
    `),
    db.execute(sql`
      SELECT
        j.id,
        j.article_id AS "articleId",
        a.title AS "articleTitle",
        a.url AS "articleUrl",
        j.language,
        j.status,
        j.attempt_count AS "attemptCount",
        j.last_error AS "lastError",
        j.scheduled_for AS "scheduledFor",
        j.started_at AS "startedAt",
        j.finished_at AS "finishedAt"
      FROM article_summary_jobs j
      INNER JOIN articles a ON a.id = j.article_id
      WHERE (
        j.status = 'failed'
        AND j.attempt_count >= ${ARTICLE_SUMMARY_MAX_ATTEMPTS}
        AND j.finished_at >= ${startDate}
      )
        OR (j.status = 'failed' AND j.attempt_count < ${ARTICLE_SUMMARY_MAX_ATTEMPTS} AND j.finished_at <= ${overdueBefore})
        OR (j.status IN ('pending', 'running') AND j.scheduled_for <= ${overdueBefore})
    `),
  ]);

  const jobsByDate = new Map((jobRows as Array<Record<string, unknown>>).map((row) => [String(row.date), row]));
  const digestsByDate = new Map((digestRows as Array<Record<string, unknown>>).map((row) => [String(row.date), row]));
  const summaryJobsByDate = new Map((summaryJobRows as Array<Record<string, unknown>>).map((row) => [String(row.date), row]));

  const daysPayload = dateLabels.map((date) => {
    const job = jobsByDate.get(date);
    const digest = digestsByDate.get(date);
    const summaryJob = summaryJobsByDate.get(date);
    return {
      date,
      jobs: {
        total: Number(job?.total ?? 0),
        succeeded: Number(job?.succeeded ?? 0),
        skipped: Number(job?.skipped ?? 0),
        failed: Number(job?.failed ?? 0),
        retrying: Number(job?.retrying ?? 0),
        pending: Number(job?.pending ?? 0),
        running: Number(job?.running ?? 0),
        cancelled: Number(job?.cancelled ?? 0),
      },
      summaryJobs: {
        total: Number(summaryJob?.total ?? 0),
        succeeded: Number(summaryJob?.succeeded ?? 0),
        skipped: Number(summaryJob?.skipped ?? 0),
        failed: Number(summaryJob?.failed ?? 0),
        retrying: Number(summaryJob?.retrying ?? 0),
        pending: Number(summaryJob?.pending ?? 0),
        running: Number(summaryJob?.running ?? 0),
        cancelled: Number(summaryJob?.cancelled ?? 0),
      },
      digests: Number(digest?.digests ?? 0),
      items: Number(digest?.items ?? 0),
      delivery: {
        qualityTrackedDigests: Number(digest?.qualityTrackedDigests ?? 0),
        eligibleItems: Number(digest?.eligibleItems ?? 0),
        assemblyRetries: Number(digest?.assemblyRetries ?? 0),
        summaryExcluded: Number(digest?.summaryExcluded ?? 0),
        publishedWithoutSummary: Number(digest?.publishedWithoutSummary ?? 0),
      },
    };
  });

  const digestAnomalies = (digestAnomalyRows as Array<Record<string, unknown>>).map((row) => ({
    kind: "digest_job" as const,
    id: String(row.id),
    subject: String(row.userEmail),
    targetDate: String(row.targetDate),
    status:
      String(row.status) === "failed" && Number(row.attemptCount ?? 0) < DIGEST_JOB_MAX_ATTEMPTS
        ? "retrying"
        : String(row.status),
    attemptCount: Number(row.attemptCount ?? 0),
    lastError: row.lastError ? String(row.lastError) : null,
    scheduledFor: String(row.scheduledFor),
    startedAt: row.startedAt ? String(row.startedAt) : null,
    finishedAt: row.finishedAt ? String(row.finishedAt) : null,
  }));
  const summaryAnomalies = (summaryAnomalyRows as Array<Record<string, unknown>>).map((row) => ({
    kind: "summary_job" as const,
    id: String(row.id),
    subject: String(row.articleTitle),
    targetDate: null,
    status:
      String(row.status) === "failed" && Number(row.attemptCount ?? 0) < ARTICLE_SUMMARY_MAX_ATTEMPTS
        ? "retrying"
        : String(row.status),
    attemptCount: Number(row.attemptCount ?? 0),
    lastError: row.lastError ? String(row.lastError) : null,
    scheduledFor: String(row.scheduledFor),
    startedAt: row.startedAt ? String(row.startedAt) : null,
    finishedAt: row.finishedAt ? String(row.finishedAt) : null,
    articleUrl: String(row.articleUrl),
    language: String(row.language),
  }));
  const anomalies = [...digestAnomalies, ...summaryAnomalies]
    .sort((a, b) => {
      const aTime = a.finishedAt || a.startedAt || a.scheduledFor;
      const bTime = b.finishedAt || b.startedAt || b.scheduledFor;
      return bTime.localeCompare(aTime);
    })
    .slice(0, 20);

  res.json({
    days: daysPayload,
    anomalyCount: digestAnomalies.length + summaryAnomalies.length,
    anomalies,
    generatedAt: now,
  });
});

adminRouter.get("/invites", async (_req, res) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(userInvites)
    .orderBy(desc(userInvites.createdAt));

  res.json({
    invites: rows.map((invite) => ({
      id: invite.id,
      email: invite.email,
      accountPlan: invite.accountPlan,
      subscriptionLimitOverride: invite.subscriptionLimitOverride,
      status: invite.status,
      createdAt: invite.createdAt,
      updatedAt: invite.updatedAt,
      claimedUserId: invite.claimedUserId,
    })),
  });
});

adminRouter.post("/invites", async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0].message,
      errorZh: "邀请参数无效",
      code: "INVALID_INVITE_PAYLOAD",
    });
    return;
  }

  const invite = await createInvite({
    email: parsed.data.email,
    accountPlan: parsed.data.accountPlan,
    subscriptionLimitOverride: parsed.data.subscriptionLimitOverride ?? null,
    createdBy: req.adminUser!.id,
  });

  res.status(201).json({
    invite: {
      id: invite.id,
      email: invite.email,
      accountPlan: invite.accountPlan,
      subscriptionLimitOverride: invite.subscriptionLimitOverride,
      status: invite.status,
      createdAt: invite.createdAt,
      updatedAt: invite.updatedAt,
      claimedUserId: invite.claimedUserId,
    },
  });
});

adminRouter.patch("/invites/:id/revoke", async (req, res) => {
  const db = getDb();
  const [invite] = await db
    .update(userInvites)
    .set({
      status: "revoked",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(userInvites.id, req.params.id))
    .returning();

  if (!invite) {
    res.status(404).json({ error: "Invite not found.", errorZh: "邀请不存在", code: "INVITE_NOT_FOUND" });
    return;
  }

  res.json({ invite });
});
