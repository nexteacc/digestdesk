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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import * as api from "@/lib/api";
import type { Digest, DigestListItem, Feed } from "@/lib/types";
import {
  ExternalLink,
  BookOpen,
  Loader2,
  CheckCircle2,
  Rss,
} from "lucide-react";

const PAGE_SIZE = 20;

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
            <Link href="/weekly">
              <Button variant="outline" size="sm" className="gap-1.5">
                <BookOpen className="h-3.5 w-3.5" />
                查看周报
              </Button>
            </Link>
          </div>
        </Card>
      )}
    </>
  );
}

// --- 主页面 ---
export default function DailyDigest() {
  const [digestList, setDigestList] = useState<DigestListItem[]>([]);
  const [current, setCurrent] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [hasFeeds, setHasFeeds] = useState(true);
  const [feeds, setFeeds] = useState<Feed[]>([]);

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
        await autoGenerate();
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
      const digest = await api.generateDigest("daily");
      setCurrent(digest);
      const list = await api.fetchDigests("daily");
      setDigestList(list);
      toast.success("日报生成成功");
    } catch (e) {
      // 生成失败（可能没有文章），不显示错误，展示空状态
      console.log("[DailyDigest] auto-generate failed:", e);
    } finally {
      setGenerating(false);
    }
  }

  // 重新生成当前选中日期的日报（测试用）
  async function regenerateCurrent() {
    if (!current) return;
    setRegenerating(true);
    try {
      const digest = await api.generateDigest("daily", {
        date: current.date,
        force: true,
      });
      setCurrent(digest);
      const list = await api.fetchDigests("daily");
      setDigestList(list);
      toast.success(`已重新生成 ${current.date} 的日报`);
    } catch {
      toast.error("重新生成失败");
    } finally {
      setRegenerating(false);
    }
  }

  async function selectDigest(item: DigestListItem) {
    try {
      const full = await api.fetchDigest(item.id);
      setCurrent(full);
    } catch {
      toast.error("加载失败");
    }
  }

  const todayLabel = useMemo(
    () => format(new Date(), "yyyy-MM-dd · EEEE", { locale: zhCN }),
    [],
  );

  const stats = useMemo(() => {
    const feedCount = feeds.length;
    const digestDays = digestList.length;
    const articleCount = current?.items.length ?? 0;

    return { feedCount, digestDays, articleCount };
  }, [feeds, digestList, current]);

  const { feedCount, digestDays, articleCount } = stats;

  const [page, setPage] = useState(1);

  const visibleItems = useMemo(() => {
    if (!current) return [];
    return current.items.slice(0, page * PAGE_SIZE);
  }, [current, page]);

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
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl md:text-3xl font-semibold">今日日报</h2>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="border-border">
                {todayLabel}
              </Badge>
              {!loading && current && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={regenerateCurrent}
                  disabled
                >
                  {regenerating ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      正在重新生成
                    </>
                  ) : (
                    <>重新生成（已禁用）</>
                  )}
                </Button>
              )}
            </div>
          </div>
          <Separator className="mt-4" />
          {!loading && (
            <div className="mt-3 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
              <div>
                <span className="font-semibold text-foreground">{feedCount}</span>
                <span className="ml-1">个订阅源</span>
                {digestDays > 0 && (
                  <>
                    <span className="mx-1">·</span>
                    <span className="ml-1">做编辑的第</span>
                    <span className="mx-1 font-semibold text-foreground">
                      {digestDays}
                    </span>
                    <span className="ml-1">天</span>
                  </>
                )}
              </div>
              <div className="md:text-right">
                <span className="font-semibold text-foreground">
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

        {/* Empty: no feeds */}
        {!loading && !generating && !current && !hasFeeds && (
          <Card className="p-10 text-center">
            <Rss className="h-8 w-8 mx-auto text-muted-foreground" />
            <div className="mt-3 text-lg font-semibold">
              还没有订阅源
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              添加你的第一个 Substack，日报会自动为你生成
            </div>
            <div className="mt-4">
              <Link href="/subscriptions">
                <Button variant="outline" className="gap-1.5">
                  <Rss className="h-4 w-4" />
                  添加订阅源
                </Button>
              </Link>
            </div>
          </Card>
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
                        >
                          {d.date}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </Card>
            )}

            <div className="grid gap-4 md:grid-cols-[320px_1fr] items-start">
              {/* TOC */}
              <Card className="p-4 md:p-5 md:sticky md:top-6 h-fit">
                <div className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
                  目录
                </div>
                <h3 className="mt-2 text-xl font-semibold">
                  {current.date} · 日报
                </h3>
                <div className="mt-2 text-xs text-muted-foreground">
                  {current.items.length} 篇文章
                </div>
                <Separator className="my-4" />
                <ScrollArea className="h-[340px] pr-3">
                  <ol className="space-y-3">
                    {toc.map((t, idx) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          className="block w-full text-left leading-snug hover:text-foreground"
                          onClick={() => handleTocClick(t.id)}
                        >
                          <div className="flex items-center gap-2 text-[12px] text-muted-foreground tracking-wide">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-[10px]">
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
                          <div className="mt-1 text-sm underline underline-offset-4 decoration-border">
                            {t.title}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ol>
                </ScrollArea>
              </Card>

              {/* Articles */}
              <div className="space-y-4">
                {visibleItems.map((it) => {
                  const index = current.items.findIndex((orig) => orig.id === it.id);
                  const anchorId = index >= 0 ? toc[index]?.id : undefined;
                  return (
                    <Card key={it.id} className="p-5" id={anchorId}>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
                              {it.feedTitle}
                            </span>
                          </div>
                          <h4 className="mt-2 text-xl md:text-2xl font-semibold leading-snug">
                            {it.title}
                          </h4>
                          {it.author && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              作者：{it.author}
                            </div>
                          )}
                        </div>
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

                      <Separator className="my-4" />

                      <div className="rounded-md border border-border bg-accent/60 p-4">
                        <div className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
                          一句话总结
                        </div>
                        <div className="mt-2 text-sm leading-relaxed">
                          {it.oneLiner}
                        </div>
                      </div>

                      {it.keyInsights.length > 0 && (
                        <div className="mt-4">
                          <div className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
                            关键洞察
                          </div>
                          <ul className="mt-2 list-disc pl-5 space-y-2 text-sm leading-relaxed">
                            {it.keyInsights.map((k) => (
                              <li key={k}>{k}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="mt-5 text-xs text-muted-foreground">
                        #
                        {String(index + 1).padStart(2, "0")} ·{" "}
                        <a
                          href="#"
                          className="underline underline-offset-4 hover:text-foreground"
                        >
                          回到目录
                        </a>
                      </div>
                    </Card>
                  );
                })}

                {current.items.length > visibleItems.length && (
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p + 1)}
                    >
                      加载更多
                    </Button>
                  </div>
                )}

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
