import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { userSettings } from "../db/schema.js";
import type { DigestSourceType } from "../../../shared/types.js";

export const DEFAULT_DIGEST_SOURCE_TYPES: DigestSourceType[] = ["substack", "rss", "podcast", "youtube"];

const digestSourceTypeSchema = z.enum(["substack", "rss", "podcast", "youtube"]);
const digestSourceTypesSchema = z.array(digestSourceTypeSchema).min(1);

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

export function parseDigestSourceTypes(raw?: string | null): DigestSourceType[] {
  if (!raw) return DEFAULT_DIGEST_SOURCE_TYPES;

  try {
    const parsed = digestSourceTypesSchema.parse(JSON.parse(raw));
    return DEFAULT_DIGEST_SOURCE_TYPES.filter((type) => parsed.includes(type));
  } catch {
    return DEFAULT_DIGEST_SOURCE_TYPES;
  }
}
