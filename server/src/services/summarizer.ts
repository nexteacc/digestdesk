import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

let _cachedModel: ReturnType<ReturnType<typeof createOpenAI>> | null = null;

function getModel() {
  if (_cachedModel) return _cachedModel;

  const modelId = process.env.AI_MODEL || "gpt-4o-mini";
  const baseURL = process.env.AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY;

  if (!apiKey) {
    throw new Error("请设置 AI_API_KEY 环境变量");
  }

  const provider = createOpenAI({
    apiKey,
    baseURL: baseURL || undefined,
  });

  _cachedModel = provider(modelId);
  return _cachedModel;
}

const ArticleSummarySchema = z.object({
  oneLiner: z
    .string()
    .describe("一句话（不超过50字）概括文章最核心的观点或结论，不要用'作者认为...'开头"),
  keyInsights: z
    .array(z.string())
    .describe("3条关键洞察，每条要具体、有信息量、可执行"),
});

export type ArticleSummary = z.infer<typeof ArticleSummarySchema>;

const ARTICLE_SYSTEM_PROMPT = `你是 DigestDesk 的编辑。目标：高密度、可执行、少废话。

输入是 Markdown 文章。利用标题/列表/引用/数据点，提炼关键信息，不要复述段落。

输出：
1. oneLiner：≤50字，直接给结论；不要以“作者认为”开头。
2. keyInsights：3条要点；每条必须具体，优先包含数字/对比/因果/做法；避免空话与口号。`;

export async function summarizeArticle(markdown: string): Promise<ArticleSummary> {
  const model = getModel();
  console.log(`[summarizer] Starting AI summary... (Input length: ${markdown.length})`);

  try {
    const { object } = await generateObject({
      model,
      schema: ArticleSummarySchema,
      system: ARTICLE_SYSTEM_PROMPT,
      prompt: markdown,
    });

    console.log(`[summarizer] AI summary complete. One-liner: ${object.oneLiner?.slice(0, 50)}...`);
    return {
      oneLiner: object.oneLiner || "暂无摘要",
      keyInsights: object.keyInsights.slice(0, 5),
    };
  } catch (err) {
    console.error(`[summarizer] AI summary failed:`, err instanceof Error ? err.message : err);
    throw err;
  }
}
