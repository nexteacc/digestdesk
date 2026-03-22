import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { users } from "../db/schema.js";

export async function resolveUser(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.clerkId, auth.userId));

  if (!user) {
    res.status(401).json({ error: "User not found. Please sign in first." });
    return;
  }

  req.userId = user.id;
  next();
}
