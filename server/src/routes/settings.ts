import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { userSettings } from "../db/schema.js";
import { getRequestUserId } from "../auth/user-context.js";

const updateSettingsSchema = z.object({
  digestTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "时间格式应为 HH:mm"),
  timezone: z.string().min(1, "时区不能为空"),
  digestLanguage: z.enum(["zh", "en"]).default("zh"),
});

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
  });
});

settingsRouter.post("/", async (req, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const { digestTime, timezone, digestLanguage } = parsed.data;
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

    res.json({ success: true });
  } catch (err) {
    console.error("[settings] Update failed:", err);
    res.status(500).json({ error: "更新设置失败" });
  }
});
