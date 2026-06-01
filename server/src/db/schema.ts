import { pgTable, text, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    clerkId: text("clerk_id").notNull().unique(),
    email: text("email").notNull(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    createdAt: text("created_at").notNull(),
    lastLoginAt: text("last_login_at").notNull(),
  },
  (table) => [index("idx_users_last_login_at").on(table.lastLoginAt)],
);

export const feeds = pgTable("feeds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  logoUrl: text("logo_url"),
  authorName: text("author_name"),
  publicationUrl: text("publication_url").notNull(),
  feedUrl: text("feed_url").notNull().unique(),
  sourceType: text("source_type", { enum: ["substack", "rss", "youtube", "podcast"] }).notNull().default("substack"),
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

export const articleSummaries = pgTable(
  "article_summaries",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    summaryJson: text("summary_json").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    generationAttempt: integer("generation_attempt"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    articleLanguageUnique: uniqueIndex("idx_article_summaries_article_language_unique").on(table.articleId, table.language),
    articleIdx: index("idx_article_summaries_article_id").on(table.articleId),
    languageIdx: index("idx_article_summaries_language").on(table.language),
  }),
);

export const digests = pgTable("digests", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["daily"] }).notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  generatedAt: text("generated_at").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
});

export const digestItems = pgTable("digest_items", {
  id: text("id").primaryKey(),
  digestId: text("digest_id").notNull().references(() => digests.id, { onDelete: "cascade" }),
  articleId: text("article_id"),
  feedId: text("feed_id").references(() => feeds.id, { onDelete: "set null" }),
  sourceType: text("source_type", { enum: ["substack", "rss", "youtube", "podcast"] }).notNull().default("substack"),
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

export const userEntitlements = pgTable("user_entitlements", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  accountPlan: text("account_plan", { enum: ["free", "test", "admin"] }).notNull().default("free"),
  subscriptionLimitOverride: integer("subscription_limit_override"),
  accessStatus: text("access_status", { enum: ["active", "revoked"] }).notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by"),
});

export const userInvites = pgTable(
  "user_invites",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    accountPlan: text("account_plan", { enum: ["free", "test", "admin"] }).notNull().default("test"),
    subscriptionLimitOverride: integer("subscription_limit_override"),
    status: text("status", { enum: ["invited", "claimed", "revoked"] }).notNull().default("invited"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
    claimedUserId: text("claimed_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    emailIdx: index("idx_user_invites_email").on(table.email),
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

export const articleSummaryJobs = pgTable(
  "article_summary_jobs",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    status: text("status", {
      enum: ["pending", "running", "succeeded", "failed", "skipped", "cancelled"],
    }).notNull(),
    scheduledFor: text("scheduled_for").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    lockedAt: text("locked_at"),
    lockedBy: text("locked_by"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => ({
    articleLanguageUnique: uniqueIndex("idx_article_summary_jobs_article_language_unique").on(table.articleId, table.language),
    statusScheduledIdx: index("idx_article_summary_jobs_status_scheduled_for").on(table.status, table.scheduledFor),
    articleIdx: index("idx_article_summary_jobs_article_id").on(table.articleId),
  }),
);
