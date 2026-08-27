import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import {
  ArrowRight,
  ArrowUp,
  Clock3,
  FileText,
  Layers3,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/contexts/I18nContext";
import * as api from "@/lib/api";
import { DIGEST_SOURCE_META, DIGEST_SOURCE_ORDER } from "@/lib/digest-sources";
import type {
  Digest,
  DigestItem,
  DigestListItem,
  DigestOverview,
  DigestSourceType,
  Feed,
  SubstackSearchResult,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type DisplayDigestItem = DigestItem & { feedLogoUrl?: string };

const PROGRESS_PHASES = [
  { delay: 0, key: "sync" },
  { delay: 3000, key: "read" },
  { delay: 8000, key: "summary" },
  { delay: 15000, key: "polish" },
] as const;

let digestOverviewCache: DigestOverview | null = null;
const digestDetailCache = new Map<string, Digest>();

function estimateReadingMinutes(items: DigestItem[]) {
  const content = items
    .flatMap((item) => [item.title, item.oneLiner, ...item.keyInsights])
    .join(" ");
  const cjkCount = content.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords = content.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return Math.max(1, Math.round(cjkCount / 300 + latinWords / 220));
}

function GeneratingProgress() {
  const [phase, setPhase] = useState(0);
  const { text } = useI18n();
  const phaseText: Record<(typeof PROGRESS_PHASES)[number]["key"], string> = {
    sync: text("正在同步最新文章…", "Syncing articles..."),
    read: text("编辑正在阅读…", "Reading..."),
    summary: text("正在生成摘要…", "Generating summaries..."),
    polish: text("正在整理排版…", "Finishing the edition..."),
  };

  useEffect(() => {
    const timers = PROGRESS_PHASES.slice(1).map((item, index) => (
      setTimeout(() => setPhase(index + 1), item.delay)
    ));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <Card className="p-10 text-center">
      <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
      <div className="mt-4 animate-pulse text-sm text-muted-foreground">{phaseText[PROGRESS_PHASES[phase].key]}</div>
      <div className="mt-6 flex justify-center gap-1.5">
        {PROGRESS_PHASES.map((item, index) => (
          <span key={item.key} className={cn("h-1.5 w-8 rounded-full", index <= phase ? "bg-foreground/30" : "bg-border")} />
        ))}
      </div>
    </Card>
  );
}

function BackToTopButton() {
  const { text } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 520);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label={text("回到顶部", "Back to top")}
      title={text("回到顶部", "Back to top")}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={cn("digest-back-to-top", visible && "is-visible")}
    >
      <ArrowUp />
    </button>
  );
}

function WelcomeSearch({ onAdded }: { onAdded: () => void }) {
  const { text } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SubstackSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      requestId.current += 1;
      setSearching(false);
      setResults([]);
      setHasSearched(false);
      return;
    }
    const id = ++requestId.current;
    const handler = setTimeout(async () => {
      setSearching(true);
      setHasSearched(true);
      try {
        const nextResults = await api.searchSubstack(normalizedQuery);
        if (requestId.current === id) setResults(nextResults);
      } catch {
        if (requestId.current === id) toast.error(text("搜索失败", "Search failed"));
      } finally {
        if (requestId.current === id) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [query, text]);

  async function subscribe(url: string) {
    setSubscribing(url);
    try {
      await api.createFeed(url);
      toast.success(text("已订阅，正在准备日报…", "Subscribed. Preparing your digest..."));
      onAdded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text("添加失败", "Failed to add"));
      setSubscribing(null);
    }
  }

  return (
    <Card className="p-8 md:p-12">
      <div className="mx-auto max-w-md text-center">
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{text("欢迎来到你的阅读台", "Welcome to DigestDesk")}</div>
        <h2 className="mt-4 text-2xl font-semibold leading-tight md:text-3xl">{text("追踪你关心的创作者", "Track the creators you care about")}</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{text("把每天的重要更新整理成一份简洁日报", "Turn daily updates into one concise digest")}</p>
      </div>
      <div className="mx-auto mt-8 max-w-md">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text("搜索出版物名称或作者…", "Search publications or authors...")} className="pl-10" autoFocus />
        </div>
        {searching ? (
          <div className="mt-4 space-y-3">
            {[1, 2, 3].map((item) => <Skeleton key={item} className="h-16 w-full" />)}
          </div>
        ) : results.length > 0 ? (
          <div className="mt-4 space-y-2">
            {results.map((result) => (
              <div key={result.url} className="flex items-center gap-3 rounded-md border border-border p-3">
                <Avatar className="h-9 w-9 shrink-0"><AvatarImage src={result.logoUrl} alt={result.name} /><AvatarFallback>{result.name.slice(0, 2)}</AvatarFallback></Avatar>
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{result.name}</div><p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{result.description}</p></div>
                <Button size="sm" variant="outline" onClick={() => subscribe(result.url)} disabled={subscribing !== null}>
                  {subscribing === result.url ? <Loader2 className="h-3 w-3 animate-spin" /> : text("订阅", "Subscribe")}
                </Button>
              </div>
            ))}
          </div>
        ) : hasSearched ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{text("未找到匹配的出版物，试试其他关键词", "No results. Try a different search.")}</div>
        ) : null}
      </div>
    </Card>
  );
}

export default function DailyDigest() {
  const { text, locale } = useI18n();
  const [digestList, setDigestList] = useState<DigestListItem[]>([]);
  const [current, setCurrent] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [hasFeeds, setHasFeeds] = useState(true);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const activeDateRef = useRef<HTMLButtonElement>(null);

  const applyOverview = useCallback((overview: DigestOverview) => {
    digestOverviewCache = overview;
    if (overview.currentDigest) digestDetailCache.set(overview.currentDigest.id, overview.currentDigest);
    startTransition(() => {
      setDigestList(overview.digests);
      setFeeds(overview.feeds);
      setHasFeeds(overview.feeds.length > 0);
      setCurrent(overview.currentDigest);
    });
  }, []);

  const loadDigest = useCallback(async () => {
    if (digestOverviewCache) {
      applyOverview(digestOverviewCache);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      applyOverview(await api.fetchDigestOverview());
    } catch {
      if (!digestOverviewCache) toast.error(text("加载失败", "Failed to load"));
    } finally {
      setLoading(false);
    }
  }, [applyOverview, text]);

  useEffect(() => {
    void loadDigest();
  }, [loadDigest]);

  async function syncNow() {
    setGenerating(true);
    try {
      const result = await api.generateDigest("daily", { force: true });
      if (!("id" in result)) {
        toast(text("暂无新文章", "No new articles"));
        return;
      }
      const [digest, list] = await Promise.all([api.fetchDigest(result.id), api.fetchDigests("daily")]);
      digestDetailCache.set(digest.id, digest);
      applyOverview({ digests: list, currentDigest: digest, feeds });
      toast.success(text("同步完成，日报已更新", "Sync complete"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text("同步失败", "Sync failed"));
    } finally {
      setGenerating(false);
    }
  }

  const selectDigest = useCallback(async (digestId: string) => {
    const cached = digestDetailCache.get(digestId);
    if (cached) {
      startTransition(() => setCurrent(cached));
      return;
    }
    setSelectingId(digestId);
    try {
      const digest = await api.fetchDigest(digestId);
      digestDetailCache.set(digest.id, digest);
      startTransition(() => setCurrent(digest));
    } catch {
      toast.error(text("加载失败", "Failed to load"));
    } finally {
      setSelectingId(null);
    }
  }, [text]);

  const dateLabel = useMemo(() => {
    const date = current?.date ? new Date(`${current.date}T00:00:00`) : new Date();
    return locale === "zh"
      ? format(date, "yyyy年M月d日 · EEEE", { locale: zhCN })
      : format(date, "EEEE, MMM d, yyyy", { locale: enUS });
  }, [current, locale]);

  const recentDigestDays = useMemo(() => {
    if (digestList.length === 0) return [];
    const digestByDate = new Map(digestList.map((digest) => [digest.date, digest]));
    const latestDate = new Date(`${digestList[0].date}T00:00:00`);
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(latestDate, index - 6);
      const dateKey = format(date, "yyyy-MM-dd");
      return { date, dateKey, digest: digestByDate.get(dateKey) };
    });
  }, [digestList]);

  useEffect(() => {
    activeDateRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current?.id]);

  const feedLogoMaps = useMemo(() => {
    const byId = new Map<string, string | undefined>();
    const byTitle = new Map<string, string | undefined>();
    feeds.forEach((feed) => {
      byId.set(feed.id, feed.logoUrl);
      byTitle.set(feed.title, feed.logoUrl);
    });
    return { byId, byTitle };
  }, [feeds]);

  const digestSections = useMemo(() => {
    if (!current) return [];
    const grouped = new Map<DigestSourceType, DisplayDigestItem[]>();
    current.items.forEach((item) => {
      const feedLogoUrl = (item.feedId ? feedLogoMaps.byId.get(item.feedId) : undefined) ?? feedLogoMaps.byTitle.get(item.feedTitle);
      const items = grouped.get(item.sourceType) ?? [];
      items.push({ ...item, feedLogoUrl });
      grouped.set(item.sourceType, items);
    });
    return DIGEST_SOURCE_ORDER.flatMap((sourceType) => {
      const items = grouped.get(sourceType) ?? [];
      return items.length > 0 ? [{ sourceType, meta: DIGEST_SOURCE_META[sourceType], items }] : [];
    });
  }, [current, feedLogoMaps]);

  const articleNumberById = useMemo(
    () => new Map(digestSections.flatMap((section) => section.items).map((item, index) => [item.id, index + 1])),
    [digestSections],
  );
  const articleCount = current?.items.length ?? 0;
  const readingMinutes = useMemo(
    () => (current?.items.length ? estimateReadingMinutes(current.items) : 0),
    [current],
  );

  return (
    <div className="digest-page">
      <header className="digest-page-head">
        <div className="digest-title-block">
          <h1>{text("今日日报", "Today's Digest")}</h1>
          <div className="digest-date-line"><span>{dateLabel}</span></div>
          {current && digestList.length > 1 ? (
            <nav className="digest-date-rail" aria-label={text("最近 7 天的日报", "Digests from the latest 7 days")}>
              <div className="digest-date-track">
                {recentDigestDays.map(({ date, dateKey, digest }) => {
                  const isActive = digest?.id === current.id;
                  const accessibleDate = locale === "zh" ? format(date, "M月d日 EEEE", { locale: zhCN }) : format(date, "EEEE, MMMM d", { locale: enUS });
                  const accessibleLabel = digest ? accessibleDate : text(`${accessibleDate}，暂无日报`, `${accessibleDate}, no digest`);
                  return (
                    <button
                      key={dateKey}
                      ref={isActive ? activeDateRef : undefined}
                      type="button"
                      className={cn("digest-date-day", isActive && "is-active")}
                      disabled={!digest || selectingId !== null}
                      aria-current={isActive ? "date" : undefined}
                      aria-label={accessibleLabel}
                      title={!digest ? accessibleLabel : undefined}
                      onClick={() => digest && void selectDigest(digest.id)}
                    >
                      <span>{locale === "zh" ? format(date, "M月d日") : format(date, "MMM d", { locale: enUS })}</span>
                      <small>{format(date, "EEE", { locale: locale === "zh" ? zhCN : enUS })}</small>
                    </button>
                  );
                })}
              </div>
            </nav>
          ) : null}
          {!loading ? (
            <div className="digest-stats">
              <span><FileText />{articleCount} {text("篇内容", "stories")}</span>
              <span><Clock3 />{text(`约 ${readingMinutes} 分钟`, `about ${readingMinutes} min`)}</span>
              <span><Layers3 />{feeds.length} {text("个订阅源", "feeds")}</span>
            </div>
          ) : null}
        </div>
        {hasFeeds ? (
          <button type="button" className="digest-sync-button" onClick={() => void syncNow()} disabled={generating || loading}>
            <RefreshCw className={cn(generating && "animate-spin")} />
            {generating ? text("正在同步", "Syncing") : text("立即同步", "Sync now")}
          </button>
        ) : null}
      </header>

      {loading ? (
        <div className="space-y-4"><Skeleton className="h-12 w-52" /><Skeleton className="h-80 w-full" /></div>
      ) : generating ? (
        <GeneratingProgress />
      ) : !current && !hasFeeds ? (
        <WelcomeSearch onAdded={loadDigest} />
      ) : !current ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">{text("暂无日报，点击“立即同步”获取更新。", "No digest yet. Sync now to fetch updates.")}</p>
          <Button size="sm" className="mt-4" onClick={() => void syncNow()}>{text("立即同步", "Sync now")}</Button>
        </Card>
      ) : (
        <>
          <Link href="/topics/ai-leaders" className="digest-feature-band">
            <span className="digest-feature-kicker"><Sparkles />{text("专题 · AI 领航者", "Feature · AI Leaders")}</span>
            <span className="digest-feature-cell"><strong>{text("本周新增 6 场访谈", "6 new interviews this week")}</strong></span>
            <span className="digest-feature-cell">Sam Altman、Boris Cherny、Michael Truell</span>
            <span className="digest-feature-action">{text("查看专题", "View feature")}<ArrowRight /></span>
          </Link>

          <div className="digest-sections">
            {digestSections.map((section) => (
              <section key={section.sourceType} className="digest-section">
                <header className="digest-section-head">
                  <span className="digest-source-mark"><img src={section.meta.logoUrl} alt={section.meta.enLabel} /></span>
                  <span>
                    <span className="digest-eyebrow">{text("栏目", "Section")}</span>
                    <h2>{text(section.meta.zhLabel, section.meta.enLabel)}<small>{section.items.length} {text("篇", "items")}</small></h2>
                  </span>
                </header>
                <ol className="digest-story-list">
                  {section.items.map((item) => (
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
                          {item.keyInsights.length > 0 ? (
                            <ul className="digest-insights">
                              {item.keyInsights.slice(0, 2).map((insight) => <li key={insight}>{insight}</li>)}
                            </ul>
                          ) : null}
                        </span>
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
          <BackToTopButton />
        </>
      )}
    </div>
  );
}
