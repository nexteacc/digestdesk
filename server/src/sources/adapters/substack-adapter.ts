import { getSubstackInfo, type SubstackInfo } from "../../services/substack.js";
import { fetchMarkdown, htmlToMarkdown } from "../../services/content-extractor.js";
import { AppError } from "../app-error.js";
import type { FeedDraft, SourceAdapter, SyncItemContent } from "../types.js";

export class SubstackAdapter implements SourceAdapter {
  readonly sourceType = "substack" as const;

  normalizePublicationUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      throw new AppError("请提供 url", 400, "INVALID_INPUT");
    }

    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

    try {
      return new URL(withProtocol).origin;
    } catch {
      throw new AppError("请输入有效的 Substack 链接", 400, "INVALID_URL");
    }
  }

  async discover(rawUrl: string): Promise<SubstackInfo> {
    const publicationUrl = this.normalizePublicationUrl(rawUrl);

    try {
      return await getSubstackInfo(publicationUrl);
    } catch {
      throw new AppError("无法获取出版物信息，请检查链接是否正确", 502, "DISCOVERY_FAILED");
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
