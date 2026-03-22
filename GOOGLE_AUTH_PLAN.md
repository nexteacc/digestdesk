# Google 登录与多用户系统 — 实施方案（Clerk 版）

## 目标

使用 Clerk 将 DigestDesk 从单用户工具升级为支持 Google 登录的多用户 Web 应用，并利用 Google OAuth token 实现一键导入 YouTube 订阅。

分两个阶段实施，每个阶段独立可交付、可验证。

---

## 技术栈版本兼容性

Clerk 于 2026 年 1 月发布了 **Core 3**，包名和组件 API 均有变更。基于本项目当前的技术栈，应直接使用 Core 3 最新版。

### 当前项目技术栈

| 依赖 | 当前版本 |
|------|---------|
| React | ^19.2.0 |
| React DOM | ^19.2.0 |
| Vite | ^7.2.4 |
| Express | ^5.1.0 |
| TypeScript | ~5.9.3 |
| Node.js | ≥20.9.0（Core 3 要求） |

### 应选用的 Clerk 版本（Core 3）

| 包名 | 版本 | 说明 |
|------|------|------|
| **`@clerk/react`** | `^7.x`（最新） | ⚠️ 注意：**不是** `@clerk/clerk-react`（已废弃）。Core 3 改名为 `@clerk/react` |
| **`@clerk/express`** | `^2.x`（最新） | Core 3 对应 Express SDK v2 |

### Core 3 关键 API 变更（影响本方案的代码写法）

| Core 2（旧） | Core 3（新） |
|-------------|-------------|
| `@clerk/clerk-react` | `@clerk/react` |
| `<SignedIn>` / `<SignedOut>` | `<Show when="signed-in">` / `<Show when="signed-out">` |
| `import type { ... } from '@clerk/types'` | `import type { ... } from '@clerk/shared/types'` |
| `req.auth` 直接访问 | 必须用 `getAuth(req)` |
| `afterSignOutUrl` prop | `ClerkProvider afterSignOutUrl` 或 `SignOutButton redirectUrl` |

> 参考：https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3

---

## 实施规范：该做什么 / 不该做什么

> 此部分作为实施 Phase 1 和 Phase 2 的强制约束。所有代码编写必须遵守以下规则。

### 权威参考源（按优先级排列）

1. **Clerk React (Vite) Quickstart** — https://clerk.com/docs/react/getting-started/quickstart
2. **Clerk Express Quickstart** — https://clerk.com/docs/expressjs/getting-started/quickstart
3. **Clerk Core 3 Upgrade Guide** — https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3
4. **Clerk Express SDK Reference** — https://clerk.com/docs/reference/express/overview
5. **getUserOauthAccessToken API** — https://clerk.com/docs/reference/backend-api/tag/Users/GetOAuthAccessToken

> 遇到任何不确定的 API 用法，必须先查阅以上文档，不可凭记忆或猜测编写。

### ✅ 必须做（DO）

| 规则 | 说明 |
|------|------|
| **用 `@clerk/react`** | Core 3 的正确包名。`npm install @clerk/react@latest` |
| **用 `@clerk/express`** | 后端 SDK。`npm install @clerk/express@latest` |
| **`<ClerkProvider>` 放在 `main.tsx`** | 包裹整个应用入口，不要放在组件树深处 |
| **不传 `publishableKey` prop** | Core 3 中 `<ClerkProvider>` 自动从 `VITE_CLERK_PUBLISHABLE_KEY` 读取 |
| **用 `<Show when="signed-in">` / `<Show when="signed-out">`** | Core 3 的认证门控组件 |
| **用 `<SignIn />`、`<UserButton />`、`<SignInButton />`** | Clerk 预构建组件，零手写 UI |
| **后端用 `getAuth(req)` 获取 userId** | Core 3 中 `req.auth` 直接访问已被移除 |
| **用 `clerkMiddleware()` 作为全局中间件** | 放在 `app.use()` 最前面，解析所有请求的 session |
| **用 `requireAuth()` 保护路由** | 未认证请求自动返回 401 |
| **用 `clerkClient.users.getUser(userId)` 获取用户信息** | 从 `@clerk/express` 导入 `clerkClient` |
| **用 `clerkClient.users.getUserOauthAccessToken(userId, 'oauth_google')` 获取 Google token** | Phase 2 调 YouTube API 时使用 |
| **环境变量命名** | 前端：`VITE_CLERK_PUBLISHABLE_KEY`；后端：`CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` |
| **创建 `server/src/types/globals.d.ts`** | 内容：`/// <reference types="@clerk/express/env" />`，启用 TypeScript 类型补全 |
| **查阅官方文档再写代码** | 任何不确定的 API，先用 `read_web_page` 检查官方文档 |

### ❌ 绝对不做（DO NOT）

| 规则 | 说明 |
|------|------|
| **不用 `@clerk/clerk-react`** | 已废弃，Core 3 改名为 `@clerk/react` |
| **不用 `<SignedIn>` / `<SignedOut>`** | Core 2 已废弃组件，Core 3 用 `<Show>` 替代 |
| **不用 `frontendApi` prop** | 早期 Clerk 的旧 API，已移除 |
| **不用 `REACT_APP_CLERK_*` 环境变量** | CRA 命名，Vite 项目必须用 `VITE_` 前缀 |
| **不手写 JWT 签发/验证** | Clerk 全托管 session，不需要 jsonwebtoken |
| **不安装 cookie-parser / express-session** | Clerk 自动处理 cookie |
| **不在 DB 存 access_token / refresh_token** | Clerk 托管 Google OAuth token，按需通过 API 获取 |
| **不用 `req.auth` 直接访问** | Core 3 已移除，必须用 `getAuth(req)` |
| **不手动传 `publishableKey` prop 给 `<ClerkProvider>`** | Core 3 自动读取环境变量 |
| **不凭记忆猜 API 签名** | Clerk 版本迭代快，必须查文档确认 |
| **不用 `afterSignInUrl` / `afterSignUpUrl`** | Core 3 已移除，用 `fallbackRedirectUrl` 或 `forceRedirectUrl` |

### 🔍 实施前检查清单

每次编写 Clerk 相关代码前，确认以下事项：

- [ ] `@clerk/react` 和 `@clerk/express` 已安装且为最新版
- [ ] Node.js ≥ 20.9.0
- [ ] 环境变量名称正确（`VITE_CLERK_PUBLISHABLE_KEY`、`CLERK_PUBLISHABLE_KEY`、`CLERK_SECRET_KEY`）
- [ ] 所有 import 来自 `@clerk/react`（前端）或 `@clerk/express`（后端），不是废弃包
- [ ] 使用 `<Show>` 而非 `<SignedIn>` / `<SignedOut>`
- [ ] 后端通过 `getAuth(req)` 获取认证信息，不用 `req.auth`
- [ ] 不确定的 API 已通过官方文档确认

---

## Phase 1：Clerk 登录 + 多用户数据模型

### 1.1 交付效果

- 首页显示 Clerk 登录组件（Google 登录按钮）
- 登录后进入应用，显示用户头像和名字（Clerk `<UserButton />` 组件）
- 未登录用户无法访问任何功能页面
- 多个 Google 账号各自拥有独立的订阅和日报
- 现有数据自动迁移到第一个登录的用户

### 1.2 技术方案

#### 1.2.1 Clerk 项目配置

```
1. 注册 Clerk (https://dashboard.clerk.com)
2. 创建 Application
3. 在 Social connections 中启用 Google
4. 获取 Publishable Key 和 Secret Key
```

> Clerk 免费档支持 10,000 MAU，充足。

#### 1.2.2 新增依赖

**前端（根目录）：**

```bash
pnpm add @clerk/react
```

**后端（server/）：**

```bash
cd server && pnpm add @clerk/express
```

> 无需 jsonwebtoken、cookie-parser、express-session 等——Clerk 全托管。

#### 1.2.3 新增环境变量

**前端 `.env`（根目录，Vite 读取）：**

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
```

**后端 `server/.env`：**

```env
# Clerk
CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
CLERK_SECRET_KEY=sk_test_xxxxx
```

> Phase 2 追加：在 Clerk Dashboard 的 Google Social Connection 中配置自定义 OAuth Credentials（Client ID / Secret）并添加 `youtube.readonly` scope。

#### 1.2.4 数据库变更

**新增 `users` 表：**

```typescript
// server/src/db/schema.ts
export const users = pgTable("users", {
  id: text("id").primaryKey(),                      // nanoid
  clerkId: text("clerk_id").notNull().unique(),      // Clerk userId (user_xxx)
  email: text("email").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: text("created_at").notNull(),
  lastLoginAt: text("last_login_at").notNull(),
});
```

**现有表追加 `user_id` 字段：**

```sql
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_feeds_user_id ON feeds(user_id);

ALTER TABLE digests ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_digests_user_id ON digests(user_id);

ALTER TABLE settings ADD COLUMN IF NOT EXISTS user_id TEXT;
```

**迁移策略：** `user_id` 初始允许 NULL。第一个用户登录后，自动将所有 `user_id IS NULL` 的记录归属给该用户。后续新建记录必须携带 `user_id`。

#### 1.2.5 后端改造

**核心：使用 `@clerk/express` 中间件**

```typescript
// server/src/index.ts
import { clerkMiddleware, requireAuth, getAuth, clerkClient } from "@clerk/express";

app.use(clerkMiddleware());

// 公开路由
app.get("/api/health", ...);
app.get("/api/ready", ...);

// 受保护路由——加 requireAuth() 中间件
app.use("/api/feeds", requireAuth(), feedsRouter);
app.use("/api/digests", requireAuth(), digestsRouter);
app.use("/api/rss-feeds", requireAuth(), rssFeedsRouter);
app.use("/api/youtube-feeds", requireAuth(), youtubeFeedsRouter);
app.use("/api/settings", requireAuth(), settingsRouter);

// 用户信息端点（供前端获取 DB 中的 userId）
app.get("/api/auth/me", requireAuth(), authMeHandler);
```

**新增 auth 处理 (`server/src/routes/auth.ts`)：**

```typescript
import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { getDb } from "../db/index.js";
import { users } from "../db/schema.js";

export const authRouter = Router();

// GET /api/auth/me — 返回当前用户，首次登录自动创建
authRouter.get("/me", async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  const db = getDb();

  // 查找或创建用户
  let [user] = await db.select().from(users).where(eq(users.clerkId, clerkId));

  if (!user) {
    // 从 Clerk 获取用户信息
    const clerkUser = await clerkClient.users.getUser(clerkId);
    const now = new Date().toISOString();

    user = {
      id: nanoid(),
      clerkId,
      email: clerkUser.emailAddresses[0]?.emailAddress || "",
      name: `${clerkUser.firstName || ""} ${clerkUser.lastName || ""}`.trim(),
      avatarUrl: clerkUser.imageUrl,
      createdAt: now,
      lastLoginAt: now,
    };
    await db.insert(users).values(user);

    // 迁移：将无主数据归属给第一个用户
    await migrateOrphanData(user.id);
  } else {
    // 更新最后登录时间
    await db.update(users)
      .set({ lastLoginAt: new Date().toISOString() })
      .where(eq(users.id, user.id));
  }

  res.json({ user });
});
```

**辅助中间件——从 Clerk userId 解析 DB userId (`server/src/middleware/resolve-user.ts`)：**

```typescript
// 每个受保护路由在 requireAuth() 之后执行
// 将 Clerk userId 映射为数据库 userId，挂到 req.dbUserId
export async function resolveUser(req, res, next) {
  const { userId: clerkId } = getAuth(req);
  const db = getDb();
  const [user] = await db.select({ id: users.id })
    .from(users).where(eq(users.clerkId, clerkId));
  if (!user) return res.status(401).json({ error: "User not found" });
  req.dbUserId = user.id;
  next();
}
```

**路由改造示例 (`routes/feeds.ts`)：**

```typescript
// 改造前
const allFeeds = await db.select().from(feeds);

// 改造后
const allFeeds = await db.select().from(feeds)
  .where(eq(feeds.userId, req.dbUserId));

// 创建时
await db.insert(feeds).values({ ...feedDraft, userId: req.dbUserId });
```

**受影响的路由/服务文件：**

| 文件 | 改造点 |
|------|--------|
| `routes/feeds.ts` | 增删查改追加 userId 过滤 |
| `routes/digests.ts` | 查询/生成追加 userId |
| `routes/rss-feeds.ts` | discover/create/list 追加 userId |
| `routes/youtube-feeds.ts` | 同上 |
| `routes/settings.ts` | 设置读写追加 userId |
| `routes/source-feed-router.ts` | 工厂内查重和入库追加 userId |
| `services/rss.ts` | `syncAllFeeds` 不变（全局同步所有 feed） |
| `services/digest.ts` | `generateDaily` 接受 userId 参数 |
| `cron/scheduler.ts` | 遍历所有用户，逐用户生成日报 |

#### 1.2.6 前端改造

**`src/main.tsx` — 包裹 ClerkProvider：**

```tsx
import { ClerkProvider } from "@clerk/react";

// ClerkProvider 自动从 VITE_CLERK_PUBLISHABLE_KEY 读取，无需手动传 prop
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider afterSignOutUrl="/">
      <App />
    </ClerkProvider>
  </StrictMode>
);
```

**`src/App.tsx` — 认证门控（Core 3 使用 `<Show>` 组件）：**

```tsx
import { Show } from "@clerk/react";
import LoginPage from "@/pages/Login";

function App() {
  return (
    <ErrorBoundary>
      <ZenModeProvider>
        <I18nProvider>
          <ThemeProvider defaultTheme="light">
            <TooltipProvider>
              <Toaster />
              <Show when="signed-in">
                <AppRouter />
              </Show>
              <Show when="signed-out">
                <LoginPage />
              </Show>
            </TooltipProvider>
          </ThemeProvider>
        </I18nProvider>
      </ZenModeProvider>
    </ErrorBoundary>
  );
}
```

**新增 `src/pages/Login.tsx`：**

```tsx
import { SignIn } from "@clerk/react";

export default function LoginPage() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <SignIn />
    </div>
  );
}
```

> Clerk 的 `<SignIn />` 组件自带 Google 登录按钮、加载状态、错误处理，零代码。

**AppShell 头部 — 用户菜单：**

```tsx
import { UserButton } from "@clerk/react";

// 在 header 区域替换或追加
<UserButton />
```

**API 请求改造 (`src/lib/api.ts`)：**

```typescript
import { useAuth } from "@clerk/react";

// request 函数不再需要手动传 cookie
// Clerk 自动在请求中携带 session token
// 只需确保 fetch 请求带上 Clerk 的 Bearer token

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (res.status === 401) {
    // Clerk 会自动处理重定向
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}
```

> 注意：Clerk React SDK + Express SDK 在同域部署时会自动通过 cookie 传递 session。如果前后端分离部署（不同域），需要在前端 fetch 时手动附加 Bearer token（通过 `useAuth().getToken()`）。当前 DigestDesk 是同域部署（Vite build 产物由 Express 托管），所以自动 cookie 方案即可，无需改动 `api.ts` 的请求逻辑。

#### 1.2.7 Vite 开发代理配置

开发模式下前端 (localhost:5173) 和后端 (localhost:8080) 不同端口，需要代理 API 请求和 Clerk cookie。

```typescript
// vite.config.ts — 确认 proxy 配置
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
});
```

#### 1.2.8 定时任务改造

```typescript
// cron/scheduler.ts
async function runDigestJob(reason: string) {
  const db = getDb();
  const allUsers = await db.select({ id: users.id }).from(users);

  for (const user of allUsers) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      await generateDaily(user.id, today);
    } catch (err) {
      console.error(`[cron] Digest for user ${user.id} failed:`, err);
    }
  }
}
```

> `syncAllFeeds` 无需改造——同步全局 feed 数据，不区分用户。

### 1.3 新增/修改文件清单

**新增：**

| 文件 | 作用 |
|------|------|
| `src/pages/Login.tsx` | 登录页（Clerk `<SignIn />` 组件） |
| `server/src/routes/auth.ts` | `/api/auth/me` 端点 |
| `server/src/middleware/resolve-user.ts` | Clerk userId → DB userId 映射 |
| `server/src/types/globals.d.ts` | Clerk Express 类型声明 |

**修改：**

| 文件 | 改动 |
|------|------|
| `package.json` | 追加 `@clerk/react` |
| `server/package.json` | 追加 `@clerk/express` |
| `server/.env.example` | 追加 Clerk 环境变量 |
| `server/src/db/schema.ts` | 新增 users 表；feeds/digests/settings 追加 userId |
| `server/src/db/index.ts` | 新增 users 建表 + 迁移 SQL |
| `server/src/index.ts` | 挂载 clerkMiddleware + requireAuth + auth 路由 |
| `server/src/routes/*.ts` | 所有路由追加 userId 过滤 |
| `server/src/routes/source-feed-router.ts` | 工厂内查重/入库追加 userId |
| `server/src/services/digest.ts` | generateDaily 接受 userId |
| `server/src/cron/scheduler.ts` | 遍历用户生成日报 |
| `src/main.tsx` | 包裹 `<ClerkProvider>` |
| `src/App.tsx` | 加 `<SignedIn>` / `<SignedOut>` 门控 |
| `src/components/AppShell.tsx` | 加 `<UserButton />` |
| `shared/types.ts` | 新增 User 类型 |

### 1.4 验证清单

| # | 测试项 | 操作 | 预期结果 |
|---|--------|------|----------|
| 1 | 登录 | 点击 Google 登录 | Clerk 弹窗 → Google 授权 → 返回后显示头像 |
| 2 | 刷新保持 | 登录后刷新页面 | 仍然是登录状态 |
| 3 | 登出 | 点击 UserButton → 登出 | 回到登录页 |
| 4 | API 拦截 | 未登录时直接请求 `/api/feeds` | 返回 401 |
| 5 | 数据迁移 | 第一个用户登录 | 原有 feeds/digests 自动归属 |
| 6 | 数据隔离 | 第二个 Google 账号登录 | 看到空的订阅列表 |
| 7 | 日报隔离 | 两个用户各自生成日报 | 各看各的日报 |
| 8 | 设置隔离 | 两个用户各自修改日报时间 | 各自独立生效 |

---

## Phase 2：一键导入 YouTube 订阅

### 2.1 交付效果

- YouTube 管理页新增「从我的 YouTube 导入」按钮
- 点击后调用 YouTube Data API 获取用户的频道订阅列表
- 展示频道列表（头像 + 频道名），已订阅的自动标记
- 用户勾选 → 确认 → 批量创建 YouTube feed

### 2.2 技术方案

#### 2.2.1 Clerk Dashboard 配置

```
1. Social connections → Google → 使用自定义 OAuth Credentials
2. 填入 Google Cloud Console 的 Client ID / Client Secret
3. 在 Scopes 中追加：https://www.googleapis.com/auth/youtube.readonly
4. 在 Google Cloud Console 中启用 YouTube Data API v3
```

> 用户授权时会看到"查看你的 YouTube 账号"权限提示。

#### 2.2.2 获取 Google OAuth Token

Clerk 提供后端 API 获取用户的 OAuth access token：

```typescript
import { clerkClient } from "@clerk/express";

// 获取用户的 Google OAuth access token
const [tokenData] = await clerkClient.users.getUserOauthAccessToken(
  clerkUserId,
  "oauth_google"
);
const accessToken = tokenData.token;
```

> Clerk 自动处理 token 刷新，无需手动管理 refresh_token。无需在数据库存储 token。

#### 2.2.3 YouTube Data API 调用

**新增服务 (`server/src/services/youtube-subscriptions.ts`)：**

```typescript
const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

export async function fetchUserSubscriptions(accessToken: string) {
  const channels = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${YT_API_BASE}/subscriptions`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("mine", "true");
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`YouTube API error: ${res.status}`);
    }

    const data = await res.json();

    for (const item of data.items || []) {
      channels.push({
        channelId: item.snippet.resourceId.channelId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnailUrl: item.snippet.thumbnails?.default?.url,
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return channels;
}
```

**API 配额：** `subscriptions.list` 每次 1 单位，50 条/页。200 个订阅 = 4 次请求 = 4 单位。每日 10,000 单位配额完全充足。

#### 2.2.4 新增路由端点

```typescript
// server/src/routes/youtube-feeds.ts — 追加两个端点

// GET /api/youtube-feeds/my-subscriptions
// 从 Clerk 获取用户 Google token → 调 YouTube API → 返回频道列表
// 同时标记已在 DigestDesk 中订阅的频道（对比 feeds 表）

// POST /api/youtube-feeds/import
// body: { channels: [{ channelId, title, thumbnailUrl }] }
// 批量创建 YouTube feed（复用现有 YouTube adapter 逻辑）
```

#### 2.2.5 前端变更

**YouTubeFeeds.tsx 新增导入流程：**

```
[从我的 YouTube 导入] 按钮
        ↓ 点击
调用 GET /api/youtube-feeds/my-subscriptions
        ↓
弹出 Modal：频道列表（头像 + 频道名）
  - 已订阅：显示「已添加」标签，不可勾选
  - 未订阅：可勾选
  - 全选 / 取消全选
        ↓ 确认导入
调用 POST /api/youtube-feeds/import
        ↓
刷新列表 + Toast「已导入 N 个频道」
```

**API 客户端追加 (`src/lib/api.ts`)：**

```typescript
export function fetchMyYouTubeSubscriptions(): Promise<{
  channels: Array<{
    channelId: string;
    title: string;
    thumbnailUrl: string;
    alreadySubscribed: boolean;
  }>;
}> {
  return request("/youtube-feeds/my-subscriptions");
}

export function importYouTubeChannels(
  channels: Array<{ channelId: string; title: string; thumbnailUrl?: string }>
): Promise<{ created: number; skipped: number }> {
  return request("/youtube-feeds/import", {
    method: "POST",
    body: JSON.stringify({ channels }),
  });
}
```

### 2.3 新增/修改文件清单

**新增：**

| 文件 | 作用 |
|------|------|
| `server/src/services/youtube-subscriptions.ts` | YouTube Data API 调用 |

**修改：**

| 文件 | 改动 |
|------|------|
| `server/src/routes/youtube-feeds.ts` | 新增 my-subscriptions + import 端点 |
| `src/pages/YouTubeFeeds.tsx` | 新增导入按钮和频道选择 Modal |
| `src/lib/api.ts` | 新增 fetchMyYouTubeSubscriptions / importYouTubeChannels |
| `shared/types.ts` | 新增 YouTubeSubscriptionChannel 类型 |

### 2.4 验证清单

| # | 测试项 | 操作 | 预期结果 |
|---|--------|------|----------|
| 1 | 权限提示 | 首次点击「从 YouTube 导入」 | Google 弹窗请求 youtube.readonly 权限 |
| 2 | 列表展示 | 授权通过 | 显示用户 YouTube 订阅频道列表 |
| 3 | 去重标记 | 已手动添加过的频道 | 显示「已添加」，不可勾选 |
| 4 | 批量导入 | 勾选 5 个 → 确认 | 5 个频道出现在订阅列表 |
| 5 | 后台同步 | 导入后等待 | syncFeed 自动抓取新视频 |
| 6 | 日报体现 | 等待下次日报 | 导入频道的视频出现在日报 |
| 7 | 大量订阅 | 200+ YouTube 订阅 | 分页获取，全部展示 |

---

## 与自建 OAuth 方案的对比

| 维度 | 自建 OAuth | Clerk |
|------|-----------|-------|
| 新增代码量 | ~5 个新文件 + 大量 auth 逻辑 | ~2 个新文件 + 配置 |
| 前端登录页 | 手写 Login 页 + Google 按钮 | `<SignIn />` 开箱即用 |
| Session 管理 | 手写 JWT 签发/验证/刷新 | 自动托管 |
| 后端中间件 | 手写 requireAuth + cookie-parser | `requireAuth()` 一行 |
| Token 存储 | 需加密存入 DB + 手写刷新 | Clerk 托管，按需获取 |
| 额外依赖 | jsonwebtoken, cookie-parser | @clerk/clerk-react, @clerk/express |
| 安全维护 | 自己负责 | Clerk 负责 |
| 费用 | 免费 | 免费（10,000 MAU 以内） |

---

## 部署检查清单

### Phase 1

- [ ] Clerk Dashboard 创建 Application，启用 Google Social Connection
- [ ] 获取 Publishable Key 和 Secret Key
- [ ] 生产环境设置环境变量：`VITE_CLERK_PUBLISHABLE_KEY`、`CLERK_PUBLISHABLE_KEY`、`CLERK_SECRET_KEY`
- [ ] Clerk Dashboard 设置生产域名（Allowed origins）
- [ ] 数据库迁移：验证 users 表创建和 userId 字段迁移

### Phase 2

- [ ] Clerk Dashboard → Google Social Connection → 使用自定义 OAuth Credentials
- [ ] Google Cloud Console 创建 OAuth Client，设置 Clerk 的 redirect URI
- [ ] Google Cloud Console 启用 YouTube Data API v3
- [ ] Clerk Dashboard 追加 youtube.readonly scope
- [ ] 验证 `clerkClient.users.getUserOauthAccessToken` 返回有效 token
