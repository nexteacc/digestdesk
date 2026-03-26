import type { GoogleYouTubeSubscription } from "../../../shared/types.js";
import { buildYouTubeChannelUrl, buildYouTubeFeedUrl } from "./youtube-discovery.js";

const YOUTUBE_SUBSCRIPTIONS_ENDPOINT = "https://www.googleapis.com/youtube/v3/subscriptions";
const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

type GoogleYouTubeSubscriptionsResponse = {
  nextPageToken?: string;
  items?: Array<{
    snippet?: {
      title?: string;
      description?: string;
      resourceId?: {
        channelId?: string;
      };
      thumbnails?: {
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
    };
  }>;
};

export function hasYouTubeReadonlyScope(scopes: string[] | undefined) {
  return (scopes || []).includes(YOUTUBE_READONLY_SCOPE);
}

export async function fetchGoogleYouTubeSubscriptions(accessToken: string) {
  const items: GoogleYouTubeSubscription[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(YOUTUBE_SUBSCRIPTIONS_ENDPOINT);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("mine", "true");
    url.searchParams.set("maxResults", "50");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(`YouTube API request failed (${response.status}): ${message.slice(0, 200)}`);
    }

    const data = (await response.json()) as GoogleYouTubeSubscriptionsResponse;
    for (const item of data.items || []) {
      const channelId = item.snippet?.resourceId?.channelId?.trim();
      const title = item.snippet?.title?.trim();
      if (!channelId || !title) {
        continue;
      }

      items.push({
        channelId,
        title,
        description: item.snippet?.description?.trim() || undefined,
        logoUrl:
          item.snippet?.thumbnails?.high?.url ||
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          undefined,
        channelUrl: buildYouTubeChannelUrl(channelId),
        feedUrl: buildYouTubeFeedUrl(channelId),
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return items;
}
