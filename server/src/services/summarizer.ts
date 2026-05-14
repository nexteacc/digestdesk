import { generateObject, type LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

let _cachedModel: LanguageModel | null = null;

export type AiErrorCategory =
  | "quota"
  | "rate_limit"
  | "auth"
  | "timeout"
  | "network"
  | "invalid_request"
  | "unknown";

export function classifyAiError(error: unknown): AiErrorCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (message.includes("quota") || message.includes("billing")) return "quota";
  if (message.includes("rate limit") || message.includes("too many requests") || message.includes("429")) {
    return "rate_limit";
  }
  if (
    message.includes("unauthorized") ||
    message.includes("authentication") ||
    message.includes("invalid api key") ||
    message.includes("401") ||
    message.includes("403")
  ) {
    return "auth";
  }
  if (message.includes("timeout") || message.includes("timed out") || message.includes("abort")) {
    return "timeout";
  }
  if (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("enotfound") ||
    message.includes("network")
  ) {
    return "network";
  }
  if (message.includes("invalid") || message.includes("bad request") || message.includes("400")) {
    return "invalid_request";
  }
  return "unknown";
}

function summarizeErrorMeta(error: unknown) {
  const err = error as {
    name?: unknown;
    message?: unknown;
    cause?: unknown;
    statusCode?: unknown;
    status?: unknown;
    code?: unknown;
    responseBody?: unknown;
  };

  return {
    category: classifyAiError(error),
    name: typeof err?.name === "string" ? err.name : null,
    message: typeof err?.message === "string" ? err.message : String(error),
    code: typeof err?.code === "string" ? err.code : null,
    statusCode: typeof err?.statusCode === "number" ? err.statusCode : null,
    status: typeof err?.status === "number" ? err.status : null,
    cause:
      err?.cause instanceof Error
        ? { name: err.cause.name, message: err.cause.message }
        : err?.cause ?? null,
    responseBody: typeof err?.responseBody === "string" ? err.responseBody.slice(0, 500) : null,
  };
}

function getModel() {
  if (_cachedModel) return _cachedModel;
  const modelId = process.env.AI_MODEL || "gpt-4o-mini";
  const baseURL = process.env.AI_BASE_URL || "https://api.openai.com/v1";
  const apiKey = process.env.AI_API_KEY;

  if (!apiKey) {
    throw new Error("请设置 AI_API_KEY 环境变量");
  }

  const provider = createOpenAICompatible({
    name: "ai-provider",
    baseURL,
    supportsStructuredOutputs: true,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  _cachedModel = provider.chatModel(modelId);
  return _cachedModel;
}

const ArticleSummarySchema = z.object({
  oneLiner: z
    .string()
    .describe("用一个完整的、不超过30个字的短句，精准总结文章的核心结论。"),
  keyInsights: z
    .array(z.string())
    .length(3)
    .describe("3个高价值的信息点。每个点必须包含具体的数据、方法或洞察。"),
});

export type ArticleSummary = z.infer<typeof ArticleSummarySchema>;

const PROMPTS = {
  zh: {
    system: `你是一名专业的中文编辑，为 DigestDesk 产品工作。
任务要求：
1. **语言统一**: 你的核心任务是阅读任何语言的文章，并始终以【简体中文】输出高质量的结构化摘要。
2. **客观去噪**: 剔除客套话、情绪表达和背景铺垫，只保留核心信息。`,
    schema: {
      oneLiner: "用一个完整的、不超过30个字的短句，精准总结文章的核心结论。确保句子通顺、信息完整。",
      keyInsights: "3个高价值的信息点。每个点必须包含具体的数据、方法或洞察。禁止废话。",
    }
  },
  en: {
    system: `You are a professional editor working for DigestDesk.
Task Requirements:
1. **Language Consistency**: Your core task is to read articles in any language and always output high-quality structured summaries in 【English】.
2. **Objective De-noising**: Remove pleasantries, emotional expressions, and background padding, keeping only the core information.`,
    schema: {
      oneLiner: "A complete sentence (max 20 words) that accurately summarizes the core conclusion of the article.",
      keyInsights: "3 high-value insight points. Each point must contain specific data, methods, or insights. No fluff.",
    }
  }
};

function normalizeSummary(input: unknown): ArticleSummary {
  const parsed = ArticleSummarySchema.parse(input);
  return {
    oneLiner: parsed.oneLiner || "暂无摘要",
    keyInsights: parsed.keyInsights,
  };
}

export function getMaxInputChars() {
  const raw = Number(process.env.AI_MAX_INPUT_CHARS ?? 0);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

export async function summarizeArticle(markdown: string, language: "zh" | "en" = "zh"): Promise<ArticleSummary> {
  const model = getModel();
  const promptConfig = PROMPTS[language] || PROMPTS.zh;
  const modelId = process.env.AI_MODEL || "gpt-4o-mini";
  const baseURL = process.env.AI_BASE_URL || "https://api.openai.com/v1";

  const maxInputChars = getMaxInputChars();
  const input = maxInputChars > 0 && markdown.length > maxInputChars
    ? markdown.slice(0, maxInputChars)
    : markdown;

  console.log(
    `[summarizer] Starting AI summary language=${language} model=${modelId} baseURL=${baseURL} inputLength=${markdown.length} sentLength=${input.length} maxInputChars=${maxInputChars}`,
  );

  try {
    const { object } = await generateObject({
      model,
      system: promptConfig.system,
      prompt: input,
      schema: z.object({
        oneLiner: z.string().describe(promptConfig.schema.oneLiner),
        keyInsights: z.array(z.string()).length(3).describe(promptConfig.schema.keyInsights),
      }),
    });
    const result = normalizeSummary(object);
    console.log(`[summarizer] AI summary complete. One-liner: ${result.oneLiner.slice(0, 50)}...`);
    return result;
  } catch (err) {
    console.error("[summarizer] AI summary failed:", summarizeErrorMeta(err));
    throw err;
  }
}
