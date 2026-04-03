import type { DigestSourceType } from "@/lib/types";

export const DIGEST_SOURCE_ORDER: DigestSourceType[] = ["substack", "rss", "podcast", "youtube"];

export const DIGEST_SOURCE_META: Record<
  DigestSourceType,
  {
    logoUrl: string;
    zhLabel: string;
    enLabel: string;
    zhDescription: string;
    enDescription: string;
  }
> = {
  substack: {
    logoUrl: "/logos/substack.svg",
    zhLabel: "Substack",
    enLabel: "Substack",
    zhDescription: "订阅专栏与作者通讯",
    enDescription: "Newsletters and writer updates",
  },
  rss: {
    logoUrl: "/logos/rss.svg",
    zhLabel: "RSS",
    enLabel: "RSS",
    zhDescription: "网站与博客更新",
    enDescription: "Sites and blog feeds",
  },
  podcast: {
    logoUrl: "/logos/applepodcasts-9933cc.svg",
    zhLabel: "Podcast",
    enLabel: "Podcast",
    zhDescription: "播客节目新一期",
    enDescription: "New podcast episodes",
  },
  youtube: {
    logoUrl: "/logos/youtube.svg",
    zhLabel: "YouTube",
    enLabel: "YouTube",
    zhDescription: "频道视频更新",
    enDescription: "Channel video updates",
  },
};
