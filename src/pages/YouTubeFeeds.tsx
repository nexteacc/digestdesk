import { useCallback, useEffect, useState } from "react";
import { useUser, useReverification } from "@clerk/react";
import { toast } from "sonner";

import FeedListSection from "@/components/FeedListSection";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/contexts/I18nContext";
import { useBatchMode } from "@/hooks/useBatchMode";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { Feed, DiscoveredYouTubeChannel, GoogleYouTubeSubscription } from "@/lib/types";
import { Search, Download, RefreshCw } from "lucide-react";

let youtubeFeedsCache: Feed[] | null = null;

export default function YouTubeFeedsPage() {
  const { text } = useI18n();
  const { user } = useUser();
  const [authorizing, setAuthorizing] = useState(false);
  const authorizeGoogle = useReverification(async () => {
    if (!user) throw new Error(text("请先登录", "Please sign in first"));
    const params = {
      additionalScopes: ["https://www.googleapis.com/auth/youtube.readonly"],
      redirectUrl: `${window.location.origin}/#/youtube`,
    };
    const existing = user.externalAccounts.find((account) => account.provider === "google");
    return existing
      ? existing.reauthorize(params)
      : user.createExternalAccount({ strategy: "oauth_google", ...params });
  });
  const googleYouTubeImportEnabled =
    import.meta.env.VITE_ENABLE_GOOGLE_YOUTUBE_IMPORT === "true";
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(true);

  // discover state
  const [urlInput, setUrlInput] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredYouTubeChannel | null>(null);
  const [adding, setAdding] = useState(false);
  const [importingSubscriptions, setImportingSubscriptions] = useState(false);
  const [googleSubscriptions, setGoogleSubscriptions] = useState<GoogleYouTubeSubscription[]>([]);
  const [selectedImports, setSelectedImports] = useState<string[]>([]);
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [requiresGoogleReauth, setRequiresGoogleReauth] = useState(false);

  const refresh = useCallback(async () => {
    if (youtubeFeedsCache) {
      setFeeds(youtubeFeedsCache);
      setFeedsLoading(false);
    }

    try {
      const all = await api.fetchYouTubeFeeds();
      youtubeFeedsCache = all;
      setFeeds(all);
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
    successToast: (n) =>
      text(`已取消订阅 ${n} 个频道`, `Unsubscribed from ${n} channels`),
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
      const result = await api.discoverYouTubeChannel(url);
      setDiscovered(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : text("识别失败", "Could not identify channel"));
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
      await api.createYouTubeFeed({
        channelId: discovered.channelId,
        title: discovered.title,
        logoUrl: discovered.logoUrl,
      });
      toast.success(text("已订阅，正在同步视频…", "Subscribed! Syncing..."));
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

  function toggleImport(channelId: string) {
    setSelectedImports((current) =>
      current.includes(channelId)
        ? current.filter((id) => id !== channelId)
        : [...current, channelId],
    );
  }

  function selectAllImportable() {
    setSelectedImports(
      googleSubscriptions
        .filter((item) => !isSubscribed(item.feedUrl))
        .map((item) => item.channelId),
    );
  }

  function clearImportSelection() {
    setSelectedImports([]);
  }

  function closeGoogleReauthDialog() {
    setRequiresGoogleReauth(false);
  }

  async function openGoogleAuthorization() {
    setAuthorizing(true);
    try {
      const account = await authorizeGoogle();
      const url = account?.verification?.externalVerificationRedirectURL;
      if (!url) throw new Error(text("未能开始 Google 授权，请重试", "Could not start Google authorization. Try again."));
      window.location.assign(url.toString());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text("授权未完成", "Authorization was not completed"));
    } finally {
      setAuthorizing(false);
    }
  }

  async function onFetchGoogleSubscriptions() {
    setImportingSubscriptions(true);
    setRequiresGoogleReauth(false);
    try {
      const result = await api.fetchGoogleYouTubeSubscriptions();
      setGoogleSubscriptions(result.items);
      setSelectedImports(
        result.items
          .filter((item) => !isSubscribed(item.feedUrl))
          .map((item) => item.channelId),
      );
      if (result.items.length === 0) {
        toast(text("没有读取到 YouTube 订阅频道", "No YouTube subscriptions found"));
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "GOOGLE_YOUTUBE_REAUTH_REQUIRED") {
        setRequiresGoogleReauth(true);
        setGoogleSubscriptions([]);
        setSelectedImports([]);
        return;
      }
      toast.error(
        error instanceof Error ? error.message : text("读取订阅失败", "Failed to load subscriptions"),
      );
    } finally {
      setImportingSubscriptions(false);
    }
  }

  async function onImportSelectedSubscriptions() {
    const targets = googleSubscriptions.filter(
      (item) => selectedImports.includes(item.channelId) && !isSubscribed(item.feedUrl),
    );
    if (targets.length === 0) {
      toast.error(text("请先选择要导入的频道", "Select channels to import"));
      return;
    }

    setImportSubmitting(true);
    let created = 0;
    let skipped = 0;

    for (const item of targets) {
      try {
        await api.createYouTubeFeed({
          channelId: item.channelId,
          title: item.title,
          logoUrl: item.logoUrl,
        });
        created += 1;
      } catch (error) {
        if (error instanceof Error && error.message.includes(text("该频道已订阅", "already"))) {
          skipped += 1;
          continue;
        }
        console.error("[youtube] Failed to import Google subscription:", item.channelId, error);
        skipped += 1;
      }
    }

    await refresh();
    setGoogleSubscriptions((current) =>
      current.filter((item) => !selectedImports.includes(item.channelId)),
    );
    setSelectedImports([]);
    setImportSubmitting(false);

    if (created > 0) {
      toast.success(
        text(`已导入 ${created} 个 YouTube 频道`, `Imported ${created} YouTube channels`),
      );
    }
    if (skipped > 0) {
      toast(
        text(`跳过 ${skipped} 个频道`, `Skipped ${skipped} channels`),
      );
    }
  }

  async function onRemove(id: string) {
    try {
      await api.deleteYouTubeFeed(id);
      toast.success(text("已取消订阅", "Unsubscribed"));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : text("删除失败", "Failed to delete"));
    }
  }

  return (
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <h2 className="text-2xl md:text-3xl font-semibold">
              {text("YouTube 频道", "YouTube Channels")}
            </h2>
            {googleYouTubeImportEnabled ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-primary/50 text-primary hover:bg-primary/10 hover:border-primary hover:text-primary transition-colors"
                onClick={onFetchGoogleSubscriptions}
                disabled={importingSubscriptions}
              >
                {importingSubscriptions ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {text("导入我的 YouTube 订阅", "Import my YouTube subscriptions")}
              </Button>
            ) : (
              <p className="max-w-sm text-right text-xs leading-5 text-muted-foreground">
                {text(
                  "Google 导入暂未开放，请直接粘贴频道链接",
                  "Google import unavailable. Paste a channel URL instead.",
                )}
              </p>
            )}
          </div>
          <Separator className="mt-4" />
        </div>

        {googleSubscriptions.length > 0 && (
          <Card className="p-4 md:p-5">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-sm font-medium">
                    {text("从 Google 读取到的 YouTube 订阅", "YouTube subscriptions from Google")}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {text(
                      "选择要导入的频道",
                      "Select channels to import",
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={selectAllImportable}
                    disabled={importSubmitting}
                  >
                    {text("全选可导入", "Select all")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={clearImportSelection}
                    disabled={importSubmitting || selectedImports.length === 0}
                  >
                    {text("清空选择", "Clear")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={onImportSelectedSubscriptions}
                    disabled={importSubmitting || selectedImports.length === 0}
                  >
                    {importSubmitting
                      ? text("导入中…", "Importing...")
                      : text(`导入已选 ${selectedImports.length} 个`, `Import ${selectedImports.length} selected`)}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {googleSubscriptions.map((item) => {
                  const subscribed = isSubscribed(item.feedUrl);
                  const checked = selectedImports.includes(item.channelId);

                  return (
                    <label
                      key={item.channelId}
                      className="flex items-center gap-3 rounded-md border border-border p-3 cursor-pointer hover:bg-accent/30 transition-colors"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={checked}
                        disabled={subscribed || importSubmitting}
                        onChange={() => toggleImport(item.channelId)}
                      />
                      <Avatar className="h-10 w-10">
                        {item.logoUrl ? <AvatarImage src={item.logoUrl} alt={item.title} /> : null}
                        <AvatarFallback>
                          <img src="/logos/youtube.svg" alt="YouTube" className="h-4 w-4" />
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{item.title}</div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {item.channelUrl}
                        </div>
                        {item.description ? (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                            {item.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-xs text-muted-foreground">
                        {subscribed ? text("已订阅", "Subscribed") : text("可导入", "Ready")}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </Card>
        )}

        <Dialog open={requiresGoogleReauth} onOpenChange={setRequiresGoogleReauth}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{text("连接 Google", "Connect Google")}</DialogTitle>
              <DialogDescription>
                {text("只读访问你的 YouTube 订阅，由你选择导入频道。", "Read-only access to your YouTube subscriptions. You choose which channels to import.")}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {text("授权后返回此页，点击导入读取频道列表。", "After authorizing, return here and click import to load your channels.")}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={closeGoogleReauthDialog}>{text("取消", "Cancel")}</Button>
              <Button disabled={authorizing} onClick={openGoogleAuthorization}>{authorizing ? text("正在连接…", "Connecting…") : text("前往 Google 授权", "Authorize with Google")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {/* Discover YouTube Channel */}
        <Card className="p-4 md:p-5">
          <div className="min-h-[120px]">
            <div className="flex gap-2 mt-1">
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={text("粘贴 YouTube 频道链接", "Paste a YouTube channel URL")}
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
                <div className="rounded-md border border-border p-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      {discovered.logoUrl ? (
                        <AvatarImage src={discovered.logoUrl} alt={discovered.title} />
                      ) : null}
                      <AvatarFallback>
                        <img src="/logos/youtube.svg" alt="YouTube" className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate">
                        {discovered.title}
                      </span>
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-1 mt-0.5">
                        {discovered.channelUrl}
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

                  {/* Recent videos */}
                  {discovered.recentVideos && discovered.recentVideos.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <span className="text-xs text-muted-foreground">
                        {text("最近更新", "Latest updates")}
                      </span>
                      {discovered.recentVideos.slice(0, 3).map((video, i) => (
                        <a
                          key={i}
                          href={video.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-3 rounded-md p-1.5 hover:bg-accent/50 transition-colors"
                        >
                          <img
                            src={video.thumbnailUrl}
                            alt={video.title}
                            className="w-[120px] h-[68px] rounded object-cover shrink-0 bg-muted"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium line-clamp-2">
                              {video.title}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {new Date(video.publishedAt).toLocaleDateString()}
                            </p>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  {text("粘贴 YouTube 频道链接开始识别", "Paste a YouTube channel URL to get started")}
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* YouTube Feeds List */}
        <FeedListSection
          feeds={feeds}
          loading={feedsLoading}
          {...batch}
          onRemove={onRemove}
          emptyText={text("暂无 YouTube 订阅", "No YouTube channels yet")}
          renderAvatarFallback={() => (
            <img src="/logos/youtube.svg" alt="YouTube" className="h-3.5 w-3.5" />
          )}
          showAuthor={false}
        />
      </div>
  );
}
