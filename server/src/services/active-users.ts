/**
 * Active-user window helper.
 *
 * Once sign-up is open, anyone can register and then never return. We must not
 * keep spending AI budget generating daily digests (or background-syncing feeds)
 * for those dormant accounts.
 *
 * A user counts as "active" if they logged in within the configured window.
 * `users.last_login_at` is refreshed on every `/api/auth/me` call, so for a web
 * app where users log in to read their digest it is a reliable activity signal.
 * A returning user is picked up again on their next login.
 *
 * This module intentionally has no DB/service imports so that both
 * `digest-jobs.ts` and `rss.ts` can use it without creating an import cycle.
 */

const DEFAULT_ACTIVE_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function getActiveUserWindowDays(): number {
  const raw = Number(process.env.DIGEST_ACTIVE_USER_WINDOW_DAYS ?? DEFAULT_ACTIVE_WINDOW_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_ACTIVE_WINDOW_DAYS;
}

/**
 * Returns the ISO cutoff timestamp: users whose `last_login_at` is >= this value
 * are considered active. `last_login_at` is stored as an ISO 8601 string, so a
 * lexical string comparison (`gte`) matches chronological order.
 */
export function getActiveUserSinceIso(now: Date = new Date()): string {
  return new Date(now.getTime() - getActiveUserWindowDays() * MS_PER_DAY).toISOString();
}
