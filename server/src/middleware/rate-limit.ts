import rateLimit from "express-rate-limit";
import type { Request } from "express";

/**
 * Per-user rate limits for the "expensive" endpoints. Once sign-up is open, any
 * logged-in user can hammer these, and each call either fetches an external URL
 * or spends AI budget. These limiters cap abuse without affecting normal use
 * (the thresholds are far above real human usage).
 *
 * Keyed by `req.userId`, so they must be mounted AFTER `requireAuth` +
 * `resolveUser`. Keying by user (not IP) also sidesteps trust-proxy concerns
 * behind the Zeabur load balancer.
 *
 * Thresholds are overridable via env. The default store is in-memory, which is
 * correct for the current single-process web service; switch to a shared store
 * (e.g. Redis) if the web tier is ever scaled to multiple instances.
 */

const RATE_LIMITED_BODY = {
  error: "Too many requests. Please slow down and try again shortly.",
  errorZh: "操作过于频繁，请稍后再试。",
  code: "RATE_LIMITED",
} as const;

function userKey(req: Request): string {
  // Mounted after auth, so userId is always present; the fallback only satisfies
  // the type and should never be hit in practice.
  return req.userId ?? "unauthenticated";
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Discovery + search: hit external sites and third-party search APIs (and the
 * SSRF-guarded fetches). Shared budget across discover/search per user.
 */
export const discoverSearchLimiter = rateLimit({
  windowMs: MINUTE_MS,
  limit: readPositiveIntEnv("RATE_LIMIT_DISCOVER_PER_MIN", 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  handler: (_req, res) => res.status(429).json(RATE_LIMITED_BODY),
});

/**
 * Manual digest generation runs the full sync + pre-summarize + assemble
 * pipeline, i.e. the most AI-expensive user action. Guarded by both a
 * short-burst (per-minute) and an accumulation (per-day) cap.
 */
export const generatePerMinuteLimiter = rateLimit({
  windowMs: MINUTE_MS,
  limit: readPositiveIntEnv("RATE_LIMIT_GENERATE_PER_MIN", 5),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  handler: (_req, res) => res.status(429).json(RATE_LIMITED_BODY),
});

export const generatePerDayLimiter = rateLimit({
  windowMs: DAY_MS,
  limit: readPositiveIntEnv("RATE_LIMIT_GENERATE_PER_DAY", 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  handler: (_req, res) =>
    res.status(429).json({
      error: "Daily generation limit reached. Please try again tomorrow.",
      errorZh: "今日生成次数已达上限，请明天再试。",
      code: "RATE_LIMITED_DAILY",
    }),
});
