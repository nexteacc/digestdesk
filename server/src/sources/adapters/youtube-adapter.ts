import {
  buildYouTubeChannelUrl,
  buildYouTubeFeedUrl,
  discoverYouTubeChannel,
  isYouTubeShort,
  YouTubeDiscoveryError,
} from "../../services/youtube-discovery.js";
import { AppError } from "../app-error.js";
import type { FeedDraft, SourceAdapter, SyncItemContent } from "../types.js";

const YOUTUBE_CHANNEL_ID_REGEX = /^UC[a-zA-Z0-9_-]{22}$/;

function pickTextValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickTextValue(item);
      if (picked) return picked;
    }
    return null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const fromKnownFields =
      pickTextValue(obj._) ||
      pickTextValue(obj["#text"]) ||
      pickTextValue(obj.value) ||
      pickTextValue(obj.text);
    if (fromKnownFields) return fromKnownFields;
  }
  return null;
}

export class YouTubeAdapter implements SourceAdapter {
  readonly sourceType = "youtube" as const;

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object") return value as Record<string, unknown>;
    return {};
  }

  async discover(rawUrl: string) {
    try {
      return await discoverYouTubeChannel(rawUrl);
    } catch (err) {
      if (err instanceof YouTubeDiscoveryError) {
        throw new AppError(err.message, err.status, err.code, err.messageZh);
      }
      throw new AppError("Discovery failed. Try again later.", 500, "DISCOVERY_FAILED", "探测失败，请稍后重试");
    }
  }

  async shouldSyncItem(_item: Record<string, unknown>, articleUrl: string): Promise<boolean> {
    const isShort = await isYouTubeShort(articleUrl);
    return !isShort;
  }

  createFeedDraft(input: {
    channelId: string;
    title: string;
    logoUrl?: string;
  }): FeedDraft {
    const channelId = input.channelId.trim();
    if (!YOUTUBE_CHANNEL_ID_REGEX.test(channelId)) {
      throw new AppError("Invalid channel ID format.", 400, "INVALID_CHANNEL_ID", "channelId 格式不正确");
    }

    return {
      name: input.title,
      description: null,
      logoUrl: input.logoUrl || null,
      authorName: null,
      publicationUrl: buildYouTubeChannelUrl(channelId),
      feedUrl: buildYouTubeFeedUrl(channelId),
      sourceType: "youtube",
    };
  }

  async extractSyncItemContent(
    item: Record<string, unknown>,
    articleUrl: string,
  ): Promise<SyncItemContent> {
    return {
      contentMarkdown: this.getDescription(item),
      coverImageUrl: this.extractThumbnail(item, articleUrl),
    };
  }

  static extractOneLiner(description: string, videoTitle: string): string {
    if (!description?.trim()) return videoTitle;
    const paragraphs = description.split(/\n\s*\n/);
    for (const p of paragraphs) {
      const cleaned = p
        .replace(/https?:\/\/\S+/g, "")
        .replace(/#\S+/g, "")
        .replace(/【[^】]*】/g, "")
        .trim();
      if (cleaned.length > 15) {
        return cleaned.slice(0, 100);
      }
    }
    return videoTitle;
  }

  private getDescription(item: Record<string, unknown>): string {
    const itemRecord = this.asRecord(item);
    const mediaGroup = this.asRecord(itemRecord.mediaGroup);
    const fromMediaGroup = pickTextValue(mediaGroup?.["media:description"]);
    if (fromMediaGroup) return fromMediaGroup;

    const fromRootMedia = pickTextValue(itemRecord["media:description"]);
    if (fromRootMedia) return fromRootMedia;

    if (typeof itemRecord.contentSnippet === "string") return itemRecord.contentSnippet;
    if (typeof itemRecord.content === "string") return itemRecord.content;
    return "";
  }

  private extractThumbnail(
    item: Record<string, unknown>,
    videoUrl: string,
  ): string | null {
    const itemRecord = this.asRecord(item);
    const mediaGroup = this.asRecord(itemRecord.mediaGroup);
    const thumbUrl =
      this.extractThumbUrl(mediaGroup["media:thumbnail"]) ||
      this.extractThumbUrl(itemRecord["media:thumbnail"]);
    if (thumbUrl) return thumbUrl;

    try {
      const url = new URL(videoUrl);
      const videoId = url.searchParams.get("v");
      if (videoId) return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    } catch {
      return null;
    }
    return null;
  }

  private extractThumbUrl(value: unknown): string | null {
    const direct = this.asRecord(this.asRecord(value).$).url;
    if (typeof direct === "string" && direct) return direct;
    if (Array.isArray(value) && value.length > 0) {
      const first = this.asRecord(value[0]);
      const nested = this.asRecord(first.$).url;
      if (typeof nested === "string" && nested) return nested;
    }
    return null;
  }
}
