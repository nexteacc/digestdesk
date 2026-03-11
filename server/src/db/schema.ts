import { pgTable, text, integer } from "drizzle-orm/pg-core";

export const feeds = pgTable("feeds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  logoUrl: text("logo_url"),
  authorName: text("author_name"),
  publicationUrl: text("publication_url").notNull(),
  feedUrl: text("feed_url").notNull().unique(),
  sourceType: text("source_type", { enum: ["substack", "rss", "youtube"] }).notNull().default("substack"),
  createdAt: text("created_at").notNull(),
  lastFetchedAt: text("last_fetched_at"),
});

export const articles = pgTable("articles", {
  id: text("id").primaryKey(),
  feedId: text("feed_id").notNull().references(() => feeds.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  author: text("author"),
  url: text("url").notNull().unique(),
  guid: text("guid"),
  publishedAt: text("published_at").notNull(),
  contentText: text("content_text"),
  coverImageUrl: text("cover_image_url"),
  fetchedAt: text("fetched_at").notNull(),
});

export const digests = pgTable("digests", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["daily"] }).notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  generatedAt: text("generated_at").notNull(),
});

export const digestItems = pgTable("digest_items", {
  id: text("id").primaryKey(),
  digestId: text("digest_id").notNull().references(() => digests.id, { onDelete: "cascade" }),
  articleId: text("article_id"),
  feedName: text("feed_name").notNull(),
  articleTitle: text("article_title").notNull(),
  author: text("author"),
  url: text("url").notNull(),
  oneLiner: text("one_liner").notNull(),
  keyInsights: text("key_insights").notNull(), // JSON array
  publishedAt: text("published_at").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});
