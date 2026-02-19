import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import * as api from "@/lib/api";
import type { Digest, DigestListItem } from "@/lib/types";
import { Loader2 } from "lucide-react";

// --- 生成进度阶段 ---
const PROGRESS_PHASES = [
  { delay: 0, text: "正在汇总本周日报…" },
  { delay: 3000, text: "AI 正在归纳主题…" },
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

export default function WeeklyDigest() {
  const [weeklyList, setWeeklyList] = useState<DigestListItem[]>([]);
  const [current, setCurrent] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const loadWeekly = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.fetchDigests("weekly");
      setWeeklyList(list);

      if (list.length > 0) {
        const w = await api.fetchDigest(list[0].id);
        setCurrent(w);
      } else {
        await autoGenerate();
      }
    } catch {
      toast.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWeekly();
  }, [loadWeekly]);

  async function autoGenerate() {
    setGenerating(true);
    try {
      const digest = await api.generateDigest("weekly");
      setCurrent(digest);
      const list = await api.fetchDigests("weekly");
      setWeeklyList(list);
      toast.success("周报生成成功");
    } catch (e) {
      console.log("[WeeklyDigest] auto-generate failed:", e);
    } finally {
      setGenerating(false);
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

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl md:text-3xl font-semibold">周报</h2>
            </div>
            <Badge variant="outline" className="border-border">
              {todayLabel}
            </Badge>
          </div>
          <Separator className="mt-4" />
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

        {/* Empty state */}
        {!loading && !generating && !current && (
          <Card className="p-10 text-center">
            <div className="text-sm text-muted-foreground">
              暂无周报内容。需要先有本周的日报数据才能生成周报。
            </div>
          </Card>
        )}

        {/* Has weekly content */}
        {!loading && !generating && current && (
          <div className="space-y-4">
            {/* Archive selector */}
            {weeklyList.length > 1 && (
              <Card className="p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
                    周报归档
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    {weeklyList.slice(0, 5).map((d) => {
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

            {/* Weekly Themes */}
            {current.weeklyThemes && current.weeklyThemes.length > 0 && (
              <Card className="p-5">
                <div className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
                  本周主题
                </div>
                <h3 className="mt-2 text-xl font-semibold">
                  你关注的作者们本周集中讨论了
                </h3>
                <Separator className="my-4" />
                <div className="space-y-3">
                  {current.weeklyThemes.map((theme, i) => (
                    <div key={theme} className="flex items-start gap-3">
                      <span className="text-xs text-muted-foreground mt-0.5 font-mono">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="text-sm leading-relaxed">{theme}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Summary footer */}
          </div>
        )}
      </div>
    </AppShell>
  );
}
