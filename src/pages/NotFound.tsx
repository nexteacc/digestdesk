import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import { Link } from "wouter";

export default function NotFound() {
  const { text } = useI18n();

  return (
    <AppShell>
      <div className="py-16 text-center">
        <div className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
          404
        </div>
        <h2 className="mt-2 text-2xl md:text-3xl font-semibold">{text("页面不存在", "Page Not Found")}</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          {text("你访问的页面不存在。", "The page you requested does not exist.")}
        </p>
        <div className="mt-6">
          <Link href="/">
            <Button>{text("回到总览", "Back to Overview")}</Button>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
