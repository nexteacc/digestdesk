import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeArticleWithMetadata } from "./summarizer.js";

const summary = {
  oneLiner: "Shared summaries reduce duplicate model requests by caching each article separately for every supported user language.",
  keyInsights: [
    "The scheduler generates summaries before daily digest assembly so readers can receive cached results without waiting for another model request.",
    "Each article and language pair shares a cached summary across users, reducing duplicate calls while preserving separate language preferences.",
    "Validation checks both the returned JSON structure and summary length before accepting generated content into the shared article cache.",
  ],
};

function response(object: unknown, incomplete = false) {
  return Response.json({
    id: "resp_test", model: "gpt-6-luna", created_at: 1,
    output: [{ type: "message", role: "assistant", id: "msg_test",
      content: [{ type: "output_text", text: JSON.stringify(object), annotations: [] }] }],
    usage: { input_tokens: 100, output_tokens: 80, input_tokens_details: { cached_tokens: 40 } },
    incomplete_details: incomplete ? { reason: "max_output_tokens" } : null,
  });
}

describe("OpenAI Responses summary integration", () => {
  beforeEach(() => {
    vi.stubEnv("AI_BASE_URL", "https://api.openai.com/v1");
    vi.stubEnv("AI_API_KEY", "test-only-fake-key");
    vi.stubEnv("AI_MODEL", "gpt-6-luna");
    vi.stubEnv("AI_RETRY_MODEL", "gpt-6.2-sol");
    vi.stubEnv("AI_MAX_OUTPUT_TOKENS", "1200");
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("sends stateless strict JSON requests to Responses and preserves summary metadata", async () => {
    const fetch = vi.fn().mockResolvedValue(response(summary));
    vi.stubGlobal("fetch", fetch);
    const result = await summarizeArticleWithMetadata("Article about shared summary caches.", "en");
    expect(result.summary).toEqual(summary);
    expect(result.metadata).toMatchObject({ model: "gpt-6-luna", attempt: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "gpt-6-luna", store: false,
      reasoning: { effort: "none" }, max_output_tokens: 1200,
      text: { verbosity: "low", format: { type: "json_schema", strict: true } } });
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("provider");
  });

  it.each(["invalid", "incomplete"])("retries %s output with Sol and its reasoning budget", async kind => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(kind === "invalid" ? { ...summary, oneLiner: "Too short" } : summary, kind === "incomplete"))
      .mockResolvedValueOnce(response(summary));
    vi.stubGlobal("fetch", fetch);
    const result = await summarizeArticleWithMetadata("Article about shared summary caches.", "en");
    expect(result.metadata).toMatchObject({ model: "gpt-6.2-sol", attempt: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      model: "gpt-6.2-sol", reasoning: { effort: "low" }, max_output_tokens: 4096, store: false,
    });
  });

  it("does not retry authentication failures", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: { message: "Invalid API key", type: "invalid_request_error", code: "invalid_api_key" } }, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect(summarizeArticleWithMetadata("Article.", "en")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps DeepSeek on Chat Completions with non-thinking JSON mode", async () => {
    vi.stubEnv("AI_BASE_URL", "https://api.deepseek.com");
    vi.stubEnv("AI_MODEL", "deepseek-flash");
    const fetch = vi.fn().mockResolvedValue(Response.json({
      id: "chat_test", created: 1, model: "deepseek-flash",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(summary) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 },
    }));
    vi.stubGlobal("fetch", fetch);
    expect((await summarizeArticleWithMetadata("Article.", "en")).summary).toEqual(summary);
    expect(fetch.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ thinking: { type: "disabled" }, response_format: { type: "json_object" } });
  });
});
