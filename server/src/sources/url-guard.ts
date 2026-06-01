import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "./app-error.js";

/**
 * SSRF outbound guard.
 *
 * The app fetches user-supplied URLs (feed discovery, feed sync). Once sign-up
 * is open, any logged-in user can submit a URL, so we must refuse to fetch
 * addresses that point at the server's own network: loopback, private ranges,
 * and the link-local block (which includes the cloud metadata endpoint
 * 169.254.169.254).
 *
 * Limitation: we validate the URL's host before the fetch. This blocks the
 * common case (a hostname/IP that resolves to a private address) but does NOT
 * follow HTTP redirects or re-check after DNS at connect time, so it is not a
 * hard defense against DNS-rebinding. That is an acceptable trade-off for the
 * current single-process deployment; revisit if we add a fetch proxy.
 */

const BLOCKED_HOSTNAMES = new Set(["localhost"]);

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true; // malformed → treat as blocked
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function parseIpv6Words(ip: string): number[] | null {
  const addr = ip.toLowerCase().split("%")[0]; // strip zone id
  const halves = addr.split("::");
  if (halves.length > 2) return null;

  const parseHalf = (half: string): number[] | null => {
    if (!half) return [];
    const words: number[] = [];
    for (const part of half.split(":")) {
      if (part.includes(".")) {
        const ipv4 = part.split(".").map(Number);
        if (ipv4.length !== 4 || ipv4.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
          return null;
        }
        words.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      words.push(Number.parseInt(part, 16));
    }
    return words;
  };

  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return null;

  if (halves.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

function isBlockedIpv6(ip: string): boolean {
  const words = parseIpv6Words(ip);
  if (!words) return true;

  const [first] = words;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] <= 1) return true; // unspecified / loopback
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  const embeddedIpv4Prefix = words.slice(0, 5).every((word) => word === 0) && (words[5] === 0 || words[5] === 0xffff);
  if (embeddedIpv4Prefix) {
    const ipv4 = `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
    return isBlockedIpv4(ipv4);
  }
  return false;
}

function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // not a valid IP → block
}

function blocked(): never {
  throw new AppError(
    "This URL is not allowed.",
    400,
    "URL_NOT_ALLOWED",
    "该网址不被允许（可能指向内部地址）",
  );
}

/**
 * Validates that `rawUrl` is an http(s) URL whose host does not resolve to a
 * private / loopback / link-local address. Throws an AppError (400, bilingual)
 * otherwise. Returns the parsed URL on success.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("Invalid URL.", 400, "INVALID_URL", "网址格式无效");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    blocked();
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    blocked();
  }

  // Host is already an IP literal → check directly, no DNS needed.
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) blocked();
    return url;
  }

  // Hostname → resolve and reject if ANY resolved address is private.
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new AppError("Could not resolve host.", 400, "DNS_RESOLUTION_FAILED", "无法解析该域名");
  }

  if (addresses.length === 0) blocked();
  for (const { address } of addresses) {
    if (isBlockedIp(address)) blocked();
  }

  return url;
}
