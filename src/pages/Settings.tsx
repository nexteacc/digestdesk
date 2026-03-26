import { useEffect, useState } from "react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/contexts/I18nContext";
import * as api from "@/lib/api";
import { Settings as SettingsIcon } from "lucide-react";

const TIMEZONES = [
  { label: "UTC-10 (Honolulu)", value: "Pacific/Honolulu" },
  { label: "UTC-8 (Los Angeles)", value: "America/Los_Angeles" },
  { label: "UTC-7 (Denver)", value: "America/Denver" },
  { label: "UTC-6 (Chicago)", value: "America/Chicago" },
  { label: "UTC-5 (New York)", value: "America/New_York" },
  { label: "UTC+0 (London)", value: "UTC" },
  { label: "UTC+1 (Paris)", value: "Europe/Paris" },
  { label: "UTC+3 (Moscow)", value: "Europe/Moscow" },
  { label: "UTC+7 (Bangkok)", value: "Asia/Bangkok" },
  { label: "UTC+8 (Beijing)", value: "Asia/Shanghai" },
  { label: "UTC+9 (Tokyo)", value: "Asia/Tokyo" },
  { label: "UTC+10 (Sydney)", value: "Australia/Sydney" },
  { label: "UTC+12 (Auckland)", value: "Pacific/Auckland" },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];

export default function SettingsPage() {
  const { text } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hour, setHour] = useState("08");
  const [minute, setMinute] = useState("00");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [digestLanguage, setDigestLanguage] = useState<"zh" | "en">("zh");

  useEffect(() => {
    async function loadSettings() {
      try {
        const settings = await api.fetchSettings();
        const [h, m] = settings.digestTime.split(":");
        setHour(h);
        setMinute(m);
        setTimezone(settings.timezone);
        setDigestLanguage(settings.digestLanguage || "zh");
      } catch {
        toast.error(text("加载设置失败", "Failed to load settings"));
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, [text]);

  async function onSave() {
    setSaving(true);
    const digestTime = `${hour}:${minute}`;
    try {
      await api.updateSettings({ digestTime, timezone, digestLanguage });
      toast.success(text("设置已保存", "Settings saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : text("保存失败", "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto py-10 px-4 space-y-6">
          <div className="h-8 w-32 bg-muted animate-pulse rounded" />
          <div className="h-[200px] bg-muted animate-pulse rounded-lg" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-xl mx-auto py-12 px-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-10">
          <SettingsIcon className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground">
            {text("偏好设置", "Settings")}
          </h1>
        </div>

        <Card className="border shadow-sm overflow-hidden bg-card/50">
          <div className="p-8 space-y-10">
            {/* Digest Language */}
            <div className="flex items-center justify-between gap-8">
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">
                  {text("日报语言", "Digest Language")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {text("编辑撰写摘要时使用的语言", "Language used for your editor's summaries")}
                </p>
              </div>
              <Select value={digestLanguage} onValueChange={(v) => setDigestLanguage(v as "zh" | "en")}>
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh">{text("简体中文", "Simplified Chinese")}</SelectItem>
                  <SelectItem value="en">{text("English", "English")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Delivery Time */}
            <div className="flex items-center justify-between gap-8 pt-6 border-t border-border/50">
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground shrink-0">
                  {text("日报生成时间", "Digest Time")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {text("每日自动生成日报的时间", "Auto-generation time")}
                </p>
              </div>
              <div className="flex items-center gap-2 bg-secondary/30 p-1 rounded-lg border border-border/50">
                <Select value={hour} onValueChange={setHour}>
                  <SelectTrigger className="w-[64px] h-8 border-none bg-transparent hover:bg-background/80 font-bold text-base transition-colors focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground/30 font-medium">:</span>
                <Select value={minute} onValueChange={setMinute}>
                  <SelectTrigger className="w-[64px] h-8 border-none bg-transparent hover:bg-background/80 font-bold text-base transition-colors focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MINUTES.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Timezone */}
            <div className="flex items-center justify-between gap-8 pt-6 border-t border-border/50">
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">
                  {text("所在时区", "Timezone")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {text("日报生成的基准时区", "Base timezone for daily digest")}
                </p>
              </div>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Action */}
            <div className="pt-4 flex justify-end">
              <Button 
                onClick={onSave} 
                disabled={saving}
                className="px-10 h-10 font-bold tracking-tight transition-all active:scale-95"
              >
                {saving ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border-2 border-background/30 border-t-background animate-spin rounded-full" />
                    {text("正在保存", "Saving")}
                  </div>
                ) : (
                  text("保存设置", "Save Changes")
                )}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
