import { SignInButton } from "@clerk/react";

const titleWords = ["Your", "everyday", "editor"];

const featureList = [
  "Track the creators you care about",
  "Your daily personal newspaper",
];

export default function PublicHome() {
  return (
    <div className="min-h-screen paper-noise flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-sm focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        Skip to main content
      </a>

      <header className="hairline">
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-semibold leading-none">
                DigestDesk
              </h1>
              <span className="hidden items-center gap-2 md:flex">
                <img src="/logos/substack.svg" alt="Substack" width={20} height={20} className="h-5 w-5" />
                <img src="/logos/applepodcasts-9933cc.svg" alt="Podcast" width={20} height={20} className="h-5 w-5" />
                <img src="/logos/youtube.svg" alt="YouTube" width={20} height={20} className="h-5 w-5" />
                <img src="/logos/rss.svg" alt="RSS" width={20} height={20} className="h-5 w-5" />
              </span>
            </div>

            <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
              <a href="#/privacy" className="hover:text-foreground transition-colors">
                Privacy
              </a>
              <a href="#/terms" className="hover:text-foreground transition-colors">
                Terms
              </a>
            </nav>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-12 md:px-6 md:py-20">
          <section className="py-10 md:py-14">
            <div className="grid gap-10 md:grid-cols-[minmax(0,1.15fr)_360px] md:items-start md:gap-12">
              <div className="max-w-3xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-px w-12 bg-border" />
                  <span className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground animate-[fadeIn_0.6s_ease_forwards] opacity-0">
                    ✦
                  </span>
                  <div className="h-px w-12 bg-border" />
                </div>

                <h2
                  className="max-w-2xl text-4xl font-semibold tracking-tight md:text-6xl"
                  style={{ fontFamily: "'Fraunces', ui-serif, Georgia, serif" }}
                >
                  {titleWords.map((word, i) => (
                    <span
                      key={word}
                      className={`mr-[0.22em] inline-block animate-[wordReveal_0.7s_ease_forwards] opacity-0 ${
                        word === "everyday" ? "text-[var(--primary)]" : "text-foreground"
                      }`}
                      style={{ animationDelay: `${0.2 + i * 0.16}s` }}
                    >
                      {word}
                    </span>
                  ))}
                </h2>

                <div
                  className="mt-8 flex flex-wrap gap-3 animate-[fadeIn_0.6s_ease_forwards] opacity-0"
                  style={{ animationDelay: "0.85s" }}
                >
                  <SignInButton
                    mode="modal"
                    fallbackRedirectUrl="/"
                    forceRedirectUrl="/"
                    signUpFallbackRedirectUrl="/"
                    signUpForceRedirectUrl="/"
                  >
                    <button className="inline-flex items-center gap-2 rounded-sm px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer shadow-sm">
                      Sign in
                    </button>
                  </SignInButton>
                </div>
              </div>

              <div
                className="rounded-sm border border-border bg-card/80 p-5 md:p-6 animate-[fadeIn_0.6s_ease_forwards] opacity-0"
                style={{ animationDelay: "1s" }}
              >
                <p className="text-[11px] tracking-[0.24em] uppercase text-muted-foreground">
                  Why It Matters
                </p>
                <ul className="mt-4 space-y-4 text-sm leading-6 text-foreground/80">
                  {featureList.map((item) => (
                    <li key={item} className="border-b border-border/70 pb-4 last:border-b-0 last:pb-0">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
