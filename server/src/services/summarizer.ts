import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

// --- 模型配置 ---

type ProviderType = "google" | "openai";

function getProvider(): ProviderType {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "google";
  if (process.env.OPENAI_API_KEY) return "openai";
  throw new Error("请设置 GOOGLE_GENERATIVE_AI_API_KEY 或 OPENAI_API_KEY 环境变量");
}

function getModel() {
  const provider = getProvider();
  if (provider === "google") {
    const modelId = process.env.AI_MODEL || "gemini-2.5-flash-preview-05-20";
    return google(modelId);
  }
  const modelId = process.env.AI_MODEL || "gpt-5-nano";
  return openai(modelId);
}

// --- Zod Schemas ---

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

// --- Prompts ---

const ARTICLE_SYSTEM_PROMPT = `你是一位资深编辑助手。你的任务是将一篇 Newsletter 文章提炼成结构化摘要。

文章内容以 Markdown 格式提供，可能包含标题、列表、引用、链接和图片描述。请充分利用这些结构化信息来提高摘要质量。

要求：
1. "oneLiner"：用一句话（不超过50字）概括文章最核心的观点或结论。不要用"作者认为..."开头。
2. "keyInsights"：提炼3条关键洞察。每条要具体、有信息量、可执行。
   - 好的例子："PLG 公司的 NDR 比 Sales-led 高 15-20%"
   - 差的例子："作者认为 PLG 很重要"`;

const WEEKLY_SYSTEM_PROMPT = `你是一位资深编辑。以下是本周多篇 Newsletter 文章的摘要列表。

请完成一个任务：
1. "weeklyThemes"：归纳本周 2-3 个跨源共性话题，每个用一句话描述趋势。`;

// --- API Functions ---

export async function summarizeArticle(markdown: string): Promise<ArticleSummary> {
  const model = getModel();

  const { object } = await generateObject({
    model,
    schema: ArticleSummarySchema,
    system: ARTICLE_SYSTEM_PROMPT,
    prompt: markdown,
    temperature: 0.3,
  });

  return {
    oneLiner: object.oneLiner || "暂无摘要",
    keyInsights: object.keyInsights.slice(0, 5),
  };
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
