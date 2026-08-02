import { generateObject, type LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import Bottleneck from "bottleneck";
import { z } from "zod";
import type { DigestLanguage } from "../../../shared/types.js";
import { getSummaryLanguageProfile } from "./summary-language-profiles.js";

const _cachedModels = new Map<string, LanguageModel>();
const _requestLimiters = new Map<string, Bottleneck>();
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_GEMINI_REQUESTS_PER_MINUTE = 8;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
let rateLimitBlockedUntil = 0;

type ModelPromptProfile = "editorial" | "strict-json";

type ModelAdapter = {
  promptProfile: ModelPromptProfile;
};

const MODEL_ADAPTERS: Record<string, ModelAdapter> = {
  "deepseek-v4-flash": {
    promptProfile: "strict-json",
  },
  "openai/gpt-oss-120b": {
    promptProfile: "editorial",
  },
  "qwen/qwen3.5-flash-02-23": {
    promptProfile: "strict-json",
  },
};

const DEFAULT_MODEL_ADAPTER: ModelAdapter = {
  promptProfile: "editorial",
};

const STRUCTURED_OUTPUT_PROTOCOL_PROMPT = `Return only valid JSON matching the provided schema. Do not include markdown, prose outside JSON, comments, or trailing text.`;

export type AiErrorCategory =
  | "quota"
  | "rate_limit"
  | "auth"
  | "timeout"
  | "network"
  | "invalid_request"
  | "unknown";

class SummaryValidationError extends Error {
  field: "oneLiner" | "keyInsight";
  language: DigestLanguage;
  chars: number;
  words: number | null;
  limit: number | null;
  limitUnit: "chars" | "words" | null;

  constructor(
    message: string,
    options: {
      field: "oneLiner" | "keyInsight";
      language: DigestLanguage;
      chars: number;
      words: number | null;
      limit?: number;
      limitUnit?: "chars" | "words";
    },
  ) {
    super(message);
    this.name = "SummaryValidationError";
    this.field = options.field;
    this.language = options.language;
    this.chars = options.chars;
    this.words = options.words;
    this.limit = options.limit ?? null;
    this.limitUnit = options.limitUnit ?? null;
  }
}

class AiRateLimitCircuitOpenError extends Error {
  constructor(blockedUntil: number) {
    super(`AI rate limit circuit open until ${new Date(blockedUntil).toISOString()}`);
    this.name = "AiRateLimitCircuitOpenError";
  }
}

function getAiErrorText(error: unknown): string {
  const values: string[] = [];
  const seen = new Set<unknown>();

  function visit(value: unknown) {
    if (value === null || value === undefined || seen.has(value)) return;
    if (typeof value === "string" || typeof value === "number") {
      values.push(String(value));
      return;
    }
    if (typeof value !== "object") return;
    seen.add(value);

    const record = value as Record<string, unknown>;
    for (const key of ["name", "message", "code", "status", "statusCode", "responseBody"]) {
      visit(record[key]);
    }
    visit(record.cause);
    visit(record.lastError);
    visit(record.errors);
    if (Array.isArray(value)) value.forEach(visit);
  }

  visit(error);
  return values.join(" ").toLowerCase();
}

export function classifyAiError(error: unknown): AiErrorCategory {
  const message = getAiErrorText(error);

  if (message.includes("rate limit") || message.includes("too many requests") || message.includes("429")) {
    return "rate_limit";
  }
  if (message.includes("quota") || message.includes("billing") || message.includes("insufficient balance")) return "quota";
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
    validation:
      error instanceof SummaryValidationError
        ? {
            field: error.field,
            language: error.language,
            chars: error.chars,
            words: error.words,
            limit: error.limit,
            limitUnit: error.limitUnit,
          }
        : null,
  };
}

export function transformProviderRequestBody(baseURL: string, body: Record<string, unknown>): Record<string, unknown> {
  const requestBody = body;
  if (baseURL.includes("api.deepseek.com")) {
    return {
      ...requestBody,
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
    };
  }
  if (!baseURL.includes("openrouter.ai")) return body;
  const providerConfig =
    requestBody.provider && typeof requestBody.provider === "object" && !Array.isArray(requestBody.provider)
      ? (requestBody.provider as Record<string, unknown>)
      : {};

  return {
    ...requestBody,
    provider: {
      ...providerConfig,
      require_parameters: true,
    },
  };
}

function getModel(modelId: string) {
  const baseURL = process.env.AI_BASE_URL || "https://api.openai.com/v1";
  const apiKey = process.env.AI_API_KEY;
  const cacheKey = `${baseURL}:${modelId}`;
  const cached = _cachedModels.get(cacheKey);
  if (cached) return cached;

  if (!apiKey) {
    throw new Error("请设置 AI_API_KEY 环境变量");
  }

  const provider = createOpenAICompatible({
    name: "ai-provider",
    baseURL,
    supportsStructuredOutputs: true,
    transformRequestBody: (body) => transformProviderRequestBody(baseURL, body),
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (baseURL.includes("api.deepseek.com")) {
    console.log(`[summarizer] DeepSeek adapter enabled model=${modelId} thinking=disabled responseFormat=json_object`);
  }
  const model = provider.chatModel(modelId);
  _cachedModels.set(cacheKey, model);
  return model;
}

function getPrimaryModelId() {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

export function getSummaryAttemptModelIds(primaryModelId: string, configuredRetryModel = process.env.AI_RETRY_MODEL) {
  const retryModelId = configuredRetryModel?.trim();
  return [primaryModelId, retryModelId || primaryModelId];
}

function getAiRequestsPerMinute(baseURL: string) {
  const configured = Number(process.env.AI_REQUESTS_PER_MINUTE);
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  if (baseURL.includes("generativelanguage.googleapis.com")) return DEFAULT_GEMINI_REQUESTS_PER_MINUTE;
  return 0;
}

function getRequestLimiter(baseURL: string) {
  const requestsPerMinute = getAiRequestsPerMinute(baseURL);
  if (requestsPerMinute <= 0) return null;
  const cacheKey = `${baseURL}:${requestsPerMinute}`;
  const cached = _requestLimiters.get(cacheKey);
  if (cached) return cached;

  const limiter = new Bottleneck({
    maxConcurrent: 1,
    minTime: Math.ceil(60_000 / requestsPerMinute),
    reservoir: requestsPerMinute,
    reservoirRefreshAmount: requestsPerMinute,
    reservoirRefreshInterval: 60_000,
  });
  _requestLimiters.set(cacheKey, limiter);
  console.log(`[summarizer] Request limiter enabled baseURL=${baseURL} rpm=${requestsPerMinute}`);
  return limiter;
}

function getRateLimitCooldownMs(error: unknown) {
  const message = getAiErrorText(error);
  const retrySeconds = message.match(/retry(?:\s+in|delay["']?\s*[:=])\s*["']?(\d+(?:\.\d+)?)\s*s/i)?.[1];
  if (retrySeconds) return Math.max(1_000, Math.ceil(Number(retrySeconds) * 1_000));
  const configured = Number(process.env.AI_RATE_LIMIT_COOLDOWN_MS);
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

function assertRateLimitCircuitClosed() {
  if (Date.now() < rateLimitBlockedUntil) {
    throw new AiRateLimitCircuitOpenError(rateLimitBlockedUntil);
  }
}

function openRateLimitCircuit(error: unknown) {
  rateLimitBlockedUntil = Math.max(rateLimitBlockedUntil, Date.now() + getRateLimitCooldownMs(error));
}

function getModelAdapter(modelId: string) {
  return MODEL_ADAPTERS[modelId] ?? DEFAULT_MODEL_ADAPTER;
}

const ArticleSummarySchema = z.object({
  oneLiner: z
    .string()
    .describe("一个完整、通顺的短句，精准总结文章的核心结论。"),
  keyInsights: z
    .array(z.string())
    .length(3)
    .describe("3个高价值的信息点。每个点必须包含具体的数据、方法或洞察。"),
});

export type ArticleSummary = z.infer<typeof ArticleSummarySchema>;

export type ArticleSummaryMetadata = {
  model: string;
  promptVersion: string;
  attempt: number;
};

export type ArticleSummaryResult = {
  summary: ArticleSummary;
  metadata: ArticleSummaryMetadata;
};

function compactSummaryText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:[-•*·]|\d+[.)、]|bullet:)\s*/i, "")
    .trim();
}

function hasDisallowedSummaryChars(value: string) {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if ((code <= 0x001f) || (code >= 0x007f && code <= 0x009f)) return true;
    if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff) return true;
  }
  return false;
}

function isLowQualitySummaryText(value: string) {
  const text = value.trim();
  if (!text) return true;
  if (hasDisallowedSummaryChars(text)) return true;
  if (!/[A-Za-z\u4e00-\u9fff]/.test(text)) return true;
  if (/^the[.!?。！？….\s]*$/i.test(text)) return true;
  if (/^\.{2,}$|^…+$/.test(text)) return true;
  if (/(\?{3,}|？{3,})/.test(text)) return true;
  if (/[.…]{2,}\s*$/.test(text) && text.replace(/[^\p{L}\p{N}]/gu, "").length < 12) return true;
  return text.replace(/[^\p{L}\p{N}]/gu, "").length < 6;
}

function countSummaryWords(value: string) {
  const text = value.trim();
  return text ? text.split(/\s+/).length : 0;
}

function countVisibleChars(value: string) {
  return [...value.replace(/[\s\u200b-\u200d\ufeff]/g, "")].length;
}

function hasExpectedLanguageScript(value: string, language: DigestLanguage) {
  const profile = getSummaryLanguageProfile(language);
  if (profile.validation.expectedScript === "cjk") {
    return /[\u4e00-\u9fff]/.test(value);
  }
  return /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(value);
}

function assertSummaryText(value: string, field: "oneLiner" | "keyInsight", language: DigestLanguage) {
  const profile = getSummaryLanguageProfile(language);
  const rule = field === "oneLiner" ? profile.validation.oneLiner : profile.validation.keyInsight;
  const visibleChars = countVisibleChars(value);
  const words = rule.unit === "words" ? countSummaryWords(value) : null;
  const validationMeta = {
    field,
    language,
    chars: visibleChars,
    words,
  };

  if (isLowQualitySummaryText(value)) {
    throw new SummaryValidationError(`low_quality_${field}`, validationMeta);
  }
  if (!hasExpectedLanguageScript(value, language)) {
    throw new SummaryValidationError(`wrong_language_${field}`, validationMeta);
  }
  if (rule.unit === "words") {
    if (rule.minChars && visibleChars < rule.minChars) {
      throw new SummaryValidationError(`too_short_${field}`, {
        ...validationMeta,
        limit: rule.minChars,
        limitUnit: "chars",
      });
    }
    if (words !== null && words < rule.min) {
      throw new SummaryValidationError(`too_short_${field}`, {
        ...validationMeta,
        limit: rule.min,
        limitUnit: "words",
      });
    }
    if (words !== null && words > rule.max) {
      throw new SummaryValidationError(`too_long_${field}`, {
        ...validationMeta,
        limit: rule.max,
        limitUnit: "words",
      });
    }
    return;
  }

  if (visibleChars < rule.min) {
    throw new SummaryValidationError(`too_short_${field}`, {
      ...validationMeta,
      limit: rule.min,
      limitUnit: "chars",
    });
  }
  if (visibleChars > rule.max) {
    throw new SummaryValidationError(`too_long_${field}`, {
      ...validationMeta,
      limit: rule.max,
      limitUnit: "chars",
    });
  }
}

function normalizeSummary(input: unknown, language: DigestLanguage = "zh"): ArticleSummary {
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

export function parseCachedArticleSummary(input: unknown, language: DigestLanguage = "zh"): ArticleSummary | null {
  try {
    return normalizeSummary(input, language);
  } catch {
    return null;
  }
}

function getRuleMinChars(language: DigestLanguage, field: "oneLiner" | "keyInsight") {
  const profile = getSummaryLanguageProfile(language);
  const rule = field === "oneLiner" ? profile.validation.oneLiner : profile.validation.keyInsight;
  return rule.unit === "chars" ? rule.min : rule.minChars ?? 1;
}

function buildArticleSummaryGenerationSchema(language: DigestLanguage) {
  const profile = getSummaryLanguageProfile(language);
  const oneLinerMinChars = getRuleMinChars(language, "oneLiner");
  const keyInsightMinChars = getRuleMinChars(language, "keyInsight");
  return z.object({
    oneLiner: z
      .string()
      .min(oneLinerMinChars)
      .describe(profile.schema.oneLiner),
    keyInsights: z
      .array(
        z
          .string()
          .min(keyInsightMinChars)
          .describe(profile.schema.keyInsights),
      )
      .length(3)
      .describe(profile.schema.keyInsights),
  });
}

function buildEditorialSummarySystemPrompt(language: DigestLanguage, retry: boolean) {
  const profile = getSummaryLanguageProfile(language);
  if (!retry) return profile.editorialSystemPrompt;
  return `${profile.editorialSystemPrompt}

${profile.retryInstructions}`;
}

function buildStrictJsonSummarySystemPrompt(language: DigestLanguage) {
  return getSummaryLanguageProfile(language).strictJsonSystemPrompt;
}

function buildSummarySystemPrompt(language: DigestLanguage, adapter: ModelAdapter, retry: boolean) {
  const taskPrompt =
    adapter.promptProfile === "strict-json"
      ? buildStrictJsonSummarySystemPrompt(language)
      : buildEditorialSummarySystemPrompt(language, retry);

  return `${taskPrompt}

${STRUCTURED_OUTPUT_PROTOCOL_PROMPT}`;
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

export function getMaxOutputTokens() {
  const raw = Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 1200);
  if (!Number.isFinite(raw) || raw <= 0) return 1200;
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

export async function summarizeArticleWithMetadata(
  markdown: string,
  language: DigestLanguage = "zh",
  options?: { onAttempt?: (attempt: number) => void },
): Promise<ArticleSummaryResult> {
  const baseURL = process.env.AI_BASE_URL || "https://api.openai.com/v1";
  const primaryModelId = getPrimaryModelId();
  const attemptModelIds = getSummaryAttemptModelIds(primaryModelId);
  const retryModelId = attemptModelIds[1] ?? "none";
  const promptVersion = getSummaryLanguageProfile(language).promptVersion;

  const maxInputChars = getMaxInputChars();
  const maxOutputTokens = getMaxOutputTokens();
  const input = buildMarkdownSummaryInput(markdown, maxInputChars);

  console.log(
    `[summarizer] Starting AI summary language=${language} model=${primaryModelId} retryModel=${retryModelId} baseURL=${baseURL} inputLength=${markdown.length} sentLength=${input.length} maxInputChars=${maxInputChars} maxOutputTokens=${maxOutputTokens}`,
  );

  let lastError: unknown;
  for (let attemptIndex = 0; attemptIndex < attemptModelIds.length; attemptIndex += 1) {
    const attempt = attemptIndex + 1;
    const attemptModelId = attemptModelIds[attemptIndex];
    const adapter = getModelAdapter(attemptModelId);
    const model = getModel(attemptModelId);

    try {
      options?.onAttempt?.(attempt);
      const request = () => {
        assertRateLimitCircuitClosed();
        return generateObject({
          model,
          system: buildSummarySystemPrompt(language, adapter, attempt > 1),
          prompt: input,
          schema: buildArticleSummaryGenerationSchema(language),
          maxOutputTokens,
          maxRetries: 0,
        });
      };
      const limiter = getRequestLimiter(baseURL);
      const { object } = limiter ? await limiter.schedule(request) : await request();
      const result = normalizeSummary(object, language);
      console.log(
        `[summarizer] AI summary complete attempt=${attempt} model=${attemptModelId}. One-liner: ${result.oneLiner.slice(0, 50)}...`,
      );
      return {
        summary: result,
        metadata: {
          model: attemptModelId,
          promptVersion,
          attempt,
        },
      };
    } catch (err) {
      lastError = err;
      const meta = summarizeErrorMeta(err);
      if (meta.category === "rate_limit" && !(err instanceof AiRateLimitCircuitOpenError)) {
        openRateLimitCircuit(err);
      }
      if (attemptIndex + 1 < attemptModelIds.length && shouldRetrySummaryGeneration(err)) {
        console.warn("[summarizer] AI summary failed validation; retrying once:", {
          ...meta,
          model: attemptModelId,
          retryModel: retryModelId,
        });
        continue;
      }
      console.error("[summarizer] AI summary failed:", { ...meta, model: attemptModelId });
      throw err;
    }
  }
  throw lastError;
}

export async function summarizeArticle(
  markdown: string,
  language: DigestLanguage = "zh",
  options?: { onAttempt?: (attempt: number) => void },
): Promise<ArticleSummary> {
  const result = await summarizeArticleWithMetadata(markdown, language, options);
  return result.summary;
}
