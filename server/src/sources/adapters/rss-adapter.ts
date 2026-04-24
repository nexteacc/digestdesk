import { discoverFeed } from "../../services/rss-discovery.js";
import { fetchMarkdown, htmlToMarkdown } from "../../services/content-extractor.js";
import { AppError } from "../app-error.js";
import type { FeedDraft, SourceAdapter, SyncItemContent } from "../types.js";

export class RssAdapter implements SourceAdapter {
  readonly sourceType = "rss" as const;

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object") return value as Record<string, unknown>;
    return {};
  }

  async discover(rawUrl: string) {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      throw new AppError("Enter a valid URL.", 400, "INVALID_INPUT", "请输入有效的 URL");
    }

    try {
      return await discoverFeed(trimmed);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        err instanceof Error ? err.message : "Discovery failed.",
        404,
        "DISCOVERY_FAILED",
        err instanceof Error ? err.message : "探测失败",
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
    // 1. Prefer RSS content:encoded — free, local, no external API quota consumed
    const itemRecord = this.asRecord(item);
    const contentHtml =
      (typeof itemRecord["content:encoded"] === "string" ? itemRecord["content:encoded"] : "") ||
      (typeof itemRecord.content === "string" ? itemRecord.content : "");
    let contentMarkdown = contentHtml ? htmlToMarkdown(contentHtml) : "";
    let extractionMethod = contentHtml ? "rss_html" : "empty";

    // 2. Fall back to Jina only when RSS content is absent or too short
    if (!contentMarkdown || contentMarkdown.length < 500) {
      const jinaResult = await fetchMarkdown(articleUrl);
      if (jinaResult) {
        contentMarkdown = jinaResult;
        extractionMethod = "jina_fallback";
      }
    }

    const enclosure = this.asRecord(this.asRecord(item).enclosure);
    const coverImageUrl = typeof enclosure.url === "string" ? enclosure.url : null;
    console.log(
      `[rss-adapter] Content extracted articleUrl=${articleUrl} method=${extractionMethod} contentLength=${contentMarkdown?.length || 0}`,
    );
    return {
      contentMarkdown,
      coverImageUrl,
    };
  }
}
