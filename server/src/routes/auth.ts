import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb, readLegacySettings } from "../db/index.js";
import { users, feeds, subscriptions, userSettings } from "../db/schema.js";

export const authRouter = Router();

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

    const legacyFeeds = await tx.select({ id: feeds.id }).from(feeds);
    if (legacyFeeds.length > 0) {
      await tx.insert(subscriptions).values(
        legacyFeeds.map((feed) => ({
          id: nanoid(),
          userId,
          feedId: feed.id,
          startedAt: now,
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

  res.json(newUser);
});
