import { describe, it, expect } from "vitest";
import { parseCachedArticleSummary } from "./summarizer.js";

/**
 * Guards the cache-quality contract from the 2026-05-26 incident: a structurally
 * valid but semantically broken summary (e.g. oneLiner === "Google", or text
 * containing hidden/zero-width characters) must NOT be accepted from cache.
 */
describe("parseCachedArticleSummary", () => {
  it("accepts a valid Chinese summary", () => {
    const result = parseCachedArticleSummary(
      {
        oneLiner:
          "本文核心结论是通过反转内容抓取的优先顺序并引入按语言的预摘要缓存机制系统显著降低了外部接口调用次数与整体的摘要生成成本",
        keyInsights: [
          "第一条信息点说明了反转抓取顺序后免费的本地内容会被优先使用从而减少外部抓取",
          "第二条信息点指出预摘要缓存使日报组装阶段几乎不再触发实时的模型调用请求",
          "第三条信息点强调按文章与语言维度缓存摘要能够在多个用户之间复用结果省成本",
        ],
      },
      "zh",
    );
    expect(result).not.toBeNull();
    expect(result?.keyInsights).toHaveLength(3);
  });

  it("rejects a too-short oneLiner (the 'Google' incident)", () => {
    const result = parseCachedArticleSummary(
      { oneLiner: "Google", keyInsights: ["a", "b", "c"] },
      "zh",
    );
    expect(result).toBeNull();
  });

  it("rejects text containing zero-width / hidden characters", () => {
    const result = parseCachedArticleSummary(
      {
        oneLiner:
          "本文核心结论是通过反转抓取顺序​​并引入预摘要缓存机制从而显著降低系统的整体摘要成本",
        keyInsights: [
          "第一条信息点说明了反转抓取顺序后免费的本地内容会被优先使用从而减少外部抓取",
          "第二条信息点指出预摘要缓存使日报组装阶段几乎不再触发实时的模型调用请求",
          "第三条信息点强调按文章与语言维度缓存摘要能够在多个用户之间复用结果省成本",
        ],
      },
      "zh",
    );
    expect(result).toBeNull();
  });

  it("rejects malformed input shapes", () => {
    expect(parseCachedArticleSummary({ foo: "bar" }, "zh")).toBeNull();
    expect(parseCachedArticleSummary(null, "zh")).toBeNull();
  });
});
