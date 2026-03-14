import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import type { Feed } from "@/lib/types";
import { Check, Trash2, X } from "lucide-react";

interface FeedListSectionProps {
  feeds: Feed[];
  loading: boolean;
  batchMode: boolean;
  batchSelected: Set<string>;
  batchDeleting: boolean;
  enterBatchMode: () => void;
  exitBatchMode: () => void;
  toggleBatchItem: (id: string) => void;
  toggleBatchAll: () => void;
  onBatchDelete: () => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  emptyText: string;
  renderAvatarFallback?: (feed: Feed) => ReactNode;
  showAuthor?: boolean;
}

export default function FeedListSection({
  feeds,
  loading,
  batchMode,
  batchSelected,
  batchDeleting,
  enterBatchMode,
  exitBatchMode,
  toggleBatchItem,
  toggleBatchAll,
  onBatchDelete,
  onRemove,
  emptyText,
  renderAvatarFallback,
  showAuthor = true,
}: FeedListSectionProps) {
  const { text, isZh } = useI18n();
  const count = feeds.length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
          {text("已订阅", "Subscribed")} · {count}
        </span>
        {!loading && count > 0 && !batchMode && (
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

      {/* Batch action bar */}
      {batchMode && (
        <Card className="p-3 mb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={toggleBatchAll}>
                {batchSelected.size === count
                  ? text("取消全选", "Deselect all")
                  : text("全选", "Select all")}
              </Button>
              <span className="text-sm text-muted-foreground">
                {isZh ? (
                  <>
                    {text("已选择", "")}{" "}
                    <span className="font-medium text-foreground">
                      {batchSelected.size}
                    </span>{" "}
                    个
                  </>
                ) : (
                  <>
                    <span className="font-medium text-foreground">
                      {batchSelected.size}
                    </span>{" "}
                    selected
                  </>
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
                      : text(
                          `取消订阅 (${batchSelected.size})`,
                          `Unsubscribe (${batchSelected.size})`,
                        )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {text("确定一键取消？", "Unsubscribe selected?")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {text(
                        `将取消订阅 ${batchSelected.size} 个源，后续日报将不再包含这些来源的内容。`,
                        `${batchSelected.size} sources will be removed from future digests.`,
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      {text("取消", "Cancel")}
                    </AlertDialogCancel>
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

      {/* Feed list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[60px] rounded-lg" />
          ))}
        </div>
      ) : count === 0 ? (
        <Card className="p-10 text-center">
          <div className="text-sm text-muted-foreground">{emptyText}</div>
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
                      {renderAvatarFallback
                        ? renderAvatarFallback(f)
                        : f.title.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {f.title}
                      </span>
                      {showAuthor && f.authorName && (
                        <span className="text-xs text-muted-foreground hidden sm:inline">
                          {text("作者：", "by ")}
                          {f.authorName}
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
                          <AlertDialogTitle>
                            {text("确定取消订阅？", "Unsubscribe?")}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {text(
                              `取消订阅「${f.title}」后，后续日报将不再包含该来源的内容。`,
                              `${f.title} will be removed from future digests.`,
                            )}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>
                            {text("取消", "Cancel")}
                          </AlertDialogCancel>
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
  );
}
