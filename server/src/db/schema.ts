import { pgTable, text, integer, index } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: text("created_at").notNull(),
  lastLoginAt: text("last_login_at").notNull(),
});

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

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    feedId: text("feed_id").notNull().references(() => feeds.id, { onDelete: "cascade" }),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    userIdx: index("idx_subscriptions_user_id").on(table.userId),
    feedIdx: index("idx_subscriptions_feed_id").on(table.feedId),
  }),
);

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
  summaryZh: text("summary_zh"),
  summaryEn: text("summary_en"),
});

export const digests = pgTable("digests", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["daily"] }).notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  generatedAt: text("generated_at").notNull(),
  userId: text("user_id"),
});

export const digestItems = pgTable("digest_items", {
  id: text("id").primaryKey(),
  digestId: text("digest_id").notNull().references(() => digests.id, { onDelete: "cascade" }),
  articleId: text("article_id"),
  feedId: text("feed_id").references(() => feeds.id, { onDelete: "set null" }),
  feedName: text("feed_name").notNull(),
  articleTitle: text("article_title").notNull(),
  author: text("author"),
  url: text("url").notNull(),
  oneLiner: text("one_liner").notNull(),
  keyInsights: text("key_insights").notNull(), // JSON array
  publishedAt: text("published_at").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const userSettings = pgTable(
  "user_settings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => ({
    userIdx: index("idx_user_settings_user_id").on(table.userId),
  }),
);

export const digestJobs = pgTable(
  "digest_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    jobType: text("job_type", { enum: ["daily_digest"] }).notNull(),
    targetDate: text("target_date").notNull(),
    scheduledFor: text("scheduled_for").notNull(),
    status: text("status", {
      enum: ["pending", "running", "succeeded", "failed", "skipped", "cancelled"],
    }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    lockedAt: text("locked_at"),
    lockedBy: text("locked_by"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => ({
    userIdx: index("idx_digest_jobs_user_id").on(table.userId),
    statusScheduledIdx: index("idx_digest_jobs_status_scheduled_for").on(table.status, table.scheduledFor),
    userTargetIdx: index("idx_digest_jobs_user_target_date").on(table.userId, table.targetDate),
  }),
);
