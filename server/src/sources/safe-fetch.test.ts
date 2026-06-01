import { afterEach, describe, expect, it, vi } from "vitest";
import { safeFetchText } from "./safe-fetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("safeFetchText", () => {
  it("blocks a redirect from a public URL to a private address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(safeFetchText("http://8.8.8.8/feed")).rejects.toMatchObject({
      code: "URL_NOT_ALLOWED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("validates and follows a relative public redirect manually", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/rss.xml" } }))
      .mockResolvedValueOnce(new Response("<rss />", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(safeFetchText("http://8.8.8.8/feed")).resolves.toMatchObject({
      text: "<rss />",
      url: "http://8.8.8.8/rss.xml",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://8.8.8.8/feed",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://8.8.8.8/rss.xml",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("rejects redirect chains above the configured limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "/next" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(safeFetchText("http://8.8.8.8/feed", { maxRedirects: 1 })).rejects.toMatchObject({
      code: "TOO_MANY_REDIRECTS",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized responses before reading the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("large", { status: 200, headers: { "content-length": "100" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(safeFetchText("http://8.8.8.8/feed", { maxResponseBytes: 10 })).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
  });
});
