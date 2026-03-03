import { generateText, Output } from "ai";
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
    .describe("用一个完整的、不超过30个字的短句，精准总结文章的核心结论。确保句子通顺、信息完整。"),
  keyInsights: z
    .array(z.string())
    .length(3)
    .describe("3个高价值的信息点。每个点必须包含具体的数据、方法或洞察。禁止废话。"),
});

export type ArticleSummary = z.infer<typeof ArticleSummarySchema>;

const ARTICLE_SYSTEM_PROMPT = `你是一名专业的中文编辑，为 DigestDesk 产品工作。

任务要求：
1. **语言统一**: 你的核心任务是阅读任何语言的文章，并始终以【简体中文】输出高质量的结构化摘要。
2. **客观去噪**: 剔除客套话、情绪表达和背景铺垫，只保留核心信息。`;

export async function summarizeArticle(markdown: string): Promise<ArticleSummary> {
  const model = getModel();
  console.log(`[summarizer] Starting AI summary... (Input length: ${markdown.length})`);

  try {
    const { output } = await generateText({
      model,
      system: ARTICLE_SYSTEM_PROMPT,
      prompt: markdown,
      output: Output.object({ schema: ArticleSummarySchema }),
    });

    console.log(`[summarizer] AI summary complete. One-liner: ${output.oneLiner?.slice(0, 50)}...`);
    return {
      oneLiner: output.oneLiner || "暂无摘要",
      keyInsights: output.keyInsights,
    };
  } catch (err) {
    console.error(`[summarizer] AI summary failed:`, err instanceof Error ? err.message : err);
    throw err;
  }
}
