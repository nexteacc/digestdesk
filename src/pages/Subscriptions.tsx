import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import FeedListSection from "@/components/FeedListSection";
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
import { useBatchMode } from "@/hooks/useBatchMode";
import * as api from "@/lib/api";
import type { Feed, SubstackSearchResult } from "@/lib/types";
import { Check, Download } from "lucide-react";
import ImportDialog from "@/components/ImportDialog";

let substackFeedsCache: Feed[] | null = null;

export default function SubscriptionsPage() {
  const { text } = useI18n();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);

  // search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SubstackSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const searchRequestId = useRef(0);

  const refresh = useCallback(async () => {
    if (substackFeedsCache) {
      setFeeds(substackFeedsCache);
      setFeedsLoading(false);
    }

    try {
      const f = await api.fetchFeeds();
      const nextFeeds = f.filter((item) => item.sourceType === "substack");
      substackFeedsCache = nextFeeds;
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

  const batch = useBatchMode({
    allIds: feeds.map((f) => f.id),
    deleteFn: api.batchDeleteFeeds,
    onDeleted: refresh,
  });

  const triggerSearch = useCallback(async (raw: string, fromButton: boolean) => {
    const q = raw.trim();
    if (!q) {
      if (fromButton) {
        toast.error(text("请输入搜索关键词", "Enter a search keyword"));
      }
      return;
    }
    const requestId = ++searchRequestId.current;
    setSearchLoading(true);
    setHasSearched(true);
    try {
      const results = await api.searchSubstack(q);
      if (searchRequestId.current !== requestId) return;
      setSearchResults(results);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : text("搜索失败", "Search failed"));
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

  async function onSubscribeFromSearch(result: SubstackSearchResult) {
    try {
      await api.createFeed(result.url);
      toast.success(text("已订阅，正在同步文章…", "Subscribed! Syncing..."));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : text("添加失败", "Failed to add"));
    }
  }

  function findSubscribedFeed(resultUrl: string) {
    return feeds.find((f) => {
      try {
        return new URL(f.url).hostname === new URL(resultUrl).hostname;
      } catch {
        return f.url === resultUrl;
      }
    });
  }

  async function onRemove(id: string) {
    try {
      await api.deleteFeed(id);
      toast.success(text("已取消订阅", "Unsubscribed"));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : text("删除失败", "Failed to delete"));
    }
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl md:text-3xl font-semibold">
                {text("追踪创作者", "Track Creators")}
              </h2>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-11 gap-1.5 border-primary/50 text-primary transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary md:h-8"
              onClick={() => setImportOpen(true)}
            >
              <Download className="h-3.5 w-3.5" />
              {text("从 Substack 导入", "Import from Substack")}
            </Button>
          </div>
          <Separator className="mt-4" />
        </div>

        {/* Search */}
        <Card className="p-4 md:p-5">
          <div className="min-h-[220px]">
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder={text("搜索 Substack 出版物", "Search Substack publications")}
                  className="flex-1"
                />
                <Button className="h-11 sm:h-9" onClick={onSearch} disabled={searchLoading}>
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
                          <Skeleton className="h-3 w-[300px]" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="space-y-2">
                    {searchResults.map((result) => {
                      const subscribedFeed = findSubscribedFeed(result.url);
                      const subscribed = Boolean(subscribedFeed);
                      return (
                        <div
                          key={result.url}
                          className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center"
                        >
                          <div className="flex min-w-0 items-start gap-3 sm:flex-1 sm:items-center">
                            <Avatar className="h-10 w-10 shrink-0">
                              <AvatarImage
                                src={result.logoUrl}
                                alt={result.name}
                              />
                              <AvatarFallback>
                                {result.name.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                                <span className="truncate text-sm font-medium">
                                  {result.name}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                  {text("作者：", "by ")}{result.authorName}
                                </span>
                              </div>
                              <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:line-clamp-1">
                                {result.description}
                              </p>
                            </div>
                          </div>
                          {subscribed ? (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-11 w-full shrink-0 gap-1.5 sm:w-auto md:h-8"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  {text("已订阅", "Subscribed")}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {text(`取消订阅「${result.name}」？`, `Unsubscribe from ${result.name}?`)}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {text(
                                      `取消订阅「${result.name}」后，后续日报将不再包含该来源的内容。`,
                                      `${result.name} will be removed from future digests.`,
                                    )}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>
                                    {text("取消", "Cancel")}
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => subscribedFeed && onRemove(subscribedFeed.id)}
                                  >
                                    {text("取消订阅", "Unsubscribe")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => onSubscribeFromSearch(result)}
                              className="h-11 w-full shrink-0 sm:w-auto md:h-8"
                            >
                              {text("订阅", "Subscribe")}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : hasSearched ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {text("未找到匹配的出版物，试试其他关键词", "No results. Try a different search.")}
                  </div>
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {text("输入出版物或作者名开始搜索", "Search by publication or author")}
                  </div>
                )}
              </div>
            </div>
        </Card>

        {/* Subscriptions List */}
        <FeedListSection
          feeds={feeds}
          loading={feedsLoading}
          {...batch}
          onRemove={onRemove}
          emptyText={text("暂无订阅内容", "No subscriptions yet")}
        />
      </div>
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={refresh}
        existingFeeds={feeds}
      />
    </>
  );
}
