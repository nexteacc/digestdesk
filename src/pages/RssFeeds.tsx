import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/contexts/I18nContext";
import * as api from "@/lib/api";
import type { Feed, DiscoveredFeed } from "@/lib/types";
import { Check, Trash2, X, Rss, Search } from "lucide-react";

export default function RssFeedsPage() {
  const { text, isZh } = useI18n();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(true);

  // batch unsubscribe state
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  // discover state
  const [urlInput, setUrlInput] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredFeed | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const all = await api.fetchFeeds();
      setFeeds(all.filter((f) => f.sourceType === "rss"));
    } catch {
      toast.error(text("加载订阅列表失败", "Failed to load"));
    } finally {
      setFeedsLoading(false);
    }
  }, [text]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // --- Discover ---
  async function onDiscover() {
    const url = urlInput.trim();
    if (!url) {
      toast.error(text("请输入 URL", "Please enter a URL"));
      return;
    }
    setDiscovering(true);
    setDiscovered(null);
    try {
      const result = await api.discoverRssFeed(url);
      setDiscovered(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : text("探测失败", "Discovery failed"));
    } finally {
      setDiscovering(false);
    }
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      onDiscover();
      return;
    }
    if (e.metaKey && e.key.toLowerCase() === "a") {
      (e.currentTarget as HTMLInputElement).select();
    }
  }

  async function onConfirmAdd() {
    if (!discovered) return;
    setAdding(true);
    try {
      await api.createRssFeed({
        feedUrl: discovered.feedUrl,
        siteUrl: discovered.siteUrl,
        title: discovered.title,
        description: discovered.description,
        logoUrl: discovered.logoUrl,
        authorName: discovered.authorName,
      });
      toast.success(text("已订阅，正在同步文章…", "Subscribed! Syncing..."));
      setDiscovered(null);
      setUrlInput("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : text("添加失败", "Failed to add"));
    } finally {
      setAdding(false);
    }
  }

  function isSubscribed(feedUrl: string) {
    return feeds.some((f) => f.feedUrl === feedUrl);
  }

  // --- Remove ---
  async function onRemove(id: string) {
    try {
      await api.deleteRssFeed(id);
      toast.success(text("已取消订阅", "Unsubscribed"));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : text("删除失败", "Failed to delete"));
    }
  }

  function enterBatchMode() {
    setBatchMode(true);
    setBatchSelected(new Set());
  }

  function exitBatchMode() {
    setBatchMode(false);
    setBatchSelected(new Set());
  }

  function toggleBatchItem(id: string) {
    setBatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBatchAll() {
    if (batchSelected.size === feeds.length) {
      setBatchSelected(new Set());
    } else {
      setBatchSelected(new Set(feeds.map((f) => f.id)));
    }
  }

  async function onBatchDelete() {
    if (batchSelected.size === 0) return;
    setBatchDeleting(true);
    try {
      const result = await api.batchDeleteRssFeeds(Array.from(batchSelected));
      toast.success(text(`已取消订阅 ${result.deleted} 个源`, `Unsubscribed from ${result.deleted} feeds`));
      exitBatchMode();
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : text("批量取消失败", "Unsubscribe failed"));
    } finally {
      setBatchDeleting(false);
    }
  }

  const count = feeds.length;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <h2 className="text-2xl md:text-3xl font-semibold">
            {text("RSS 订阅", "RSS Feeds")}
          </h2>
          <Separator className="mt-4" />
        </div>

        {/* Add RSS Feed */}
        <Card className="p-4 md:p-5">
          <div className="min-h-[120px]">
            <div className="flex gap-2 mt-1">
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={text("粘贴网站或 RSS 链接，例如 https://blog.example.com", "Paste a website or RSS URL, e.g. https://blog.example.com")}
                className="flex-1"
              />
              <Button onClick={onDiscover} disabled={discovering}>
                {discovering ? (
                  <>{text("探测中…", "Discovering...")}</>
                ) : (
                  <><Search className="h-4 w-4 mr-1.5" />{text("探测", "Discover")}</>
                )}
              </Button>
            </div>

            <div className="mt-4">
              {discovering ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-[200px]" />
                      <Skeleton className="h-3 w-[300px]" />
                    </div>
                  </div>
                </div>
              ) : discovered ? (
                <div className="flex items-center gap-3 rounded-md border border-border p-3">
                  <Avatar className="h-10 w-10">
                    {discovered.logoUrl ? (
                      <AvatarImage src={discovered.logoUrl} alt={discovered.title} />
                    ) : null}
                    <AvatarFallback>
                      <Rss className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {discovered.title || discovered.feedUrl}
                      </span>
                      {discovered.authorName && (
                        <span className="text-xs text-muted-foreground">
                          {text("作者：", "by ")}{discovered.authorName}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-1 mt-0.5">
                      {discovered.description || discovered.feedUrl}
                    </p>
                  </div>
                  {isSubscribed(discovered.feedUrl) ? (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {text("已订阅", "Subscribed")}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      onClick={onConfirmAdd}
                      disabled={adding}
                      className="shrink-0"
                    >
                      {adding ? text("添加中…", "Adding...") : text("订阅", "Subscribe")}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* RSS Feeds List */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
              {text("已订阅", "Subscribed")} · {count}
            </span>
            {!feedsLoading && feeds.length > 0 && !batchMode && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                onClick={enterBatchMode}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {text("一键取消", "Bulk Unsubscribe")}
              </Button>
            )}
          </div>

          {/* Batch mode action bar */}
          {batchMode && (
            <Card className="p-3 mb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={toggleBatchAll}>
                    {batchSelected.size === feeds.length ? text("取消全选", "Deselect all") : text("全选", "Select all")}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {isZh ? (
                      <>{text("已选择", "")} <span className="font-medium text-foreground">{batchSelected.size}</span> 个</>
                    ) : (
                      <><span className="font-medium text-foreground">{batchSelected.size}</span> selected</>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={exitBatchMode}
                    className="gap-1.5"
                  >
                    <X className="h-3.5 w-3.5" />
                    {text("取消", "Cancel")}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={batchSelected.size === 0 || batchDeleting}
                        className="gap-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {batchDeleting
                          ? text("删除中…", "Removing...")
                          : text(`取消订阅 (${batchSelected.size})`, `Unsubscribe (${batchSelected.size})`)}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {text("确定一键取消？", "Unsubscribe selected?")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {text(`将取消订阅 ${batchSelected.size} 个源，后续日报将不再包含这些来源的内容。`, `${batchSelected.size} sources will be removed from future digests.`)}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{text("取消", "Cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={onBatchDelete}>
                          {text("确认取消订阅", "Unsubscribe")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </Card>
          )}

          {feedsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[60px] rounded-lg" />
              ))}
            </div>
          ) : feeds.length === 0 ? (
            <Card className="p-10 text-center">
              <div className="text-sm text-muted-foreground">
                {text("还没有 RSS 订阅源。粘贴一个网站链接试试。", "No RSS feeds yet. Paste a URL above to add one.")}
              </div>
            </Card>
          ) : (
            <div className="space-y-2">
              {feeds.map((f) => {
                const checked = batchSelected.has(f.id);
                return (
                  <Card
                    key={f.id}
                    className={`p-3 transition-colors ${batchMode ? "cursor-pointer hover:bg-accent/40" : ""} ${checked ? "border-foreground/20 bg-accent/50" : ""}`}
                    onClick={batchMode ? () => toggleBatchItem(f.id) : undefined}
                  >
                    <div className="flex items-center gap-3">
                      {batchMode && (
                        <div
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                            checked
                              ? "border-foreground bg-foreground text-background"
                              : "border-muted-foreground/40"
                          }`}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </div>
                      )}
                      <Avatar className="h-9 w-9">
                        {f.logoUrl ? (
                          <AvatarImage src={f.logoUrl} alt={f.title} />
                        ) : null}
                        <AvatarFallback className="text-xs">
                          <Rss className="h-3.5 w-3.5" />
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {f.title}
                          </span>
                          {f.authorName && (
                            <span className="text-xs text-muted-foreground hidden sm:inline">
                              {text("作者：", "by ")}{f.authorName}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <a
                            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground truncate"
                            href={f.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => batchMode && e.preventDefault()}
                          >
                            {f.url}
                          </a>
                        </div>
                      </div>
                      {!batchMode && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive shrink-0"
                              aria-label={text("删除", "Delete")}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{text("确定取消订阅？", "Unsubscribe?")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {text(`取消订阅「${f.title}」后，后续日报将不再包含该来源的内容。`, `${f.title} will be removed from future digests.`)}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{text("取消", "Cancel")}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => onRemove(f.id)}>
                                {text("确认取消订阅", "Unsubscribe")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
