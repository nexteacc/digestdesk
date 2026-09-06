import { useMemo, useState } from "react";
import { format } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { ChevronDown, Clock3, FileText, Layers3 } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useI18n } from "@/contexts/I18nContext";
import { DIGEST_SOURCE_META, DIGEST_SOURCE_ORDER } from "@/lib/digest-sources";
import type { Digest, DigestItem, DigestSourceType, Feed } from "@/lib/types";

type DisplayDigestItem = DigestItem & { feedLogoUrl?: string };

function estimateReadingMinutes(items: DigestItem[]) {
  const content = items.flatMap((item) => [item.title, item.oneLiner, ...item.keyInsights]).join(" ");
  const cjkCount = content.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords = content.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return Math.max(1, Math.round(cjkCount / 300 + latinWords / 220));
}

export function DigestEdition({ digest, feeds, localeOverride, initialItemsPerSection }: { digest: Digest; feeds: Feed[]; localeOverride?: "zh" | "en"; initialItemsPerSection?: number }) {
  const i18n = useI18n();
  const [expandedSections, setExpandedSections] = useState<Set<DigestSourceType>>(() => new Set());
  const locale = localeOverride ?? i18n.locale;
  const text = (zh: string, en: string) => (locale === "zh" ? zh : en);
  const date = new Date(`${digest.date}T00:00:00`);
  const dateLabel = locale === "zh"
    ? format(date, "yyyy年M月d日 · EEEE", { locale: zhCN })
    : format(date, "EEEE, MMM d, yyyy", { locale: enUS });

  const feedLogoMaps = useMemo(() => {
    const byId = new Map<string, string | undefined>();
    const byTitle = new Map<string, string | undefined>();
    feeds.forEach((feed) => {
      byId.set(feed.id, feed.logoUrl);
      byTitle.set(feed.title, feed.logoUrl);
    });
    return { byId, byTitle };
  }, [feeds]);

  const sections = useMemo(() => {
    const grouped = new Map<DigestSourceType, DisplayDigestItem[]>();
    digest.items.forEach((item) => {
      const feedLogoUrl = (item.feedId ? feedLogoMaps.byId.get(item.feedId) : undefined) ?? feedLogoMaps.byTitle.get(item.feedTitle);
      const items = grouped.get(item.sourceType) ?? [];
      items.push({ ...item, feedLogoUrl });
      grouped.set(item.sourceType, items);
    });
    return DIGEST_SOURCE_ORDER.flatMap((sourceType) => {
      const items = grouped.get(sourceType) ?? [];
      return items.length > 0 ? [{ sourceType, meta: DIGEST_SOURCE_META[sourceType], items }] : [];
    });
  }, [digest, feedLogoMaps]);

  const articleNumberById = useMemo(
    () => new Map(sections.flatMap((section) => section.items).map((item, index) => [item.id, index + 1])),
    [sections],
  );

  return (
    <div className="digest-page">
      <header className="digest-page-head">
        <div className="digest-title-block">
          <h1>{text("今日日报", "Today's Digest")}</h1>
          <div className="digest-date-line"><span>{dateLabel}</span></div>
          <div className="digest-stats">
            <span><FileText />{digest.items.length} {text("篇内容", "stories")}</span>
            <span><Clock3 />{text(`约 ${estimateReadingMinutes(digest.items)} 分钟`, `about ${estimateReadingMinutes(digest.items)} min`)}</span>
            <span><Layers3 />{feeds.length} {text("个订阅源", "feeds")}</span>
          </div>
        </div>
      </header>

      <div className="digest-sections">
        {sections.map((section) => {
          const canCollapse = initialItemsPerSection !== undefined && section.items.length > initialItemsPerSection;
          const isExpanded = expandedSections.has(section.sourceType);
          const visibleItems = canCollapse && !isExpanded ? section.items.slice(0, initialItemsPerSection) : section.items;
          const hiddenCount = section.items.length - visibleItems.length;

          return <section key={section.sourceType} className="digest-section">
            <header className="digest-section-head">
              <span className="digest-source-mark"><img src={section.meta.logoUrl} alt={section.meta.enLabel} /></span>
              <span>
                <span className="digest-eyebrow">{text("栏目", "Section")}</span>
                <h2>{text(section.meta.zhLabel, section.meta.enLabel)}<small>{section.items.length} {text("篇", "items")}</small></h2>
              </span>
            </header>
            <ol className="digest-story-list">
              {visibleItems.map((item) => (
                <li key={item.id}>
                  <a href={item.url} target="_blank" rel="noreferrer" className="digest-story-card" aria-label={text(`打开原文：${item.title}`, `Open original: ${item.title}`)}>
                    <span className="digest-story-number">{String(articleNumberById.get(item.id) ?? 0).padStart(2, "0")}</span>
                    <span className="digest-story-main">
                      <span className="digest-story-meta">
                        <Avatar className="digest-feed-logo">
                          <AvatarImage src={item.feedLogoUrl} alt={item.feedTitle} />
                          <AvatarFallback>{item.feedTitle.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span>{item.feedTitle}</span>
                        {item.author ? <><span>·</span><span>{item.author}</span></> : null}
                      </span>
                      <h3 className="digest-story-title">{item.title}</h3>
                      <blockquote className="digest-summary-quote"><strong>{text("一句话总结：", "In one sentence: ")}</strong>{item.oneLiner}</blockquote>
                      {item.keyInsights.length > 0 ? <ul className="digest-insights">{item.keyInsights.slice(0, 2).map((insight) => <li key={insight}>{insight}</li>)}</ul> : null}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
            {canCollapse ? (
              <button
                type="button"
                className="digest-section-toggle"
                aria-expanded={isExpanded}
                onClick={() => setExpandedSections((current) => {
                  const next = new Set(current);
                  if (isExpanded) next.delete(section.sourceType);
                  else next.add(section.sourceType);
                  return next;
                })}
              >
                <span>{isExpanded ? text("收起本栏", "Collapse section") : text(`展开其余 ${hiddenCount} 篇`, `Show ${hiddenCount} more`)}</span>
                <ChevronDown aria-hidden="true" />
              </button>
            ) : null}
          </section>;
        })}
      </div>
    </div>
  );
}
