import { summarizeArticle } from "../services/summarizer.js";

const sampleArticle = `OpenRouter routes requests across providers.
Structured outputs require providers that support response_format and schema validation.
Applications should validate returned objects locally before writing cache snapshots.`;

async function main() {
  const originalModel = process.env.AI_MODEL;
  const originalRetryModel = process.env.AI_RETRY_MODEL;
  const originalBaseUrl = process.env.AI_BASE_URL;

  process.env.AI_BASE_URL = originalBaseUrl || "https://openrouter.ai/api/v1";
  process.env.AI_MODEL = "invalid/structured-output-smoke";
  process.env.AI_RETRY_MODEL = "qwen/qwen3.5-flash-02-23";

  const attempts: number[] = [];
  const result = await summarizeArticle(sampleArticle, "en", {
    onAttempt: (attempt) => attempts.push(attempt),
  });

  if (attempts.length !== 2 || attempts[0] !== 1 || attempts[1] !== 2) {
    throw new Error(`Expected forced retry attempts [1,2], got [${attempts.join(",")}]`);
  }
  if (!result.oneLiner || result.keyInsights.length !== 3) {
    throw new Error("Structured output smoke returned an invalid summary shape.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseURL: process.env.AI_BASE_URL,
        attempts,
        retryModel: process.env.AI_RETRY_MODEL,
        oneLiner: result.oneLiner,
        insightCount: result.keyInsights.length,
      },
      null,
      2,
    ),
  );

  process.env.AI_MODEL = originalModel;
  process.env.AI_RETRY_MODEL = originalRetryModel;
  process.env.AI_BASE_URL = originalBaseUrl;
}

main().catch((err) => {
  console.error("[smoke-structured-output] failed:", err);
  process.exit(1);
});
