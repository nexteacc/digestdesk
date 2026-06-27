import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Activity,
  Ban,
  CheckCircle2,
  CircleAlert,
  Gauge,
  Loader2,
  MoreVertical,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRoundCog,
  Users,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/contexts/I18nContext";
import * as api from "@/lib/api";
import type { AdminAccessStatus, AdminOperationsDay, AdminOperationsSummary, AdminPlan, AdminUser } from "@/lib/api";
import { cn } from "@/lib/utils";

type UserStatusFilter = "active" | "revoked" | "all";

const PLAN_META: Record<AdminPlan, { label: string; limit: number | null; className: string }> = {
  free: {
    label: "Free",
    limit: 100,
    className: "border-border bg-secondary text-foreground",
  },
  test: {
    label: "Test",
    limit: 300,
    className: "border-primary/40 bg-primary/10 text-primary",
  },
  admin: {
    label: "Admin",
    limit: null,
    className: "border-foreground/20 bg-foreground text-background",
  },
};

function effectiveLimit(plan: AdminPlan, override: number | null) {
  return override ?? PLAN_META[plan].limit;
}

function displayName(user: AdminUser) {
  return user.name?.trim() || user.email.split("@")[0] || user.email;
}

function fallbackInitials(user: AdminUser) {
  return displayName(user).slice(0, 2).toUpperCase();
}

function limitText(limit: number | null, text: (zh: string, en: string) => string) {
  return limit === null ? text("不限", "Unlimited") : String(limit);
}

function planLabel(plan: AdminPlan, text: (zh: string, en: string) => string) {
  if (plan === "free") return text("基础", "Basic");
  if (plan === "test") return text("内测", "Test");
  return text("不限额", "Unlimited");
}

function statusLabel(status: AdminAccessStatus, text: (zh: string, en: string) => string) {
  return status === "active" ? text("可用", "Active") : text("已停用", "Revoked");
}

function formatDate(value: string | null, text: (zh: string, en: string) => string) {
  if (!value) return text("暂无", "None");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function AdminMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <div className="mt-3 text-3xl font-semibold leading-none">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function jobStatusTone(status: string) {
  if (status === "failed") return "border-destructive/20 bg-destructive/8 text-destructive";
  if (status === "running") return "border-primary/25 bg-primary/8 text-primary";
  if (status === "pending") return "border-foreground/20 bg-foreground/8 text-foreground";
  return "border-border bg-secondary text-foreground";
}

function previousOperationsDay(summary: AdminOperationsSummary | null): AdminOperationsDay | null {
  if (!summary || summary.days.length === 0) return null;
  return summary.days.at(-2) ?? summary.days.at(-1) ?? null;
}

function operationHealth(day: AdminOperationsDay) {
  if (day.jobs.failed > 0) return "failed";
  if (day.jobs.pending + day.jobs.running > 0) return "pending";
  if (day.jobs.succeeded > 0) return "healthy";
  return "quiet";
}

function operationHealthLabel(day: AdminOperationsDay, text: (zh: string, en: string) => string) {
  const health = operationHealth(day);
  if (health === "failed") return text("有失败", "Failed");
  if (health === "pending") return text("待处理", "Pending");
  if (health === "healthy") return text("正常", "Healthy");
  return text("无任务", "No jobs");
}

function operationHealthClass(day: AdminOperationsDay) {
  const health = operationHealth(day);
  if (health === "failed") return "border-destructive/25 bg-destructive/8 text-destructive";
  if (health === "pending") return "border-primary/25 bg-primary/8 text-primary";
  if (health === "healthy") return "border-green-700/20 bg-green-700/8 text-green-700";
  return "border-border bg-secondary text-muted-foreground";
}

function quotaTone(user: AdminUser) {
  if (user.subscriptionLimit === null) return "text-muted-foreground";
  const ratio = user.activeSubscriptions / user.subscriptionLimit;
  if (ratio >= 1) return "text-destructive";
  if (ratio >= 0.85) return "text-primary";
  return "text-muted-foreground";
}

function UserRow({
  user,
  busy,
  onPlanChange,
  onAdjustLimit,
  onClearOverride,
  onToggleStatus,
}: {
  user: AdminUser;
  busy: boolean;
  onPlanChange: (userId: string, plan: AdminPlan) => void;
  onAdjustLimit: (user: AdminUser) => void;
  onClearOverride: (userId: string) => void;
  onToggleStatus: (userId: string) => void;
}) {
  const { text } = useI18n();
  const quotaPercent =
    user.subscriptionLimit === null
      ? 100
      : Math.min(100, Math.round((user.activeSubscriptions / user.subscriptionLimit) * 100));

  return (
    <TableRow className="align-middle transition-colors hover:bg-secondary/35">
      <TableCell className="py-4 pl-4 pr-3">
        <div className="flex min-w-[220px] items-center gap-3">
          <Avatar className="h-9 w-9 border border-border">
            <AvatarImage src={user.avatarUrl ?? undefined} alt={displayName(user)} />
            <AvatarFallback>{fallbackInitials(user)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{displayName(user)}</div>
            <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          </div>
        </div>
      </TableCell>
      <TableCell className="px-3 py-4">
        <Select
          value={user.accountPlan}
          onValueChange={(value) => onPlanChange(user.id, value as AdminPlan)}
          disabled={busy}
        >
          <SelectTrigger className="h-9 w-[120px] bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="free">{text("基础", "Basic")}</SelectItem>
            <SelectItem value="test">{text("内测", "Test")}</SelectItem>
            <SelectItem value="admin">{text("不限额", "Unlimited")}</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="px-3 py-4">
        <div className="min-w-[150px]">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className={cn("font-semibold", quotaTone(user))}>
              {user.activeSubscriptions} / {limitText(user.subscriptionLimit, text)}
            </span>
            {user.subscriptionLimitOverride ? (
              <Badge variant="outline" className="rounded-sm text-[10px]">
                {text("覆盖", "Override")}
              </Badge>
            ) : null}
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-secondary">
            <div
              className={cn(
                "h-full rounded-full",
                user.subscriptionLimit === null
                  ? "bg-foreground/50"
                  : quotaPercent >= 85
                    ? "bg-primary"
                    : "bg-foreground/45",
              )}
              style={{ width: `${quotaPercent}%` }}
            />
          </div>
        </div>
      </TableCell>
      <TableCell className="px-3 py-4">
        <div className="text-sm">{user.digestCount}</div>
        <div className="text-xs text-muted-foreground">{formatDate(user.lastDigestAt, text)}</div>
      </TableCell>
      <TableCell className="px-3 py-4">
        <Badge
          variant="outline"
          className={cn(
            "rounded-sm",
            user.accessStatus === "active"
              ? "border-green-700/20 bg-green-700/8 text-green-700"
              : "border-destructive/20 bg-destructive/8 text-destructive",
          )}
        >
          {user.accessStatus === "active" ? <CheckCircle2 className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
          {statusLabel(user.accessStatus, text)}
        </Badge>
      </TableCell>
      <TableCell className="py-4 pl-3 pr-4 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
              <span className="sr-only">{text("打开用户操作", "Open user actions")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onAdjustLimit(user)}>
              <SlidersHorizontal className="h-4 w-4" />
              {text("调整订阅额度", "Adjust feed limit")}
            </DropdownMenuItem>
            {user.subscriptionLimitOverride ? (
              <DropdownMenuItem onClick={() => onClearOverride(user.id)}>
                <Gauge className="h-4 w-4" />
                {text("恢复默认额度", "Use default limit")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant={user.accessStatus === "active" ? "destructive" : "default"}
              onClick={() => onToggleStatus(user.id)}
            >
              <Ban className="h-4 w-4" />
              {user.accessStatus === "active" ? text("停用用户", "Revoke access") : text("恢复用户", "Restore access")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

export default function AdminPage() {
  const { text } = useI18n();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [operations, setOperations] = useState<AdminOperationsSummary | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("active");
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [limitValue, setLimitValue] = useState<number[]>([300]);
  const [userToRevoke, setUserToRevoke] = useState<AdminUser | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadAdmin() {
      try {
        await api.fetchAdminMe();
        const [nextUsers, nextOperations] = await Promise.all([
          api.fetchAdminUsers(),
          api.fetchAdminOperationsSummary(7),
        ]);
        if (!mounted) return;
        setUsers(nextUsers);
        setOperations(nextOperations);
      } catch (error) {
        if (!mounted) return;
        if (error instanceof api.ApiError && error.status === 403) {
          setAccessDenied(true);
        }
        toast.error(error instanceof Error ? error.message : text("加载管理数据失败", "Failed to load admin data"));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadAdmin();

    return () => {
      mounted = false;
    };
  }, [text]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((user) => {
      if (statusFilter !== "all" && user.accessStatus !== statusFilter) return false;
      if (!q) return true;
      return `${displayName(user)} ${user.email} ${user.accountPlan}`.toLowerCase().includes(q);
    });
  }, [query, statusFilter, users]);

  const activeUsers = users.filter((user) => user.accessStatus === "active").length;
  const activeUserRows = users.filter((user) => user.accessStatus === "active");
  const totalSubscriptions = activeUserRows.reduce((sum, user) => sum + user.activeSubscriptions, 0);
  const nearLimitUsers = activeUserRows.filter(
    (user) => user.subscriptionLimit !== null && user.activeSubscriptions / user.subscriptionLimit >= 0.85,
  ).length;
  const digestCount = activeUserRows.reduce((sum, user) => sum + user.digestCount, 0);
  const yesterdayOperations = previousOperationsDay(operations);

  async function persistUser(
    userId: string,
    getNext: (user: AdminUser) => {
      accountPlan: AdminPlan;
      subscriptionLimitOverride: number | null;
      accessStatus: AdminAccessStatus;
    },
  ) {
    const user = users.find((item) => item.id === userId);
    if (!user) return;
    const next = getNext(user);
    setBusyUserId(userId);
    try {
      await api.updateAdminUserEntitlement(userId, next);
      setUsers((current) =>
        current.map((item) =>
          item.id === userId
            ? {
                ...item,
                accountPlan: next.accountPlan,
                accessStatus: next.accessStatus,
                subscriptionLimitOverride: next.subscriptionLimitOverride,
                subscriptionLimit: effectiveLimit(next.accountPlan, next.subscriptionLimitOverride),
              }
            : item,
        ),
      );
      toast.success(text("已保存", "Saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text("保存失败", "Save failed"));
    } finally {
      setBusyUserId(null);
    }
  }

  function onPlanChange(userId: string, plan: AdminPlan) {
    persistUser(userId, (user) => ({
      accountPlan: plan,
      subscriptionLimitOverride: user.subscriptionLimitOverride,
      accessStatus: user.accessStatus,
    }));
  }

  function onToggleStatus(userId: string) {
    const user = users.find((item) => item.id === userId);
    if (!user) return;
    if (user.accessStatus === "active") {
      setUserToRevoke(user);
      return;
    }

    void persistUser(userId, (current) => ({
      accountPlan: current.accountPlan,
      subscriptionLimitOverride: current.subscriptionLimitOverride,
      accessStatus: "active",
    }));
  }

  async function onConfirmRevoke() {
    if (!userToRevoke) return;
    await persistUser(userToRevoke.id, (user) => ({
      accountPlan: user.accountPlan,
      subscriptionLimitOverride: user.subscriptionLimitOverride,
      accessStatus: "revoked",
    }));
    setUserToRevoke(null);
  }

  function onAdjustLimit(user: AdminUser) {
    setSelectedUser(user);
    setLimitValue([user.subscriptionLimit ?? 1000]);
    setLimitDialogOpen(true);
  }

  function onClearOverride(userId: string) {
    persistUser(userId, (user) => ({
      accountPlan: user.accountPlan,
      subscriptionLimitOverride: null,
      accessStatus: user.accessStatus,
    }));
  }

  async function onSaveLimit() {
    if (!selectedUser) return;
    await persistUser(selectedUser.id, (user) => ({
      accountPlan: user.accountPlan,
      subscriptionLimitOverride: limitValue[0],
      accessStatus: user.accessStatus,
    }));
    setLimitDialogOpen(false);
    setSelectedUser(null);
  }

  if (loading) {
    return (
      <div className="pb-12">
        <Card className="flex min-h-[320px] items-center justify-center border-border bg-card/70 shadow-sm">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {text("正在加载管理数据", "Loading admin data")}
          </div>
        </Card>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="mx-auto max-w-3xl pb-12">
        <Card className="border-border bg-card/70 p-8 shadow-sm">
          <Badge variant="outline" className="rounded-sm border-destructive/25 bg-destructive/8 text-destructive">
            {text("没有权限", "No access")}
          </Badge>
          <h2 className="mt-5 text-2xl font-semibold">{text("需要管理员邮箱", "Admin email required")}</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {text(
              "请使用后端 ADMIN_EMAILS 环境变量中配置的 Clerk 账号登录。这个邮箱限制只在后端生效，前端不会保存管理员名单。",
              "Sign in with a Clerk account listed in the backend ADMIN_EMAILS environment variable. The admin list is enforced server-side only.",
            )}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-7 pb-12">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              {text("内部管理", "Internal Admin")}
            </div>
            <h2 className="mt-2 text-3xl font-semibold leading-tight md:text-4xl">
              {text("Admin", "Admin")}
            </h2>
          </div>
        </div>
        <Separator />
      </div>

      <Tabs defaultValue="users" className="gap-6">
        <TabsList className="rounded-md">
          <TabsTrigger value="users">{text("用户与额度", "Users & Limits")}</TabsTrigger>
          <TabsTrigger value="operations">{text("运行状态", "Operations")}</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-7">
      <div className="grid gap-5 md:grid-cols-4">
        <AdminMetric
          icon={<Users className="h-4 w-4" />}
          label={text("可用账号", "Active accounts")}
          value={`${activeUsers}/${users.length}`}
          detail={text("可用账号 / 全部账号", "Active accounts / total")}
        />
        <AdminMetric
          icon={<Gauge className="h-4 w-4" />}
          label={text("活跃订阅源", "Active feeds")}
          value={String(totalSubscriptions)}
          detail={text("可用账号正在接收的订阅源", "Feeds on active accounts")}
        />
        <AdminMetric
          icon={<CircleAlert className="h-4 w-4" />}
          label={text("接近额度上限", "Near quota")}
          value={String(nearLimitUsers)}
          detail={text("额度使用率超过 85%", "Quota usage over 85%")}
        />
        <AdminMetric
          icon={<Activity className="h-4 w-4" />}
          label={text("累计日报", "Total digests")}
          value={String(digestCount)}
          detail={text("可用账号已生成的日报", "Generated for active accounts")}
        />
      </div>

      <Card className="overflow-hidden border-border bg-card/70 shadow-sm">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <UserRoundCog className="h-4 w-4 text-primary" />
              {text("用户管理", "User Management")}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {text(
                "管理用户可用状态和订阅源额度。",
                "Manage account status and feed limits.",
              )}
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row">
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as UserStatusFilter)}>
              <SelectTrigger className="h-10 w-full bg-background md:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{text("可用用户", "Active")}</SelectItem>
                <SelectItem value="revoked">{text("已停用", "Revoked")}</SelectItem>
                <SelectItem value="all">{text("全部用户", "All users")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative w-full md:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={text("搜索姓名、邮箱或等级", "Search name, email, or plan")}
                className="pl-9"
              />
            </div>
          </div>
        </div>

        <Table className="min-w-[880px] border-collapse text-left">
          <TableHeader className="border-t border-border bg-secondary/45 text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <TableRow>
              <TableHead className="py-3 pl-4 pr-3 font-medium">{text("用户", "User")}</TableHead>
              <TableHead className="px-3 py-3 font-medium">{text("额度方案", "Plan")}</TableHead>
              <TableHead className="px-3 py-3 font-medium">{text("订阅额度", "Subscription quota")}</TableHead>
              <TableHead className="px-3 py-3 font-medium">{text("累计日报", "Total digests")}</TableHead>
              <TableHead className="px-3 py-3 font-medium">{text("状态", "Status")}</TableHead>
              <TableHead className="py-3 pl-3 pr-4 text-right font-medium">{text("操作", "Action")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                busy={busyUserId === user.id}
                onPlanChange={onPlanChange}
                onAdjustLimit={onAdjustLimit}
                onClearOverride={onClearOverride}
                onToggleStatus={onToggleStatus}
              />
            ))}
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-28 text-center text-sm text-muted-foreground">
                  {text("没有匹配用户", "No matching users")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>

      <Card className="border-border bg-card/70 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">{text("额度方案", "Plan Rules")}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {text(
                "这些方案只控制订阅源数量上限，不代表后台管理员权限。",
                "Plans control feed limits only; they do not grant admin access.",
              )}
            </div>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {(Object.keys(PLAN_META) as AdminPlan[]).map((plan) => (
            <div key={plan} className="rounded-md border border-border bg-background/60 p-4">
              <Badge variant="outline" className={cn("rounded-sm", PLAN_META[plan].className)}>
                {planLabel(plan, text)}
              </Badge>
              <div className="mt-4 text-2xl font-semibold">
                {limitText(PLAN_META[plan].limit, text)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {text("订阅源上限", "feed limit")}
              </div>
            </div>
          ))}
        </div>
      </Card>
        </TabsContent>

        <TabsContent value="operations" className="space-y-7">
          <div className="grid gap-5 md:grid-cols-4">
            <AdminMetric
              icon={<Activity className="h-4 w-4" />}
              label={text("昨日任务", "Yesterday jobs")}
              value={String(yesterdayOperations?.jobs.total ?? 0)}
              detail={text(
                `${yesterdayOperations?.jobs.succeeded ?? 0} 成功 / ${yesterdayOperations?.jobs.skipped ?? 0} 跳过`,
                `${yesterdayOperations?.jobs.succeeded ?? 0} succeeded / ${yesterdayOperations?.jobs.skipped ?? 0} skipped`,
              )}
            />
            <AdminMetric
              icon={<CircleAlert className="h-4 w-4" />}
              label={text("近 7 天异常", "7-day anomalies")}
              value={String(operations?.anomalies.length ?? 0)}
              detail={text("失败或到点未完成任务", "Failed or overdue jobs")}
            />
            <AdminMetric
              icon={<Gauge className="h-4 w-4" />}
              label={text("昨日日报", "Yesterday digests")}
              value={String(yesterdayOperations?.digests ?? 0)}
              detail={text("昨日已生成日报", "Generated yesterday")}
            />
            <AdminMetric
              icon={<Users className="h-4 w-4" />}
              label={text("昨日条目", "Yesterday items")}
              value={String(yesterdayOperations?.items ?? 0)}
              detail={text("昨日 digest items", "Digest items yesterday")}
            />
          </div>

          <Card className="overflow-hidden border-border bg-card/70 shadow-sm">
            <div className="p-4">
              <div className="text-sm font-semibold">{text("最近 7 天逐日运行", "Daily Runs: Last 7 Days")}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {text("每一行是一条日报目标日期，用来快速确认每天是否正常完成。", "Each row is one digest target date, so daily completion is easy to scan.")}
              </div>
            </div>
            <div className="space-y-2 border-t border-border p-4">
              {(operations?.days ?? []).map((day) => (
                <div
                  key={day.date}
                  className="grid gap-3 rounded-md border border-border bg-background/55 p-3 md:grid-cols-[150px_110px_1fr_160px]"
                >
                  <div>
                    <div className="text-sm font-semibold">{day.date}</div>
                    <Badge variant="outline" className={cn("mt-2 rounded-sm", operationHealthClass(day))}>
                      {operationHealthLabel(day, text)}
                    </Badge>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold leading-none">{day.jobs.total}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{text("任务", "jobs")}</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm md:grid-cols-5">
                    <div>
                      <div className="font-semibold">{day.jobs.succeeded}</div>
                      <div className="text-xs text-muted-foreground">{text("成功", "succeeded")}</div>
                    </div>
                    <div>
                      <div className="font-semibold">{day.jobs.skipped}</div>
                      <div className="text-xs text-muted-foreground">{text("跳过", "skipped")}</div>
                    </div>
                    <div>
                      <div className={cn("font-semibold", day.jobs.failed > 0 ? "text-destructive" : "")}>{day.jobs.failed}</div>
                      <div className="text-xs text-muted-foreground">{text("失败", "failed")}</div>
                    </div>
                    <div>
                      <div className={cn("font-semibold", day.jobs.pending + day.jobs.running > 0 ? "text-primary" : "")}>
                        {day.jobs.pending + day.jobs.running}
                      </div>
                      <div className="text-xs text-muted-foreground">{text("待处理", "pending")}</div>
                    </div>
                    <div>
                      <div className="font-semibold">{day.digests}</div>
                      <div className="text-xs text-muted-foreground">{text("日报", "digests")}</div>
                    </div>
                  </div>
                  <div className="md:text-right">
                    <div className="text-2xl font-semibold leading-none">{day.items}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{text("总结条目", "digest items")}</div>
                  </div>
                </div>
              ))}
              {operations && operations.days.length === 0 ? (
                <div className="rounded-md border border-border bg-background/55 p-6 text-center text-sm text-muted-foreground">
                  {text("暂无运行数据", "No operations data")}
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="overflow-hidden border-border bg-card/70 shadow-sm">
            <div className="p-4">
              <div className="text-sm font-semibold">{text("需要关注的任务", "Needs Attention")}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {text("只显示失败、到点仍 pending 或 running 的任务。", "Failed, pending, or running jobs past schedule.")}
              </div>
            </div>
            <Table className="min-w-[820px] border-collapse text-left">
              <TableHeader className="border-t border-border bg-secondary/45 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <TableRow>
                  <TableHead className="py-3 pl-4 pr-3 font-medium">{text("日期", "Date")}</TableHead>
                  <TableHead className="px-3 py-3 font-medium">{text("用户", "User")}</TableHead>
                  <TableHead className="px-3 py-3 font-medium">{text("状态", "Status")}</TableHead>
                  <TableHead className="px-3 py-3 font-medium">{text("调度时间", "Scheduled")}</TableHead>
                  <TableHead className="py-3 pl-3 pr-4 font-medium">{text("错误", "Error")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(operations?.anomalies ?? []).map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="py-3 pl-4 pr-3 text-sm font-medium">{job.targetDate}</TableCell>
                    <TableCell className="px-3 py-3 text-sm">{job.userEmail}</TableCell>
                    <TableCell className="px-3 py-3">
                      <Badge variant="outline" className={cn("rounded-sm", jobStatusTone(job.status))}>
                        {job.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                      {formatDate(job.scheduledFor, text)}
                    </TableCell>
                    <TableCell className="max-w-[320px] truncate py-3 pl-3 pr-4 text-xs text-muted-foreground">
                      {job.lastError || text("暂无", "None")}
                    </TableCell>
                  </TableRow>
                ))}
                {operations && operations.anomalies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                      {text("没有需要处理的任务", "No jobs need attention")}
                    </TableCell>
                  </TableRow>
                ) : null}
                {!operations ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                      {text("暂无运行数据", "No operations data")}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={limitDialogOpen} onOpenChange={setLimitDialogOpen}>
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle>{text("调整订阅额度", "Adjust subscription limit")}</DialogTitle>
            <DialogDescription>
              {selectedUser
                ? text(
                    `为 ${selectedUser.email} 设置单独额度。`,
                    `Set an override limit for ${selectedUser.email}.`,
                  )
                : text("设置单独额度。", "Set an override limit.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="flex items-end justify-between gap-4">
              <div>
                <Label>{text("订阅源上限", "Subscription limit")}</Label>
                <div className="mt-1 text-xs text-muted-foreground">
                  {text("保存后会覆盖套餐默认额度。", "Saving creates an override over the plan default.")}
                </div>
              </div>
              <div className="text-3xl font-semibold text-primary">{limitValue[0]}</div>
            </div>
            <Slider
              value={limitValue}
              onValueChange={setLimitValue}
              min={50}
              max={1000}
              step={25}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>50</span>
              <span>1000</span>
            </div>
            {selectedUser ? (
              <div className="rounded-md border border-border bg-background/60 p-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{text("当前使用", "Current usage")}</span>
                  <span className="font-semibold">{selectedUser.activeSubscriptions}</span>
                </div>
                <div className="mt-2 flex justify-between gap-4">
                  <span className="text-muted-foreground">{text("当前上限", "Current limit")}</span>
                  <span className="font-semibold">{limitText(selectedUser.subscriptionLimit, text)}</span>
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLimitDialogOpen(false)}>
              {text("取消", "Cancel")}
            </Button>
            <Button onClick={onSaveLimit} disabled={Boolean(selectedUser && busyUserId === selectedUser.id)}>
              {selectedUser && busyUserId === selectedUser.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SlidersHorizontal className="h-4 w-4" />
              )}
              {text("保存额度", "Save limit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(userToRevoke)} onOpenChange={(open) => !open && setUserToRevoke(null)}>
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle>{text("停用这个用户？", "Revoke this account?")}</DialogTitle>
            <DialogDescription>
              {userToRevoke
                ? text(
                    `停用 ${userToRevoke.email} 后，该用户不能继续使用 API，调度器也不会再为他生成日报。历史数据会保留。`,
                    `After revoking ${userToRevoke.email}, they cannot use the app APIs and the scheduler will stop generating digests for them. Existing history is kept.`,
                  )
                : text("停用后会停止访问和日报生成。", "Revoking stops access and digest generation.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUserToRevoke(null)}>
              {text("取消", "Cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmRevoke}
              disabled={Boolean(userToRevoke && busyUserId === userToRevoke.id)}
            >
              {userToRevoke && busyUserId === userToRevoke.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Ban className="h-4 w-4" />
              )}
              {text("停用用户", "Revoke account")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
