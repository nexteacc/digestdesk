import { useEffect, useState } from "react";

import { useI18n } from "@/contexts/I18nContext";
import { DigestEdition } from "@/components/DigestEdition";
import LocaleToggle from "@/components/LocaleToggle";
import * as api from "@/lib/api";
import type { DigestOverview } from "@/lib/types";

export default function PublicHome() {
  const { locale, text } = useI18n();
  const titleWords = locale === "zh" ? ["你的", "每日", "编辑"] : ["Your", "daily", "editor"];
  const [overview, setOverview] = useState<DigestOverview | null>(null);

  useEffect(() => {
    void api.fetchPublicDigest().then(setOverview).catch(() => undefined);
  }, []);

  return (
    <div className="min-h-screen paper-noise flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-sm focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        {text("跳至主要内容", "Skip to main content")}
      </a>

      <header className="hairline public-home-header">
        <div className="w-full px-4 md:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold leading-none md:text-3xl">
                DigestDesk
              </h1>
              <span className="hidden items-center gap-2 md:flex">
                <img src="/logos/substack.svg" alt="Substack" width={20} height={20} className="h-5 w-5" />
                <img src="/logos/applepodcasts-9933cc.svg" alt="Podcast" width={20} height={20} className="h-5 w-5" />
                <img src="/logos/youtube.svg" alt="YouTube" width={20} height={20} className="h-5 w-5" />
                <img src="/logos/rss.svg" alt="RSS" width={20} height={20} className="h-5 w-5" />
              </span>
            </div>

            <nav aria-label={text("法律信息与语言", "Legal information and language")} className="flex flex-wrap items-center justify-end gap-3 text-sm font-medium text-foreground/70 sm:gap-7 sm:text-base">
              <a href="/privacy" className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
                {text("隐私政策", "Privacy policy")}
              </a>
              <a href="/terms" className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
                {text("服务条款", "Terms of service")}
              </a>
              <LocaleToggle />
            </nav>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        <div className="w-full px-4 md:px-6 lg:px-8">
          <section className="public-home-hero">
            <div>
              <h2
                className="public-home-title max-w-5xl font-semibold leading-[0.98] tracking-tight"
                style={{ fontFamily: "'Fraunces', ui-serif, Georgia, serif" }}
              >
                {titleWords.map((word) => (
                  <span
                    key={word}
                    className={`mr-[0.18em] inline-block ${word === (locale === "zh" ? "每日" : "daily") ? "text-[var(--primary)]" : "text-foreground"}`}
                  >
                    {word}{locale === "en" ? " " : ""}
                  </span>
                ))}
              </h2>

              <p className="public-home-description">
                {text("追踪你关心的创作者，每天编辑一份专属日报。", "Follow the creators you care about. Get a daily digest made for you.")}
              </p>

              <div className="public-home-actions flex flex-wrap items-center gap-3">
                <a href="/#/sign-in" className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-sm bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 active:bg-primary/85">
                  {text("登录", "Sign in")}
                </a>
              </div>
            </div>
          </section>
          {overview?.currentDigest ? (
            <section className="public-home-digest border-t border-border">
              <DigestEdition digest={overview.currentDigest} feeds={overview.feeds} initialItemsPerSection={3} />
            </section>
          ) : null}

          <section aria-labelledby="about-digestdesk-heading" className="border-t border-border py-10 md:py-12">
            <div className="max-w-3xl space-y-3 text-sm leading-6 text-muted-foreground">
              <h2 id="about-digestdesk-heading" className="text-base font-semibold text-foreground">
                {text("关于 DigestDesk", "About DigestDesk")}
              </h2>
              <p>
                {text("DigestDesk 将 Substack、播客、RSS 和 YouTube 的更新整理成一份个人日报。", "DigestDesk is a personal reading workflow application that aggregates updates from Substack newsletters, Podcasts, RSS feeds, and YouTube channels into a structured daily reading digest.")}
              </p>
              <p>
                {text("你可以直接订阅公开内容源，也可以选择连接 Google 账户，仅授予 YouTube 只读权限，用于查看并导入自己的频道订阅。DigestDesk 遵循 Google API 服务用户数据政策，包括受限使用要求。", "Users can subscribe to public feeds directly or optionally connect their Google account with read-only YouTube access solely to view and import their own YouTube channel subscriptions into DigestDesk. DigestDesk complies with the Google API Services User Data Policy, including the Limited Use requirements.")}
              </p>
            </div>
          </section>
        </div>
      </main>

      <footer className="hairline">
        <div className="w-full flex flex-col gap-3 px-4 py-4 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between md:px-6 lg:px-8">
          <p>{text("用 DigestDesk 整理 Substack、播客、RSS 和 YouTube 更新。", "DigestDesk helps users organize Substack, Podcast, RSS, and YouTube updates into one personal workflow.")}</p>
          <div className="flex gap-4">
            <a href="/privacy" className="hover:text-foreground transition-colors">
              {text("隐私政策", "Privacy policy")}
            </a>
            <a href="/terms" className="hover:text-foreground transition-colors">
              {text("服务条款", "Terms of service")}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
