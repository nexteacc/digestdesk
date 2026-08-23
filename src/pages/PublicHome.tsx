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
        <div className="w-full px-4 py-4 md:px-6 lg:px-8">
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

            <nav aria-label="Legal" className="flex items-center gap-4 text-sm font-medium text-foreground/70 sm:gap-7 sm:text-base">
              <a href="#/privacy" className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
                Privacy
              </a>
              <a href="#/terms" className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
                Terms
              </a>
            </nav>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        <div className="w-full px-4 py-12 md:px-6 md:py-16 lg:px-8 xl:py-20">
          <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.48fr)] lg:items-end lg:gap-16">
            <div>
              <p className="mb-5 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                One edition. Every source that matters.
              </p>
              <h2
                className="max-w-5xl text-5xl font-semibold leading-[0.98] tracking-tight sm:text-6xl lg:text-7xl xl:text-[5.5rem]"
                style={{ fontFamily: "'Fraunces', ui-serif, Georgia, serif" }}
              >
                {titleWords.map((word) => (
                  <span
                    key={word}
                    className={`mr-[0.18em] inline-block ${word === "everyday" ? "text-[var(--primary)]" : "text-foreground"}`}
                  >
                    {word}
                  </span>
                ))}
              </h2>

              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#/sign-in" className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-sm bg-primary px-6 py-2.5 text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 active:bg-primary/85">
                  Sign in
                </a>
              </div>
            </div>

            <div className="rounded-md bg-secondary/65 p-6 md:p-7">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/65">
                Why It Matters
              </p>
              <ul className="mt-5 space-y-3 text-base leading-7 text-foreground/85">
                {featureList.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
