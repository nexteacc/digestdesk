import { Router } from "express";
import { like } from "drizzle-orm";
import { z } from "zod";
import { searchSubstack, fetchSubstackReads } from "../services/substack.js";
import { getDb } from "../db/index.js";
import { feeds } from "../db/schema.js";
import { toAppError } from "../sources/app-error.js";
import { getSubstackAdapter } from "../sources/factory.js";

export const substackRouter = Router();
const substackAdapter = getSubstackAdapter();

substackRouter.get("/info", async (req, res) => {
  const url = z.string().min(1, "参数 url 不能为空").safeParse(req.query.url);
  if (!url.success) {
    res.status(400).json({ error: url.error.issues[0].message });
    return;
  }

  try {
    const info = await substackAdapter.discover(url.data);
    res.json(info);
  } catch (err) {
    const appError = toAppError(err);
    console.error("[substack/info] Error:", appError.message);
    res.status(appError.status).json({ error: appError.message, code: appError.code });
  }
});

substackRouter.get("/search", async (req, res) => {
  const query = z.string().min(1, "参数 query 不能为空").safeParse(req.query.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.issues[0].message });
    return;
  }

  try {
    const page = Math.max(0, parseInt(req.query.page as string) || 0);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));

    const db = getDb();
    const escaped = query.data.replace(/%/g, "\\%").replace(/_/g, "\\_");
    const localFeeds = await db
      .select()
      .from(feeds)
      .where(like(feeds.name, `%${escaped}%`));

    const localResults = localFeeds.map((f) => ({
      name: f.name,
      logoUrl: f.logoUrl || "",
      description: f.description || "",
      url: f.publicationUrl,
      authorName: f.authorName || "",
      isLocal: true,
    }));

    let remoteResults: typeof localResults = [];
    try {
      const remote = await searchSubstack(query.data, page, limit);
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

substackRouter.get("/reads", async (req, res) => {
  const username = z.string().min(1, "参数 username 不能为空").safeParse(req.query.username);
  if (!username.success) {
    res.status(400).json({ error: username.error.issues[0].message });
    return;
  }

  try {
    const results = await fetchSubstackReads(username.data.trim());
    res.json({ results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "获取订阅列表失败";
    console.error("[substack/reads] Error:", err);
    res.status(500).json({ error: msg });
  }
});
