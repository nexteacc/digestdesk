import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import * as api from "@/lib/api";
import type { Digest, DigestItem, DigestListItem, DigestOverview, DigestSourceType, Feed, SubstackSearchResult } from "@/lib/types";
import { DIGEST_SOURCE_META, DIGEST_SOURCE_ORDER } from "@/lib/digest-sources";
import {
  ExternalLink,
  Loader2,
  CheckCircle2,
  Search,
  RefreshCw,
  ArrowUp,
  ChevronDown,
  Pause,
  Play,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { useZenMode } from "@/hooks/useZenMode";
import { useI18n } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

let digestOverviewCache: DigestOverview | null = null;
const digestDetailCache = new Map<string, Digest>();

function DigestVoicePlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const { text } = useI18n();

  return (
    <button
      type="button"
      aria-label={isPlaying ? text("暂停雷军语音日报", "Pause Lei Jun's audio digest") : text("播放雷军语音日报", "Play Lei Jun's audio digest")}
      aria-pressed={isPlaying}
      onClick={() => setIsPlaying((playing) => !playing)}
      className="group flex shrink-0 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className={cn(
        "relative h-10 w-10 shrink-0 overflow-hidden rounded-full ring-1 ring-inset ring-border transition-all duration-200 group-hover:ring-foreground/30",
        isPlaying && "ring-2 ring-primary"
      )}>
        <img
          src="/avatars/lei-jun.jpg"
          alt=""
          title={text("雷军（图片：DirectX3，CC BY-SA 4.0）", "Lei Jun (photo: DirectX3, CC BY-SA 4.0)")}
          data-source="https://commons.wikimedia.org/wiki/File:Lei_Jun.jpg"
          className="h-full w-full object-cover"
        />
        <span className={cn(
          "absolute inset-0 flex items-center justify-center bg-black/20 text-white transition-colors group-hover:bg-black/30",
          isPlaying && "bg-black/35"
        )}>
          {isPlaying ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 translate-x-px fill-current" />}
        </span>
      </span>
      <span className="flex flex-col items-start leading-none">
        <span className="text-sm font-semibold text-foreground">{text("雷军", "Lei Jun")}</span>
        <span className="mt-1.5 text-[11px] text-muted-foreground">{text("6 分钟", "6 min")}</span>
      </span>
    </button>
  );
}

// --- 生成进度阶段 ---
const PROGRESS_PHASES = [
  { delay: 0, key: "sync" },
  { delay: 3000, key: "read" },
  { delay: 8000, key: "summary" },
  { delay: 15000, key: "polish" },
] as const;

function GeneratingProgress() {
  const [phase, setPhase] = useState(0);
  const { text } = useI18n();

  const phaseText: Record<(typeof PROGRESS_PHASES)[number]["key"], string> = {
    sync: text("正在同步最新文章…", "Syncing articles..."),
    read: text("编辑正在阅读…", "Reading..."),
    summary: text("正在生成摘要…", "Generating..."),
    polish: text("正在整理排版…", "Wrapping up..."),
  };

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < PROGRESS_PHASES.length; i++) {
      timers.push(setTimeout(() => setPhase(i), PROGRESS_PHASES[i].delay));
    }
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <Card className="p-10 text-center">
      <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
      <div className="mt-4 text-sm text-muted-foreground animate-pulse">
        {phaseText[PROGRESS_PHASES[phase].key]}
      </div>
      <div className="mt-6 flex justify-center gap-1.5">
        {PROGRESS_PHASES.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 w-8 rounded-full transition-colors duration-500 ${
              i <= phase ? "bg-foreground/30" : "bg-border"
            }`}
          />
        ))}
      </div>
    </Card>
  );
}

// --- 阅读完成仪式 ---
function ReadingComplete({ itemCount }: { itemCount: number }) {
  const [visible, setVisible] = useState(false);
  const [readingMinutes, setReadingMinutes] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const mountTime = useRef(0);
  const { text } = useI18n();

  useEffect(() => {
    mountTime.current = Date.now();
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !visible) {
          const minutes = Math.max(
            1,
            Math.round((Date.now() - mountTime.current) / 60000),
          );
          setReadingMinutes(minutes);
          setVisible(true);
        }
      },
      { threshold: 0.5 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <>
      <div ref={sentinelRef} className="h-1" />
      {visible && (
        <Card className="p-6 text-center border-green-200 bg-green-50/50 animate-in fade-in duration-700">
          <CheckCircle2 className="h-8 w-8 mx-auto text-green-600" />
          <div className="mt-3 text-lg font-semibold">{text("今天的日报已读完", "You're all caught up")}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {text(`共读完 ${itemCount} 条更新 · 用时约 ${readingMinutes} 分钟`, `${itemCount} updates read · about ${readingMinutes} min`)}
          </div>
          <div className="mt-4">
          </div>
        </Card>
      )}
    </>
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
      className={cn(
        "fixed bottom-6 right-4 z-40 inline-flex h-14 w-10 items-center justify-center rounded-md border border-foreground/12 bg-background/98 text-foreground shadow-[0_10px_28px_rgba(0,0,0,0.10)] backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-foreground/22 hover:bg-background hover:shadow-[0_16px_36px_rgba(0,0,0,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "md:bottom-10 md:right-8 md:h-16 md:w-11",
        visible ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
      )}
    >
      <ArrowUp className="h-4 w-4 md:h-4.5 md:w-4.5" />
    </button>
  );
}

// --- 首页欢迎 + 内联搜索 ---
function WelcomeSearch({ onAdded }: { onAdded: () => void }) {
  const { text } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SubstackSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
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
        const r = await api.searchSubstack(q);
        if (requestId.current === id) setResults(r);
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
      toast.success(text("已订阅，正在准备日报…", "Subscribed! Preparing digest..."));
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : text("添加失败", "Failed to add"));
      setSubscribing(null);
    }
  }

  return (
    <Card className="p-8 md:p-12">
      <div className="max-w-md mx-auto text-center">
        <div className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
          {text("欢迎来到你的阅读台", "Welcome to DigestDesk")}
        </div>
        <h3 className="mt-4 text-2xl md:text-3xl font-semibold leading-tight">
          {text("追踪你关心的创作者", "Track the creators you care about")}
        </h3>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          {text("把每天的重要更新整理成一份简洁日报", "Turn daily updates into one concise digest")}
        </p>
      </div>

      <div className="max-w-md mx-auto mt-8">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={text("搜索出版物名称或作者…", "Search...")}
            className="pl-10"
            autoFocus
          />
        </div>

        {(searching || results.length > 0 || (hasSearched && results.length === 0)) && (
          <div className="mt-4">
            {searching ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-2">
                    <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-[140px]" />
                      <Skeleton className="h-3 w-[220px]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : results.length > 0 ? (
              <div className="space-y-2">
                {results.map((r) => (
                  <div
                    key={r.url}
                    className="flex items-center gap-3 rounded-md border border-border p-3 transition-colors hover:bg-accent/40"
                  >
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarImage src={r.logoUrl} alt={r.name} />
                      <AvatarFallback className="text-xs">
                        {r.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{r.name}</span>
                        <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                          {text("作者：", "by ")}{r.authorName}
                        </span>
                      </div>
                      {r.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {r.description}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => subscribe(r.url)}
                      disabled={subscribing !== null}
                      className="shrink-0 gap-1.5"
                    >
                      {subscribing === r.url ? (
                        <><Loader2 className="h-3 w-3 animate-spin" />{text("订阅中…", "Subscribing...")}</>
                      ) : (
                        text("订阅", "Subscribe")
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {text("未找到匹配的出版物，试试其他关键词", "No results. Try a different search.")}
              </div>
            )}
          </div>
        )}


      </div>
    </Card>
  );
}

// --- 主页面 ---
export default function DailyDigest() {
  const { text, locale } = useI18n();
  const [digestList, setDigestList] = useState<DigestListItem[]>([]);
  const [current, setCurrent] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [hasFeeds, setHasFeeds] = useState(true);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [isMobileTocOpen, setIsMobileTocOpen] = useState(false);
  const { isZen } = useZenMode();

  const applyOverview = useCallback((overview: DigestOverview) => {
    digestOverviewCache = overview;
    if (overview.currentDigest) {
      digestDetailCache.set(overview.currentDigest.id, overview.currentDigest);
    }

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
      const overview = await api.fetchDigestOverview();
      applyOverview(overview);
    } catch {
      if (!digestOverviewCache) {
        toast.error(text("加载失败", "Failed to load"));
      }
    } finally {
      setLoading(false);
    }
  }, [applyOverview, text]);

  useEffect(() => {
    loadDigest();
  }, [loadDigest]);

  // 立即同步并刷新最近一期日报
  async function syncNow() {
    setGenerating(true);
    try {
      const result = await api.generateDigest("daily", { force: true });
      if ("status" in result && result.status === "empty") {
        toast(text("暂无新文章", "No new articles"));
        return;
      }
      if (!("id" in result)) {
        toast(text("暂无新文章", "No new articles"));
        return;
      }
      const digest = await api.fetchDigest(result.id);
      const list = await api.fetchDigests("daily");
      digestDetailCache.set(digest.id, digest);
      const nextOverview: DigestOverview = {
        digests: list,
        currentDigest: digest,
        feeds,
      };
      applyOverview(nextOverview);
      toast.success(text("同步完成，日报已更新", "Sync complete"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : text("同步失败", "Sync failed"));
    } finally {
      setGenerating(false);
    }
  }

  async function selectDigest(item: DigestListItem) {
    const cached = digestDetailCache.get(item.id);
    if (cached) {
      startTransition(() => {
        setCurrent(cached);
      });
      return;
    }

    setSelectingId(item.id);
    try {
      const full = await api.fetchDigest(item.id);
      digestDetailCache.set(item.id, full);
      startTransition(() => {
        setCurrent(full);
      });
    } catch {
      toast.error(text("加载失败", "Failed to load"));
    } finally {
      setSelectingId(null);
    }
  }

  const todayLabel = useMemo(
    () => {
      const date = current?.date ? new Date(current.date + 'T00:00:00') : new Date();
      return locale === "zh"
        ? format(date, "yyyy-MM-dd · EEEE", { locale: zhCN })
        : format(date, "EEEE, MMM d, yyyy", { locale: enUS });
    },
    [current, locale],
  );

  const formatDigestDate = useCallback((dateText: string) => {
    const date = new Date(`${dateText}T00:00:00`);
    return locale === "zh"
      ? format(date, "yyyy-MM-dd", { locale: zhCN })
      : format(date, "MMM d, yyyy", { locale: enUS });
  }, [locale]);

  const stats = useMemo(() => {
    const feedCount = feeds.length;
    const digestDays = digestList.length;
    const articleCount = current?.items.length ?? 0;

    return { feedCount, digestDays, articleCount };
  }, [feeds, digestList, current]);

  const { feedCount, digestDays, articleCount } = stats;

  // --- TOC ---
  const feedLogoMaps = useMemo(() => {
    const byId = new Map<string, string | undefined>();
    const byTitle = new Map<string, string | undefined>();
    feeds.forEach((f) => {
      byId.set(f.id, f.logoUrl);
      byTitle.set(f.title, f.logoUrl);
    });
    return { byId, byTitle };
  }, [feeds]);

  const digestSections = useMemo(() => {
    if (!current) return [];

    const grouped = new Map<DigestSourceType, Array<DigestItem & { anchorId: string; feedLogoUrl?: string }>>();

    current.items.forEach((item) => {
      const anchorId = `a-${item.sourceType}-${slugify(item.feedTitle)}-${slugify(item.title)}-${item.id.slice(0, 6)}`;
      const feedLogoUrl = (item.feedId ? feedLogoMaps.byId.get(item.feedId) : undefined) ?? feedLogoMaps.byTitle.get(item.feedTitle);
      const list = grouped.get(item.sourceType) ?? [];
      list.push({ ...item, anchorId, feedLogoUrl });
      grouped.set(item.sourceType, list);
    });

    return DIGEST_SOURCE_ORDER
      .map((sourceType) => {
        const items = grouped.get(sourceType) ?? [];
        if (items.length === 0) return null;
        return {
          sourceType,
          meta: DIGEST_SOURCE_META[sourceType],
          items,
        };
      })
      .filter((section): section is NonNullable<typeof section> => section !== null);
  }, [current, feedLogoMaps]);

  const handleTocClick = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setIsMobileTocOpen(false);
  }, []);

  const articleNumberById = useMemo(
    () => new Map(digestSections.flatMap((section) => section.items).map((item, index) => [item.id, index + 1])),
    [digestSections],
  );

  return (
      <div className="flex flex-col">
        <div className={cn(
          "transition-all duration-500 ease-in-out overflow-hidden",
          isZen ? "max-h-0 opacity-0 mb-0" : "max-h-[420px] opacity-100 mb-8"
        )}>
          <div className="flex flex-1 flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h2 className="text-5xl font-semibold leading-none tracking-tight md:text-6xl lg:text-7xl">
                {text("今日日报", "Today's Digest")}
              </h2>
              <div className="mt-4 text-lg text-muted-foreground md:text-xl">{todayLabel}</div>
              {!loading && (
                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-foreground/70">
                  <span><strong className="font-semibold text-foreground">{articleCount}</strong> {text("篇内容", "stories")}</span>
                  <span><strong className="font-semibold text-foreground">{feedCount}</strong> {text("个订阅源", "feeds")}</span>
                  {digestDays > 0 && (
                    <span>{text(`第 ${digestDays} 期`, `Edition ${digestDays}`)}</span>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 md:justify-end">
              <DigestVoicePlayer />
              {hasFeeds && (
                <Button
                  size="sm"
                  className="h-11 gap-1.5 rounded-full text-xs font-medium shadow-sm md:h-8"
                  onClick={syncNow}
                  disabled={generating || loading}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${generating ? "animate-spin" : ""}`} />
                  {generating ? text("正在同步", "Syncing") : text("立即同步", "Sync Now")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="space-y-4">
            <Skeleton className="h-10 w-[200px]" />
            <Skeleton className="h-[300px] rounded-lg" />
          </div>
        )}

        {/* Generating */}
        {!loading && generating && <GeneratingProgress />}

        {/* Empty: no feeds — welcome + inline search */}
        {!loading && !generating && !current && !hasFeeds && (
          <WelcomeSearch onAdded={loadDigest} />
        )}

        {/* Empty: has feeds but no digest */}
        {!loading && !generating && !current && hasFeeds && (
          <Card className="p-10 text-center">
            <div className="text-sm text-muted-foreground">
              {text("暂无简报。点击“立即同步”获取更新。", "No brief yet. Click Sync Now to fetch updates.")}
            </div>
            <Button
              size="sm"
              className="mt-4 h-11 gap-1.5 rounded-full text-xs font-medium shadow-sm md:h-8"
              onClick={syncNow}
              disabled={generating || loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${generating ? "animate-spin" : ""}`} />
              {text("立即同步", "Sync Now")}
            </Button>
          </Card>
        )}

        {/* Has digest content */}
        {!loading && !generating && current && (
          <>
            {digestList.length > 1 && (
              <div className={cn(
                "transition-all duration-500 ease-in-out overflow-hidden",
                isZen ? "max-h-0 opacity-0 mb-0" : "max-h-[200px] opacity-100 mb-6"
              )}>
                <div className="flex flex-wrap items-center gap-3 rounded-md bg-secondary/35 px-4 py-3">
                  <div className="mr-2 text-xs tracking-[0.18em] uppercase text-muted-foreground">
                    {text("归档", "Archive")}
                  </div>
                  {digestList.slice(0, 7).map((d) => {
                    const active = current.id === d.id;
                    return (
                      <Button
                        key={d.id}
                        variant={active ? "default" : "ghost"}
                        size="sm"
                        className={cn("transition-colors", active ? "text-primary-foreground" : "text-foreground/75")}
                        onClick={() => selectDigest(d)}
                        disabled={selectingId !== null}
                      >
                        {formatDigestDate(d.date)}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            <a
              href="https://mega4labs.vercel.app/"
              target="_blank"
              rel="noreferrer"
              className="group mb-8 flex cursor-pointer flex-col gap-4 rounded-md bg-primary/[0.07] px-5 py-5 transition-colors hover:bg-primary/[0.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 md:flex-row md:items-center md:justify-between md:px-6"
            >
              <div className="flex min-w-0 items-start gap-4 md:items-center">
                <Sparkles className="mt-1 h-5 w-5 shrink-0 text-primary md:mt-0" />
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    {text("专题 · Mega4Labs 策展", "Feature · Curated by Mega4Labs")}
                  </div>
                  <div className="mt-1 text-xl font-semibold md:text-2xl">
                    {text("AI 行业领航者", "AI Industry Sailors")}
                  </div>
                  <div className="mt-1 text-sm text-foreground/65">
                    {text("追踪塑造 AI 未来的人，以及他们真正说过什么。", "Long-form interviews with the people shaping AI.")}
                  </div>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-primary">
                {text("查看策展", "Explore")}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </a>

            <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-10">
              <aside id="digest-toc" className="flex flex-col rounded-md bg-secondary/35 p-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-5rem)] lg:overflow-hidden lg:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
                      {text("目录", "Contents")}
                    </div>
                    <h3 className="mt-2 text-lg font-semibold md:text-xl">
                      {formatDigestDate(current.date)} · {text("日报", "Digest")}
                    </h3>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {current.items.length} {text("篇文章", "articles")}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 lg:hidden"
                    aria-expanded={isMobileTocOpen}
                    aria-controls="digest-toc-list"
                    aria-label={isMobileTocOpen ? text("收起目录", "Collapse contents") : text("展开目录", "Expand contents")}
                    onClick={() => setIsMobileTocOpen((open) => !open)}
                  >
                    <ChevronDown className={cn("h-4 w-4 transition-transform", isMobileTocOpen && "rotate-180")} />
                  </Button>
                </div>
                <ScrollArea
                  id="digest-toc-list"
                  className={cn(
                    "mt-4 -mx-2 px-2 lg:h-auto lg:min-h-0 lg:flex-1 lg:overscroll-contain",
                    isMobileTocOpen ? "h-[min(50vh,320px)]" : "hidden lg:block",
                  )}
                >
                  <div className="space-y-6 pb-4">
                    {digestSections.map((section) => (
                      <section key={section.sourceType}>
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background">
                            <img src={section.meta.logoUrl} alt={section.meta.enLabel} className="h-4 w-4 object-contain" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">
                              {text(section.meta.zhLabel, section.meta.enLabel)}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {section.items.length} {text("篇", "items")}
                            </div>
                          </div>
                        </div>
                        <ol className="mt-4 space-y-4">
                          {section.items.map((item) => (
                            <li key={item.anchorId}>
                              <button
                                type="button"
                                className="group block w-full cursor-pointer text-left leading-snug hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                onClick={() => handleTocClick(item.anchorId)}
                              >
                                <div className="flex items-center gap-2 text-[12px] text-muted-foreground tracking-wide group-hover:text-foreground transition-colors">
                                  <span className="inline-flex h-5 w-6 items-center justify-center text-[11px] font-semibold tabular-nums text-foreground/55">
                                    {String(articleNumberById.get(item.id) ?? 0).padStart(2, "0")}
                                  </span>
                                  <Avatar className="h-5 w-5 border border-border bg-muted">
                                    <AvatarImage src={item.feedLogoUrl} alt={item.feedTitle} />
                                    <AvatarFallback className="text-[10px]">
                                      {item.feedTitle.slice(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="truncate">{item.feedTitle}</span>
                                </div>
                                <div className="mt-1 pl-8 text-sm transition-colors line-clamp-2">
                                  {item.title}
                                </div>
                              </button>
                            </li>
                          ))}
                        </ol>
                      </section>
                    ))}
                  </div>
                </ScrollArea>
              </aside>

              <div className="space-y-12">
                {digestSections.map((section) => (
                  <section key={section.sourceType}>
                    <div className="mb-2 flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/45">
                        <img src={section.meta.logoUrl} alt={section.meta.enLabel} className="h-5 w-5 object-contain" />
                      </span>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{text("栏目", "Section")}</div>
                        <h3 className="mt-0.5 text-2xl font-semibold md:text-3xl">
                          {text(section.meta.zhLabel, section.meta.enLabel)}
                          <span className="ml-2 text-sm font-normal text-muted-foreground">{section.items.length} {text("篇", "items")}</span>
                        </h3>
                      </div>
                    </div>

                    <ol>
                      {section.items.map((it) => (
                        <li key={it.id}>
                          <article className="scroll-mt-8 py-7" id={it.anchorId}>
                            <div className="grid gap-4 lg:grid-cols-[52px_minmax(0,1fr)_auto] lg:gap-6">
                              <div className="text-2xl font-medium tabular-nums text-foreground/45 md:text-3xl">
                                {String(articleNumberById.get(it.id) ?? 0).padStart(2, "0")}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Avatar className="h-5 w-5 border border-border bg-muted">
                                    <AvatarImage src={it.feedLogoUrl} alt={it.feedTitle} />
                                    <AvatarFallback className="text-[9px]">{it.feedTitle.slice(0, 2).toUpperCase()}</AvatarFallback>
                                  </Avatar>
                                  <span>{it.feedTitle}</span>
                                  {it.author && <span>· {it.author}</span>}
                                </div>
                                <h4 className="mt-2 text-xl font-semibold leading-snug break-words md:text-2xl lg:text-[1.7rem]">
                                  {it.title}
                                </h4>
                                <p className="mt-3 max-w-4xl text-base leading-7 text-foreground/75 break-words">
                                  {it.oneLiner}
                                </p>
                                {it.keyInsights.length > 0 && (
                                  <ul className="mt-4 max-w-4xl space-y-2 text-sm leading-6 text-foreground/70">
                                    {it.keyInsights.map((k, i) => (
                                      <li key={i} className="flex gap-3">
                                        <span aria-hidden="true" className="mt-[0.65rem] h-1 w-1 shrink-0 rounded-full bg-primary/70" />
                                        <span>{k}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <a
                                href={it.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-fit cursor-pointer items-center gap-1.5 text-sm font-semibold text-foreground/65 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 lg:mt-8"
                              >
                                {text("原文", "Original")}
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </div>
                          </article>
                        </li>
                      ))}
                    </ol>
                  </section>
                ))}

                <ReadingComplete itemCount={current.items.length} />
              </div>
            </div>
            <BackToTopButton />
          </>
        )}
      </div>
  );
}
