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
import type { Feed, DiscoveredYouTubeChannel } from "@/lib/types";
import { Search } from "lucide-react";

export default function YouTubeFeedsPage() {
  const { text } = useI18n();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(true);

  // discover state
  const [urlInput, setUrlInput] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredYouTubeChannel | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const all = await api.fetchYouTubeFeeds();
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
      toast.error(text("请输入 URL", "Please enter a URL"));
      return;
    }
    setDiscovering(true);
    setDiscovered(null);
    try {
      const result = await api.discoverYouTubeChannel(url);
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
    <AppShell>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <h2 className="text-2xl md:text-3xl font-semibold">
            {text("YouTube 频道", "YouTube Channels")}
          </h2>
          <Separator className="mt-4" />
        </div>

        {/* Discover YouTube Channel */}
        <Card className="p-4 md:p-5">
          <div className="min-h-[120px]">
            <div className="flex gap-2 mt-1">
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={text("粘贴 YouTube 频道链接，例如 https://www.youtube.com/@earthfm", "Paste a YouTube channel URL, e.g. https://www.youtube.com/@earthfm")}
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
                        {text("最近视频", "Recent Videos")}
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
          emptyText={text("还没有 YouTube 订阅。粘贴一个频道链接试试。", "No YouTube channels yet. Paste a channel URL above to add one.")}
          renderAvatarFallback={() => (
            <img src="/logos/youtube.svg" alt="YouTube" className="h-3.5 w-3.5" />
          )}
          showAuthor={false}
        />
      </div>
    </AppShell>
  );
}
