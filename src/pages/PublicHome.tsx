import { SignInButton } from "@clerk/react";

const featureList = [
  "Bring Substack, RSS, and YouTube updates into one reading desk.",
  "Review incoming items in a calm daily workflow instead of scattered tabs.",
  "Keep subscriptions organized without losing the original source context.",
];

export default function PublicHome() {
  return (
    <div className="min-h-screen paper-noise flex flex-col">
      <header className="hairline">
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-semibold leading-none">
                DigestDesk
              </h1>
              <span className="hidden items-center gap-2 md:flex">
                <img src="/logos/substack.svg" alt="Substack" className="h-5 w-5" />
                <img src="/logos/youtube.svg" alt="YouTube" className="h-5 w-5" />
                <img src="/logos/rss.svg" alt="RSS" className="h-5 w-5" />
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

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-12 md:px-6 md:py-20">
          <section className="grid gap-10 border-y border-border py-10 md:grid-cols-[1.25fr_0.9fr] md:gap-16">
            <div>
              <p className="text-[11px] tracking-[0.28em] uppercase text-muted-foreground">
                Product Overview
              </p>
              <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-foreground md:text-6xl">
                A personal desk for reading across newsletters, feeds, and channel updates.
              </h2>
              <p className="mt-6 max-w-2xl text-base leading-7 text-foreground/80 md:text-lg">
                DigestDesk helps users collect and review updates from Substack, RSS, and YouTube
                in one place. It is built for focused reading, quick triage, and a cleaner daily
                workflow around the sources you already follow.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
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
                <a
                  href="#/privacy"
                  className="inline-flex items-center rounded-sm border border-border px-6 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
                >
                  Review privacy policy
                </a>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-sm border border-border bg-card/80 p-5">
                <p className="text-[11px] tracking-[0.24em] uppercase text-muted-foreground">
                  Core Use
                </p>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-foreground/80">
                  {featureList.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="hairline">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between md:px-6">
          <p>DigestDesk helps users organize Substack, RSS, and YouTube updates into one personal workflow.</p>
          <div className="flex gap-4">
            <a href="#/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </a>
            <a href="#/terms" className="hover:text-foreground transition-colors">
              Terms
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
