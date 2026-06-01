import { AppError } from "./app-error.js";
import { assertPublicUrl } from "./url-guard.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface SafeFetchTextOptions {
  headers?: HeadersInit;
  maxRedirects?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  requireOk?: boolean;
}

export interface SafeFetchTextResult {
  text: string;
  url: string;
  status: number;
  ok: boolean;
}

function invalidRedirect(): never {
  throw new AppError("Invalid redirect.", 400, "INVALID_REDIRECT", "重定向地址无效");
}

async function readTextWithLimit(response: Response, maxResponseBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    throw new AppError("Response is too large.", 413, "RESPONSE_TOO_LARGE", "响应内容过大");
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > maxResponseBytes) {
      await reader.cancel();
      throw new AppError("Response is too large.", 413, "RESPONSE_TOO_LARGE", "响应内容过大");
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

/**
 * Fetch text from a public HTTP(S) URL without trusting automatic redirects.
 * Every redirect target is resolved and validated before the next request.
 *
 * This blocks redirect-based SSRF. It does not eliminate the DNS-rebinding gap
 * between validation and connection; use an outbound proxy if that becomes a
 * required hard boundary.
 */
export async function safeFetchText(
  rawUrl: string,
  options: SafeFetchTextOptions = {},
): Promise<SafeFetchTextResult> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  let currentUrl = rawUrl;
  let redirectCount = 0;

  while (true) {
    await assertPublicUrl(currentUrl);
    const response = await fetch(currentUrl, {
      headers: options.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      await response.body?.cancel();
      if (redirectCount >= maxRedirects) {
        throw new AppError("Too many redirects.", 400, "TOO_MANY_REDIRECTS", "重定向次数过多");
      }
      const location = response.headers.get("location");
      if (!location) invalidRedirect();
      try {
        currentUrl = new URL(location, currentUrl).href;
      } catch {
        invalidRedirect();
      }
      redirectCount += 1;
      continue;
    }

    if ((options.requireOk ?? true) && !response.ok) {
      throw new Error(`HTTP request failed with status ${response.status}`);
    }

    return {
      text: await readTextWithLimit(response, maxResponseBytes),
      url: currentUrl,
      status: response.status,
      ok: response.ok,
    };
  }
}

export async function safeParseRssUrl<T>(
  parser: { parseString(xml: string): Promise<T> },
  rawUrl: string,
  options: SafeFetchTextOptions = {},
): Promise<T> {
  const { text } = await safeFetchText(rawUrl, options);
  return parser.parseString(text);
}
