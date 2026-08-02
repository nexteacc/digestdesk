import { describe, it, expect } from "vitest";
import {
  classifyAiError,
  getSummaryAttemptModelIds,
  parseCachedArticleSummary,
  transformProviderRequestBody,
} from "./summarizer.js";

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

describe("getSummaryAttemptModelIds", () => {
  it("retries once with the primary model when no retry model is configured", () => {
    expect(getSummaryAttemptModelIds("gemini-3.6-flash", undefined)).toEqual([
      "gemini-3.6-flash",
      "gemini-3.6-flash",
    ]);
  });

  it("retries once when the configured retry model matches the primary model", () => {
    expect(getSummaryAttemptModelIds("gemini-3.6-flash", "gemini-3.6-flash")).toEqual([
      "gemini-3.6-flash",
      "gemini-3.6-flash",
    ]);
  });

  it("uses an explicitly different retry model", () => {
    expect(getSummaryAttemptModelIds("gemini-3.6-flash", "gemini-3.5-flash-lite")).toEqual([
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
    ]);
  });
});

describe("classifyAiError", () => {
  it("detects a nested Gemini rate limit error", () => {
    const error = new Error("Failed after 1 attempt");
    error.cause = Object.assign(new Error("RESOURCE_EXHAUSTED: Too Many Requests"), {
      statusCode: 429,
    });

    expect(classifyAiError(error)).toBe("rate_limit");
  });

  it("prioritizes HTTP 429 over quota wording", () => {
    const error = Object.assign(new Error("You exceeded your current quota"), {
      statusCode: 429,
    });

    expect(classifyAiError(error)).toBe("rate_limit");
  });

  it("detects an exhausted provider balance as quota", () => {
    expect(classifyAiError(new Error("Insufficient balance"))).toBe("quota");
  });
});

describe("transformProviderRequestBody", () => {
  it("forces DeepSeek non-thinking JSON object mode", () => {
    expect(
      transformProviderRequestBody("https://api.deepseek.com", {
        model: "deepseek-v4-flash",
        response_format: { type: "json_schema", json_schema: { name: "summary" } },
      }),
    ).toEqual({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
    });
  });
});
