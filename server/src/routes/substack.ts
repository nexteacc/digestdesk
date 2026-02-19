import { Router } from "express";
import { like } from "drizzle-orm";
import { getSubstackInfo, searchSubstack } from "../services/substack.js";
import { getDb } from "../db/index.js";
import { feeds } from "../db/schema.js";

export const substackRouter = Router();

// GET /api/substack/info?url=xxx
substackRouter.get("/info", async (req, res) => {
  const url = req.query.url as string;
  if (!url) {
    res.status(400).json({ error: "参数 url 不能为空" });
    return;
  }

  try {
    // 自动补全协议
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    // 只保留 origin
    const parsed = new URL(normalizedUrl);
    const publicationUrl = parsed.origin;

    const info = await getSubstackInfo(publicationUrl);
    res.json(info);
  } catch (err) {
    console.error("[substack/info] Error:", err);
    res.status(500).json({ error: "无法获取出版物信息，请检查链接是否正确" });
  }
});

// GET /api/substack/search?query=xxx
substackRouter.get("/search", async (req, res) => {
  const query = req.query.query as string;
  if (!query) {
    res.status(400).json({ error: "参数 query 不能为空" });
    return;
  }

  try {
    const page = parseInt(req.query.page as string) || 0;
    const limit = parseInt(req.query.limit as string) || 10;

    // 第一层：本地 DB 搜索已订阅的出版物
    const db = getDb();
    const localFeeds = await db
      .select()
      .from(feeds)
      .where(like(feeds.name, `%${query}%`));

    const localResults = localFeeds.map((f) => ({
      name: f.name,
      logoUrl: f.logoUrl || "",
      description: f.description || "",
      url: f.publicationUrl,
      authorName: f.authorName || "",
      isLocal: true,
    }));

    // 第二层：远程 Substack API（失败不阻塞）
    let remoteResults: typeof localResults = [];
    try {
      const remote = await searchSubstack(query, page, limit);
      // 过滤掉本地已有的（按 URL 去重）
      const localUrls = new Set(localResults.map((r) => r.url));
      remoteResults = remote
        .filter((r) => !localUrls.has(r.url))
        .map((r) => ({ ...r, isLocal: false }));
    } catch (err) {
      console.warn("[substack/search] Remote search failed, using local only:", err instanceof Error ? err.message : err);
    }

    res.json({ results: [...localResults, ...remoteResults] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[substack/search] Error:", msg);
    res.status(500).json({ error: "搜索失败，请稍后重试" });
  }
});
