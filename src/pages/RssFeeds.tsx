import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import FeedListSection from "@/components/FeedListSection";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/contexts/I18nContext";
import { useBatchMode } from "@/hooks/useBatchMode";
import * as api from "@/lib/api";
import type { Feed, DiscoveredFeed } from "@/lib/types";
import { Rss, Search } from "lucide-react";

let rssFeedsCache: Feed[] | null = null;

export default function RssFeedsPage() {
  const { text } = useI18n();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(true);

  // discover state
  const [urlInput, setUrlInput] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredFeed | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    if (rssFeedsCache) {
      setFeeds(rssFeedsCache);
      setFeedsLoading(false);
    }

    try {
      const all = await api.fetchFeeds();
      const nextFeeds = all.filter((f) => f.sourceType === "rss");
      rssFeedsCache = nextFeeds;
      setFeeds(nextFeeds);
    } catch {
      toast.error(text("加载订阅列表失败", "Failed to load"));
    } finally {
      setFeedsLoading(false);
    }
  }, [text]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!urlInput.trim()) {
      setDiscovered(null);
    }
  }, [urlInput]);

  const batch = useBatchMode({
    allIds: feeds.map((f) => f.id),
    deleteFn: api.batchDeleteFeeds,
    onDeleted: refresh,
  });

  async function onDiscover() {
    const url = urlInput.trim();
    if (!url) {
      toast.error(text("请先输入链接", "Enter a URL"));
      return;
    }
    setDiscovering(true);
    setDiscovered(null);
    try {
      const result = await api.discoverRssFeed(url);
      setDiscovered(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : text("识别失败", "Could not identify feed"));
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

  async function onRemove(id: string) {
    try {
      await api.deleteRssFeed(id);
      toast.success(text("已取消订阅", "Unsubscribed"));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : text("删除失败", "Failed to delete"));
    }
  }

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

        {/* Discover RSS Feed */}
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
                  <>{text("识别中…", "Checking...")}</>
                ) : (
                  <><Search className="h-4 w-4 mr-1.5" />{text("识别链接", "Check link")}</>
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
                  {text("粘贴一个网站或 RSS 链接，先识别来源，再决定是否订阅。", "Paste a website or RSS URL to preview the feed before subscribing.")}
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* RSS Feeds List */}
        <FeedListSection
          feeds={feeds}
          loading={feedsLoading}
          {...batch}
          onRemove={onRemove}
          emptyText={text("还没有 RSS 订阅。粘贴一个网站链接试试。", "No RSS subscriptions yet. Paste a URL above to add one.")}
          renderAvatarFallback={() => <Rss className="h-3.5 w-3.5" />}
        />
      </div>
    </AppShell>
  );
}
