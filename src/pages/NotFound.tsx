import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <AppShell>
      <div className="py-16 text-center">
        <div className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
          404
        </div>
        <h2 className="mt-2 text-2xl md:text-3xl font-semibold">页面不存在</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          你访问的页面不存在。
        </p>
        <div className="mt-6">
          <Link href="/">
            <Button>回到总览</Button>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
