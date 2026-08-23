import { useMemo, useState } from "react";
import { Building2, UserRound } from "lucide-react";
import { Link } from "wouter";

import { useI18n } from "@/contexts/I18nContext";
import { AI_LEADER_VIDEOS } from "@/lib/ai-leaders";
import { cn } from "@/lib/utils";

export default function AiLeadersTopic() {
  const { locale, text } = useI18n();
  const [organization, setOrganization] = useState("all");
  const featured = AI_LEADER_VIDEOS[0];
  const organizations = useMemo(
    () => ["all", ...Array.from(new Set(AI_LEADER_VIDEOS.map((video) => video.organization)))],
    [],
  );
  const videos = organization === "all"
    ? AI_LEADER_VIDEOS
    : AI_LEADER_VIDEOS.filter((video) => video.organization === organization);

  return (
    <div className="topic-page">
      <div className="topic-breadcrumb">
        <span>{text("DigestDesk 专题", "DigestDesk Features")}</span>
        <span>·</span>
        <span>{text("Mega4Labs 策展", "Curated by Mega4Labs")}</span>
      </div>

      <header className="topic-page-head">
        <div className="digest-eyebrow">{text("每周策展", "Weekly curation")}</div>
        <h1>{text("AI 领航者", "AI Leaders")}</h1>
        <p>{text("追踪塑造 AI 未来的人，以及他们真正说过什么。", "Follow the people shaping AI and what they actually said.")}</p>
        <div className="topic-meta">
          <span>{text("每周更新", "Updated weekly")}</span>
          <span>{text("人物 · 机构 · 长访谈", "People · organizations · long-form interviews")}</span>
          <span>{text("最近更新 2026年8月22日", "Last updated Aug 22, 2026")}</span>
        </div>
      </header>

      <section aria-labelledby="featured-heading">
        <div id="featured-heading" className="digest-eyebrow topic-section-label">{text("本周精选", "Featured this week")}</div>
        <div className="topic-featured">
          <Link href={`/topics/ai-leaders/${featured.slug}`} className="topic-media-frame topic-featured-media">
            <img src={featured.thumbnailUrl} alt={locale === "zh" ? featured.titleZh : featured.titleEn} />
            <span className="topic-duration">{featured.duration}</span>
          </Link>
          <div className="topic-featured-copy">
            <h2><Link href={`/topics/ai-leaders/${featured.slug}`}>{locale === "zh" ? featured.titleZh : featured.titleEn}</Link></h2>
            <div className="topic-detail-row"><UserRound />{featured.person}</div>
            <div className="topic-detail-row"><Building2 />{featured.organization}</div>
            <p>{locale === "zh" ? featured.descriptionZh : featured.descriptionEn}</p>
          </div>
        </div>
      </section>

      <div className="topic-filters" role="tablist" aria-label={text("机构筛选", "Filter by organization")}>
        {organizations.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={organization === item}
            className={cn("topic-filter", organization === item && "is-active")}
            onClick={() => setOrganization(item)}
          >
            {item === "all" ? text("全部", "All") : item}
          </button>
        ))}
      </div>

      <div className="topic-video-grid">
        {videos.map((video) => (
          <Link key={video.slug} href={`/topics/ai-leaders/${video.slug}`} className="topic-video-card">
            <span className="topic-media-frame">
              <img src={video.thumbnailUrl} alt={locale === "zh" ? video.titleZh : video.titleEn} />
              <span className="topic-duration">{video.duration}</span>
            </span>
            <h3>{locale === "zh" ? video.titleZh : video.titleEn}</h3>
            <span className="topic-detail-row"><UserRound />{video.person}</span>
            <span className="topic-detail-row"><Building2 />{video.organization}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
