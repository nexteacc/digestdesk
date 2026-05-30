import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DigestLanguage } from "../../../shared/types.js";
import { getDb } from "../db/index.js";
import { articleSummaries, articles } from "../db/schema.js";
import type { ArticleSummary } from "./summarizer.js";
import { parseCachedArticleSummary } from "./summarizer.js";

type LegacySummaryFields = {
  summaryZh?: string | null;
  summaryEn?: string | null;
};

export type CachedSummaryLookup = {
  summary: ArticleSummary;
  source: "article_summaries" | "legacy_column";
};

export function serializeArticleSummary(summary: ArticleSummary) {
  return JSON.stringify({
    oneLiner: summary.oneLiner,
    keyInsights: summary.keyInsights,
  });
}

function getLegacySummaryJson(fields: LegacySummaryFields, language: DigestLanguage) {
  if (language === "zh") return fields.summaryZh || null;
  if (language === "en") return fields.summaryEn || null;
  return null;
}

export function parseSummaryJson(json: string | null | undefined, language: DigestLanguage) {
  if (!json) return null;
  try {
    return parseCachedArticleSummary(JSON.parse(json), language);
  } catch {
    return null;
  }
}

export async function readArticleSummaryMap(articleIds: string[], language: DigestLanguage) {
  if (articleIds.length === 0) return new Map<string, string>();
  const db = getDb();
  const rows = await db
    .select({
      articleId: articleSummaries.articleId,
      summaryJson: articleSummaries.summaryJson,
    })
    .from(articleSummaries)
    .where(and(inArray(articleSummaries.articleId, articleIds), eq(articleSummaries.language, language)));

  return new Map(rows.map((row) => [row.articleId, row.summaryJson]));
}

export function readCachedArticleSummaryFromMaps(input: {
  articleId: string;
  language: DigestLanguage;
  summaryMap: Map<string, string>;
  legacyFields?: LegacySummaryFields;
}): CachedSummaryLookup | null {
  const currentSummary = parseSummaryJson(input.summaryMap.get(input.articleId), input.language);
  if (currentSummary) {
    return { summary: currentSummary, source: "article_summaries" };
  }

  const legacySummary = parseSummaryJson(
    input.legacyFields ? getLegacySummaryJson(input.legacyFields, input.language) : null,
    input.language,
  );
  if (legacySummary) {
    return { summary: legacySummary, source: "legacy_column" };
  }

  return null;
}

export async function writeArticleSummary(input: {
  articleId: string;
  language: DigestLanguage;
  summary: ArticleSummary;
  model?: string;
  promptVersion?: string;
  generationAttempt?: number;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const summaryJson = serializeArticleSummary(input.summary);

  await db
    .insert(articleSummaries)
    .values({
      id: nanoid(),
      articleId: input.articleId,
      language: input.language,
      summaryJson,
      model: input.model || null,
      promptVersion: input.promptVersion || null,
      generationAttempt: input.generationAttempt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [articleSummaries.articleId, articleSummaries.language],
      set: {
        summaryJson,
        model: input.model || null,
        promptVersion: input.promptVersion || null,
        generationAttempt: input.generationAttempt ?? null,
        updatedAt: now,
      },
    });

  if (input.language === "zh") {
    await db.update(articles).set({ summaryZh: summaryJson }).where(eq(articles.id, input.articleId));
  } else if (input.language === "en") {
    await db.update(articles).set({ summaryEn: summaryJson }).where(eq(articles.id, input.articleId));
  }
}
