// 前后端共享的类型定义

export type Feed = {
  id: string;
  title: string;
  description?: string;
  logoUrl?: string;
  authorName?: string;
  url: string;
  feedUrl: string;
  sourceType: "substack" | "rss" | "youtube";
  lastFetchedAt?: string; // ISO
  createdAt: string; // ISO
};

export type DigestItem = {
  id: string;
  feedTitle: string;
  title: string;
  author?: string;
  url: string;
  oneLiner: string;
  keyInsights: string[];
  publishedAt: string; // ISO
};

export type Digest = {
  id: string;
  type: "daily";
  date: string; // YYYY-MM-DD
  generatedAt: string; // ISO
  items: DigestItem[];
};

export type SubstackSearchResult = {
  name: string;
  logoUrl: string;
  description: string;
  url: string;
  authorName: string;
};

export type SubstackInfo = {
  name: string;
  description: string;
  logoUrl: string;
  authorName: string;
  feedUrl: string;
  recentPosts: Array<{
    title: string;
    url: string;
    publishedAt: string;
    author?: string;
  }>;
};

// GET /api/digests 列表接口返回（不含 items）
export type DigestListItem = {
  id: string;
  type: "daily";
  date: string;
  generatedAt: string;
};

// 后端专用：文章（前端不直接使用）
export type Article = {
  id: string;
  feedId: string;
  title: string;
  author?: string;
  url: string;
  guid?: string;
  publishedAt: string; // ISO
  contentText?: string;
  coverImageUrl?: string;
  fetchedAt: string; // ISO
};

export type DiscoveredFeed = {
  feedUrl: string;
  title: string;
  description: string;
  logoUrl: string;
  authorName: string;
  siteUrl: string;
};

export type DiscoveredYouTubeChannel = {
  channelId: string;
  feedUrl: string;
  title: string;
  logoUrl?: string;
  channelUrl: string;
  recentVideos: Array<{
    title: string;
    url: string;
    thumbnailUrl: string;
    publishedAt: string;
  }>;
};

export type Settings = {
  digestTime: string;
  timezone: string;
};
