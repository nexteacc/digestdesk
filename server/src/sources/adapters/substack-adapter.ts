import { getSubstackInfo, type SubstackInfo } from "../../services/substack.js";
import { fetchMarkdown, htmlToMarkdown } from "../../services/content-extractor.js";
import { AppError } from "../app-error.js";
import type { FeedDraft, SourceAdapter, SyncItemContent } from "../types.js";

export class SubstackAdapter implements SourceAdapter {
  readonly sourceType = "substack" as const;

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object") return value as Record<string, unknown>;
    return {};
  }

  normalizePublicationUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      throw new AppError("URL is required.", 400, "INVALID_INPUT", "请提供 url");
    }

    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

    try {
      return new URL(withProtocol).origin;
    } catch {
      throw new AppError("Enter a valid Substack URL.", 400, "INVALID_URL", "请输入有效的 Substack 链接");
    }
  }

  async discover(rawUrl: string): Promise<SubstackInfo> {
    const publicationUrl = this.normalizePublicationUrl(rawUrl);

    try {
      return await getSubstackInfo(publicationUrl);
    } catch {
      throw new AppError("Could not fetch publication. Check the URL.", 502, "DISCOVERY_FAILED", "无法获取出版物，请检查链接");
    }
  }

  async createFeedDraft(input: {
    url: string;
    title?: string;
    description?: string;
    logoUrl?: string;
    authorName?: string;
  }): Promise<FeedDraft> {
    const publicationUrl = this.normalizePublicationUrl(input.url);
    const hostname = new URL(publicationUrl).hostname;
    const feedUrl = `${publicationUrl}/feed`;

    let info = {
      name: input.title || "",
      description: input.description || "",
      logoUrl: input.logoUrl || "",
      authorName: input.authorName || "",
    };

    try {
      const discovered = await getSubstackInfo(publicationUrl);
      info = {
        name: input.title || discovered.name || hostname,
        description: input.description || discovered.description,
        logoUrl: input.logoUrl || discovered.logoUrl,
        authorName: input.authorName || discovered.authorName,
      };
    } catch {
      if (!info.name) {
        info.name = hostname.replace(/^www\./, "");
      }
    }

    return {
      name: info.name.slice(0, 80),
      description: info.description || null,
      logoUrl: info.logoUrl || null,
      authorName: info.authorName || null,
      publicationUrl,
      feedUrl,
      sourceType: "substack",
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
      `[substack] Content extracted articleUrl=${articleUrl} method=${extractionMethod} contentLength=${contentMarkdown?.length || 0}`,
    );
    return {
      contentMarkdown,
      coverImageUrl,
    };
  }
}
