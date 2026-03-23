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
    CREATE INDEX IF NOT EXISTS idx_digest_items_digest_id ON digest_items(digest_id);
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
