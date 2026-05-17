import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Activity,
  Ban,
  CheckCircle2,
  CircleAlert,
  Gauge,
  Loader2,
  MailPlus,
  MoreVertical,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
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
  DialogTrigger,
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
import type { AdminAccessStatus, AdminInvite, AdminPlan, AdminUser } from "@/lib/api";
import { cn } from "@/lib/utils";

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
  if (plan === "free") return text("免费", "Free");
  if (plan === "test") return text("内测", "Test");
  return text("管理员", "Admin");
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
  const planMeta = PLAN_META[user.accountPlan];
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
          <SelectTrigger className="h-8 w-[112px] bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="free">{text("免费", "Free")}</SelectItem>
            <SelectItem value="test">{text("内测", "Test")}</SelectItem>
            <SelectItem value="admin">{text("管理员", "Admin")}</SelectItem>
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
        <Badge variant="outline" className={cn("rounded-sm", planMeta.className)}>
          {planLabel(user.accountPlan, text)}
        </Badge>
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
              {text("调整额度", "Adjust limit")}
            </DropdownMenuItem>
            {user.subscriptionLimitOverride ? (
              <DropdownMenuItem onClick={() => onClearOverride(user.id)}>
                <Gauge className="h-4 w-4" />
                {text("取消覆盖额度", "Clear override")}
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
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePlan, setInvitePlan] = useState<AdminPlan>("test");
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [limitValue, setLimitValue] = useState<number[]>([300]);

  useEffect(() => {
    let mounted = true;

    async function loadAdmin() {
      try {
        await api.fetchAdminMe();
        const [nextUsers, nextInvites] = await Promise.all([
          api.fetchAdminUsers(),
          api.fetchAdminInvites(),
        ]);
        if (!mounted) return;
        setUsers(nextUsers);
        setInvites(nextInvites);
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
    if (!q) return users;
    return users.filter((user) =>
      `${displayName(user)} ${user.email} ${user.accountPlan}`.toLowerCase().includes(q),
    );
  }, [query, users]);

  const activeUsers = users.filter((user) => user.accessStatus === "active").length;
  const totalSubscriptions = users.reduce((sum, user) => sum + user.activeSubscriptions, 0);
  const nearLimitUsers = users.filter(
    (user) => user.subscriptionLimit !== null && user.activeSubscriptions / user.subscriptionLimit >= 0.85,
  ).length;
  const digestCount = users.reduce((sum, user) => sum + user.digestCount, 0);

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
    persistUser(userId, (user) => ({
      accountPlan: user.accountPlan,
      subscriptionLimitOverride: user.subscriptionLimitOverride,
      accessStatus: user.accessStatus === "active" ? "revoked" : "active",
    }));
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

  async function onSendInvite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      toast.error(text("请输入邮箱", "Enter an email address"));
      return;
    }
    setInviteBusy(true);
    try {
      const invite = await api.createAdminInvite({
        email,
        accountPlan: invitePlan,
        subscriptionLimitOverride: null,
      });
      setInvites((current) => [invite, ...current.filter((item) => item.id !== invite.id)]);
      setInviteEmail("");
      setInvitePlan("test");
      setInviteOpen(false);
      toast.success(text("邀请已保存", "Invite saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text("邀请失败", "Invite failed"));
    } finally {
      setInviteBusy(false);
    }
  }

  async function onRevokeInvite(inviteId: string) {
    try {
      const invite = await api.revokeAdminInvite(inviteId);
      setInvites((current) => current.map((item) => (item.id === invite.id ? invite : item)));
      toast.success(text("邀请已撤销", "Invite revoked"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text("撤销失败", "Revoke failed"));
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl pb-12">
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
    <div className="mx-auto max-w-6xl space-y-7 pb-12">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              {text("内部管理", "Internal Admin")}
            </div>
            <h2 className="mt-2 text-3xl font-semibold leading-tight md:text-4xl">
              {text("用户与额度", "Users & Limits")}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-sm border-primary/30 bg-primary/8 text-primary">
              {text("后端权限校验已启用", "Server authorization enabled")}
            </Badge>
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <UserPlus className="h-4 w-4" />
                  {text("邀请内测用户", "Invite tester")}
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card">
                <DialogHeader>
                  <DialogTitle>{text("邀请内测用户", "Invite tester")}</DialogTitle>
                  <DialogDescription>
                    {text(
                      "用户用这个邮箱首次登录后，会自动获得预设等级。",
                      "When this email signs in, the preset plan is claimed automatically.",
                    )}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">{text("邮箱", "Email")}</Label>
                    <Input
                      id="invite-email"
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="reader@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{text("预设等级", "Preset plan")}</Label>
                    <Select value={invitePlan} onValueChange={(value) => setInvitePlan(value as AdminPlan)}>
                      <SelectTrigger className="w-full bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="free">{text("免费", "Free")}</SelectItem>
                        <SelectItem value="test">{text("内测", "Test")}</SelectItem>
                        <SelectItem value="admin">{text("管理员", "Admin")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setInviteOpen(false)} disabled={inviteBusy}>
                    {text("取消", "Cancel")}
                  </Button>
                  <Button onClick={onSendInvite} disabled={inviteBusy}>
                    {inviteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}
                    {text("添加邀请", "Add invite")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        <Separator />
      </div>

      <div className="grid gap-5 md:grid-cols-4">
        <AdminMetric
          icon={<Users className="h-4 w-4" />}
          label={text("用户", "Users")}
          value={`${activeUsers}/${users.length}`}
          detail={text("可用账号 / 全部账号", "Active accounts / total")}
        />
        <AdminMetric
          icon={<Gauge className="h-4 w-4" />}
          label={text("订阅源", "Feeds")}
          value={String(totalSubscriptions)}
          detail={text("当前 active subscriptions", "Current active subscriptions")}
        />
        <AdminMetric
          icon={<CircleAlert className="h-4 w-4" />}
          label={text("接近上限", "Near limit")}
          value={String(nearLimitUsers)}
          detail={text("额度使用率超过 85%", "Quota usage over 85%")}
        />
        <AdminMetric
          icon={<Activity className="h-4 w-4" />}
          label={text("日报", "Digests")}
          value={String(digestCount)}
          detail={text("用户累计日报", "User digest count")}
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
                "切换用户等级、管理订阅额度、停用访问权限。",
                "Change plans, manage feed limits, and revoke access.",
              )}
            </div>
          </div>
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

        <Table className="min-w-[980px] border-collapse text-left">
          <TableHeader className="border-t border-border bg-secondary/45 text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <TableRow>
              <TableHead className="py-3 pl-4 pr-3 font-medium">{text("用户", "User")}</TableHead>
              <TableHead className="px-3 py-3 font-medium">{text("等级", "Plan")}</TableHead>
              <TableHead className="px-3 py-3 font-medium">{text("订阅额度", "Subscription quota")}</TableHead>
              <TableHead className="px-3 py-3 font-medium">{text("标签", "Label")}</TableHead>
              <TableHead className="px-3 py-3 font-medium">{text("日报", "Digests")}</TableHead>
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
                <TableCell colSpan={7} className="h-28 text-center text-sm text-muted-foreground">
                  {text("没有匹配用户", "No matching users")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card className="border-border bg-card/70 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">{text("套餐规则", "Plan Rules")}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {text("第一版规则由后端 entitlements 服务执行。", "First version is enforced by the backend entitlements service.")}
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
                  {text("active subscriptions", "active subscriptions")}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="border-border bg-card/70 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{text("内测邀请", "Tester Invites")}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {text("按邮箱预设等级，用户注册后自动认领。", "Assign a plan before signup; claim on first login.")}
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setInviteOpen(true)}>
              <MailPlus className="h-3.5 w-3.5" />
              {text("添加", "Add")}
            </Button>
          </div>
          <div className="mt-5 space-y-3">
            {invites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{invite.email}</div>
                  <div className="text-xs text-muted-foreground">{formatDate(invite.createdAt, text)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className={cn("rounded-sm", PLAN_META[invite.accountPlan].className)}>
                    {invite.status}
                  </Badge>
                  {invite.status === "invited" ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onRevokeInvite(invite.id)}
                    >
                      <Ban className="h-3.5 w-3.5" />
                      <span className="sr-only">{text("撤销邀请", "Revoke invite")}</span>
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
            {invites.length === 0 ? (
              <div className="border-t border-border pt-4 text-sm text-muted-foreground">
                {text("暂无邀请", "No invites yet")}
              </div>
            ) : null}
          </div>
        </Card>
      </div>

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
    </div>
  );
}
