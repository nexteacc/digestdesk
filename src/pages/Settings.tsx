import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
import { ApiError } from "@/lib/api";
import type { DigestLanguage, DigestSourceType } from "@/lib/types";
import { DIGEST_SOURCE_META, DIGEST_SOURCE_ORDER } from "@/lib/digest-sources";
import { Check, Settings as SettingsIcon } from "lucide-react";
import type { Settings } from "@/lib/types";

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
const DIGEST_LANGUAGE_OPTIONS: Array<{ value: DigestLanguage; zhLabel: string; enLabel: string }> = [
  { value: "zh", zhLabel: "简体中文", enLabel: "Simplified Chinese" },
  { value: "en", zhLabel: "English", enLabel: "English" },
  { value: "de", zhLabel: "德语", enLabel: "German" },
];
let settingsCache: Settings | null = null;

function getSettingsErrorText(error: unknown, text: (zh: string, en: string) => string) {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "invalid_digest_time":
        return text("日报时间格式无效，应为 HH:mm", "Digest time must use HH:mm format");
      case "invalid_timezone":
        return text("时区不能为空", "Timezone is required");
      case "invalid_digest_language":
        return text("日报语言无效", "Digest language is invalid");
      case "invalid_digest_source_types":
        return text("请至少选择一个日报来源", "Select at least one digest source");
      case "invalid_settings_payload":
        return text("设置参数无效", "Settings payload is invalid");
      case "settings_update_failed":
        return text("更新设置失败", "Failed to update settings");
      default:
        return error.message || text("保存失败", "Failed to save");
    }
  }

  return error instanceof Error ? error.message : text("保存失败", "Failed to save");
}

function SourceInlineSelect({
  value,
  onChange,
  disabled,
}: {
  value: DigestSourceType[];
  onChange: (next: DigestSourceType[]) => void;
  disabled?: boolean;
}) {
  const { text } = useI18n();
  const orderedValue = DIGEST_SOURCE_ORDER.filter((type) => value.includes(type));

  function toggleSource(type: DigestSourceType) {
    if (disabled) return;

    if (value.includes(type)) {
      if (value.length === 1) {
        toast.error(text("请至少保留一个日报来源", "Keep at least one digest source enabled"));
        return;
      }
      onChange(orderedValue.filter((item) => item !== type));
      return;
    }

    onChange(DIGEST_SOURCE_ORDER.filter((item) => orderedValue.includes(item) || item === type));
  }

  return (
    <div className="flex flex-wrap justify-end gap-2 max-w-[420px]">
      {DIGEST_SOURCE_ORDER.map((type) => {
        const meta = DIGEST_SOURCE_META[type];
        const selected = orderedValue.includes(type);
        return (
          <button
            key={type}
            type="button"
            disabled={disabled}
            onClick={() => toggleSource(type)}
            className={`inline-flex min-w-[122px] items-center justify-between gap-2 rounded-full border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "border-primary/60 bg-primary/8 text-foreground shadow-[inset_0_0_0_1px_rgba(255,103,25,0.14)]"
                : "border-border bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full border ${selected ? "border-primary/20 bg-background" : "border-border bg-background"}`}>
                <img src={meta.logoUrl} alt={meta.enLabel} className="h-4 w-4 object-contain" />
              </span>
              <span className="font-medium">{text(meta.zhLabel, meta.enLabel)}</span>
            </span>
            <span className={`flex h-4 w-4 items-center justify-center rounded-full transition-colors ${selected ? "bg-primary text-primary-foreground" : "bg-transparent text-transparent"}`}>
              <Check className="h-3 w-3" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function SettingsPage() {
  const { text } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hour, setHour] = useState("08");
  const [minute, setMinute] = useState("00");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [digestLanguage, setDigestLanguage] = useState<DigestLanguage>("zh");
  const [digestSourceTypes, setDigestSourceTypes] = useState<DigestSourceType[]>(DIGEST_SOURCE_ORDER);

  const orderedSourceTypes = useMemo(
    () => DIGEST_SOURCE_ORDER.filter((type) => digestSourceTypes.includes(type)),
    [digestSourceTypes],
  );

  useEffect(() => {
    async function loadSettings() {
      if (settingsCache) {
        const [h, m] = settingsCache.digestTime.split(":");
        setHour(h);
        setMinute(m);
        setTimezone(settingsCache.timezone);
        setDigestLanguage(settingsCache.digestLanguage || "zh");
        const cachedSourceTypes = DIGEST_SOURCE_ORDER.filter((type) => settingsCache?.digestSourceTypes?.includes(type));
        setDigestSourceTypes(cachedSourceTypes.length > 0 ? cachedSourceTypes : DIGEST_SOURCE_ORDER);
        setLoading(false);
      }

      try {
        const settings = await api.fetchSettings();
        settingsCache = settings;
        const [h, m] = settings.digestTime.split(":");
        setHour(h);
        setMinute(m);
        setTimezone(settings.timezone);
        setDigestLanguage(settings.digestLanguage || "zh");
        const nextSourceTypes = DIGEST_SOURCE_ORDER.filter((type) => settings.digestSourceTypes?.includes(type));
        setDigestSourceTypes(nextSourceTypes.length > 0 ? nextSourceTypes : DIGEST_SOURCE_ORDER);
      } catch {
        toast.error(text("加载设置失败", "Failed to load settings"));
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, [text]);

  async function onSave() {
    if (orderedSourceTypes.length === 0) {
      toast.error(text("请至少选择一个日报来源", "Select at least one digest source"));
      return;
    }

    setSaving(true);
    const digestTime = `${hour}:${minute}`;
    try {
      await api.updateSettings({
        digestTime,
        timezone,
        digestLanguage,
        digestSourceTypes: orderedSourceTypes,
      });
      settingsCache = {
        digestTime,
        timezone,
        digestLanguage,
        digestSourceTypes: orderedSourceTypes,
      };
      toast.success(text("设置已保存", "Settings saved"));
    } catch (err) {
      toast.error(getSettingsErrorText(err, text));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
        <div className="max-w-2xl mx-auto py-10 px-4 space-y-6">
          <div className="h-8 w-32 bg-muted animate-pulse rounded" />
          <div className="h-[200px] bg-muted animate-pulse rounded-lg" />
        </div>
    );
  }

  return (
      <div className="max-w-3xl mx-auto py-12 px-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-10">
          <SettingsIcon className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground">
            {text("偏好设置", "Settings")}
          </h1>
        </div>

        <Card className="border shadow-sm overflow-hidden bg-card/50">
          <div className="p-8 space-y-0">
            {/* Digest Language */}
            <div className="flex items-center justify-between gap-8 py-1">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {text("日报语言", "Digest Language")}
                </label>
              </div>
              <Select value={digestLanguage} onValueChange={(v) => setDigestLanguage(v as DigestLanguage)}>
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIGEST_LANGUAGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {text(option.zhLabel, option.enLabel)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start justify-between gap-8 pt-6 border-t border-border/50">
              <div className="pt-2">
                <label className="text-sm font-medium text-foreground">
                  {text("日报来源", "Digest Sources")}
                </label>
              </div>
              <SourceInlineSelect
                value={orderedSourceTypes}
                onChange={setDigestSourceTypes}
                disabled={saving}
              />
            </div>

            {/* Delivery Time */}
            <div className="flex items-center justify-between gap-8 pt-6 border-t border-border/50">
              <div>
                <label className="text-sm font-medium text-foreground shrink-0">
                  {text("日报生成时间", "Digest Time")}
                </label>
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
              <div>
                <label className="text-sm font-medium text-foreground">
                  {text("所在时区", "Timezone")}
                </label>
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
  );
}
