import { afterEach, describe, expect, it, vi } from "vitest";
import { safeParseRssUrl } from "../sources/safe-fetch.js";
import { parseApplePodcastCountries, searchPodcasts } from "./podcast-discovery.js";

vi.mock("../sources/safe-fetch.js", () => ({
  safeParseRssUrl: vi.fn(async (_parser: unknown, feedUrl: string) => ({
    title: `Verified ${feedUrl}`,
    link: feedUrl.replace(/\/feed\.xml$/, ""),
    description: "Verified podcast description",
    image: { url: `${feedUrl}/cover.png` },
    items: [{ isoDate: "2026-06-04T00:00:00.000Z" }],
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parseApplePodcastCountries", () => {
  it("defaults to the auto multi-region set", () => {
    expect(parseApplePodcastCountries()).toEqual(["us", "cn", "tw", "hk", "sg", "gb", "ca", "au"]);
  });

  it("normalizes custom country lists and ignores invalid tokens", () => {
    expect(parseApplePodcastCountries("US, cn, usa, 1x, TW")).toEqual(["us", "cn", "tw"]);
  });

  it("expands auto/global aliases inside custom lists", () => {
    expect(parseApplePodcastCountries("de,auto,fr")).toEqual(["de", "us", "cn", "tw", "hk", "sg", "gb", "ca"]);
  });
});

describe("searchPodcasts", () => {
  it("searches all configured Apple countries and dedupes by feed URL before verification", async () => {
    vi.stubEnv("PODCAST_APPLE_COUNTRIES", "us,cn");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const country = url.searchParams.get("country");
      const feedUrl =
        country === "us"
          ? "https://podcasts.example.com/shared/feed.xml"
          : "https://podcasts.example.com/shared/feed.xml";

      return new Response(
        JSON.stringify({
          results: [
            {
              collectionName: `Daily Show ${country}`,
              artistName: "DigestDesk",
              artworkUrl600: "https://podcasts.example.com/cover.png",
              feedUrl,
              collectionViewUrl: `https://podcasts.example.com/${country}`,
              releaseDate: "2026-06-04T00:00:00.000Z",
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchPodcasts("multi region test");

    const countries = fetchMock.mock.calls.map((call) => new URL(String(call[0])).searchParams.get("country"));
    expect(countries.sort()).toEqual(["cn", "us"]);
    expect(safeParseRssUrl).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0].feedUrl).toBe("https://podcasts.example.com/shared/feed.xml");
  });
});
