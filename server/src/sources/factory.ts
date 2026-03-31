import type { SourceAdapter, SourceType } from "./types.js";
import { SubstackAdapter } from "./adapters/substack-adapter.js";
import { RssAdapter } from "./adapters/rss-adapter.js";
import { YouTubeAdapter } from "./adapters/youtube-adapter.js";
import { PodcastAdapter } from "./adapters/podcast-adapter.js";

const substackAdapter = new SubstackAdapter();
const rssAdapter = new RssAdapter();
const youtubeAdapter = new YouTubeAdapter();
const podcastAdapter = new PodcastAdapter();

export function getSubstackAdapter() {
  return substackAdapter;
}

export function getRssAdapter() {
  return rssAdapter;
}

export function getYouTubeAdapter() {
  return youtubeAdapter;
}

export function getPodcastAdapter() {
  return podcastAdapter;
}

export function getSourceAdapter(sourceType: SourceType): SourceAdapter {
  switch (sourceType) {
    case "substack":
      return substackAdapter;
    case "rss":
      return rssAdapter;
    case "youtube":
      return youtubeAdapter;
    case "podcast":
      return podcastAdapter;
    default:
      throw new Error(`Unsupported source type: ${sourceType}`);
  }
}
