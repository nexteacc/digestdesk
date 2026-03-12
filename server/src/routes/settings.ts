import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { settings } from "../db/schema.js";
import { restartDigestJob } from "../cron/scheduler.js";

const updateSettingsSchema = z.object({
  digestTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "时间格式应为 HH:mm"),
  timezone: z.string().min(1, "时区不能为空"),
});

export const settingsRouter = Router();

settingsRouter.get("/", async (_req, res) => {
  const db = getDb();
  const rows = await db.select().from(settings);
  
  const config: Record<string, string> = {};
  rows.forEach(row => {
    config[row.key] = row.value;
  });

  // Default values if not set
  res.json({
    digestTime: config.digest_time || "08:00",
    timezone: config.timezone || "Asia/Shanghai",
  });
});

settingsRouter.post("/", async (req, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const { digestTime, timezone } = parsed.data;
  const db = getDb();

  try {
    await db.insert(settings).values({ key: "digest_time", value: digestTime })
      .onConflictDoUpdate({ target: settings.key, set: { value: digestTime } });
    
    await db.insert(settings).values({ key: "timezone", value: timezone })
      .onConflictDoUpdate({ target: settings.key, set: { value: timezone } });

    // 关键点：重启定时任务以应用新时间
    restartDigestJob(digestTime, timezone);

    res.json({ success: true });
  } catch (err) {
    console.error("[settings] Update failed:", err);
    res.status(500).json({ error: "更新设置失败" });
  }
});
