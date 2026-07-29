import { summarizeArticle } from "../services/summarizer.js";

const sampleArticle = `Gemini structured outputs use a JSON schema to constrain model responses.
Applications still validate the returned object before writing it to the summary cache.
Rate limits are handled separately from schema and content quality validation.`;

async function main() {
  const attempts: number[] = [];
  const result = await summarizeArticle(sampleArticle, "en", {
    onAttempt: (attempt) => attempts.push(attempt),
  });

  if (attempts.length !== 1 || attempts[0] !== 1) {
    throw new Error(`Expected a single Gemini attempt [1], got [${attempts.join(",")}]`);
  }
  if (!result.oneLiner || result.keyInsights.length !== 3) {
    throw new Error("Structured output smoke returned an invalid summary shape.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseURL: process.env.AI_BASE_URL,
        model: process.env.AI_MODEL,
        attempts,
        oneLiner: result.oneLiner,
        insightCount: result.keyInsights.length,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[smoke-structured-output] failed:", err);
  process.exit(1);
});
