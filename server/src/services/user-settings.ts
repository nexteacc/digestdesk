import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { userSettings } from "../db/schema.js";

export async function getUserSettingsMap(userId: string) {
  const db = getDb();
  const rows = await db
    .select({ key: userSettings.key, value: userSettings.value })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function getUserTimezone(userId: string) {
  const settings = await getUserSettingsMap(userId);
  return settings.timezone || "Asia/Shanghai";
}
