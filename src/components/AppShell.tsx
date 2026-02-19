import type { PropsWithChildren } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Newspaper, Rss, BookOpen } from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

const nav: NavItem[] = [
  { href: "/", label: "今日日报", icon: <Newspaper className="h-4 w-4" /> },
  { href: "/subscriptions", label: "订阅源", icon: <Rss className="h-4 w-4" /> },
  { href: "/weekly", label: "周报", icon: <BookOpen className="h-4 w-4" /> },
];

export default function AppShell({ children }: PropsWithChildren) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen paper-noise">
      {/* Masthead */}
      <header className="hairline">
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-6">
          <h1 className="flex items-center gap-3 text-2xl md:text-3xl font-semibold leading-none">
            <span>DigestDesk</span>
            <span className="flex items-center gap-2">
              <img
                src="/logos/substack.svg"
                alt="Substack"
                className="h-5 w-5"
              />
              <img
                src="/logos/youtube.svg"
                alt="YouTube"
                className="h-5 w-5"
              />
            </span>
          </h1>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        <div className="grid gap-6 md:grid-cols-[240px_1fr]">
          {/* Sidebar */}
          <aside className="md:sticky md:top-6 h-fit">
            <div className="rounded-lg border border-border bg-card/70 backdrop-blur p-3">
              <div className="text-xs tracking-[0.18em] uppercase text-muted-foreground px-2 py-2">
                导航
              </div>
              <Separator />
              <nav className="mt-2 mb-1 grid gap-1">
                {nav.map((item) => {
                  const active =
                    location === item.href ||
                    (item.href !== "/" && location.startsWith(item.href));
                  return (
                    <Link key={item.href} href={item.href}>
                      <Button
                        variant={active ? "secondary" : "ghost"}
                        className={cn(
                          "w-full justify-start gap-2",
                          active && "border border-border"
                        )}
                      >
                        {item.icon}
                        {item.label}
                      </Button>
                    </Link>
                  );
                })}
              </nav>
            </div>
          </aside>

          {/* Main */}
          <main>
            <div className="rounded-lg border border-border bg-card/80 backdrop-blur px-4 py-4 md:px-6 md:py-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
