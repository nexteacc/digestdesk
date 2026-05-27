import type { DigestLanguage } from "../../../shared/types.js";

export type LengthRule =
  | {
      unit: "chars";
      min: number;
      max: number;
    }
  | {
      unit: "words";
      min: number;
      max: number;
      minChars?: number;
    };

export type SummaryLanguageProfile = {
  language: DigestLanguage;
  label: string;
  promptVersion: string;
  schema: {
    oneLiner: string;
    keyInsights: string;
  };
  editorialSystemPrompt: string;
  retryInstructions: string;
  strictJsonSystemPrompt: string;
  validation: {
    oneLiner: LengthRule;
    keyInsight: LengthRule;
    minInsightChars: number;
    expectedScript: "cjk" | "latin";
  };
  fallbackText: {
    unavailable: string;
    contentTooShort: string;
    youtubeNoTranscript: string;
    podcastDescription: string;
    unknownSource: string;
  };
};

export const DIGEST_LANGUAGES = ["zh", "en", "de"] as const satisfies readonly DigestLanguage[];

export function isDigestLanguage(value: unknown): value is DigestLanguage {
  return typeof value === "string" && (DIGEST_LANGUAGES as readonly string[]).includes(value);
}

export function parseDigestLanguage(value: unknown): DigestLanguage {
  return isDigestLanguage(value) ? value : "zh";
}

export const SUMMARY_LANGUAGE_PROFILES: Record<DigestLanguage, SummaryLanguageProfile> = {
  zh: {
    language: "zh",
    label: "简体中文",
    promptVersion: "zh-v1",
    schema: {
      oneLiner: "1 条中文核心结论。",
      keyInsights: "3 条中文信息点，每条 1 个事实、数据、方法或结论。",
    },
    editorialSystemPrompt: `你是 DigestDesk 的中文日报编辑。将输入文章总结为简体中文。

要求：
- oneLiner：1 条核心结论，35-70 个中文字符。
- keyInsights：3 条信息点，每条只写 1 个事实、数据、方法或结论，55-90 个中文字符。
- 数值事实准确；英文金额按中文习惯换算（如 $124m -> 1.24 亿美元），数量级和指标类型准确。
- 行业术语翻译：先判断文章所属领域，再按该领域选择中文译法；不要机械直译多义词。
- 专业文章的关键术语必须符合对应行业的中文习惯。
- 若英文术语在中文专业语境中更常保留英文，优先保留英文原词；不确定时保留英文，不要误译到其他行业。`,
    retryInstructions: `上一轮输出未通过校验。请重新生成：
1. oneLiner：1 条中文核心结论。
2. keyInsights：3 条中文信息点，每条 1 个事实、数据、方法或结论。`,
    strictJsonSystemPrompt: `你是 DigestDesk 文章摘要的严格 JSON 生成器。

任务规则：
1. oneLiner：1 条核心结论，35-70 个中文字符。
2. keyInsights：3 条信息点，每条只写 1 个事实、数据、方法或结论，55-90 个中文字符。
3. 数值事实准确；英文金额按中文习惯换算（如 $124m -> 1.24 亿美元），数量级和指标类型准确。
4. 输出 JSON 对象：{"oneLiner": string, "keyInsights": [string, string, string]}。`,
    validation: {
      oneLiner: { unit: "chars", min: 35, max: 90 },
      keyInsight: { unit: "chars", min: 10, max: 130 },
      minInsightChars: 10,
      expectedScript: "cjk",
    },
    fallbackText: {
      unavailable: "暂时无法生成摘要。",
      contentTooShort: "文章内容太短，无法生成总结。",
      youtubeNoTranscript: "YouTube 视频，暂无文本总结。",
      podcastDescription: "播客已更新，以下为简介型快讯。",
      unknownSource: "未知来源",
    },
  },
  en: {
    language: "en",
    label: "English",
    promptVersion: "en-v1",
    schema: {
      oneLiner: "One complete, natural English sentence expressing the core conclusion.",
      keyInsights: "Exactly 3 complete, natural English sentences. Each expresses one concrete fact, data point, method, or conclusion.",
    },
    editorialSystemPrompt: `You are an editor for DigestDesk. Read articles in any language and output concise English summaries.

Writing rules:
- Keep the core conclusion and important facts; remove ads, links, boilerplate, and background noise.
- Preserve amounts, percentages, dates, quantities, units, and order of magnitude; do not confuse funding, revenue, valuation, cost, or spend; omit uncertain numeric details instead of guessing.
- oneLiner: one core conclusion, target 14-30 words.
- keyInsights: exactly 3 takeaways, one fact, data point, method, or conclusion each, target 18-40 words.
- Prefer a shorter complete sentence over a longer unfinished one.`,
    retryInstructions: `Previous output failed length or quality validation. Regenerate and strictly follow:
1. oneLiner must be one complete short sentence, target 14-30 words, with no ellipses, question-mark placeholders, or fragments.
2. keyInsights must contain exactly 3 independent, specific, concise items, target 18-40 words each.
3. Do not paste long source paragraphs, table-of-contents text, list dumps, or meaningless characters.`,
    strictJsonSystemPrompt: `You are a strict JSON generator for DigestDesk article summaries.

Task rules:
1. Output one complete English oneLiner sentence, 14-30 words.
2. Output keyInsights as exactly 3 complete English sentences, 18-40 words each.
3. Preserve amounts, percentages, dates, quantities, units, and order of magnitude; do not confuse funding, revenue, valuation, cost, or spend; omit uncertain numeric details instead of guessing.
4. Each key insight must contain one specific fact, data point, method, or conclusion.
5. Never use ellipses, placeholders, fragments, headings, markdown, or source text dumps.
6. Required JSON object shape: {"oneLiner": string, "keyInsights": [string, string, string]}.`,
    validation: {
      oneLiner: { unit: "words", min: 14, max: 45, minChars: 6 },
      keyInsight: { unit: "words", min: 1, max: 60, minChars: 24 },
      minInsightChars: 24,
      expectedScript: "latin",
    },
    fallbackText: {
      unavailable: "Summary unavailable for now.",
      contentTooShort: "Content is too short to generate a useful summary.",
      youtubeNoTranscript: "YouTube update with no transcript-based summary yet.",
      podcastDescription: "Podcast updated. Summary is based on the available episode description.",
      unknownSource: "Unknown source",
    },
  },
  de: {
    language: "de",
    label: "Deutsch",
    promptVersion: "de-v1",
    schema: {
      oneLiner: "Ein vollständiger, natürlicher deutscher Satz mit der Kernaussage.",
      keyInsights: "Genau 3 vollständige deutsche Sätze. Jeder Satz enthält genau einen konkreten Fakt, Datenpunkt, eine Methode oder Schlussfolgerung.",
    },
    editorialSystemPrompt: `Du bist deutschsprachige:r Redakteur:in für DigestDesk. Lies Artikel in jeder Sprache und schreibe prägnante Zusammenfassungen auf Deutsch.

Regeln:
- Bewahre die Kernaussage und die wichtigsten Fakten; entferne Werbung, Links, Boilerplate und Hintergrundrauschen.
- Bewahre Beträge, Prozentwerte, Daten, Mengen, Einheiten und Größenordnungen korrekt; verwechsle Finanzierung, Umsatz, Bewertung, Kosten oder Ausgaben nicht.
- oneLiner: genau eine zentrale Aussage als vollständiger deutscher Satz, Ziel 14-32 Wörter.
- keyInsights: genau 3 Erkenntnisse, jeweils ein Fakt, Datenpunkt, eine Methode oder Schlussfolgerung, Ziel 18-42 Wörter.
- Verwende natürliche deutsche Fachsprache; übersetze Fachbegriffe nur, wenn die deutsche Fachübersetzung üblich ist. Sonst den etablierten englischen Begriff beibehalten.
- Schreibe keine Überschriften, kein Markdown und keine wörtlichen langen Auszüge aus der Quelle.`,
    retryInstructions: `Die vorherige Ausgabe hat Längen-, Sprach- oder Qualitätsregeln verletzt. Erstelle sie erneut und halte dich strikt daran:
1. oneLiner muss ein vollständiger deutscher Satz mit 14-32 Wörtern sein.
2. keyInsights müssen genau 3 eigenständige, konkrete deutsche Sätze mit 18-42 Wörtern sein.
3. Keine Ellipsen, Platzhalter, Fragmente, Überschriften, Markdown oder Quellentext-Dumps.`,
    strictJsonSystemPrompt: `Du bist ein strikter JSON-Generator für DigestDesk-Artikelzusammenfassungen.

Aufgabenregeln:
1. Gib einen vollständigen deutschen oneLiner-Satz mit 14-32 Wörtern aus.
2. Gib keyInsights als genau 3 vollständige deutsche Sätze aus, jeweils 18-42 Wörter.
3. Bewahre Beträge, Prozentwerte, Daten, Mengen, Einheiten und Größenordnungen korrekt; verwechsle Finanzierung, Umsatz, Bewertung, Kosten oder Ausgaben nicht.
4. Jeder keyInsight enthält genau einen konkreten Fakt, Datenpunkt, eine Methode oder Schlussfolgerung.
5. Keine Ellipsen, Platzhalter, Fragmente, Überschriften, Markdown oder Quellentext-Dumps.
6. Erforderliches JSON-Objekt: {"oneLiner": string, "keyInsights": [string, string, string]}.`,
    validation: {
      oneLiner: { unit: "words", min: 12, max: 48, minChars: 8 },
      keyInsight: { unit: "words", min: 1, max: 66, minChars: 24 },
      minInsightChars: 24,
      expectedScript: "latin",
    },
    fallbackText: {
      unavailable: "Zusammenfassung derzeit nicht verfügbar.",
      contentTooShort: "Der Inhalt ist zu kurz, um eine hilfreiche Zusammenfassung zu erstellen.",
      youtubeNoTranscript: "YouTube-Update ohne transkriptbasierte Zusammenfassung.",
      podcastDescription: "Podcast aktualisiert. Die Zusammenfassung basiert auf der verfügbaren Episodenbeschreibung.",
      unknownSource: "Unbekannte Quelle",
    },
  },
};

export function getSummaryLanguageProfile(language: DigestLanguage) {
  return SUMMARY_LANGUAGE_PROFILES[language] ?? SUMMARY_LANGUAGE_PROFILES.zh;
}
