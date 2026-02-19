import RssParser from "rss-parser";
import TurndownService from "turndown";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { feeds, articles } from "../db/schema.js";

const rssParser = new RssParser({
  timeout: 15000,
  headers: {
    "User-Agent": "DigestDesk/1.0 (RSS Reader)",
  },
});

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// 跳过导航、页眉页脚等无用元素
turndown.remove(["script", "style", "nav", "footer", "header"]);

const JINA_READER_BASE = "https://r.jina.ai/";
const MIN_CONTENT_LENGTH = 500; // Markdown 最少字数，低于此认为内容不完整

/**
 * 用 Jina Reader 抓取文章全文 Markdown
 */
export async function fetchMarkdown(articleUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${JINA_READER_BASE}${articleUrl}`, {
      headers: {
        Accept: "text/markdown",
        "User-Agent": "DigestDesk/1.0",
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      console.warn(`[rss] Jina Reader returned ${response.status} for ${articleUrl}`);
      return null;
    }

    const markdown = await response.text();

    // 提取正文部分（跳过 Jina 返回的 Title/URL Source/Published Time 头部）
    const contentStart = markdown.indexOf("Markdown Content:");
    const content = contentStart !== -1
      ? markdown.slice(contentStart + "Markdown Content:".length).trim()
      : markdown;

    if (content.length < MIN_CONTENT_LENGTH) {
      console.warn(`[rss] Jina content too short (${content.length} chars) for ${articleUrl}`);
      return null;
    }

    return content;
  } catch (err) {
    console.warn(`[rss] Jina Reader failed for ${articleUrl}:`, err);
    return null;
  }
}

/**
 * RSS HTML → Markdown（兜底方案）
 */
function htmlToMarkdown(html: string): string {
  if (!html) return "";
  return turndown.turndown(html);
}

export async function syncFeed(feedId: string): Promise<number> {
  const db = getDb();
  const feed = db.select().from(feeds).where(eq(feeds.id, feedId)).get();
  if (!feed) {
    console.warn(`[rss] Feed ${feedId} not found`);
    return 0;
  }

  console.log(`[rss] Syncing: ${feed.name} (${feed.feedUrl})`);

  let parsed;
  try {
    parsed = await rssParser.parseURL(feed.feedUrl);
  } catch (err) {
    console.error(`[rss] Failed to fetch ${feed.feedUrl}:`, err);
    return 0;
  }

  const now = new Date().toISOString();
  let newCount = 0;

  for (const item of parsed.items || []) {
    const articleUrl = item.link || "";
    const guid = item.guid || articleUrl;

    if (!articleUrl) continue;

    // 增量去重：按 URL 检查
    const existing = db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.url, articleUrl))
      .get();

    if (existing) continue;

    // 1) 先尝试 Jina Reader 抓全文 Markdown
    let contentMarkdown = await fetchMarkdown(articleUrl);

    // 2) 兜底：RSS content:encoded → Turndown 转 Markdown
    if (!contentMarkdown) {
      const contentHtml = item["content:encoded"] || item.content || "";
      contentMarkdown = contentHtml ? htmlToMarkdown(contentHtml) : "";
    }

    const contentHtml = item["content:encoded"] || item.content || null;

    const article = {
      id: nanoid(),
      feedId: feed.id,
      title: item.title || "无标题",
      author: item.creator || item["dc:creator"] || feed.authorName || null,
      url: articleUrl,
      guid,
      publishedAt: item.isoDate || item.pubDate || now,
      contentHtml: contentHtml || null,
      contentText: contentMarkdown || null, // 现在存的是 Markdown 而非纯文本
      coverImageUrl: item.enclosure?.url || null,
      fetchedAt: now,
    };

    db.insert(articles).values(article).run();
    newCount++;
  }

  // 更新 lastFetchedAt
  db.update(feeds).set({ lastFetchedAt: now }).where(eq(feeds.id, feedId)).run();

  console.log(`[rss] ${feed.name}: ${newCount} new articles`);
  return newCount;
}

export async function syncAllFeeds(): Promise<void> {
  const db = getDb();
  const allFeeds = db.select().from(feeds).all();

  console.log(`[rss] Syncing ${allFeeds.length} feeds...`);

  for (const feed of allFeeds) {
    try {
      await syncFeed(feed.id);
    } catch (err) {
      console.error(`[rss] Error syncing ${feed.name}:`, err);
    }
    // 请求间隔 1 秒，尊重服务器
    await new Promise((r) => setTimeout(r, 1000));
  }
}
