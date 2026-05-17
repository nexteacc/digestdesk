import { and, count, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";
import { subscriptions, userEntitlements, userInvites } from "../db/schema.js";

export type AccountPlan = "free" | "test" | "admin";
export type AccessStatus = "active" | "revoked";

export const PLAN_LIMITS: Record<AccountPlan, number | null> = {
  free: 100,
  test: 300,
  admin: null,
};

export class SubscriptionLimitError extends Error {
  code = "SUBSCRIPTION_LIMIT_REACHED" as const;
  status = 403;
  current: number;
  limit: number;
  requested: number;
  remaining: number;
  plan: AccountPlan;

  constructor(input: { current: number; limit: number; requested: number; plan: AccountPlan }) {
    super("Subscription limit reached.");
    this.current = input.current;
    this.limit = input.limit;
    this.requested = input.requested;
    this.remaining = Math.max(0, input.limit - input.current);
    this.plan = input.plan;
  }
}

export class AccessRevokedError extends Error {
  code = "ACCOUNT_ACCESS_REVOKED" as const;
  status = 403;

  constructor() {
    super("Account access has been revoked.");
  }
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getAdminEmailSet() {
  return new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => normalizeEmail(email))
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  return getAdminEmailSet().has(normalizeEmail(email));
}

export async function ensureUserEntitlement(
  userId: string,
  options?: { plan?: AccountPlan; limitOverride?: number | null; updatedBy?: string | null },
) {
  const db = getDb();
  const now = new Date().toISOString();
  const plan = options?.plan ?? "free";
  const [existing] = await db
    .select()
    .from(userEntitlements)
    .where(eq(userEntitlements.userId, userId));

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(userEntitlements)
    .values({
      userId,
      accountPlan: plan,
      subscriptionLimitOverride: options?.limitOverride ?? null,
      accessStatus: "active",
      createdAt: now,
      updatedAt: now,
      updatedBy: options?.updatedBy ?? null,
    })
    .returning();
  return created;
}

export async function getUserEntitlement(userId: string) {
  return ensureUserEntitlement(userId);
}

export function getEffectiveSubscriptionLimit(entitlement: typeof userEntitlements.$inferSelect) {
  return entitlement.subscriptionLimitOverride ?? PLAN_LIMITS[entitlement.accountPlan];
}

export async function getActiveSubscriptionCount(userId: string) {
  const db = getDb();
  const [row] = await db
    .select({ value: count() })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt)));
  return row?.value ?? 0;
}

export async function getSubscriptionUsage(userId: string) {
  const entitlement = await getUserEntitlement(userId);
  const activeSubscriptions = await getActiveSubscriptionCount(userId);
  const subscriptionLimit = getEffectiveSubscriptionLimit(entitlement);
  return {
    accountPlan: entitlement.accountPlan,
    accessStatus: entitlement.accessStatus,
    subscriptionLimit,
    subscriptionLimitOverride: entitlement.subscriptionLimitOverride,
    activeSubscriptions,
    remainingSubscriptions:
      subscriptionLimit === null ? null : Math.max(0, subscriptionLimit - activeSubscriptions),
  };
}

export async function assertCanAddSubscriptions(userId: string, requested = 1) {
  const usage = await getSubscriptionUsage(userId);

  if (usage.accessStatus === "revoked") {
    throw new AccessRevokedError();
  }

  if (usage.subscriptionLimit === null) {
    return usage;
  }

  if (usage.activeSubscriptions + requested > usage.subscriptionLimit) {
    throw new SubscriptionLimitError({
      current: usage.activeSubscriptions,
      limit: usage.subscriptionLimit,
      requested,
      plan: usage.accountPlan,
    });
  }

  return usage;
}

export function sendEntitlementError(res: {
  status: (status: number) => {
    json: (body: unknown) => void;
  };
}, error: unknown) {
  if (error instanceof SubscriptionLimitError) {
    res.status(error.status).json({
      error: error.message,
      errorZh: "订阅数量已达当前账号上限。",
      code: error.code,
      current: error.current,
      limit: error.limit,
      requested: error.requested,
      remaining: error.remaining,
      plan: error.plan,
    });
    return true;
  }

  if (error instanceof AccessRevokedError) {
    res.status(error.status).json({
      error: error.message,
      errorZh: "该账号已被停用。",
      code: error.code,
    });
    return true;
  }

  return false;
}

export async function upsertUserEntitlement(input: {
  userId: string;
  accountPlan: AccountPlan;
  subscriptionLimitOverride?: number | null;
  accessStatus?: AccessStatus;
  updatedBy?: string | null;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const [row] = await db
    .insert(userEntitlements)
    .values({
      userId: input.userId,
      accountPlan: input.accountPlan,
      subscriptionLimitOverride: input.subscriptionLimitOverride ?? null,
      accessStatus: input.accessStatus ?? "active",
      createdAt: now,
      updatedAt: now,
      updatedBy: input.updatedBy ?? null,
    })
    .onConflictDoUpdate({
      target: userEntitlements.userId,
      set: {
        accountPlan: input.accountPlan,
        subscriptionLimitOverride: input.subscriptionLimitOverride ?? null,
        accessStatus: input.accessStatus ?? "active",
        updatedAt: now,
        updatedBy: input.updatedBy ?? null,
      },
    })
    .returning();
  return row;
}

export async function claimInviteForUser(userId: string, email: string) {
  const db = getDb();
  const normalized = normalizeEmail(email);
  const [invite] = await db
    .select()
    .from(userInvites)
    .where(eq(userInvites.email, normalized))
    .orderBy(desc(userInvites.createdAt));

  if (!invite || invite.status !== "invited") {
    await ensureUserEntitlement(userId);
    return null;
  }

  await upsertUserEntitlement({
    userId,
    accountPlan: invite.accountPlan,
    subscriptionLimitOverride: invite.subscriptionLimitOverride,
    updatedBy: invite.createdBy ?? null,
  });

  await db
    .update(userInvites)
    .set({
      status: "claimed",
      claimedUserId: userId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(userInvites.id, invite.id));

  return invite;
}

export async function createInvite(input: {
  email: string;
  accountPlan: AccountPlan;
  subscriptionLimitOverride?: number | null;
  createdBy?: string | null;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const normalized = normalizeEmail(input.email);
  const [row] = await db
    .insert(userInvites)
    .values({
      id: nanoid(),
      email: normalized,
      accountPlan: input.accountPlan,
      subscriptionLimitOverride: input.subscriptionLimitOverride ?? null,
      status: "invited",
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy ?? null,
      claimedUserId: null,
    })
    .onConflictDoUpdate({
      target: userInvites.email,
      set: {
        accountPlan: input.accountPlan,
        subscriptionLimitOverride: input.subscriptionLimitOverride ?? null,
        status: "invited",
        updatedAt: now,
        createdBy: input.createdBy ?? null,
        claimedUserId: null,
      },
    })
    .returning();
  return row;
}
