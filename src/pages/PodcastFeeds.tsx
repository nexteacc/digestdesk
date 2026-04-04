import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import FeedListSection from "@/components/FeedListSection";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/contexts/I18nContext";
import { useBatchMode } from "@/hooks/useBatchMode";
import * as api from "@/lib/api";
import type { Feed, PodcastSearchResult } from "@/lib/types";
import { Check } from "lucide-react";

let podcastFeedsCache: Feed[] | null = null;

export default function PodcastFeedsPage() {
  const { text } = useI18n();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PodcastSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [addingFeedUrl, setAddingFeedUrl] = useState<string | null>(null);
  const searchRequestId = useRef(0);

  const refresh = useCallback(async () => {
    if (podcastFeedsCache) {
      setFeeds(podcastFeedsCache);
      setFeedsLoading(false);
    }

    try {
      const all = await api.fetchPodcastFeeds();
      podcastFeedsCache = all;
      setFeeds(all);
    } catch {
      toast.error(text("加载播客订阅失败", "Failed to load podcasts"));
    } finally {
      setFeedsLoading(false);
    }
  }, [text]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const batch = useBatchMode({
    allIds: feeds.map((f) => f.id),
    deleteFn: api.batchDeletePodcastFeeds,
    onDeleted: refresh,
    successToast: (count) => text(`已取消订阅 ${count} 个播客`, `Unsubscribed from ${count} podcasts`),
  });

  const triggerSearch = useCallback(async (raw: string, fromButton: boolean) => {
    const q = raw.trim();
    if (!q) {
      if (fromButton) {
        toast.error(text("请输入播客节目名", "Enter a podcast title"));
      }
      return;
    }

    const requestId = ++searchRequestId.current;
    setSearchLoading(true);
    setHasSearched(true);

    try {
      const results = await api.searchPodcasts(q);
      if (searchRequestId.current !== requestId) return;
      setSearchResults(results);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text("搜索失败", "Search failed"));
    } finally {
      if (searchRequestId.current === requestId) {
        setSearchLoading(false);
      }
    }
  }, [text]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      searchRequestId.current += 1;
      setSearchLoading(false);
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    const handler = setTimeout(() => {
      triggerSearch(q, false);
    }, 300);

    return () => clearTimeout(handler);
  }, [searchQuery, triggerSearch]);

  async function onSearch() {
    await triggerSearch(searchQuery, true);
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      onSearch();
      return;
    }
    if (e.metaKey && e.key.toLowerCase() === "a") {
      (e.currentTarget as HTMLInputElement).select();
    }
  }

  async function onSubscribe(result: PodcastSearchResult) {
    setAddingFeedUrl(result.feedUrl);
    try {
      await api.createPodcastFeed({
        title: result.title,
        description: result.description,
        logoUrl: result.logoUrl,
        authorName: result.authorName,
        feedUrl: result.feedUrl,
        siteUrl: result.siteUrl,
      });
      toast.success(text("已订阅，正在同步播客…", "Subscribed! Syncing..."));
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text("添加失败", "Failed to add"));
    } finally {
      setAddingFeedUrl(null);
    }
  }

  function isSubscribed(feedUrl: string) {
    return feeds.some((feed) => feed.feedUrl === feedUrl);
  }

  async function onRemove(id: string) {
    try {
      await api.deletePodcastFeed(id);
      toast.success(text("已取消订阅", "Unsubscribed"));
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text("删除失败", "Failed to delete"));
    }
  }

  return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-semibold">
            {text("Podcast 节目", "Podcast Shows")}
          </h2>
          <Separator className="mt-4" />
        </div>

        <Card className="p-4 md:p-5">
          <div className="min-h-[220px]">
            <div className="flex gap-2 mt-1">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder={text("搜索你想订阅的播客节目", "Search for a podcast show")}
                className="flex-1"
              />
              <Button onClick={onSearch} disabled={searchLoading}>
                {searchLoading ? text("搜索中…", "Searching...") : text("搜索", "Search")}
              </Button>
            </div>

            <div className="mt-4">
              {searchLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-[200px]" />
                        <Skeleton className="h-3 w-[320px]" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : searchResults.length > 0 ? (
                <div className="space-y-2">
                  {searchResults.map((result) => {
                    const subscribed = isSubscribed(result.feedUrl);
                    const adding = addingFeedUrl === result.feedUrl;
                    return (
                      <div
                        key={result.feedUrl}
                        className="flex items-center gap-3 rounded-md border border-border p-3"
                      >
                        <Avatar className="h-10 w-10">
                          {result.logoUrl ? <AvatarImage src={result.logoUrl} alt={result.title} /> : null}
                          <AvatarFallback>
                            {result.title.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{result.title}</span>
                            {result.authorName ? (
                              <span className="text-xs text-muted-foreground">
                                {text("作者：", "by ")}
                                {result.authorName}
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-1 mt-0.5">
                            {result.description || result.siteUrl}
                          </p>
                        </div>
                        {subscribed ? (
                          <Badge variant="secondary" className="gap-1 border border-border shrink-0">
                            <Check className="h-3 w-3" />
                            {text("已订阅", "Subscribed")}
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => onSubscribe(result)}
                            disabled={adding}
                            className="shrink-0"
                          >
                            {adding ? text("添加中…", "Adding...") : text("订阅", "Subscribe")}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : hasSearched ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {text("未找到匹配的播客节目，试试其他关键词", "No podcasts found. Try another title.")}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {text("搜索播客节目名称", "Search for a podcast title")}
                </div>
              )}
            </div>
          </div>
        </Card>

        <FeedListSection
          feeds={feeds}
          loading={feedsLoading}
          {...batch}
          onRemove={onRemove}
          emptyText={text("暂无播客订阅", "No podcast subscriptions yet")}
        />
      </div>
  );
}
