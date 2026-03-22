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
              <button className="inline-flex items-center gap-2.5 rounded-sm border border-border px-7 py-2.5 text-sm font-medium tracking-wide bg-white text-foreground hover:bg-accent transition-colors cursor-pointer">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Sign in with Google
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
