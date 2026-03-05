import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
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
      created_at TEXT NOT NULL,
      last_fetched_at TEXT
    );
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_digests_type_date ON digests(type, date);
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

  console.log("Database initialized (PostgreSQL).");
}

export function getDb() {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}
