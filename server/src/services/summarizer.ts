import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

function getModel() {
  const modelId = process.env.AI_MODEL;
  const baseURL = process.env.AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;

  if (process.env.AI_PROVIDER !== "google" && (apiKey || baseURL)) {
    const provider = createOpenAI({
      apiKey,
      baseURL: baseURL || undefined,
    });
    return provider(modelId || "gpt-5-mini");
  }

  if (process.env.AI_PROVIDER === "google" || process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return google(modelId || "gemini-2.0-flash-exp");
  }

  const defaultProvider = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  return defaultProvider(modelId || "gpt-5-mini");
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

const WeeklyAnalysisSchema = z.object({
  weeklyThemes: z
    .array(z.string())
    .describe("本周 2-3 个跨源共性话题，每个用一句话描述趋势"),
});

export type WeeklyAnalysis = z.infer<typeof WeeklyAnalysisSchema>;

const ARTICLE_SYSTEM_PROMPT = `你是 DigestDesk 的编辑。目标：高密度、可执行、少废话。

输入是 Markdown 文章。利用标题/列表/引用/数据点，提炼关键信息，不要复述段落。

输出：
1. oneLiner：≤50字，直接给结论；不要以“作者认为”开头。
2. keyInsights：3条要点；每条必须具体，优先包含数字/对比/因果/做法；避免空话与口号。`;

const WEEKLY_SYSTEM_PROMPT = `你是一位资深编辑。以下是本周多篇 Newsletter 文章的摘要列表。

请输出 weeklyThemes：2-3 个跨源主题；每个用一句话写“趋势 + 含义/影响”，避免泛泛而谈。`;

export async function summarizeArticle(markdown: string): Promise<ArticleSummary> {
  const model = getModel();
  console.log(`[summarizer] Starting AI summary... (Input length: ${markdown.length})`);

  try {
    const { object } = await generateObject({
      model,
      schema: ArticleSummarySchema,
      system: ARTICLE_SYSTEM_PROMPT,
      prompt: markdown,
      temperature: 0.3,
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

export async function generateWeeklyAnalysis(
  items: Array<{
    id: string;
    feedTitle: string;
    title: string;
    oneLiner: string;
    url: string;
  }>,
): Promise<WeeklyAnalysis> {
  const input = items
    .map(
      (it) =>
        `[${it.id}] ${it.feedTitle} — ${it.title}\n摘要：${it.oneLiner}\n链接：${it.url}`,
    )
    .join("\n\n");

  const model = getModel();

  const { object } = await generateObject({
    model,
    schema: WeeklyAnalysisSchema,
    system: WEEKLY_SYSTEM_PROMPT,
    prompt: input,
    temperature: 0.4,
  });

  return object;
}
