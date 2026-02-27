import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import * as api from "@/lib/api";
import type { Feed, SubstackSearchResult, SubstackInfo } from "@/lib/types";
import { Check, Search, Trash2, Link as LinkIcon, Download, X } from "lucide-react";
import ImportDialog from "@/components/ImportDialog";

export default function SubscriptionsPage() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);

  // batch unsubscribe state
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  // search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SubstackSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const searchRequestId = useRef(0);

  // URL add state
  const [url, setUrl] = useState("");
  const [urlPreview, setUrlPreview] = useState<SubstackInfo | null>(null);
  const [urlPreviewLoading, setUrlPreviewLoading] = useState(false);
  const [urlAdding, setUrlAdding] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const f = await api.fetchFeeds();
      setFeeds(f);
    } catch {
      toast.error("加载订阅列表失败");
    } finally {
      setFeedsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function triggerSearch(raw: string, fromButton: boolean) {
    const q = raw.trim();
    if (!q) {
      if (fromButton) {
        toast.error("请输入搜索关键词");
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
      toast.error(e instanceof Error ? e.message : "搜索失败");
    } finally {
      if (searchRequestId.current === requestId) {
        setSearchLoading(false);
      }
    }
  }

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
  }, [searchQuery]);

  const count = feeds.length;

  // --- Search ---
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
      toast.success("已订阅，正在同步文章…");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败");
    }
  }

  function isSubscribed(resultUrl: string) {
    return feeds.some((f) => {
      try {
        return new URL(f.url).hostname === new URL(resultUrl).hostname;
      } catch {
        return f.url === resultUrl;
      }
    });
  }

  // --- URL Preview + Add ---
  async function onPreviewUrl() {
    const trimmed = url.trim();
    if (!trimmed) {
      toast.error("请先粘贴链接");
      return;
    }
    setUrlPreviewLoading(true);
    setUrlPreview(null);
    try {
      const info = await api.getSubstackInfo(trimmed);
      setUrlPreview(info);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "无法获取出版物信息");
    } finally {
      setUrlPreviewLoading(false);
    }
  }

  async function onConfirmUrlAdd() {
    setUrlAdding(true);
    try {
      await api.createFeed(url.trim());
      setUrl("");
      setUrlPreview(null);
      toast.success("已订阅，正在同步文章…");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败");
    } finally {
      setUrlAdding(false);
    }
  }

  // --- Remove ---
  async function onRemove(id: string) {
    try {
      await api.deleteFeed(id);
      toast.success("已取消订阅");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
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
      const result = await api.batchDeleteFeeds(Array.from(batchSelected));
      toast.success(`已取消订阅 ${result.deleted} 个源`);
      exitBatchMode();
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "批量取消失败");
    } finally {
      setBatchDeleting(false);
    }
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl md:text-3xl font-semibold">
                订阅源管理
              </h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                添加你关注的 Substack
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setImportOpen(true)}
            >
              <Download className="h-3.5 w-3.5" />
              从 Substack 导入
            </Button>
          </div>
          <Separator className="mt-4" />
        </div>

        {/* Add Subscription - Tabs */}
        <Card className="p-4 md:p-5">
          <Tabs defaultValue="search">
            <TabsList>
              <TabsTrigger value="search" className="gap-1.5">
                <Search className="h-3.5 w-3.5" />
                搜索添加
              </TabsTrigger>
              <TabsTrigger value="url" className="gap-1.5">
                <LinkIcon className="h-3.5 w-3.5" />
                URL 添加
              </TabsTrigger>
            </TabsList>

            {/* Search Tab */}
            <TabsContent value="search" className="min-h-[220px]">
              <div className="flex gap-2 mt-1">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder="搜索你想看的 Substack 出版物"
                  className="flex-1"
                />
                <Button onClick={onSearch} disabled={searchLoading}>
                  {searchLoading ? "搜索中…" : "搜索"}
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
                      const subscribed = isSubscribed(result.url);
                      return (
                        <div
                          key={result.url}
                          className="flex items-center gap-3 rounded-md border border-border p-3"
                        >
                          <Avatar className="h-10 w-10">
                            <AvatarImage
                              src={result.logoUrl}
                              alt={result.name}
                            />
                            <AvatarFallback>
                              {result.name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {result.name}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                by {result.authorName}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-1 mt-0.5">
                              {result.description}
                            </p>
                          </div>
                          {subscribed ? (
                            <Badge
                              variant="secondary"
                              className="gap-1 border border-border shrink-0"
                            >
                              <Check className="h-3 w-3" />
                              已订阅
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => onSubscribeFromSearch(result)}
                              className="shrink-0"
                            >
                              订阅
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : hasSearched ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    未找到匹配的出版物，试试其他关键词
                  </div>
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    
                  </div>
                )}
              </div>
            </TabsContent>

            {/* URL Tab */}
            <TabsContent value="url" className="min-h-[220px]">
              <div className="flex gap-2 mt-1">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onPreviewUrl()}
                  placeholder="粘贴 Substack 主页链接"
                  className="flex-1"
                />
                <Button onClick={onPreviewUrl} disabled={urlPreviewLoading}>
                  {urlPreviewLoading ? "获取中…" : "预览"}
                </Button>
              </div>
              {/* URL Preview Loading */}
              {urlPreviewLoading && (
                <div className="mt-4 flex items-center gap-3 rounded-md border border-border p-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-[200px]" />
                    <Skeleton className="h-3 w-[300px]" />
                  </div>
                </div>
              )}

              {/* URL Preview Card */}
              {urlPreview && !urlPreviewLoading && (
                <div className="mt-4 rounded-md border border-border p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-12 w-12">
                      <AvatarImage
                        src={urlPreview.logoUrl}
                        alt={urlPreview.name}
                      />
                      <AvatarFallback>
                        {urlPreview.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        {urlPreview.name}
                      </div>
                      {urlPreview.authorName && (
                        <div className="text-xs text-muted-foreground">
                          by {urlPreview.authorName}
                        </div>
                      )}
                      {urlPreview.description && (
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-2">
                          {urlPreview.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button
                      onClick={onConfirmUrlAdd}
                      disabled={urlAdding}
                      size="sm"
                    >
                      {urlAdding ? "添加中…" : "确认订阅"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setUrlPreview(null)}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </Card>

        {/* Subscriptions List */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
              已订阅 · {count}
            </span>
            {!feedsLoading && feeds.length > 0 && !batchMode && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={enterBatchMode}
              >
                <Trash2 className="h-3.5 w-3.5" />
                一键取消
              </Button>
            )}
          </div>

          {/* Batch mode action bar */}
          {batchMode && (
            <Card className="p-3 mb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={toggleBatchAll}>
                    {batchSelected.size === feeds.length ? "取消全选" : "全选"}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    已选择 <span className="font-medium text-foreground">{batchSelected.size}</span> 个
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
                    取消
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
                          ? "删除中…"
                          : `取消订阅 (${batchSelected.size})`}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          确定一键取消？
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          将取消订阅 {batchSelected.size} 个源，后续日报将不再包含这些来源的内容。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={onBatchDelete}>
                          确认取消订阅
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
                还没有订阅源。用上面的搜索或 URL 添加试试。
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
                          {f.title.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {f.title}
                          </span>
                          {f.authorName && (
                            <span className="text-xs text-muted-foreground hidden sm:inline">
                              by {f.authorName}
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
                              aria-label="删除"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确定取消订阅？</AlertDialogTitle>
                              <AlertDialogDescription>
                                取消订阅「{f.title}
                                」后，后续日报将不再包含该来源的内容。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction onClick={() => onRemove(f.id)}>
                                确认取消订阅
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
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={refresh}
        existingFeeds={feeds}
      />
    </AppShell>
  );
}
