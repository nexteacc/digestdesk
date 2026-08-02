import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { nanoid } from "nanoid";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { getDb, readLegacySettings } from "../db/index.js";
import { users, feeds, subscriptions, userSettings } from "../db/schema.js";
import { claimInviteForUser, getUserEntitlement, isAdminEmail } from "../services/entitlements.js";

export const authRouter = Router();

type UserRecord = typeof users.$inferSelect;

async function repairLegacyFirstUserSubscriptions(userId: string, userCreatedAt: string) {
  const db = getDb();
  const allUsers = await db.select({ id: users.id }).from(users);
  if (allUsers.length !== 1) {
    return;
  }

  const rows = await db
    .select({
      subscriptionId: subscriptions.id,
      feedCreatedAt: feeds.createdAt,
    })
    .from(subscriptions)
    .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
    .where(
      and(
        eq(subscriptions.userId, userId),
        isNull(subscriptions.endedAt),
        eq(subscriptions.startedAt, userCreatedAt),
        lt(feeds.createdAt, userCreatedAt),
      ),
    );

  for (const row of rows) {
    await db
      .update(subscriptions)
      .set({ startedAt: row.feedCreatedAt })
      .where(eq(subscriptions.id, row.subscriptionId));
  }

  if (rows.length > 0) {
    console.log(`[auth] Repaired ${rows.length} migrated subscriptions for first user ${userId}`);
  }
}

async function refreshExistingUser(existing: UserRecord) {
  const db = getDb();
  const now = new Date().toISOString();
  await db.update(users).set({ lastLoginAt: now }).where(eq(users.id, existing.id));
  await repairLegacyFirstUserSubscriptions(existing.id, existing.createdAt);
  await claimInviteForUser(existing.id, existing.email);
  const entitlement = await getUserEntitlement(existing.id);
  return {
    user: { ...existing, lastLoginAt: now },
    accessRevoked: entitlement.accessStatus === "revoked" && !isAdminEmail(existing.email),
  };
}

authRouter.get("/me", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const clerkId = auth.userId;
  const db = getDb();

  // Find existing user
  const [existing] = await db.select().from(users).where(eq(users.clerkId, clerkId));

  if (existing) {
    const refreshed = await refreshExistingUser(existing);
    if (refreshed.accessRevoked) {
      res.status(403).json({
        error: "Account access has been revoked.",
        errorZh: "该账号已被停用",
        code: "ACCOUNT_ACCESS_REVOKED",
      });
      return;
    }
    res.json(refreshed.user);
    return;
  }

  const clerkUser = await clerkClient.users.getUser(clerkId);
  const now = new Date().toISOString();
  const userId = nanoid();

  const newUser = {
    id: userId,
    clerkId,
    email: clerkUser.emailAddresses[0]?.emailAddress || "",
    name: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null,
    avatarUrl: clerkUser.imageUrl || null,
    createdAt: now,
    lastLoginAt: now,
  };

  const resolved = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('digestdesk.auth.bootstrap'))`);
    const [concurrentExisting] = await tx.select().from(users).where(eq(users.clerkId, clerkId));
    if (concurrentExisting) {
      return { user: concurrentExisting, created: false };
    }

    const allUsers = await tx.select({ id: users.id }).from(users);
    const isFirstUser = allUsers.length === 0;
    const legacySettings = isFirstUser ? await readLegacySettings() : [];
    const [createdUser] = await tx
      .insert(users)
      .values(newUser)
      .onConflictDoNothing({ target: users.clerkId })
      .returning();

    if (!createdUser) {
      const [conflictedUser] = await tx.select().from(users).where(eq(users.clerkId, clerkId));
      if (!conflictedUser) {
        throw new Error("Unable to resolve the authenticated user after a concurrent insert.");
      }
      return { user: conflictedUser, created: false };
    }

    if (isFirstUser) {
      const legacyFeeds = await tx
        .select({ id: feeds.id, feedCreatedAt: feeds.createdAt })
        .from(feeds);
      if (legacyFeeds.length > 0) {
        await tx.insert(subscriptions).values(
          legacyFeeds.map((feed) => ({
            id: nanoid(),
            userId: createdUser.id,
            feedId: feed.id,
            startedAt: feed.feedCreatedAt,
            createdAt: now,
          })),
        ).onConflictDoNothing();
      }
      if (legacySettings.length > 0) {
        await tx.insert(userSettings).values(
          legacySettings.map((row: { key: string; value: string }) => ({
            id: nanoid(),
            userId: createdUser.id,
            key: row.key,
            value: row.value,
          })),
        ).onConflictDoNothing();
      }
    }

    return { user: createdUser, created: true };
  });

  if (!resolved.created) {
    const refreshed = await refreshExistingUser(resolved.user);
    if (refreshed.accessRevoked) {
      res.status(403).json({
        error: "Account access has been revoked.",
        errorZh: "该账号已被停用",
        code: "ACCOUNT_ACCESS_REVOKED",
      });
      return;
    }
    res.json(refreshed.user);
    return;
  }

  await claimInviteForUser(resolved.user.id, resolved.user.email);
  const entitlement = await getUserEntitlement(resolved.user.id);
  if (entitlement.accessStatus === "revoked" && !isAdminEmail(resolved.user.email)) {
    res.status(403).json({
      error: "Account access has been revoked.",
      errorZh: "该账号已被停用",
      code: "ACCOUNT_ACCESS_REVOKED",
    });
    return;
  }

  res.json(resolved.user);
});
