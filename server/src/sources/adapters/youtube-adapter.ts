import {
  buildYouTubeChannelUrl,
  buildYouTubeFeedUrl,
  discoverYouTubeChannel,
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

  async discover(rawUrl: string) {
    try {
      return await discoverYouTubeChannel(rawUrl);
    } catch (err) {
      if (err instanceof YouTubeDiscoveryError) {
        throw new AppError(err.message, err.status, err.code);
      }
      throw new AppError("探测失败，请稍后重试", 500, "DISCOVERY_FAILED");
    }
  }

  createFeedDraft(input: {
    channelId: string;
    title: string;
    logoUrl?: string;
  }): FeedDraft {
    const channelId = input.channelId.trim();
    if (!YOUTUBE_CHANNEL_ID_REGEX.test(channelId)) {
      throw new AppError("channelId 格式不正确", 400, "INVALID_CHANNEL_ID");
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
    const mediaGroup = (item as any).mediaGroup;
    const fromMediaGroup = pickTextValue(mediaGroup?.["media:description"]);
    if (fromMediaGroup) return fromMediaGroup;

    const fromRootMedia = pickTextValue((item as any)["media:description"]);
    if (fromRootMedia) return fromRootMedia;

    return (item as any).contentSnippet || (item as any).content || "";
  }

  private extractThumbnail(
    item: Record<string, unknown>,
    videoUrl: string,
  ): string | null {
    try {
      const mediaGroup = (item as any).mediaGroup;
      const thumb = mediaGroup?.["media:thumbnail"];
      if (thumb?.$?.url) return thumb.$.url;
      if (Array.isArray(thumb) && thumb[0]?.$?.url) return thumb[0].$.url;

      const rootThumb = (item as any)["media:thumbnail"];
      if (rootThumb?.$?.url) return rootThumb.$.url;
      if (Array.isArray(rootThumb) && rootThumb[0]?.$?.url) return rootThumb[0].$.url;
    } catch {}
    try {
      const url = new URL(videoUrl);
      const videoId = url.searchParams.get("v");
      if (videoId) return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    } catch {}
    return null;
  }
}
