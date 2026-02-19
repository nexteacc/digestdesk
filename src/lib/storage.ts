/**
 * 归一化 Substack / Newsletter URL
 * 支持格式：
 *   lennysnewsletter.com
 *   https://www.lennysnewsletter.com
 *   lennysnewsletter.substack.com
 *   https://lennysnewsletter.substack.com/
 *   https://lennysnewsletter.com/p/some-post（提取根域名）
 */
export function normalizeSubstackUrl(input: string): {
  url: string;
  feedUrl: string;
} {
  let raw = input.trim();
  if (!raw) throw new Error("请输入有效的链接");

  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("请输入有效的链接");
  }

  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    throw new Error("请输入有效的链接");
  }

  const url = parsed.origin;
  const feedUrl = `${url}/feed`;

  return { url, feedUrl };
}
