import { SignInButton } from "@clerk/react";
import type { ReactNode } from "react";

type PublicPageLayoutProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
};

export default function PublicPageLayout({
  eyebrow,
  title,
  description,
  children,
}: PublicPageLayoutProps) {
  return (
    <div className="min-h-screen paper-noise flex flex-col">
      <header className="hairline">
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] tracking-[0.28em] uppercase text-muted-foreground">
                DigestDesk
              </p>
              <h1 className="mt-1 text-2xl md:text-3xl font-semibold leading-none">
                {title}
              </h1>
            </div>

            <SignInButton
              mode="modal"
              fallbackRedirectUrl="/"
              forceRedirectUrl="/"
              signUpFallbackRedirectUrl="/"
              signUpForceRedirectUrl="/"
            >
              <button className="inline-flex items-center gap-2 rounded-sm px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer shadow-sm">
                Sign in
              </button>
            </SignInButton>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-4 py-12 md:px-6 md:py-16">
          <div className="border-y border-border py-6 md:py-8">
            <p className="text-[11px] tracking-[0.24em] uppercase text-muted-foreground">
              {eyebrow}
            </p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-foreground/80 md:text-lg">
              {description}
            </p>
          </div>

          <div className="mt-10 space-y-8 text-sm leading-7 text-foreground/82 md:text-[15px]">
            {children}
          </div>
        </div>
      </main>

      <footer className="hairline">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between md:px-6">
          <p>DigestDesk helps users organize Substack, RSS, and YouTube updates into one personal workflow.</p>
          <div className="flex gap-4">
            <a href="#/" className="hover:text-foreground transition-colors">
              Home
            </a>
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
