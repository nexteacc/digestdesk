export const DEFAULT_BACKGROUND_FEED_FRESHNESS_MS = 4 * 60 * 60 * 1000;

export function isBackgroundFeedSyncEnabled() {
  return process.env.ENABLE_BACKGROUND_FEED_SYNC === "true";
}

export function getBackgroundFeedFreshnessMs() {
  const value = Number(process.env.FEED_SYNC_FRESHNESS_WINDOW_MS);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_BACKGROUND_FEED_FRESHNESS_MS;
}

export function getBackgroundFeedBatchLimit() {
  const value = Number(process.env.FEED_SYNC_BATCH_LIMIT);
  return Number.isSafeInteger(value) && value > 0 ? value : 24;
}

export function getRetryAfterMs(header: string | null, now: number) {
  const value = header?.trim();
  if (!value) return 0;
  if (/^\d+$/.test(value)) {
    const ms = Number(value) * 1000;
    return Number.isSafeInteger(ms) && now + ms <= 8.64e15 ? ms : 0;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}
