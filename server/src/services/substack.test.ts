import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSubstackReads } from "./substack.js";

const publication = { name: "Example", subdomain: "example", custom_domain: "example.org" };
const profile = { profile: { subscriptions: [{ publication }], subscriptionsTruncated: false } };
const jsonPage = (value: unknown) => `<script type="application/json" id="preloads-json">${JSON.stringify(value)}</script>`;

afterEach(() => vi.unstubAllGlobals());

describe("fetchSubstackReads", () => {
  it("reads current profile JSON and preserves custom domains", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(jsonPage(profile)));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchSubstackReads("slowloop")).toEqual([
      { name: "Example", url: "https://example.org", logoUrl: "", description: "", authorName: "" },
    ]);
    expect(fetch.mock.calls[0][0]).toBe("https://substack.com/@slowloop");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retains legacy embedded JSON support", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      `<script>window._preloads = JSON.parse(${JSON.stringify(JSON.stringify(profile))})</script>`,
    )));
    expect(await fetchSubstackReads("legacy")).toHaveLength(1);
  });

  it("does not mistake unrelated links for subscriptions", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('<a href="https://unrelated.substack.com"><h3>Unrelated</h3></a>'))
      .mockResolvedValueOnce(new Response(jsonPage(profile)));
    vi.stubGlobal("fetch", fetch);
    expect((await fetchSubstackReads("reader"))[0].name).toBe("Example");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects truncated lists instead of silently importing a partial list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(jsonPage({
      profile: { ...profile.profile, subscriptionsTruncated: true },
    }))));
    await expect(fetchSubstackReads("reader")).rejects.toThrow("incomplete");
  });

  it("deduplicates subscriptions and ignores malformed entries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(jsonPage({
      profile: { subscriptions: [{ publication }, { publication }, {}, { publication: {} }] },
    }))));
    expect(await fetchSubstackReads("reader")).toHaveLength(1);
  });

  it("reports unrecognized page formats rather than returning page links", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response('<a href="https://example.com"><span>Example</span></a>')));
    await expect(fetchSubstackReads("reader")).rejects.toThrow("page format");
  });
});
