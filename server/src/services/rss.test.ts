import { afterEach, expect, it, vi } from "vitest";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db/index.js", () => ({ getDb }));

import { syncFeed } from "./rss.js";

afterEach(() => vi.unstubAllGlobals());

it("pauses subsequent Substack requests and remembers Retry-After for the throttled feed", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, {
    status: 429, headers: { "Retry-After": "3600" },
  }));
  vi.stubGlobal("fetch", fetch);
  const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const source = { sourceType: "substack", feedUrl: "https://8.8.8.8/feed", nextFetchAt: null };
  const where = vi.fn()
    .mockResolvedValueOnce([{ ...source, id: "first" }])
    .mockResolvedValueOnce([{ ...source, id: "second", feedUrl: "https://1.1.1.1/feed" }]);
  getDb.mockReturnValue({
    select: () => ({ from: () => ({ where }) }),
    update: () => ({ set }),
  });
  const before = Date.now();
  await expect(syncFeed("first")).resolves.toBe(0);
  await expect(syncFeed("second")).resolves.toBe(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(set).toHaveBeenCalledTimes(1);
  const [{ nextFetchAt }] = set.mock.calls[0];
  expect(Date.parse(nextFetchAt)).toBeGreaterThanOrEqual(before + 3_600_000);

  // The stored timestamp also protects a fetch handled by another process.
  where.mockResolvedValueOnce([{ ...source, id: "first", sourceType: "rss", nextFetchAt }]);
  await expect(syncFeed("first")).resolves.toBe(0);
  expect(fetch).toHaveBeenCalledTimes(1);
});
