import { format } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { ArrowLeft, ArrowRight, ExternalLink, Play } from "lucide-react";
import { Link, useRoute } from "wouter";

import { useI18n } from "@/contexts/I18nContext";
import { AI_LEADER_VIDEOS, getAiLeaderVideo } from "@/lib/ai-leaders";

export default function AiLeaderDetail() {
  const { locale, text } = useI18n();
  const [, params] = useRoute("/topics/ai-leaders/:slug");
  const video = getAiLeaderVideo(params?.slug ?? "");

  if (!video) {
    return (
      <div className="topic-empty">
        <h1>{text("没有找到这场访谈", "Interview not found")}</h1>
        <Link href="/topics/ai-leaders">{text("返回 AI 领航者", "Back to AI Leaders")}</Link>
      </div>
    );
  }

  const publishedDate = new Date(`${video.publishedAt}T00:00:00`);
  const related = AI_LEADER_VIDEOS.filter((item) => item.slug !== video.slug);

  return (
    <div className="topic-detail-page">
      <div className="topic-detail-topline">
        <div className="topic-breadcrumb">
          <span>{text("专题", "Features")}</span>
          <span>/</span>
          <span>{text("AI 领航者", "AI Leaders")}</span>
          <span>/</span>
          <span>{video.person}</span>
        </div>
        <Link href="/topics/ai-leaders" className="topic-back-link"><ArrowLeft />{text("返回 AI 领航者", "Back to AI Leaders")}</Link>
      </div>

      <div className="topic-detail-grid">
        <div className="topic-media-frame topic-detail-media">
          <img src={video.thumbnailUrl} alt={locale === "zh" ? video.titleZh : video.titleEn} />
          <a href={video.youtubeUrl} target="_blank" rel="noreferrer" className="topic-play-link" aria-label={text("在 YouTube 观看", "Watch on YouTube")}>
            <span><Play /></span>
          </a>
        </div>
        <div className="topic-detail-copy">
          <h1>{locale === "zh" ? video.titleZh : video.titleEn}</h1>
          <div className="topic-facts">
            <div><span>{text("人物", "Person")}</span><strong>{video.person}</strong></div>
            <div><span>{text("机构", "Organization")}</span><strong>{video.organization}</strong></div>
            <div><span>{text("发布日期", "Published")}</span><strong>{locale === "zh" ? format(publishedDate, "yyyy年M月d日", { locale: zhCN }) : format(publishedDate, "MMM d, yyyy", { locale: enUS })}</strong></div>
            <div><span>{text("时长", "Duration")}</span><strong>{video.duration}</strong></div>
          </div>
          <a href={video.youtubeUrl} target="_blank" rel="noreferrer" className="topic-youtube-button">
            {text("在 YouTube 观看", "Watch on YouTube")}<ExternalLink />
          </a>
        </div>
      </div>

      <section className="topic-takeaways">
        <h2>{text("这场访谈讲了什么", "What this interview covers")}</h2>
        <ol>
          {(locale === "zh" ? video.takeawaysZh : video.takeawaysEn).map((takeaway, index) => (
            <li key={takeaway}><b>{index + 1}</b><span>{takeaway}</span></li>
          ))}
        </ol>
      </section>

      <section className="topic-related">
        <h2>{text("继续探索 AI 领航者", "Explore more AI leaders")}</h2>
        {related.map((item) => (
          <Link key={item.slug} href={`/topics/ai-leaders/${item.slug}`} className="topic-related-row">
            <img src={item.thumbnailUrl} alt={locale === "zh" ? item.titleZh : item.titleEn} />
            <span>
              <h3>{locale === "zh" ? item.titleZh : item.titleEn}</h3>
              <p>{item.organization} · {locale === "zh" ? format(new Date(`${item.publishedAt}T00:00:00`), "yyyy年M月d日", { locale: zhCN }) : format(new Date(`${item.publishedAt}T00:00:00`), "MMM d, yyyy", { locale: enUS })}</p>
            </span>
            <span className="topic-related-duration">{item.duration}<ArrowRight /></span>
          </Link>
        ))}
      </section>
    </div>
  );
}
