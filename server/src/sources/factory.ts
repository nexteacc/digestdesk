import type { SourceAdapter, SourceType } from "./types.js";
import { SubstackAdapter } from "./adapters/substack-adapter.js";
import { RssAdapter } from "./adapters/rss-adapter.js";
import { YouTubeAdapter } from "./adapters/youtube-adapter.js";

const substackAdapter = new SubstackAdapter();
const rssAdapter = new RssAdapter();
const youtubeAdapter = new YouTubeAdapter();

export function getSubstackAdapter() {
  return substackAdapter;
}

export function getRssAdapter() {
  return rssAdapter;
}

export function getYouTubeAdapter() {
  return youtubeAdapter;
}

export function getSourceAdapter(sourceType: SourceType): SourceAdapter {
  switch (sourceType) {
    case "substack":
      return substackAdapter;
    case "rss":
      return rssAdapter;
    case "youtube":
      return youtubeAdapter;
    default:
      throw new Error(`Unsupported source type: ${sourceType}`);
  }
}
