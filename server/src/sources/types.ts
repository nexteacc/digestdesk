export type SourceType = "substack" | "rss" | "youtube";

export interface FeedDraft {
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  authorName?: string | null;
  publicationUrl: string;
  feedUrl: string;
  sourceType: SourceType;
}

export interface SyncItemContent {
  contentMarkdown: string | null;
  coverImageUrl: string | null;
}

export interface SourceAdapter {
  readonly sourceType: SourceType;
  discover(rawUrl: string): Promise<unknown>;
  createFeedDraft(input: Record<string, unknown>): FeedDraft | Promise<FeedDraft>;
  extractSyncItemContent(
    item: Record<string, unknown>,
    articleUrl: string,
  ): Promise<SyncItemContent>;
}
