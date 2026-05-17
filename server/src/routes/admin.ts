import { Router } from "express";
import type { Request } from "express";
import { getAuth } from "@clerk/express";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { userInvites, users } from "../db/schema.js";
import {
  createInvite,
  getEffectiveSubscriptionLimit,
  isAdminEmail,
  PLAN_LIMITS,
  upsertUserEntitlement,
  type AccessStatus,
  type AccountPlan,
} from "../services/entitlements.js";

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
