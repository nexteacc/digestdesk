import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGoogleYouTubeSubscriptions, GoogleYouTubeAuthorizationError } from "./google-youtube.js";

afterEach(() => vi.unstubAllGlobals());

describe("Google YouTube subscription access", () => {
  it("requires fresh authorization for expired access", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(fetchGoogleYouTubeSubscriptions("test-token")).rejects.toBeInstanceOf(GoogleYouTubeAuthorizationError);
  });

  it("requires authorization for missing permissions but not quota failures", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { errors: [{ reason: "insufficientPermissions" }] } }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchGoogleYouTubeSubscriptions("test-token")).rejects.toBeInstanceOf(GoogleYouTubeAuthorizationError);
    await expect(fetchGoogleYouTubeSubscriptions("test-token")).rejects.not.toBeInstanceOf(GoogleYouTubeAuthorizationError);
  });

  it("reads all pages using the current user's bearer token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ nextPageToken: "page-two", items: [{ snippet: { title: "First", resourceId: { channelId: "UCfirst" } } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ snippet: { title: "Second", resourceId: { channelId: "UCsecond" } } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchGoogleYouTubeSubscriptions("test-token");
    expect(result.map((item) => item.channelId)).toEqual(["UCfirst", "UCsecond"]);
    expect(fetchMock.mock.calls[0][0].searchParams.get("mine")).toBe("true");
    expect(fetchMock.mock.calls[1][0].searchParams.get("pageToken")).toBe("page-two");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-token");
  });
});
