import { SignInButton } from "@clerk/react";

const featureList = [
  "When enabled, import a user's own YouTube subscriptions after explicit Google authorization.",
  "Track public updates from Substack, RSS, and selected YouTube channels in one place.",
  "Help the user review incoming items in a personal daily reading workflow.",
];

const dataUseList = [
  "DigestDesk requests read-only access only when the user chooses to connect Google.",
  "The YouTube subscription list is used only to help the same user import channels into DigestDesk.",
  "DigestDesk does not publish, sell, or expose a user's YouTube subscription data to other users.",
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
                DigestDesk is a personal workflow tool that helps users collect and review updates
                from Substack, RSS, and YouTube. If a user chooses to connect Google, and if the
                feature is enabled for that environment, DigestDesk may request read-only access to
                that user's YouTube subscription list so the same user can import channels into the
                product faster.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <SignInButton mode="modal">
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
                  Core use
                </p>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-foreground/80">
                  {featureList.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-sm border border-border bg-card/80 p-5">
                <p className="text-[11px] tracking-[0.24em] uppercase text-muted-foreground">
                  YouTube data handling
                </p>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-foreground/80">
                  {dataUseList.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="mt-4 text-sm leading-6 text-foreground/70">
                  The Google import flow may be unavailable in some environments while verification
                  or rollout is in progress.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="hairline">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between md:px-6">
          <p>Public product page for OAuth review and user information. Support: support@digestdesk.app</p>
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
