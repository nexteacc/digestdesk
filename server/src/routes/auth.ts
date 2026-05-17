import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { nanoid } from "nanoid";
import { and, eq, isNull, lt } from "drizzle-orm";
import { getDb, readLegacySettings } from "../db/index.js";
import { users, feeds, subscriptions, userSettings } from "../db/schema.js";
import { claimInviteForUser, getUserEntitlement, isAdminEmail } from "../services/entitlements.js";

export const authRouter = Router();

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
    // Update last login
    const now = new Date().toISOString();
    await db.update(users).set({ lastLoginAt: now }).where(eq(users.id, existing.id));
    await repairLegacyFirstUserSubscriptions(existing.id, existing.createdAt);
    await claimInviteForUser(existing.id, existing.email);
    const entitlement = await getUserEntitlement(existing.id);
    if (entitlement.accessStatus === "revoked" && !isAdminEmail(existing.email)) {
      res.status(403).json({
        error: "Account access has been revoked.",
        errorZh: "该账号已被停用",
        code: "ACCOUNT_ACCESS_REVOKED",
      });
      return;
    }
    res.json({ ...existing, lastLoginAt: now });
    return;
  }

  // Create new user from Clerk data
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

  const allUsers = await db.select({ id: users.id }).from(users);
  const isFirstUser = allUsers.length === 0;
  const legacySettings = isFirstUser ? await readLegacySettings() : [];

  await db.transaction(async (tx) => {
    await tx.insert(users).values(newUser);

    if (!isFirstUser) {
      return;
    }

    const legacyFeeds = await tx
      .select({ id: feeds.id, feedCreatedAt: feeds.createdAt })
      .from(feeds);
    if (legacyFeeds.length > 0) {
      await tx.insert(subscriptions).values(
        legacyFeeds.map((feed) => ({
          id: nanoid(),
          userId,
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
          userId,
          key: row.key,
          value: row.value,
        })),
      ).onConflictDoNothing();
    }
  });

  await claimInviteForUser(userId, newUser.email);

  res.json(newUser);
});
