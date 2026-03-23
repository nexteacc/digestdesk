import { SignInButton } from "@clerk/react";

const words = ["Your", "Daily", "Editor"];

export default function LoginPage() {
  return (
    <div className="min-h-screen paper-noise flex flex-col">
      {/* Masthead */}
      <header className="hairline">
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl md:text-3xl font-semibold leading-none">
              DigestDesk
            </h1>
            <span className="flex items-center gap-2">
              <img src="/logos/substack.svg" alt="Substack" className="h-5 w-5" />
              <img src="/logos/youtube.svg" alt="YouTube" className="h-5 w-5" />
              <img src="/logos/rss.svg" alt="RSS" className="h-5 w-5" />
            </span>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="h-px w-12 bg-border" />
            <span className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground animate-[fadeIn_0.6s_ease_forwards] opacity-0">✦</span>
            <div className="h-px w-12 bg-border" />
          </div>

          <h2
            className="text-4xl md:text-5xl font-semibold tracking-tight flex items-baseline justify-center gap-[0.3em]"
            style={{ fontFamily: "'Fraunces', ui-serif, Georgia, serif" }}
          >
            {words.map((word, i) => (
              <span
                key={word}
                className={`inline-block animate-[wordReveal_0.7s_ease_forwards] opacity-0 ${
                  word === "Daily" ? "text-[var(--primary)]" : "text-foreground/85"
                }`}
                style={{ animationDelay: `${0.3 + i * 0.18}s` }}
              >
                {word}
              </span>
            ))}
          </h2>

          <div
            className="mt-12 animate-[fadeIn_0.6s_ease_forwards] opacity-0"
            style={{ animationDelay: "1.1s" }}
          >
            <SignInButton mode="modal">
              <button className="inline-flex items-center gap-2.5 rounded-sm px-7 py-2.5 text-sm font-medium tracking-wide bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer shadow-sm">
                Sign in
              </button>
            </SignInButton>
          </div>

          <div
            className="mt-16 flex items-center justify-center gap-4 animate-[fadeIn_0.6s_ease_forwards] opacity-0"
            style={{ animationDelay: "1.4s" }}
          >
            <div className="h-px flex-1 max-w-[80px] bg-border" />
            <span className="text-xs text-muted-foreground tracking-wider">✦</span>
            <div className="h-px flex-1 max-w-[80px] bg-border" />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center">
        <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground/40">
          DigestDesk — MIT License
        </p>
      </footer>
    </div>
  );
}
