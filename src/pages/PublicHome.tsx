const titleWords = ["Your", "everyday", "editor"];

const featureList = [
  "Track the creators you care about",
  "Your daily personal newspaper",
];

const digestPreview = [
  {
    source: "Substack",
    logo: "/logos/substack.svg",
    publication: "Product Notes",
    title: "The small decisions that make a product worth returning to",
    summary: "Retention often begins before the habit does: with a clear promise, a useful first result, and fewer decisions left to the reader.",
    readTime: "6 min",
  },
  {
    source: "Podcast",
    logo: "/logos/applepodcasts-9933cc.svg",
    publication: "The Long View",
    title: "What changes when software becomes a daily collaborator",
    summary: "A conversation about shifting from one-off automation to systems that remember context, surface judgment, and improve with use.",
    readTime: "42 min",
  },
  {
    source: "YouTube",
    logo: "/logos/youtube.svg",
    publication: "Field Research",
    title: "Inside a quieter, more durable creator business",
    summary: "The strongest audience loops are built around recurring value, direct distribution, and content people deliberately save for later.",
    readTime: "12 min",
  },
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

          <section aria-labelledby="digest-preview-title" className="mt-14 md:mt-20">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">A sample edition</p>
                <h2 id="digest-preview-title" className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
                  Today’s digest, already edited
                </h2>
              </div>
              <p className="text-sm font-medium text-foreground/65">3 sources · 3 essential stories · about 12 minutes to scan</p>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-card/85 shadow-[0_18px_50px_rgba(28,25,23,0.07)]">
              <div className="grid lg:grid-cols-[280px_minmax(0,1fr)]">
                <aside className="bg-secondary/45 p-5 md:p-7 lg:border-r lg:border-border/80">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">In this edition</p>
                  <ol className="mt-6 space-y-5">
                    {digestPreview.map((item, index) => (
                      <li key={item.title} className="flex gap-3">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background text-xs font-semibold text-foreground/65">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <img src={item.logo} alt="" className="h-4 w-4 object-contain" />
                            <span>{item.publication}</span>
                          </div>
                          <p className="mt-1.5 text-sm font-semibold leading-5 text-foreground/90">{item.title}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </aside>

                <div className="p-5 md:p-8 lg:p-10">
                  <div className="space-y-9">
                    {digestPreview.map((item) => (
                      <article key={item.title} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_120px] md:gap-8">
                        <div>
                          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            <img src={item.logo} alt="" className="h-4 w-4 object-contain" />
                            <span>{item.source}</span>
                            <span aria-hidden="true">·</span>
                            <span>{item.publication}</span>
                          </div>
                          <h3 className="mt-3 max-w-4xl text-2xl font-semibold leading-tight md:text-3xl">{item.title}</h3>
                          <div className="mt-4 max-w-4xl border-l-4 border-primary pl-4">
                            <p className="text-base leading-7 text-foreground/78">{item.summary}</p>
                          </div>
                        </div>
                        <div className="text-sm font-medium text-muted-foreground md:text-right">{item.readTime}</div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
