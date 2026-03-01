import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import * as schema from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../../data/digestdesk.db");

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

export function initDb() {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("cache_size = -20000");
  sqlite.pragma("synchronous = NORMAL");

  db = drizzle(sqlite, { schema });

  sqlite.exec(`
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

    CREATE TABLE IF NOT EXISTS digests (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('daily')),
      date TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );

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
      reading_value TEXT CHECK(reading_value IN ('high', 'medium', 'low')),
      published_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
    CREATE INDEX IF NOT EXISTS idx_digest_items_digest_id ON digest_items(digest_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_digests_type_date ON digests(type, date);
    CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
  `);

  console.log("Database initialized at", DB_PATH);
}

export function getDb() {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

export function getSqlite() {
  if (!sqlite) throw new Error("Database not initialized. Call initDb() first.");
  return sqlite;
}
