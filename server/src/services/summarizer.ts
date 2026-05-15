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

const SUMMARY_LIMITS = {
  zh: {
    oneLinerChars: 70,
    keyInsightChars: 70,
    minInsightChars: 10,
  },
  en: {
    oneLinerChars: 120,
    keyInsightChars: 140,
    minInsightChars: 24,
  },
} as const;

const PROMPTS = {
  zh: {
    system: `你是一名专业的中文编辑，为 DigestDesk 产品工作。
任务要求：
1. **语言统一**: 你的核心任务是阅读任何语言的文章，并始终以【简体中文】输出高质量的结构化摘要。
2. **客观去噪**: 剔除客套话、情绪表达和背景铺垫，只保留核心信息。
3. **长度纪律**: 输出必须短，禁止把整段原文、列表或长句塞进任一字段。`,
    schema: {
      oneLiner: "用一个完整的、不超过30个字的短句，精准总结文章的核心结论。确保句子通顺、信息完整。",
      keyInsights: "正好3条关键洞察；每条不超过45个汉字；每条只表达一个具体数据、方法或结论。禁止长段落、原文堆砌、占位符和废话。",
    }
  },
  en: {
    system: `You are a professional editor working for DigestDesk.
Task Requirements:
1. **Language Consistency**: Your core task is to read articles in any language and always output high-quality structured summaries in 【English】.
2. **Objective De-noising**: Remove pleasantries, emotional expressions, and background padding, keeping only the core information.
3. **Length Discipline**: Keep every field short. Never paste full paragraphs, long lists, or source fragments into any field.`,
    schema: {
      oneLiner: "A complete sentence (max 20 words) that accurately summarizes the core conclusion of the article.",
      keyInsights: "Exactly 3 concise takeaways. Each item must be 8-24 words, contain one specific data point, method, or conclusion, and avoid placeholders or source-text dumping.",
    }
  }
};

function compactSummaryText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:[-•*·]|\d+[.)、]|bullet:)\s*/i, "")
    .trim();
}

function isLowQualitySummaryText(value: string) {
  const text = value.trim();
  if (!text) return true;
  if (!/[A-Za-z\u4e00-\u9fff]/.test(text)) return true;
  if (/^the[.!?。！？….\s]*$/i.test(text)) return true;
  if (/^\.{2,}$|^…+$/.test(text)) return true;
  if (/(\?{3,}|？{3,})/.test(text)) return true;
  if (/[.…]{2,}\s*$/.test(text) && text.replace(/[^\p{L}\p{N}]/gu, "").length < 12) return true;
  return text.replace(/[^\p{L}\p{N}]/gu, "").length < 6;
}

function assertSummaryText(value: string, field: "oneLiner" | "keyInsight", language: "zh" | "en") {
  const limits = SUMMARY_LIMITS[language] ?? SUMMARY_LIMITS.zh;
  const maxChars = field === "oneLiner" ? limits.oneLinerChars : limits.keyInsightChars;
  const minChars = field === "oneLiner" ? 6 : limits.minInsightChars;

  if (isLowQualitySummaryText(value)) {
    throw new Error(`low_quality_${field}`);
  }
  if (value.length < minChars) {
    throw new Error(`too_short_${field}`);
  }
  if (value.length > maxChars) {
    throw new Error(`too_long_${field}`);
  }
}

function normalizeSummary(input: unknown, language: "zh" | "en" = "zh"): ArticleSummary {
  const parsed = ArticleSummarySchema.parse(input);
  const oneLiner = compactSummaryText(parsed.oneLiner || "");
  const keyInsights = parsed.keyInsights.map(compactSummaryText);

  assertSummaryText(oneLiner, "oneLiner", language);
  keyInsights.forEach((insight) => assertSummaryText(insight, "keyInsight", language));

  return {
    oneLiner,
    keyInsights,
  };
}

export function parseCachedArticleSummary(input: unknown, language: "zh" | "en" = "zh"): ArticleSummary | null {
  try {
    return normalizeSummary(input, language);
  } catch {
    return null;
  }
}

function buildArticleSummaryGenerationSchema(language: "zh" | "en") {
  const limits = SUMMARY_LIMITS[language] ?? SUMMARY_LIMITS.zh;
  return z.object({
    oneLiner: z
      .string()
      .min(6)
      .max(limits.oneLinerChars)
      .describe(PROMPTS[language].schema.oneLiner),
    keyInsights: z
      .array(
        z
          .string()
          .min(limits.minInsightChars)
          .max(limits.keyInsightChars)
          .describe(PROMPTS[language].schema.keyInsights),
      )
      .length(3)
      .describe(PROMPTS[language].schema.keyInsights),
  });
}

function buildSummarySystemPrompt(language: "zh" | "en", retry: boolean) {
  const promptConfig = PROMPTS[language] || PROMPTS.zh;
  if (!retry) return promptConfig.system;
  const retryInstructions = language === "en"
    ? `Previous output failed length or quality validation. Regenerate and strictly follow:
1. oneLiner must be a complete short sentence, with no ellipses, question-mark placeholders, or fragments.
2. keyInsights must contain exactly 3 independent, specific, concise items.
3. Do not paste long source paragraphs, table-of-contents text, list dumps, or meaningless characters.`
    : `上一轮输出未通过长度或质量校验。请重新生成，必须满足：
1. oneLiner 是完整短句，不要省略号、问号占位或残片。
2. keyInsights 正好 3 条，每条独立、具体、短。
3. 不要粘贴原文长段、目录、列表堆砌或无意义字符。`;

  return `${promptConfig.system}

${retryInstructions}`;
}

function shouldRetrySummaryGeneration(error: unknown) {
  const category = classifyAiError(error);
  return !["quota", "rate_limit", "auth", "timeout", "network"].includes(category);
}

export function getMaxInputChars() {
  const raw = Number(process.env.AI_MAX_INPUT_CHARS ?? 0);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

type MarkdownBlock = {
  index: number;
  text: string;
  score: number;
};

const HIGH_SIGNAL_RE =
  /(conclusion|takeaway|summary|tl;dr|why it matters|key point|in short|bottom line|结论|要点|总结|关键|影响|数据|建议|原因|重点)/i;
const LOW_SIGNAL_RE =
  /(subscribe|unsubscribe|leave a comment|share this|read more|sponsor|sponsored|advertisement|copyright|all rights reserved|推荐阅读|相关阅读|点击阅读|加入会员|订阅|退订|广告|赞助)/i;
const DATA_RE = /(\d[\d,.]*\s?%|\$[\d,.]+|€[\d,.]+|¥[\d,.]+|[\d,.]+\s?(million|billion|万|亿|k|m|bn)\b|\b20\d{2}\b)/i;

function splitMarkdownBlocks(markdown: string): string[] {
  return markdown
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function scoreMarkdownBlock(block: string, index: number, total: number): number {
  const firstLine = block.split("\n", 1)[0] ?? "";
  let score = 0;

  if (/^#{1,6}\s+\S/.test(firstLine)) score += 8;
  if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/m.test(block)) score += 5;
  if (HIGH_SIGNAL_RE.test(block)) score += 5;
  if (DATA_RE.test(block)) score += 4;
  if (/^>\s+/.test(firstLine)) score += 2;
  if (block.length >= 180 && block.length <= 1200) score += 1;

  const relativePosition = total <= 1 ? 0 : index / (total - 1);
  if (relativePosition <= 0.18) score += 3;
  if (relativePosition >= 0.82) score += 3;
  if (/```/.test(block)) score -= 3;
  if (LOW_SIGNAL_RE.test(block)) score -= 8;

  return score;
}

function addBlock(
  selected: Map<number, string>,
  block: MarkdownBlock,
  used: { value: number },
  maxChars: number,
) {
  if (selected.has(block.index)) return;
  const separatorLength = selected.size === 0 ? 0 : 2;
  const nextLength = used.value + separatorLength + block.text.length;
  if (nextLength > maxChars) return;
  selected.set(block.index, block.text);
  used.value = nextLength;
}

function buildMarkdownSummaryInput(markdown: string, maxChars: number): string {
  if (maxChars <= 0 || markdown.length <= maxChars) return markdown;
  if (maxChars < 2000) return markdown.slice(0, maxChars);

  const blocks = splitMarkdownBlocks(markdown);
  if (blocks.length <= 1) return markdown.slice(0, maxChars);

  const scored = blocks.map((text, index) => ({
    index,
    text,
    score: scoreMarkdownBlock(text, index, blocks.length),
  }));

  const selected = new Map<number, string>();
  const used = { value: 0 };
  const headBudget = Math.floor(maxChars * 0.38);
  const tailBudget = Math.floor(maxChars * 0.24);

  for (const block of scored) {
    if (used.value >= headBudget) break;
    if (block.score < -2) continue;
    addBlock(selected, block, used, maxChars);
  }

  const tailUsed = { value: 0 };
  for (const block of [...scored].reverse()) {
    if (tailUsed.value >= tailBudget) break;
    if (block.score < -2) continue;
    const before = used.value;
    addBlock(selected, block, used, maxChars);
    if (used.value !== before) {
      tailUsed.value += (tailUsed.value === 0 ? 0 : 2) + block.text.length;
    }
  }

  for (const block of scored.filter((block) => /^#{1,6}\s+\S/.test(block.text.split("\n", 1)[0] ?? ""))) {
    addBlock(selected, block, used, maxChars);
  }

  const remainingByScore = scored
    .filter((block) => !selected.has(block.index) && block.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  for (const block of remainingByScore) {
    addBlock(selected, block, used, maxChars);
    if (used.value >= maxChars * 0.98) break;
  }

  const result = [...selected.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, text]) => text)
    .join("\n\n");

  return result.length > 0 ? result : markdown.slice(0, maxChars);
}

export async function summarizeArticle(markdown: string, language: "zh" | "en" = "zh"): Promise<ArticleSummary> {
  const model = getModel();
  const modelId = process.env.AI_MODEL || "gpt-4o-mini";
  const baseURL = process.env.AI_BASE_URL || "https://api.openai.com/v1";

  const maxInputChars = getMaxInputChars();
  const input = buildMarkdownSummaryInput(markdown, maxInputChars);

  console.log(
    `[summarizer] Starting AI summary language=${language} model=${modelId} baseURL=${baseURL} inputLength=${markdown.length} sentLength=${input.length} maxInputChars=${maxInputChars}`,
  );

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { object } = await generateObject({
        model,
        system: buildSummarySystemPrompt(language, attempt > 1),
        prompt: input,
        schema: buildArticleSummaryGenerationSchema(language),
      });
      const result = normalizeSummary(object, language);
      console.log(
        `[summarizer] AI summary complete attempt=${attempt}. One-liner: ${result.oneLiner.slice(0, 50)}...`,
      );
      return result;
    } catch (err) {
      lastError = err;
      const meta = summarizeErrorMeta(err);
      if (attempt < 2 && shouldRetrySummaryGeneration(err)) {
        console.warn("[summarizer] AI summary failed validation; retrying once:", meta);
        continue;
      }
      console.error("[summarizer] AI summary failed:", meta);
      throw err;
    }
  }
  throw lastError;
}
