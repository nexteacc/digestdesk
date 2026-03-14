import { discoverFeed } from "../../services/rss-discovery.js";
import { fetchMarkdown, htmlToMarkdown } from "../../services/content-extractor.js";
import { AppError } from "../app-error.js";
import type { FeedDraft, SourceAdapter, SyncItemContent } from "../types.js";

export class RssAdapter implements SourceAdapter {
  readonly sourceType = "rss" as const;

  async discover(rawUrl: string) {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      throw new AppError("请输入有效的 URL", 400, "INVALID_INPUT");
    }

    try {
      return await discoverFeed(trimmed);
    } catch (err) {
      throw new AppError(
        err instanceof Error ? err.message : "探测失败",
        404,
        "DISCOVERY_FAILED",
      );
    }
  }

  createFeedDraft(input: {
    feedUrl: string;
    siteUrl: string;
    title: string;
    description?: string;
    logoUrl?: string;
    authorName?: string;
  }): FeedDraft {
    return {
      name: input.title,
      description: input.description || null,
      logoUrl: input.logoUrl || null,
      authorName: input.authorName || null,
      publicationUrl: input.siteUrl,
      feedUrl: input.feedUrl,
      sourceType: "rss",
    };
  }

  async extractSyncItemContent(
    item: Record<string, unknown>,
    articleUrl: string,
  ): Promise<SyncItemContent> {
    let contentMarkdown = await fetchMarkdown(articleUrl);
    if (!contentMarkdown) {
      const contentHtml =
        (item as any)["content:encoded"] || (item as any).content || "";
      contentMarkdown = contentHtml ? htmlToMarkdown(contentHtml) : "";
    }
    return {
      contentMarkdown,
      coverImageUrl: (item as any).enclosure?.url || null,
    };
  }
}
