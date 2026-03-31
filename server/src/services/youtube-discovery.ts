import RssParser from "rss-parser";
import type { DiscoveredYouTubeChannel } from "../../../shared/types.js";
import { AppError } from "../sources/app-error.js";

const rssParser = new RssParser({
  timeout: 10000,
  headers: {
    "User-Agent": "DigestDesk/1.0 (YouTube Discovery)",
  },
});

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const YOUTUBE_CHANNEL_ID_REGEX = /^UC[a-zA-Z0-9_-]{22}$/;
const SHORTS_RESULT_CACHE = new Map<string, boolean>();
const YOUTUBE_CHANNEL_FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=";
const YOUTUBE_PLAYLIST_FEED_URL = "https://www.youtube.com/feeds/videos.xml?playlist_id=";
const YOUTUBE_LONG_FORM_PLAYLIST_PREFIX = "UULF";
const YOUTUBE_SHORTS_PLAYLIST_PREFIX = "UUSH";

export class YouTubeDiscoveryError extends AppError {
  constructor(message: string, status: number, code: string) {
    super(message, status, code);
    this.name = "YouTubeDiscoveryError";
  }
}

type ChannelMetadata = {
  title: string;
  logoUrl: string;
};

type YouTubeChannelPresentation = {
  title: string;
  logoUrl: string;
};

function isYouTubeHostname(hostname: string): boolean {
  return YOUTUBE_HOSTS.has(hostname.toLowerCase());
}

export function buildYouTubeFeedUrl(channelId: string): string {
  return buildYouTubeLongFormFeedUrl(channelId);
}

export function buildYouTubeChannelFeedUrl(channelId: string): string {
  return `${YOUTUBE_CHANNEL_FEED_URL}${channelId}`;
}

export function buildYouTubeLongFormPlaylistId(channelId: string): string {
  return `${YOUTUBE_LONG_FORM_PLAYLIST_PREFIX}${channelId.slice(2)}`;
}

export function buildYouTubeShortsPlaylistId(channelId: string): string {
  return `${YOUTUBE_SHORTS_PLAYLIST_PREFIX}${channelId.slice(2)}`;
}

export function buildYouTubeLongFormFeedUrl(channelId: string): string {
  return `${YOUTUBE_PLAYLIST_FEED_URL}${buildYouTubeLongFormPlaylistId(channelId)}`;
}

export function buildYouTubeShortsFeedUrl(channelId: string): string {
  return `${YOUTUBE_PLAYLIST_FEED_URL}${buildYouTubeShortsPlaylistId(channelId)}`;
}

export function extractChannelIdFromYouTubeFeedUrl(feedUrl: string): string | null {
  try {
    const parsed = new URL(feedUrl);
    const channelId = parsed.searchParams.get("channel_id");
    if (channelId && YOUTUBE_CHANNEL_ID_REGEX.test(channelId)) {
      return channelId;
    }

    const playlistId = parsed.searchParams.get("playlist_id");
    if (
      playlistId &&
      (playlistId.startsWith(YOUTUBE_LONG_FORM_PLAYLIST_PREFIX) ||
        playlistId.startsWith(YOUTUBE_SHORTS_PLAYLIST_PREFIX))
    ) {
      const derivedChannelId = `UC${playlistId.slice(4)}`;
      return YOUTUBE_CHANNEL_ID_REGEX.test(derivedChannelId) ? derivedChannelId : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function isYouTubeLongFormFeedUrl(feedUrl: string): boolean {
  try {
    const parsed = new URL(feedUrl);
    const playlistId = parsed.searchParams.get("playlist_id");
    return Boolean(playlistId?.startsWith(YOUTUBE_LONG_FORM_PLAYLIST_PREFIX));
  } catch {
    return false;
  }
}

export function buildYouTubeChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes("/shorts/")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      const shortsIndex = parts.indexOf("shorts");
      return shortsIndex >= 0 ? parts[shortsIndex + 1] || null : null;
    }
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1) || null;
    }
    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
}

export async function isYouTubeShort(videoUrl: string): Promise<boolean> {
  if (videoUrl.includes("/shorts/")) {
    return true;
  }

  const videoId = extractYouTubeVideoId(videoUrl);
  if (!videoId) {
    return false;
  }

  const cached = SHORTS_RESULT_CACHE.get(videoId);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const response = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });

    const isShort = response.ok;
    SHORTS_RESULT_CACHE.set(videoId, isShort);
    return isShort;
  } catch (err) {
    console.warn("[youtube] Failed to detect Shorts video:", videoId, err);
    return false;
  }
}

function normalizeInputUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new YouTubeDiscoveryError("请输入 YouTube 频道链接", 400, "INVALID_INPUT");
  }

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new YouTubeDiscoveryError("请输入有效的 YouTube URL", 400, "INVALID_URL");
  }

  if (!isYouTubeHostname(parsed.hostname)) {
    throw new YouTubeDiscoveryError("请输入有效的 YouTube URL", 400, "INVALID_YOUTUBE_HOST");
  }

  return parsed;
}

/**
 * 从 YouTube URL 探测频道信息，返回频道预览数据
 */
export async function discoverYouTubeChannel(url: string): Promise<DiscoveredYouTubeChannel> {
  const parsed = normalizeInputUrl(url);
  const targetUrl = parsed.href;

  // 提取 channelId
  const channelId = await extractChannelId(targetUrl);
  if (!channelId) {
    throw new YouTubeDiscoveryError("无法从该 URL 提取 YouTube 频道信息", 422, "CHANNEL_ID_NOT_FOUND");
  }

  const channelUrl = buildYouTubeChannelUrl(channelId);
  const feedUrl = buildYouTubeFeedUrl(channelId);
  const fallbackFeedUrl = buildYouTubeChannelFeedUrl(channelId);

  const channelMetadata = await fetchChannelMetadata(channelUrl);

  // 解析 RSS feed 获取频道名称和最近视频
  let feed;
  let usedFallbackFeed = false;
  try {
    feed = await rssParser.parseURL(feedUrl);
  } catch {
    try {
      feed = await rssParser.parseURL(fallbackFeedUrl);
      usedFallbackFeed = true;
    } catch {
      throw new YouTubeDiscoveryError(
        "无法读取该频道订阅源，请稍后重试",
        502,
        "YOUTUBE_FEED_UNAVAILABLE",
      );
    }
  }

  const title =
    channelMetadata.title ||
    feed.items?.[0]?.author ||
    feed.items?.[0]?.creator ||
    feed.title ||
    "未知频道";
  const recentVideos = [];
  for (const item of feed.items || []) {
    const itemUrl = item.link || "";
    if (!itemUrl) continue;
    if (usedFallbackFeed && await isYouTubeShort(itemUrl)) {
      continue;
    }

    const videoId = extractYouTubeVideoId(itemUrl);
    recentVideos.push({
      title: item.title || "无标题",
      url: itemUrl,
      thumbnailUrl: videoId
        ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        : "",
      publishedAt: item.isoDate || item.pubDate || "",
    });

    if (recentVideos.length >= 5) {
      break;
    }
  }

  return {
    channelId,
    feedUrl,
    title,
    channelUrl,
    logoUrl: channelMetadata.logoUrl,
    recentVideos,
  };
}

/**
 * 从各种 YouTube URL 格式中提取 channelId
 */
async function extractChannelId(url: string): Promise<string | null> {
  const parsed = new URL(url);
  const pathname = parsed.pathname;

  // youtube.com/channel/UCxxxxxx → 直接提取
  const channelMatch = pathname.match(/\/channel\/(UC[\w-]{22})/);
  if (channelMatch) {
    return channelMatch[1];
  }

  // youtube.com/@handle, /c/ChannelName, /watch?v=VIDEO_ID → 抓取页面 HTML
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      if (response.status >= 500) {
        throw new YouTubeDiscoveryError(
          "YouTube 服务暂时不可用，请稍后重试",
          502,
          "YOUTUBE_UPSTREAM_ERROR",
        );
      }
      return null;
    }

    const html = await response.text();

    // 策略 1: <meta itemprop="channelId" content="UCxxx">
    const metaMatch = html.match(
      /<meta\s+itemprop=["']channelId["']\s+content=["'](UC[\w-]+)["']/
    );
    if (metaMatch && YOUTUBE_CHANNEL_ID_REGEX.test(metaMatch[1])) return metaMatch[1];

    // 策略 2: <meta property="og:url"> 中的 /channel/UC
    const ogUrlMatch = html.match(
      /<meta\s+property=["']og:url["']\s+content=["'][^"']*\/channel\/(UC[\w-]+)["']/
    );
    if (ogUrlMatch && YOUTUBE_CHANNEL_ID_REGEX.test(ogUrlMatch[1])) return ogUrlMatch[1];

    // 策略 3: browseId":"UCxxx" 正则兜底
    const browseIdMatch = html.match(/browseId":"(UC[\w-]+)"/);
    if (browseIdMatch && YOUTUBE_CHANNEL_ID_REGEX.test(browseIdMatch[1])) return browseIdMatch[1];
  } catch (err) {
    if (err instanceof YouTubeDiscoveryError) {
      throw err;
    }
    console.warn(`[youtube] 抓取页面失败:`, err);
    throw new YouTubeDiscoveryError(
      "无法访问 YouTube 页面，请稍后重试",
      502,
      "YOUTUBE_PAGE_FETCH_FAILED",
    );
  }

  return null;
}

/**
 * 从频道页面获取高清头像
 */
async function fetchChannelMetadata(channelUrl: string): Promise<ChannelMetadata> {
  try {
    const response = await fetch(channelUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { title: "", logoUrl: "" };
    }

    const html = await response.text();
    const ogTitleMatch = html.match(
      /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/
    );
    const ogImageMatch = html.match(
      /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/
    );
    const rawTitle = ogTitleMatch?.[1]?.trim() || "";
    const title = rawTitle.replace(/\s*-\s*YouTube\s*$/i, "").trim();
    const logoUrl = ogImageMatch?.[1] || "";
    return { title, logoUrl };
  } catch (err) {
    console.warn(`[youtube] 获取频道元信息失败:`, err);
  }
  return { title: "", logoUrl: "" };
}

export async function resolveYouTubeChannelPresentation(
  channelUrl: string,
  feedUrl: string,
): Promise<YouTubeChannelPresentation> {
  const channelMetadata = await fetchChannelMetadata(channelUrl);

  try {
    const fallbackFeedUrl = buildYouTubeChannelFeedUrl(extractChannelIdFromYouTubeFeedUrl(feedUrl) || "");
    let feed;
    try {
      feed = await rssParser.parseURL(feedUrl);
    } catch {
      feed = fallbackFeedUrl
        ? await rssParser.parseURL(fallbackFeedUrl)
        : null;
    }

    return {
      title:
        channelMetadata.title ||
        feed?.items?.[0]?.author ||
        feed?.items?.[0]?.creator ||
        feed?.title ||
        "未知频道",
      logoUrl: channelMetadata.logoUrl,
    };
  } catch {
    return {
      title: channelMetadata.title || "未知频道",
      logoUrl: channelMetadata.logoUrl,
    };
  }
}
