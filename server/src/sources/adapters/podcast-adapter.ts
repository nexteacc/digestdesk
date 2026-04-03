import { AppError } from "../app-error.js";
import type { FeedDraft, SourceAdapter, SyncItemContent } from "../types.js";
import { htmlToMarkdown } from "../../services/content-extractor.js";

function pickString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function getNestedImage(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const direct = (value as { href?: unknown }).href;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const nested = (value as { $?: { href?: unknown; url?: unknown } }).$;
  if (nested) {
    if (typeof nested.href === "string" && nested.href.trim()) return nested.href.trim();
    if (typeof nested.url === "string" && nested.url.trim()) return nested.url.trim();
  }
  return "";
}

function cleanShownotes(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*(subscribe|follow|support|sponsor|advertis(e|ing)|patreon)\b.*$/gim, "")
    .replace(/^\s*(时间轴|timestamps?)[:：].*$/gim, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .trim();
}

export class PodcastAdapter implements SourceAdapter {
  readonly sourceType = "podcast" as const;

  async discover(): Promise<never> {
    throw new AppError("Add podcasts via search.", 400, "PODCAST_SEARCH_REQUIRED", "请通过搜索添加播客");
  }

  createFeedDraft(input: {
    title: string;
    description?: string;
    logoUrl?: string;
    authorName?: string;
    feedUrl: string;
    siteUrl: string;
  }): FeedDraft {
    const title = pickString(input.title);
    const feedUrl = pickString(input.feedUrl);
    const siteUrl = pickString(input.siteUrl);

    if (!title || !feedUrl || !siteUrl) {
      throw new AppError("Incomplete podcast data. Try searching again.", 400, "INVALID_PODCAST_INPUT", "播客数据不完整，请重新搜索");
    }

    return {
      name: title,
      description: pickString(input.description) || null,
      logoUrl: pickString(input.logoUrl) || null,
      authorName: pickString(input.authorName) || null,
      publicationUrl: siteUrl,
      feedUrl,
      sourceType: "podcast",
    };
  }

  async extractSyncItemContent(
    item: Record<string, unknown>,
  ): Promise<SyncItemContent> {
    const itemRecord = asRecord(item);
    const contentHtml =
      pickString(itemRecord["itunes:summary"]) ||
      pickString(itemRecord.itunesSummary) ||
      pickString(itemRecord["content:encoded"]) ||
      pickString(itemRecord.content) ||
      pickString(itemRecord.contentSnippet) ||
      pickString(itemRecord.summary) ||
      pickString(itemRecord.description);

    const markdown = cleanShownotes(htmlToMarkdown(contentHtml || ""));
    const itemImage =
      getNestedImage(itemRecord["itunes:image"]) ||
      getNestedImage(itemRecord.itunesImage) ||
      getNestedImage(itemRecord["media:content"]) ||
      getNestedImage(itemRecord["media:thumbnail"]) ||
      "";

    return {
      contentMarkdown: markdown,
      coverImageUrl: itemImage || null,
    };
  }
}
