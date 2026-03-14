import TurndownService from "turndown";
import Bottleneck from "bottleneck";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

const JINA_READER_BASE = "https://r.jina.ai/";
const MIN_CONTENT_LENGTH = 500;
const DEFAULT_JINA_RPM = 20;
const DEFAULT_JINA_CONCURRENCY = 1;

function readPositiveInt(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) return fallback;
  const value = Number.parseInt(rawValue, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const jinaRpm = readPositiveInt(process.env.JINA_RPM, DEFAULT_JINA_RPM);
const jinaConcurrency = readPositiveInt(process.env.JINA_MAX_CONCURRENCY, DEFAULT_JINA_CONCURRENCY);

// Global limiter for all Jina requests across all feeds.
// Retries also go through this limiter, so total traffic stays under plan limits.
const jinaLimiter = new Bottleneck({
  maxConcurrent: jinaConcurrency,
  minTime: Math.ceil(60_000 / jinaRpm),
  reservoir: jinaRpm,
  reservoirRefreshAmount: jinaRpm,
  reservoirRefreshInterval: 60_000,
});

console.log(`[content-extractor] Jina limiter enabled: rpm=${jinaRpm}, concurrency=${jinaConcurrency}`);

async function fetchWithRetry(url: string, options: RequestInit, retries = 2, backoff = 1000): Promise<Response> {
  try {
    const response = await jinaLimiter.schedule(() => fetch(url, options));
    if ([429, 502, 503, 504].includes(response.status) && retries > 0) {
      console.log(`[content-extractor] Server returned ${response.status}, retrying in ${backoff}ms...`);
      await new Promise(r => setTimeout(r, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    return response;
  } catch (err) {
    if (retries > 0) {
      console.log(`[content-extractor] Fetch failed, retrying in ${backoff}ms...`, err);
      await new Promise(r => setTimeout(r, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw err;
  }
}

export async function fetchMarkdown(articleUrl: string): Promise<string | null> {
  try {
    const response = await fetchWithRetry(`${JINA_READER_BASE}${articleUrl}`, {
      headers: {
        Accept: "text/markdown",
        "User-Agent": "DigestDesk/1.0",
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      console.warn(`[content-extractor] Jina Reader returned ${response.status} for ${articleUrl}`);
      return null;
    }

    const markdown = await response.text();

    const contentStart = markdown.indexOf("Markdown Content:");
    const content = contentStart !== -1
      ? markdown.slice(contentStart + "Markdown Content:".length).trim()
      : markdown;

    if (content.length < MIN_CONTENT_LENGTH) {
      console.warn(`[content-extractor] Jina content too short (${content.length} chars) for ${articleUrl}`);
      return null;
    }

    return content;
  } catch (err) {
    console.warn(`[content-extractor] Jina Reader failed for ${articleUrl}:`, err);
    return null;
  }
}

export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  return turndown.turndown(html);
}
