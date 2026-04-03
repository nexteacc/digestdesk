import { Router } from "express";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z, type ZodIssue } from "zod";
import { getDb } from "../db/index.js";
import { userSettings } from "../db/schema.js";
import { getRequestUserId } from "../auth/user-context.js";
import { DEFAULT_DIGEST_SOURCE_TYPES, parseDigestSourceTypes } from "../services/user-settings.js";

const updateSettingsSchema = z.object({
  digestTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  timezone: z.string().min(1),
  digestLanguage: z.enum(["zh", "en"]).default("zh"),
  digestSourceTypes: z.array(z.enum(["substack", "rss", "podcast", "youtube"])).min(1).default(DEFAULT_DIGEST_SOURCE_TYPES),
});

function getSettingsValidationError(issue: ZodIssue) {
  const field = issue.path[0];

  switch (field) {
    case "digestTime":
      return {
        code: "invalid_digest_time",
        error: "Digest time must use HH:mm format.",
      };
    case "timezone":
      return {
        code: "invalid_timezone",
        error: "Timezone is required.",
      };
    case "digestLanguage":
      return {
        code: "invalid_digest_language",
        error: "Digest language is invalid.",
      };
    case "digestSourceTypes":
      return {
        code: "invalid_digest_source_types",
        error: "Select at least one digest source.",
      };
    default:
      return {
        code: "invalid_settings_payload",
        error: "Settings payload is invalid.",
      };
  }
}

export const settingsRouter = Router();

settingsRouter.get("/", async (req, res) => {
  const db = getDb();
  const userId = getRequestUserId(req);
  const rows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  
  const config: Record<string, string> = {};
  rows.forEach(row => {
    config[row.key] = row.value;
  });

  // Default values if not set
  res.json({
    digestTime: config.digest_time || "08:00",
    timezone: config.timezone || "Asia/Shanghai",
    digestLanguage: config.digest_language || "zh",
    digestSourceTypes: parseDigestSourceTypes(config.digest_source_types),
  });
});

settingsRouter.post("/", async (req, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    const detail = getSettingsValidationError(parsed.error.issues[0]);
    res.status(400).json(detail);
    return;
  }

  const { digestTime, timezone, digestLanguage, digestSourceTypes } = parsed.data;
  const db = getDb();
  const userId = getRequestUserId(req);

  try {
    await db
      .insert(userSettings)
      .values({ id: nanoid(), userId, key: "digest_time", value: digestTime })
      .onConflictDoUpdate({
        target: [userSettings.userId, userSettings.key],
        set: { value: digestTime },
      });

    await db
      .insert(userSettings)
      .values({ id: nanoid(), userId, key: "timezone", value: timezone })
      .onConflictDoUpdate({
        target: [userSettings.userId, userSettings.key],
        set: { value: timezone },
      });

    await db
      .insert(userSettings)
      .values({ id: nanoid(), userId, key: "digest_language", value: digestLanguage })
      .onConflictDoUpdate({
        target: [userSettings.userId, userSettings.key],
        set: { value: digestLanguage },
      });

    await db
      .insert(userSettings)
      .values({
        id: nanoid(),
        userId,
        key: "digest_source_types",
        value: JSON.stringify(digestSourceTypes),
      })
      .onConflictDoUpdate({
        target: [userSettings.userId, userSettings.key],
        set: { value: JSON.stringify(digestSourceTypes) },
      });

    res.json({ success: true });
  } catch (err) {
    console.error("[settings] Update failed:", err);
    res.status(500).json({ error: "Failed to update settings.", code: "settings_update_failed" });
  }
});
