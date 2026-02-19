import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import * as api from "@/lib/api";
import type { Feed, SubstackSearchResult } from "@/lib/types";
import { Download, Loader2, X, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Props = {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  existingFeeds: Feed[];
};

type Phase = "input" | "loading" | "select" | "importing";

export default function ImportDialog({ open, onClose, onImported, existingFeeds }: Props) {
  const [phase, setPhase] = useState<Phase>("input");
  const [username, setUsername] = useState("");
  const [results, setResults] = useState<SubstackSearchResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importResult, setImportResult] = useState<{
    created: number;
    skipped: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时聚焦输入框
  useEffect(() => {
    if (open && phase === "input") {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, phase]);

  // 关闭时重置状态
  const handleClose = useCallback(() => {
    setPhase("input");
    setUsername("");
    setResults([]);
    setSelected(new Set());
    setImportResult(null);
    onClose();
  }, [onClose]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  // 判断某个 URL 是否已订阅（按 hostname 比较）
  function isSubscribed(resultUrl: string): boolean {
    try {
      const host = new URL(resultUrl).hostname;
      return existingFeeds.some((f) => {
        try {
          return new URL(f.url).hostname === host;
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  }

  async function handleFetch() {
    const name = username.trim().replace(/^@/, "");
    if (!name) {
      toast.error("请输入 Substack 用户名");
      return;
    }

    setPhase("loading");
    try {
      const data = await api.fetchSubstackReads(name);
      if (data.length === 0) {
        toast.error("该用户没有公开的订阅列表");
        setPhase("input");
        return;
      }
      setResults(data);
      // 默认只选中尚未订阅的
      const newOnly = data.filter((r) => !isSubscribed(r.url)).map((r) => r.url);
      setSelected(new Set(newOnly));
      setPhase("select");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "获取失败");
      setPhase("input");
    }
  }

  function toggleItem(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === results.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map((r) => r.url)));
    }
  }

  async function handleImport() {
    const items = results
      .filter((r) => selected.has(r.url))
      .map((r) => ({
        url: r.url,
        name: r.name,
        logoUrl: r.logoUrl,
        authorName: r.authorName,
        description: r.description,
      }));

    if (items.length === 0) {
      toast.error("请至少选择一个订阅源");
      return;
    }

    setPhase("importing");
    try {
      const result = await api.importFeeds(items);
      setImportResult(result);
      toast.success(
        `导入完成：新增 ${result.created} 个${result.skipped > 0 ? `，跳过 ${result.skipped} 个已有的` : ""}`,
      );
      onImported();
      // 短暂展示结果后关闭
      setTimeout(handleClose, 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导入失败");
      setPhase("select");
    }
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 animate-in fade-in duration-200"
        onClick={handleClose}
      />

      {/* Dialog */}
      <Card className="relative z-50 w-full max-w-lg mx-4 p-0 shadow-lg animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 pb-0">
          <div>
            <h3 className="text-lg font-semibold">从 Substack 导入</h3>
            <p className="text-xs text-muted-foreground mt-1">
              输入你的 Substack 用户名，一键导入已有订阅
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="shrink-0 -mt-2 -mr-2"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Separator className="mt-3" />

        <div className="p-4">
          {/* Phase: Input */}
          {phase === "input" && (
            <div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">
                    @
                  </span>
                  <Input
                    ref={inputRef}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleFetch()}
                    placeholder="输入用户名，如 nexteacc"
                    className="pl-8"
                  />
                </div>
                <Button onClick={handleFetch}>查询</Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                用户名可在 Substack 个人主页 URL 中找到，格式为
                substack.com/@<span className="font-medium">用户名</span>
              </p>
            </div>
          )}

          {/* Phase: Loading */}
          {phase === "loading" && (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-[140px]" />
                    <Skeleton className="h-3 w-[220px]" />
                  </div>
                </div>
              ))}
              <div className="text-center text-xs text-muted-foreground animate-pulse pt-2">
                正在获取订阅列表…
              </div>
            </div>
          )}

          {/* Phase: Select */}
          {phase === "select" && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted-foreground">
                  找到 <span className="font-medium text-foreground">{results.length}</span> 个订阅源
                  {results.some((r) => isSubscribed(r.url)) && (
                    <span className="ml-1">
                      （{results.filter((r) => isSubscribed(r.url)).length} 个已订阅）
                    </span>
                  )}
                </span>
                <Button variant="ghost" size="sm" onClick={toggleAll}>
                  {selected.size === results.length ? "取消全选" : "全选"}
                </Button>
              </div>
              <ScrollArea className="h-[340px] pr-2">
                <div className="space-y-1.5">
                  {results.map((r) => {
                    const checked = selected.has(r.url);
                    const alreadySub = isSubscribed(r.url);
                    return (
                      <button
                        key={r.url}
                        type="button"
                        onClick={() => toggleItem(r.url)}
                        className={`flex items-center gap-3 w-full rounded-md border p-2.5 text-left transition-colors ${
                          alreadySub
                            ? "border-transparent opacity-50"
                            : checked
                              ? "border-foreground/20 bg-accent/50"
                              : "border-transparent hover:bg-accent/30"
                        }`}
                      >
                        <div
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                            checked
                              ? "border-foreground bg-foreground text-background"
                              : "border-muted-foreground/40"
                          }`}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </div>
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarImage src={r.logoUrl} alt={r.name} />
                          <AvatarFallback className="text-[10px]">
                            {r.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">
                              {r.name}
                            </span>
                            {alreadySub && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                                已订阅
                              </Badge>
                            )}
                          </div>
                          {r.authorName && (
                            <div className="text-xs text-muted-foreground truncate">
                              by {r.authorName}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
              <Separator className="my-3" />
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => setPhase("input")}>
                  返回
                </Button>
                <Button onClick={handleImport} className="gap-1.5">
                  <Download className="h-3.5 w-3.5" />
                  导入 {selected.size} 个订阅源
                </Button>
              </div>
            </div>
          )}

          {/* Phase: Importing */}
          {phase === "importing" && (
            <div className="py-8 text-center">
              {importResult ? (
                <>
                  <Check className="h-8 w-8 mx-auto text-green-600" />
                  <div className="mt-3 text-sm font-medium">导入完成</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    新增 {importResult.created} 个
                    {importResult.skipped > 0 &&
                      `，跳过 ${importResult.skipped} 个已有`}
                  </div>
                </>
              ) : (
                <>
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                  <div className="mt-3 text-sm text-muted-foreground animate-pulse">
                    正在导入 {selected.size} 个订阅源…
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>,
    document.body,
  );
}
