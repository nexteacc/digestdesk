import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Link } from "wouter";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import * as api from "@/lib/api";
import type { Digest, DigestListItem, Feed, SubstackSearchResult } from "@/lib/types";
import {
  ExternalLink,
  Loader2,
  CheckCircle2,
  Search,
  RefreshCw,
} from "lucide-react";
import { useZenMode } from "@/hooks/useZenMode";
import { cn } from "@/lib/utils";

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

// --- 生成进度阶段 ---
const PROGRESS_PHASES = [
  { delay: 0, text: "正在同步最新文章…" },
  { delay: 3000, text: "AI 正在阅读文章…" },
  { delay: 8000, text: "正在生成摘要…" },
  { delay: 15000, text: "正在整理排版…" },
];

function GeneratingProgress() {
  const [phase, setPhase] = useState(0);

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
        {PROGRESS_PHASES[phase].text}
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
          <div className="mt-3 text-lg font-semibold">今日日报已读完</div>
          <div className="mt-1 text-sm text-muted-foreground">
            共 {itemCount} 篇文章 · 阅读用时约 {readingMinutes} 分钟
          </div>
          <div className="mt-4">
          </div>
        </Card>
      )}
    </>
  );
}

// --- 首页欢迎 + 内联搜索 ---
function WelcomeSearch({ onAdded }: { onAdded: () => void }) {
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
        if (requestId.current === id) toast.error("搜索失败");
      } finally {
        if (requestId.current === id) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [query]);

  async function subscribe(url: string) {
    setSubscribing(url);
    try {
      await api.createFeed(url);
      toast.success("已订阅，正在准备你的第一份日报…");
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败");
      setSubscribing(null);
    }
  }

  return (
    <Card className="p-8 md:p-12">
      <div className="max-w-md mx-auto text-center">
        <div className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
          Welcome to your desk
        </div>
        <h3 className="mt-4 text-2xl md:text-3xl font-semibold leading-tight">
          集中跟踪，轻松读完
        </h3>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          添加你关注的创作者，DigestDesk 每天帮你读完他们的最新文章
        </p>
      </div>

      <div className="max-w-md mx-auto mt-8">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索出版物名称或作者…"
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
                          by {r.authorName}
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
                        <><Loader2 className="h-3 w-3 animate-spin" />添加中</>
                      ) : (
                        "订阅"
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-muted-foreground">
                未找到匹配的出版物，试试其他关键词
              </div>
            )}
          </div>
        )}

        {!hasSearched && (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            也可以前往
            <Link href="/subscriptions">
              <span className="underline underline-offset-4 hover:text-foreground mx-1">
                订阅源管理
              </span>
            </Link>
            通过 URL 添加
          </p>
        )}
      </div>
    </Card>
  );
}

// --- 主页面 ---
export default function DailyDigest() {
  const [digestList, setDigestList] = useState<DigestListItem[]>([]);
  const [current, setCurrent] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [hasFeeds, setHasFeeds] = useState(true);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const { isZen } = useZenMode();

  const loadDigest = useCallback(async () => {
    setLoading(true);
    try {
      const [dailyList, feeds] = await Promise.all([
        api.fetchDigests("daily"),
        api.fetchFeeds(),
      ]);
      setDigestList(dailyList);
      setHasFeeds(feeds.length > 0);
      setFeeds(feeds);

      if (dailyList.length > 0) {
        const d = await api.fetchDigest(dailyList[0].id);
        setCurrent(d);
      } else if (feeds.length > 0) {
        setLoading(false);
        await autoGenerate();
        return;
      }
    } catch {
      toast.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDigest();
  }, [loadDigest]);

  async function autoGenerate() {
    setGenerating(true);
    try {
      const { id } = await api.generateDigest("daily");
      const digest = await api.fetchDigest(id);
      setCurrent(digest);
      const list = await api.fetchDigests("daily");
      setDigestList(list);
      toast.success("日报生成成功");
    } catch (e) {
      // 生成失败（可能没有新文章），展示空状态提示
      console.log("[DailyDigest] auto-generate failed:", e);
      toast("暂无新文章，稍后再来看看");
    } finally {
      setGenerating(false);
    }
  }

  // 立即同步并生成今日日报
  async function syncNow() {
    setGenerating(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { id } = await api.generateDigest("daily", { date: today, force: true });
      const digest = await api.fetchDigest(id);
      setCurrent(digest);
      const list = await api.fetchDigests("daily");
      setDigestList(list);
      toast.success("同步并生成今日日报成功");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "同步失败");
    } finally {
      setGenerating(false);
    }
  }

  async function selectDigest(item: DigestListItem) {
    setSelectingId(item.id);
    try {
      const full = await api.fetchDigest(item.id);
      setCurrent(full);
    } catch {
      toast.error("加载失败");
    } finally {
      setSelectingId(null);
    }
  }

  const todayLabel = useMemo(
    () => {
      const date = current?.date ? new Date(current.date + 'T00:00:00') : new Date();
      return format(date, "yyyy-MM-dd · EEEE", { locale: zhCN });
    },
    [current],
  );

  const stats = useMemo(() => {
    const feedCount = feeds.length;
    const digestDays = digestList.length;
    const articleCount = current?.items.length ?? 0;

    return { feedCount, digestDays, articleCount };
  }, [feeds, digestList, current]);

  const { feedCount, digestDays, articleCount } = stats;

  // --- TOC ---
  const feedLogoMap = useMemo(() => {
    const map = new Map<string, string | undefined>();
    feeds.forEach((f) => {
      map.set(f.title, f.logoUrl);
    });
    return map;
  }, [feeds]);

  const toc = useMemo(() => {
    if (!current) return [];
    return current.items.map((it) => ({
      id: `a-${slugify(it.feedTitle)}-${slugify(it.title)}-${it.id.slice(0, 6)}`,
      title: it.title,
      feedTitle: it.feedTitle,
      logoUrl: feedLogoMap.get(it.feedTitle),
    }));
  }, [current, feedLogoMap]);

  const handleTocClick = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <AppShell>
      <div className="flex flex-col">
        {/* Header */}
        <div className={cn(
          "transition-all duration-500 ease-in-out overflow-hidden",
          isZen ? "max-h-0 opacity-0 mb-0" : "max-h-[300px] opacity-100 mb-6"
        )}>
          <div className="flex-1 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <div className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
                Daily Digest
              </div>
              <h2 className="mt-1 text-3xl font-semibold tracking-tight">
                今日日报
              </h2>
            </div>
            <div className="flex items-center gap-3">
              {hasFeeds && (
                <Button
                  size="sm"
                  className="gap-1.5 h-8 text-xs font-medium shadow-sm rounded-full"
                  onClick={syncNow}
                  disabled={generating || loading}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${generating ? "animate-spin" : ""}`} />
                  {generating ? "正在同步" : "立即同步"}
                </Button>
              )}
              <Badge variant="outline" className="border-border">
                {todayLabel}
              </Badge>
            </div>
          </div>
          <Separator className="mt-4" />
          {!loading && (
            <div className="mt-3 grid gap-3 text-xs text-muted-foreground md:grid-cols-2 items-center">
              <div>
                <span className="font-bold text-primary text-sm">{feedCount}</span>
                <span className="ml-1">个订阅源</span>
                {digestDays > 0 && (
                  <>
                    <span className="mx-1">·</span>
                    <span className="ml-1">做编辑的第</span>
                    <span className="mx-1 font-bold text-primary text-sm">
                      {digestDays}
                    </span>
                    <span className="ml-1">天</span>
                  </>
                )}
              </div>
              <div className="md:text-right">
                <span className="font-bold text-primary text-sm">
                  {articleCount}
                </span>
                <span className="ml-1">篇文章收录</span>
              </div>
            </div>
          )}
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
              暂无日报内容。文章同步后会自动生成。
            </div>
          </Card>
        )}

        {/* Has digest content */}
        {!loading && !generating && current && (
          <>
            {/* Archive selector */}
            {digestList.length > 1 && (
              <div className={cn(
                "transition-all duration-500 ease-in-out overflow-hidden",
                isZen ? "max-h-0 opacity-0 mb-0" : "max-h-[200px] opacity-100 mb-6"
              )}>
                <Card className="p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
                      归档
                    </div>
                    <div className="flex flex-wrap gap-2 justify-end">
                      {digestList.slice(0, 7).map((d) => {
                        const active = current.id === d.id;
                        return (
                          <Button
                            key={d.id}
                            variant={active ? "secondary" : "outline"}
                            size="sm"
                            className={active ? "border border-border" : ""}
                            onClick={() => selectDigest(d)}
                            disabled={selectingId !== null}
                          >
                            {d.date}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                </Card>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-[320px_1fr] items-start transition-all duration-500">
              {/* TOC */}
              <Card id="digest-toc" className="p-4 md:p-5">
                <div className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
                  目录
                </div>
                <h3 className="mt-2 text-xl font-semibold">
                  {current.date} · 日报
                </h3>
                <div className="mt-2 text-xs text-muted-foreground">
                  {current.items.length} 篇文章
                </div>
                <div className="mt-4 -mx-2 px-2">
                  <ol className="space-y-4 pb-6">
                    {toc.map((t, idx) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          className="block w-full text-left leading-snug hover:text-foreground group"
                          onClick={() => handleTocClick(t.id)}
                        >
                          <div className="flex items-center gap-2 text-[12px] text-muted-foreground tracking-wide group-hover:text-foreground transition-colors">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-[10px] group-hover:border-foreground/30 transition-colors">
                              {String(idx + 1).padStart(2, "0")}
                            </span>
                            <Avatar className="h-5 w-5 border border-border bg-muted">
                              <AvatarImage src={t.logoUrl} alt={t.feedTitle} />
                              <AvatarFallback className="text-[10px]">
                                {t.feedTitle.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate">{t.feedTitle}</span>
                          </div>
                          <div className="mt-1 text-sm underline underline-offset-4 decoration-border group-hover:decoration-foreground/30 transition-colors line-clamp-2">
                            {t.title}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              </Card>

              {/* Articles */}
              <div className="space-y-4">
                {current.items.map((it, index) => {
                  const anchorId = toc[index]?.id;
                  return (
                    <Card key={it.id} className="p-5 scroll-mt-8" id={anchorId}>
                      <div className="flex flex-col gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
                              {it.feedTitle}
                            </span>
                          </div>
                          <h4 className="mt-2 text-xl md:text-2xl font-semibold leading-snug break-words">
                            {it.title}
                          </h4>
                        </div>
                        
                        <div className="flex flex-col gap-3 items-start">
                          {it.author && (
                            <div className="text-xs text-muted-foreground">
                              作者：{it.author}
                            </div>
                          )}
                          <a
                            href={it.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex"
                          >
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                            >
                              阅读原文
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </a>
                        </div>
                      </div>

                      <Separator className="my-4" />

                      <div className="pl-4 border-l-4 border-primary my-6">
                        <div className="text-xs tracking-[0.18em] uppercase text-primary mb-2 font-medium">
                          一句话总结
                        </div>
                        <div className="text-base italic leading-relaxed text-foreground/90 break-words">
                          {it.oneLiner}
                        </div>
                      </div>

                      {it.keyInsights.length > 0 && (
                        <div className="mt-4">
                          <div className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
                            关键洞察
                          </div>
                          <ul className="mt-2 list-disc pl-5 space-y-2 text-sm leading-relaxed">
                            {it.keyInsights.map((k, i) => (
                              <li key={i}>{k}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="mt-5 text-xs text-muted-foreground">
                        <span className="text-primary font-semibold mr-1">
                          #{String(index + 1).padStart(2, "0")}
                        </span>
                        ·{" "}
                        <button
                          type="button"
                          className="underline underline-offset-4 hover:text-foreground"
                          onClick={(e) => {
                            e.preventDefault();
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          回到顶部
                        </button>
                      </div>
                    </Card>
                  );
                })}

                {/* Reading completion ritual */}
                <ReadingComplete itemCount={current.items.length} />
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
