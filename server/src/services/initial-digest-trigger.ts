import { getUserTimezone } from "./user-settings.js";
import { getPreviousDateLabel, getTimeZoneDateLabel } from "../utils/timezone.js";
import { executeDailyDigestJob } from "./digest-execution.js";

type PendingInitialDigest = {
  timer: ReturnType<typeof setTimeout>;
  userId: string;
  targetDate: string;
  logContext: string;
  feedIds: Set<string>;
  requestedAt: number;
};

const DEFAULT_DEBOUNCE_MS = 30000;
const pendingInitialDigests = new Map<string, PendingInitialDigest>();

function getDebounceMs() {
  const raw = Number(process.env.INITIAL_DIGEST_DEBOUNCE_MS ?? DEFAULT_DEBOUNCE_MS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_DEBOUNCE_MS;
}

function buildKey(userId: string, targetDate: string) {
  return `${userId}:${targetDate}`;
}

export async function queueInitialDigestForUser(
  userId: string,
  options?: { feedId?: string; logContext?: string },
) {
  const timezone = await getUserTimezone(userId);
  const today = getTimeZoneDateLabel(new Date(), timezone);
  const targetDate = getPreviousDateLabel(today);
  const key = buildKey(userId, targetDate);
  const debounceMs = getDebounceMs();
  const logContext = options?.logContext ?? "initial-digest";
  const feedId = options?.feedId;
  const existing = pendingInitialDigests.get(key);

  if (existing) {
    if (feedId) existing.feedIds.add(feedId);
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => {
      void runQueuedInitialDigest(key);
    }, debounceMs);
    console.log(
      `[${logContext}] Initial digest request coalesced user=${userId} feed=${feedId ?? "none"} date=${targetDate} pendingFeeds=${existing.feedIds.size} debounceMs=${debounceMs}`,
    );
    return;
  }

  const pending: PendingInitialDigest = {
    timer: setTimeout(() => {
      void runQueuedInitialDigest(key);
    }, debounceMs),
    userId,
    targetDate,
    logContext,
    feedIds: new Set(feedId ? [feedId] : []),
    requestedAt: Date.now(),
  };
  pendingInitialDigests.set(key, pending);

  console.log(
    `[${logContext}] Initial digest queued user=${userId} feed=${feedId ?? "none"} date=${targetDate} debounceMs=${debounceMs}`,
  );
}

async function runQueuedInitialDigest(key: string) {
  const pending = pendingInitialDigests.get(key);
  if (!pending) return;
  pendingInitialDigests.delete(key);

  const feedList = Array.from(pending.feedIds).join(",");
  const waitMs = Date.now() - pending.requestedAt;
  console.log(
    `[${pending.logContext}] Initial digest execution requested user=${pending.userId} date=${pending.targetDate} feeds=${pending.feedIds.size}${feedList ? ` feedIds=${feedList}` : ""} waitMs=${waitMs}`,
  );

  try {
    const digestId = await executeDailyDigestJob(pending.userId, pending.targetDate);
    if (!digestId) {
      console.log(
        `[${pending.logContext}] Initial digest result empty user=${pending.userId} date=${pending.targetDate} feeds=${pending.feedIds.size}`,
      );
      return;
    }
    console.log(
      `[${pending.logContext}] Initial digest generated user=${pending.userId} date=${pending.targetDate} digestId=${digestId} feeds=${pending.feedIds.size}`,
    );
  } catch (err) {
    console.error(
      `[${pending.logContext}] Initial sync/digest failed user=${pending.userId} date=${pending.targetDate} feeds=${pending.feedIds.size}:`,
      err,
    );
  }
}
