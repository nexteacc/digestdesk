import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";

let queryClient: postgres.Sql;
let db: ReturnType<typeof drizzle<typeof schema>>;

export async function initDb() {
  // Support multiple environment variable names for compatibility
  // Zeabur often uses POSTGRES_CONNECTION_STRING or POSTGRES_URI
  const connectionString = 
    process.env.DATABASE_URL || 
    process.env.POSTGRES_CONNECTION_STRING || 
    process.env.POSTGRES_URI;

  if (!connectionString) {
    throw new Error("Database connection string not found. Please set DATABASE_URL, POSTGRES_CONNECTION_STRING, or POSTGRES_URI.");
  }

  queryClient = postgres(connectionString);
  db = drizzle(queryClient, { schema });

  // PostgreSQL schema initialization
  // Note: In production, use Drizzle Kit for migrations.
  // This is a simplified setup for quick start.
  await queryClient`
    CREATE TABLE IF NOT EXISTS feeds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      logo_url TEXT,
      author_name TEXT,
      publication_url TEXT NOT NULL,
      feed_url TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL DEFAULT 'substack',
      created_at TEXT NOT NULL,
      last_fetched_at TEXT
    );
  `;

  // Migration: add source_type column for existing databases
  await queryClient`
    ALTER TABLE feeds ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'substack';
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      author TEXT,
      url TEXT NOT NULL,
      guid TEXT,
      published_at TEXT NOT NULL,
      content_text TEXT,
      cover_image_url TEXT,
      fetched_at TEXT NOT NULL
    );
  `;

  // PG requires explicit unique constraint for ON CONFLICT DO NOTHING on 'url'
  // We create a unique index for it.
  await queryClient`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
  `;
  
  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id);
  `;
  
  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
  `;

  await queryClient`
    ALTER TABLE articles ADD COLUMN IF NOT EXISTS summary_zh TEXT;
  `;

  await queryClient`
    ALTER TABLE articles ADD COLUMN IF NOT EXISTS summary_en TEXT;
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS article_summaries (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      language TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      model TEXT,
      prompt_version TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `;

  await queryClient`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_article_summaries_article_language_unique
    ON article_summaries(article_id, language);
  `;

  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_article_summaries_article_id ON article_summaries(article_id);
  `;

  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_article_summaries_language ON article_summaries(language);
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS digests (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('daily')),
      date TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS digest_items (
      id TEXT PRIMARY KEY,
      digest_id TEXT NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
      article_id TEXT,
      feed_id TEXT REFERENCES feeds(id) ON DELETE SET NULL,
      source_type TEXT NOT NULL DEFAULT 'substack',
      feed_name TEXT NOT NULL,
      article_title TEXT NOT NULL,
      author TEXT,
      url TEXT NOT NULL,
      one_liner TEXT NOT NULL,
      key_insights TEXT NOT NULL,
      published_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `;

  await queryClient`
    ALTER TABLE digest_items ADD COLUMN IF NOT EXISTS feed_id TEXT REFERENCES feeds(id) ON DELETE SET NULL;
  `;

  await queryClient`
    ALTER TABLE digest_items ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'substack';
  `;

  await queryClient`
    UPDATE digest_items AS di
    SET source_type = f.source_type
    FROM feeds AS f
    WHERE di.feed_id = f.id
      AND (di.source_type IS NULL OR di.source_type = 'substack');
  `;

  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_digest_items_digest_id ON digest_items(digest_id);
  `;

  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_digest_items_feed_id ON digest_items(feed_id);
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      clerk_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      name TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    );
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT NOT NULL
    );
  `;

  await queryClient`
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS started_at TEXT;
  `;

  await queryClient`
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ended_at TEXT;
  `;

  await queryClient`
    UPDATE subscriptions
    SET started_at = created_at
    WHERE started_at IS NULL;
  `;

  await queryClient`
    DROP INDEX IF EXISTS idx_subscriptions_user_feed_unique;
  `;

  await queryClient`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_feed_active_unique
    ON subscriptions(user_id, feed_id)
    WHERE ended_at IS NULL;
  `;

  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
  `;

  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_feed_id ON subscriptions(feed_id);
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS user_settings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL
    );
  `;

  await queryClient`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_user_key_unique
    ON user_settings(user_id, key);
  `;

  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS user_entitlements (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      account_plan TEXT NOT NULL DEFAULT 'free' CHECK(account_plan IN ('free', 'test', 'admin')),
      subscription_limit_override INTEGER,
      access_status TEXT NOT NULL DEFAULT 'active' CHECK(access_status IN ('active', 'revoked')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );
  `;

  await queryClient`
    ALTER TABLE user_entitlements ADD COLUMN IF NOT EXISTS subscription_limit_override INTEGER;
  `;

  await queryClient`
    ALTER TABLE user_entitlements ADD COLUMN IF NOT EXISTS access_status TEXT NOT NULL DEFAULT 'active';
  `;

  await queryClient`
    ALTER TABLE user_entitlements ADD COLUMN IF NOT EXISTS updated_by TEXT;
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS user_invites (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      account_plan TEXT NOT NULL DEFAULT 'test' CHECK(account_plan IN ('free', 'test', 'admin')),
      subscription_limit_override INTEGER,
      status TEXT NOT NULL DEFAULT 'invited' CHECK(status IN ('invited', 'claimed', 'revoked')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      claimed_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
    );
  `;

  await queryClient`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_invites_email_unique
    ON user_invites(email);
  `;

  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_user_invites_email ON user_invites(email);
  `;

  await queryClient`
    ALTER TABLE digests ADD COLUMN IF NOT EXISTS user_id TEXT;
  `;

  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_digests_user_id ON digests(user_id);
  `;

  // Legacy single-user index must be removed before multi-user data can coexist.
  await queryClient`
    DROP INDEX IF EXISTS idx_digests_type_date;
  `;

  await queryClient`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_digests_user_type_date_unique
    ON digests(user_id, type, date);
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS digest_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL CHECK(job_type IN ('daily_digest')),
      target_date TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      locked_at TEXT,
      locked_by TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
  `;

  await queryClient`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_digest_jobs_user_type_target_unique
    ON digest_jobs(user_id, job_type, target_date);
  `;

  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_digest_jobs_status_scheduled_for
    ON digest_jobs(status, scheduled_for);
  `;

  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_digest_jobs_user_id
    ON digest_jobs(user_id);
  `;

  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_digest_jobs_user_target_date
    ON digest_jobs(user_id, target_date);
  `;

  console.log("Database initialized (PostgreSQL).");
}

export async function readLegacySettings() {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");

  const tableCheck = await db.execute(sql`
    SELECT to_regclass('public.settings')::text AS table_name
  `);
  const tableName = tableCheck[0]?.table_name;
  if (!tableName) {
    return [] as Array<{ key: string; value: string }>;
  }

  const rows = await db.execute(sql`
    SELECT key, value
    FROM settings
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    key: String(row.key ?? ""),
    value: String(row.value ?? ""),
  }));
}

export function getDb() {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}
