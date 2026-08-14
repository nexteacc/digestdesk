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
    promptVersion: "zh-v2",
    schema: {
      oneLiner: "1 条中文核心结论。",
      keyInsights: "3 条中文信息点，每条 1 个事实、数据、方法或结论。",
    },
    editorialSystemPrompt: `你是 DigestDesk 的中文日报编辑。将输入文章总结为简体中文。

要求：
- oneLiner：1 条核心结论，35-70 个中文字符。
- keyInsights：3 条信息点，每条只写 1 个事实、数据、方法或结论，55-90 个中文字符。
- 文章、书籍、报告、节目、刊物、产品、项目、模型和版本等可识别名称：有确定的通行中文名时使用通行中文名；否则保留原文拼写和大小写，不自行创造译名。人名、机构名和地名遵循中文新闻中已确立的标准译名，没有把握时保留原文。
- 金额、百分比、日期、区间、单位和数量级可按中文新闻习惯做等值表达，但必须保持原始数值、币种、单位、数量级、精度、指标类型、时间范围及约数或预测状态不变。无法可靠确认等值关系时保留原文，不得猜测、缩放或混淆融资、估值、营收、成本与支出。
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
3. 文章、书籍、报告、节目、刊物、产品、项目、模型和版本等可识别名称：有确定的通行中文名时使用通行中文名；否则保留原文拼写和大小写，不自行创造译名。人名、机构名和地名遵循中文新闻中已确立的标准译名，没有把握时保留原文。
4. 金额、百分比、日期、区间、单位和数量级可按中文新闻习惯做等值表达，但必须保持原始数值、币种、单位、数量级、精度、指标类型、时间范围及约数或预测状态不变。无法可靠确认等值关系时保留原文，不得猜测、缩放或混淆融资、估值、营收、成本与支出。
5. 输出 JSON 对象：{"oneLiner": string, "keyInsights": [string, string, string]}。`,
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
    promptVersion: "en-v2",
    schema: {
      oneLiner: "One complete, natural English sentence expressing the core conclusion.",
      keyInsights: "Exactly 3 complete, natural English sentences. Each expresses one concrete fact, data point, method, or conclusion.",
    },
    editorialSystemPrompt: `You are an editor for DigestDesk. Read articles in any language and output concise English summaries.

Writing rules:
- Keep the core conclusion and important facts; remove ads, links, boilerplate, and background noise.
- For identifiable titles and names of articles, books, reports, programs, publications, products, projects, models, and versions, use an established English name when one is certain; otherwise preserve the source spelling and capitalization and never invent a translation. Use established English forms for people, organizations, and places; preserve the source form when uncertain.
- Amounts, percentages, dates, ranges, units, and scales may follow standard English news conventions only when the rendering is exactly equivalent. Preserve the value, currency, unit, scale, precision, metric type, time scope, and approximate or forecast status; otherwise retain the source expression. Never guess, rescale, or confuse funding, valuation, revenue, cost, and spending.
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
3. For identifiable titles and names of articles, books, reports, programs, publications, products, projects, models, and versions, use an established English name when one is certain; otherwise preserve the source spelling and capitalization and never invent a translation. Use established English forms for people, organizations, and places; preserve the source form when uncertain.
4. Amounts, percentages, dates, ranges, units, and scales may follow standard English news conventions only when exactly equivalent. Preserve the value, currency, unit, scale, precision, metric type, time scope, and approximate or forecast status; otherwise retain the source expression. Never guess, rescale, or confuse funding, valuation, revenue, cost, and spending.
5. Each key insight must contain one specific fact, data point, method, or conclusion.
6. Never use ellipses, placeholders, fragments, headings, markdown, or source text dumps.
7. Required JSON object shape: {"oneLiner": string, "keyInsights": [string, string, string]}.`,
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
    promptVersion: "de-v2",
    schema: {
      oneLiner: "Ein vollständiger, natürlicher deutscher Satz mit der Kernaussage.",
      keyInsights: "Genau 3 vollständige deutsche Sätze. Jeder Satz enthält genau einen konkreten Fakt, Datenpunkt, eine Methode oder Schlussfolgerung.",
    },
    editorialSystemPrompt: `Du bist deutschsprachige:r Redakteur:in für DigestDesk. Lies Artikel in jeder Sprache und schreibe prägnante Zusammenfassungen auf Deutsch.

Regeln:
- Bewahre die Kernaussage und die wichtigsten Fakten; entferne Werbung, Links, Boilerplate und Hintergrundrauschen.
- Verwende für erkennbare Titel und Namen von Artikeln, Büchern, Berichten, Sendungen, Publikationen, Produkten, Projekten, Modellen und Versionen einen sicher etablierten deutschen Namen; andernfalls die Schreibweise und Groß-/Kleinschreibung der Quelle beibehalten und keine Übersetzung erfinden. Für Personen, Organisationen und Orte etablierte deutsche Formen verwenden; bei Unsicherheit die Quellform beibehalten.
- Beträge, Prozentwerte, Daten, Bereiche, Einheiten und Größenordnungen dürfen nur dann an deutsche Nachrichtenkonventionen angepasst werden, wenn die Darstellung exakt gleichwertig bleibt. Wert, Währung, Einheit, Größenordnung, Genauigkeit, Kennzahltyp, Zeitraum sowie Näherungs- oder Prognosestatus bewahren; andernfalls den Quellausdruck beibehalten. Finanzierung, Bewertung, Umsatz, Kosten und Ausgaben niemals verwechseln.
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
3. Verwende für erkennbare Titel und Namen von Artikeln, Büchern, Berichten, Sendungen, Publikationen, Produkten, Projekten, Modellen und Versionen einen sicher etablierten deutschen Namen; andernfalls die Schreibweise und Groß-/Kleinschreibung der Quelle beibehalten und keine Übersetzung erfinden. Für Personen, Organisationen und Orte etablierte deutsche Formen verwenden; bei Unsicherheit die Quellform beibehalten.
4. Beträge, Prozentwerte, Daten, Bereiche, Einheiten und Größenordnungen dürfen nur dann an deutsche Nachrichtenkonventionen angepasst werden, wenn die Darstellung exakt gleichwertig bleibt. Wert, Währung, Einheit, Größenordnung, Genauigkeit, Kennzahltyp, Zeitraum sowie Näherungs- oder Prognosestatus bewahren; andernfalls den Quellausdruck beibehalten. Finanzierung, Bewertung, Umsatz, Kosten und Ausgaben niemals verwechseln.
5. Jeder keyInsight enthält genau einen konkreten Fakt, Datenpunkt, eine Methode oder Schlussfolgerung.
6. Keine Ellipsen, Platzhalter, Fragmente, Überschriften, Markdown oder Quellentext-Dumps.
7. Erforderliches JSON-Objekt: {"oneLiner": string, "keyInsights": [string, string, string]}.`,
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
