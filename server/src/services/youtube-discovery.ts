import RssParser from "rss-parser";
import type { DiscoveredYouTubeChannel } from "../../../shared/types.js";
import { AppError } from "../sources/app-error.js";
import { safeParseRssUrl } from "../sources/safe-fetch.js";

const rssParser = new RssParser({
  timeout: 10000,
  headers: {
    "User-Agent": "DigestDesk/1.0 (YouTube Discovery)",
  },
});
const YOUTUBE_DISCOVERY_HEADERS = { "User-Agent": "DigestDesk/1.0 (YouTube Discovery)" };

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
  constructor(message: string, status: number, code: string, messageZh?: string) {
    super(message, status, code, messageZh);
    this.name = "YouTubeDiscoveryError";
  }
}

type ChannelMetadata = {
  title: string;
  logoUrl: string;
};

export type YouTubeFeedItem = {
  title: string;
  link: string;
  guid: string;
  creator?: string;
  author?: string;
  isoDate: string;
  pubDate: string;
  contentSnippet: string;
  content: string;
};

type YouTubeDataApiChannel = {
  title: string;
  logoUrl: string;
  uploadsPlaylistId: string;
};

type YouTubeDataApiChannelResponse = {
  error?: {
    message?: string;
    status?: string;
  };
  items?: Array<{
    snippet?: {
      title?: string;
      thumbnails?: {
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
    };
    contentDetails?: {
      relatedPlaylists?: {
        uploads?: string;
      };
    };
  }>;
};

type YouTubeDataApiPlaylistItemsResponse = {
  error?: {
    message?: string;
    status?: string;
  };
  items?: Array<{
    snippet?: {
      title?: string;
      description?: string;
      publishedAt?: string;
      thumbnails?: {
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
      resourceId?: {
        videoId?: string;
      };
    };
    contentDetails?: {
      videoId?: string;
      videoPublishedAt?: string;
    };
  }>;
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

function getYouTubeApiKey(): string | null {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  return key || null;
}

function pickThumbnailUrl(thumbnails: {
  high?: { url?: string };
  medium?: { url?: string };
  default?: { url?: string };
} | undefined): string {
  return thumbnails?.high?.url || thumbnails?.medium?.url || thumbnails?.default?.url || "";
}

async function fetchYouTubeDataApi<T>(
  path: "channels" | "playlistItems",
  params: Record<string, string>,
): Promise<T | null> {
  const key = getYouTubeApiKey();
  if (!key) {
    return null;
  }

  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  url.searchParams.set("key", key);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });

  const data = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string; status?: string };
  };

  if (!response.ok || data.error) {
    console.warn(
      `[youtube] YouTube Data API ${path} failed status=${response.status} reason=${data.error?.status || "unknown"} message=${data.error?.message || ""}`,
    );
    throw new YouTubeDiscoveryError(
      "YouTube Data API fallback failed. Try again later.",
      502,
      "YOUTUBE_DATA_API_FAILED",
      "YouTube Data API 备用读取失败，请稍后重试",
    );
  }

  return data;
}

async function fetchYouTubeDataApiChannel(channelId: string): Promise<YouTubeDataApiChannel | null> {
  const data = await fetchYouTubeDataApi<YouTubeDataApiChannelResponse>("channels", {
    part: "snippet,contentDetails",
    id: channelId,
  });
  if (!data) {
    return null;
  }

  const item = data.items?.[0];
  const uploadsPlaylistId = item?.contentDetails?.relatedPlaylists?.uploads || "";
  if (!item || !uploadsPlaylistId) {
    return null;
  }

  return {
    title: item.snippet?.title?.trim() || "",
    logoUrl: pickThumbnailUrl(item.snippet?.thumbnails),
    uploadsPlaylistId,
  };
}

export async function fetchYouTubeDataApiFeedItems(
  channelId: string,
  maxResults = 15,
): Promise<YouTubeFeedItem[] | null> {
  const channel = await fetchYouTubeDataApiChannel(channelId);
  if (!channel?.uploadsPlaylistId) {
    return null;
  }

  return fetchYouTubeDataApiPlaylistItems(channel.uploadsPlaylistId, maxResults);
}

async function fetchYouTubeDataApiPlaylistItems(
  uploadsPlaylistId: string,
  maxResults: number,
): Promise<YouTubeFeedItem[] | null> {
  const data = await fetchYouTubeDataApi<YouTubeDataApiPlaylistItemsResponse>("playlistItems", {
    part: "snippet,contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: String(maxResults),
  });
  if (!data) {
    return null;
  }

  return (data.items || [])
    .map((item): YouTubeFeedItem | null => {
      const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || "";
      if (!videoId) return null;

      const publishedAt =
        item.contentDetails?.videoPublishedAt ||
        item.snippet?.publishedAt ||
        new Date().toISOString();
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const description = item.snippet?.description || "";
      return {
        title: item.snippet?.title || "Untitled",
        link: url,
        guid: videoId,
        creator: "",
        author: "",
        isoDate: publishedAt,
        pubDate: publishedAt,
        contentSnippet: description,
        content: description,
      };
    })
    .filter((item): item is YouTubeFeedItem => Boolean(item));
}

async function fetchYouTubeDataApiDiscovery(
  channelId: string,
  maxResults = 5,
): Promise<{
  metadata: ChannelMetadata;
  recentVideos: DiscoveredYouTubeChannel["recentVideos"];
} | null> {
  const channel = await fetchYouTubeDataApiChannel(channelId);
  if (!channel) {
    return null;
  }

  const feedItems = await fetchYouTubeDataApiPlaylistItems(channel.uploadsPlaylistId, maxResults);
  return {
    metadata: {
      title: channel.title,
      logoUrl: channel.logoUrl,
    },
    recentVideos: (feedItems || []).map((item) => {
      const videoId = extractYouTubeVideoId(item.link);
      return {
        title: item.title,
        url: item.link,
        thumbnailUrl: videoId
          ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
          : "",
        publishedAt: item.isoDate,
      };
    }),
  };
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
    throw new YouTubeDiscoveryError("Enter a YouTube channel URL.", 400, "INVALID_INPUT", "请输入 YouTube 频道链接");
  }

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new YouTubeDiscoveryError("Enter a valid YouTube URL.", 400, "INVALID_URL", "请输入有效的 YouTube URL");
  }

  if (!isYouTubeHostname(parsed.hostname)) {
    throw new YouTubeDiscoveryError("Enter a valid YouTube URL.", 400, "INVALID_YOUTUBE_HOST", "请输入有效的 YouTube URL");
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
    throw new YouTubeDiscoveryError("Could not identify channel from this URL.", 422, "CHANNEL_ID_NOT_FOUND", "无法从该 URL 提取 YouTube 频道信息");
  }

  const channelUrl = buildYouTubeChannelUrl(channelId);
  const feedUrl = buildYouTubeFeedUrl(channelId);
  const fallbackFeedUrl = buildYouTubeChannelFeedUrl(channelId);

  const channelMetadata = await fetchChannelMetadata(channelUrl);

  // 解析 RSS feed 获取频道名称和最近视频
  let feed;
  let usedFallbackFeed = false;
  let dataApiFallback: Awaited<ReturnType<typeof fetchYouTubeDataApiDiscovery>> = null;
  try {
    feed = await safeParseRssUrl(rssParser, feedUrl, { headers: YOUTUBE_DISCOVERY_HEADERS, timeoutMs: 10000 });
  } catch {
    try {
      feed = await safeParseRssUrl(rssParser, fallbackFeedUrl, { headers: YOUTUBE_DISCOVERY_HEADERS, timeoutMs: 10000 });
      usedFallbackFeed = true;
    } catch {
      dataApiFallback = await fetchYouTubeDataApiDiscovery(channelId, 5);
      if (!dataApiFallback) {
        throw new YouTubeDiscoveryError(
          "Channel feed unavailable. Try again later.",
          502,
          "YOUTUBE_FEED_UNAVAILABLE",
          "无法读取该频道订阅源，请稍后重试",
        );
      }
    }
  }

  const title =
    channelMetadata.title ||
    dataApiFallback?.metadata.title ||
    feed?.items?.[0]?.author ||
    feed?.items?.[0]?.creator ||
    feed?.title ||
    "Unknown channel";
  const recentVideos = [...(dataApiFallback?.recentVideos || [])];
  for (const item of feed?.items || []) {
    const itemUrl = item.link || "";
    if (!itemUrl) continue;
    if (usedFallbackFeed && await isYouTubeShort(itemUrl)) {
      continue;
    }

    const videoId = extractYouTubeVideoId(itemUrl);
    recentVideos.push({
      title: item.title || "Untitled",
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
    logoUrl: channelMetadata.logoUrl || dataApiFallback?.metadata.logoUrl,
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
          "YouTube is temporarily unavailable. Try again later.",
          502,
          "YOUTUBE_UPSTREAM_ERROR",
          "YouTube 服务暂时不可用，请稍后重试",
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
      "Could not reach YouTube. Try again later.",
      502,
      "YOUTUBE_PAGE_FETCH_FAILED",
      "无法访问 YouTube 页面，请稍后重试",
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
      feed = await safeParseRssUrl(rssParser, feedUrl, { headers: YOUTUBE_DISCOVERY_HEADERS, timeoutMs: 10000 });
    } catch {
      feed = fallbackFeedUrl
        ? await safeParseRssUrl(rssParser, fallbackFeedUrl, { headers: YOUTUBE_DISCOVERY_HEADERS, timeoutMs: 10000 })
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
