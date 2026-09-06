import { useEffect, useState } from "react";

import { DigestEdition } from "@/components/DigestEdition";
import * as api from "@/lib/api";
import type { DigestOverview } from "@/lib/types";

const titleWords = ["你的", "每日", "编辑"];

export default function PublicHome() {
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
        跳至主要内容
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

            <nav aria-label="法律信息" className="flex items-center gap-4 text-sm font-medium text-foreground/70 sm:gap-7 sm:text-base">
              <a href="#/privacy" className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
                隐私
              </a>
              <a href="#/terms" className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
                条款
              </a>
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
                    className={`mr-[0.18em] inline-block ${word === "每日" ? "text-[var(--primary)]" : "text-foreground"}`}
                  >
                    {word}
                  </span>
                ))}
              </h2>

              <p className="public-home-description">
                追踪你关心的创作者，每天编辑一份专属日报。
              </p>

              <div className="public-home-actions flex flex-wrap items-center gap-3">
                <a href="#/sign-in" className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-sm bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 active:bg-primary/85">
                  登录
                </a>
              </div>
            </div>
          </section>
          {overview?.currentDigest ? (
            <section className="public-home-digest border-t border-border">
              <DigestEdition digest={overview.currentDigest} feeds={overview.feeds} localeOverride="zh" initialItemsPerSection={3} />
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
