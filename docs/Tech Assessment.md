# DigestDesk — 技术探针评估

> 工程师视角的架构评估：从 MVP 到生产部署的演进路径。
> 评估时间：2026-02-19，基于 MVP 完成后的代码实际状态。

---

## 1. 当前架构现状

### 技术栈快照

```
前端：React 19 + TypeScript + Vite 7 + TailwindCSS 4 + shadcn/ui + wouter (hash route)
后端：Express 5 + TypeScript + tsx (dev runner)
数据库：SQLite (better-sqlite3 + Drizzle ORM, WAL mode, busy_timeout/cache_size/synchronous 已调优)
AI：Vercel AI SDK + Gemini 2.5 Flash（默认，Google API Key 优先）/ gpt-5-nano（OpenAI 备选），Zod schema 结构化输出
内容抓取：Jina Reader API (主) + Turndown HTML→Markdown (兜底)
搜索代理：Cloudflare Worker（绕过 Substack 对云服务器 IP 的封锁）
定时任务：node-cron（进程内）
项目结构：Monorepo（/ 前端 + /server 后端 + /shared 共享类型）
```

### 数据规模

| 指标 | 当前值 | 说明 |
|------|--------|------|
| 订阅源 | 3 个 | Latent.Space, a16z, 42章经 |
| 文章总量 | 47 篇 | 首次同步历史积压 40 + 增量 7 |
| 实际送 AI 总结 | 7 篇 / 4 天 | 仅当天发布的文章进入日报 |
| 日报 | 4 份 | 每份 1-3 篇文章 |
| 周报 | 1 份 | 汇总本周日报 oneLiner |
| SQLite 文件 | ~2 MB | 含全文 Markdown 存储 |

### AI 调用成本（实测）

| 指标 | 值 |
|------|-----|
| 模型 | gpt-5-nano |
| 每篇文章 input | 中位数 ~4,700 tokens，最大 ~24,500 tokens |
| 每篇文章 output | ~80 tokens（oneLiner + keyInsights JSON） |
| 4 天总 AI 成本 | ~$0.002-0.003 |
| 推算月成本（3 Feed） | ~$0.02 |
| 全文无截断 | 正确策略 — 文章量少，截断得不偿失 |

---

## 2. 部署架构评估

### 当前开发模式

```
Vite dev server :5173 ──proxy /api──→ Express :8080 ──→ SQLite 文件
```

前后端分别运行，Vite 配置了 `/api` 代理转发到后端。

### 生产部署目标架构

```
单进程 Express :8080
  ├── /api/*     → 后端路由（REST API）
  ├── /*         → 前端静态文件（vite build 产物）
  ├── node-cron  → 每日定时 RSS 同步 + 日报生成
  └── SQLite     → 本地文件持久化
```

**改动点：**
- Express 托管前端 `dist/` 静态文件
- 添加生产环境构建脚本（前端 build + 后端 tsc 编译）
- cron 已改为每天 8:00 一次

### 为什么合并成一个服务

| 原因 | 说明 |
|------|------|
| 部署简单 | 一个进程、一个端口、一次部署 |
| 免费额度友好 | 大多数平台免费层只允许一个服务 |
| 资源占用低 | 静态文件 serve 几乎零开销 |
| 后续可拆 | 未来流量大了再拆分，现在没必要 |

---

## 3. 平台评估

### 评估维度

| 维度 | 权重 | 说明 |
|------|------|------|
| 免费额度 | 高 | MVP 阶段零成本验证 |
| SQLite 持久化 | 高 | 数据不能丢 |
| 常驻进程 | 中 | node-cron 需要进程存活 |
| PostgreSQL 可加 | 中 | 多用户阶段需要迁移 |
| 邮件服务兼容 | 低 | 后续阶段需要，不影响当前选择 |
| 部署 DX | 中 | Git push 自动部署为佳 |

### 平台对比

| 平台 | 免费层 | SQLite 持久化 | 常驻进程 | 加 PostgreSQL | 部署方式 | 评价 |
|------|--------|-------------|---------|-------------|---------|------|
| **Render** | 免费 Web Service | 运行期间保留，重部署丢失 | 休眠（15分钟无流量） | 免费 90 天 | Git push | 最简单，免费玩够用 |
| **Fly.io** | 免费额度（需信用卡） | Volume 持久化 | 可常驻 | Fly Postgres 免费 | CLI deploy | 持久化好，上手稍复杂 |
| **Railway** | 无免费（$5/月起） | 持久化 Volume | 常驻 | 内置 PostgreSQL | Git push | 最省心，但不免费 |
| Vercel | 免费 | 不支持 | Serverless（不适合） | 需外部 | Git push | 不适合此架构 |
| Cloudflare Workers | 免费 | 不支持 SQLite | 不支持常驻 | 需 D1 (不兼容 Drizzle better-sqlite3) | Wrangler | 需要大幅重构 |
| VPS (Hetzner/DO) | €3-5/月 | 完全持久 | 完全控制 | 自建 | SSH + pm2 | 最灵活，需运维 |

### 推荐选择

**当前阶段（免费玩）：Render Free**

理由：
- 零成本，Git push 自动部署
- 前后端合并成一个 Web Service
- SQLite 在运行期间完全正常
- 限制可接受：休眠后冷启动 ~30 秒，重部署丢数据（开发阶段可接受）

**正式使用阶段（$5-7/月）：Railway**

理由：
- 持久化 Volume，SQLite 数据不丢
- 内置 PostgreSQL，迁移时一键开
- 内置 Cron Job 支持
- 部署体验最好

---

## 4. 数据库演进评估

### SQLite 当前配置（2026-02-27 优化后）

```
Pragma 配置：
  journal_mode = WAL          — 并发读写
  foreign_keys = ON           — 引用完整性
  busy_timeout = 5000         — 锁等待 5 秒，防 SQLITE_BUSY
  cache_size = -20000         — 20MB 页缓存
  synchronous = NORMAL        — WAL 模式下安全且高效

索引：
  idx_articles_feed_id        — 按 feed 查文章
  idx_articles_url            — 文章去重
  idx_articles_published_at   — 日报生成的时间范围查询
  idx_digest_items_digest_id  — 按 digest 查条目
  idx_digests_type_date       — UNIQUE, 防重复日报/周报

事务使用：
  digest 写入（UPSERT + items replace）已包裹在单一事务内
```

### SQLite 的适用边界

| 场景 | SQLite 够用吗 | 说明 |
|------|-------------|------|
| 单用户自用 | 完全够用 | 当前状态，没有并发压力 |
| 5-10 个用户 | 勉强 | WAL 模式支持并发读，但只有单写者 |
| 50+ 用户 | 不够 | 写锁竞争、备份复杂、无连接池 |
| 云平台部署 | 受限 | 依赖持久化磁盘，不是所有平台都支持 |

### 迁移路径：SQLite → PostgreSQL

**好消息：Drizzle ORM 让这条路很平滑。**

| 步骤 | 改动量 | 说明 |
|------|--------|------|
| 1. 安装 `drizzle-orm/pg` + `pg` 驱动 | 一个依赖 | 替换 `better-sqlite3` |
| 2. 修改 `db/index.ts` 连接方式 | ~10 行 | 从 SQLite 文件 → PostgreSQL 连接字符串 |
| 3. 调整 schema 数据类型 | 微调 | `text` → `text` 基本不变，`integer` → `integer` 兼容 |
| 4. 同步查询 → 异步查询 | 中等 | better-sqlite3 是同步的，pg 是异步的。需要加 `await` |
| 5. 迁移数据 | 脚本 | 导出 SQLite → 导入 PostgreSQL |

**预估工作量：半天到一天。** Drizzle 的 schema 定义对两种数据库高度兼容。

### 时机建议

**不要提前迁移。** 在以下信号出现时再迁移：
- 需要多用户隔离（每个用户有自己的 feeds/digests）
- 部署平台不支持持久化磁盘
- 需要数据库备份/恢复能力

---

## 5. 账户体系评估

### 需求场景

当前 MVP 是单用户模式（无 Users 表）。后续需要：
- 用户注册/登录（邮箱+密码，可选 OAuth）
- 每个用户有独立的订阅、日报、周报
- 登录状态管理（JWT 或 Session）

### 方案对比

| 方案 | 类型 | 免费额度 | 与 Express 兼容 | 锁定风险 | 推荐度 |
|------|------|---------|----------------|---------|--------|
| **Better Auth** | 开源库 | 完全免费 | 原生支持 | 无 | 推荐 |
| **Lucia Auth** | 开源库 | 完全免费 | 原生支持 | 无 | 推荐 |
| Supabase Auth | 托管服务 | 50,000 MAU | 需适配 | 绑定 Supabase | 备选 |
| Clerk | 托管服务 | 10,000 MAU | SDK 集成 | 强绑定 | 不推荐 |
| 手写 JWT | 自建 | 免费 | 完全控制 | 无 | 不推荐（安全风险） |

### 推荐：Better Auth

理由：
- 开源免费，社区活跃
- 原生 Express 中间件，和现有架构无缝集成
- 支持邮箱密码 + Google/GitHub OAuth
- 自带 Session 管理，不需要手写 JWT 逻辑
- 数据存在自己的数据库里（SQLite 或 PostgreSQL），不外发

### 改动影响评估

| 现有模块 | 改动 |
|----------|------|
| `db/schema.ts` | 新增 `users` 表、`sessions` 表 |
| `feeds` / `articles` / `digests` | 新增 `userId` 外键 |
| 所有 API 路由 | 加 auth 中间件，按 userId 过滤 |
| 前端 | 新增登录/注册页，路由守卫 |

---

## 6. 邮件推送评估

### 需求场景

将日报/周报以邮件形式发送到用户邮箱，是产品核心交付方式之一。

### 邮件服务对比

| 服务 | 免费额度 | API 风格 | 邮件模板 | 投递率 | 推荐度 |
|------|---------|---------|---------|--------|--------|
| **Resend** | 3,000 封/月, 100 封/天 | 现代 REST | React Email（可复用 React 组件） | 高 | 最推荐 |
| SendGrid | 100 封/天 | REST | Handlebars 模板 | 高 | 成熟备选 |
| Amazon SES | 前 12 月免费 | AWS SDK | 自定义 | 高 | 最便宜但配置复杂 |
| Postmark | 100 封/月 | REST | Handlebars | 最高 | 额度太少 |

### 推荐：Resend

理由：
- **React Email**：用 React 组件写邮件模板，可以复用现有的日报排版逻辑
- API 简洁：`resend.emails.send({ to, subject, react: <DigestEmail /> })`
- 免费额度足够：3,000 封/月，按 30 天 × 1 封日报 + 4 封周报 = 34 封/用户/月，免费层可支撑 ~80 个用户
- 与 Express 集成零摩擦

### 邮件内容设计

```
Subject: DigestDesk 日报 · 2026-02-19 · 3 篇文章

Body (HTML):
┌─────────────────────────────────┐
│ DigestDesk · Daily Digest       │
│ 2026-02-19 · 星期四              │
├─────────────────────────────────┤
│                                 │
│ 01 · a16z                       │
│ Investing in Heron Power        │
│ 软件定义电网借助固态变压器...     │
│ → 阅读原文                      │
│                                 │
│ 02 · a16z                       │
│ How bundling benefits...        │
│ 捆绑信息产品可同时提升...        │
│ → 阅读原文                      │
│                                 │
├─────────────────────────────────┤
│ 在 DigestDesk 查看完整日报 →    │
└─────────────────────────────────┘
```

数据已经在 `digest_items` 表中，生成邮件只需查询 + 渲染模板，不需要额外调用 AI。

---

## 7. 定时任务演进评估

### 当前方案

```typescript
// server/src/cron/scheduler.ts
cron.schedule("0 8 * * *", async () => { ... }); // 每天 8:00
```

进程内 node-cron，简单直接。

### 演进路径

| 阶段 | 方案 | 说明 |
|------|------|------|
| **当前（单用户）** | node-cron，每天一次 | 改 `0 * * * *` → `0 8 * * *`（每天 8:00） |
| **Render Free 部署** | 外部 cron 唤醒 | cron-job.org 免费，每天 ping `POST /api/digests/generate` |
| **付费部署** | node-cron 进程内 | 服务常驻，cron 正常运行 |
| **多用户多时区** | 外部 Cron + API 触发 | Railway Cron Job / Render Cron Job，按时区分批触发 |
| **规模化（100+ 用户）** | BullMQ + Redis | 任务队列，失败重试，优先级调度 |

### 当前建议

改为每天一次即可。对于 Render Free 部署，配合外部 cron 服务：

```
cron-job.org (免费)
  └─ 每天 08:00 UTC+8
       └─ POST https://your-app.onrender.com/api/digests/generate
            └─ 唤醒 Render 服务 → 同步 RSS → 生成日报
```

---

## 8. 框架演进评估

### 是否需要换框架？

| 问题 | 评估 | 结论 |
|------|------|------|
| Express 5 能撑多久？ | 生态成熟，异步中间件支持好，长耗时任务（AI、RSS）天然适合 | **不换** |
| 要不要迁移到 Next.js？ | Serverless 模式不适合 cron + 长耗时任务；SSR 对 Digest 产品不必要（登录后内容，无 SEO 需求） | **不换** |
| 要不要迁移到 Hono/Fastify？ | 性能差异对当前规模无感知，迁移成本 > 收益 | **不换** |
| React SPA 够用吗？ | 用户登录后看自己的 Digest，SPA 完全满足 | **够用** |
| Vite 构建有问题吗？ | 构建速度快，HMR 好，生态支持好 | **没问题** |

**结论：当前技术栈 Express + React + Vite + Drizzle 可以一直用到 SaaS 阶段，无需大规模迁移。**

---

## 9. 安全评估

### 当前风险点

| 风险 | 严重度 | 说明 | 建议 |
|------|--------|------|------|
| API Key 明文在 .env | 中 | 已在 .gitignore 中，但需确认未提交 | 检查 git 历史 |
| 无认证的 API | 低（单用户） | 任何人可访问 /api/*  | 多用户时必须加 auth 中间件 |
| 无 rate limiting | 低 | /api/digests/generate 可被滥用 | 部署时加 express-rate-limit |
| Jina Reader 依赖 | 低 | 第三方服务，可能限流或下线 | 已有 Turndown 兜底 |
| SQLite 无备份 | 中 | 数据丢失不可恢复 | 部署后加定时备份（或迁 PostgreSQL） |

### 部署前必做

- [ ] 确认 `.env` 不在 git 历史中
- [ ] 添加 `express-rate-limit` 到 generate 端点
- [ ] 生产环境禁用 CORS 通配符（`cors({ origin: '你的域名' })`）

---

## 10. 演进路线图

```
Phase 0 — 当前（免费部署，自己玩）
├── cron 改为每天一次
├── Express 托管前端静态文件
├── 部署到 Render Free
├── 外部 cron 服务每日唤醒
└── 预计改动量：半天

Phase 1 — 正式自用（$5-7/月）
├── 迁移到 Railway（持久化 + 稳定）
├── 或 Render Paid（持久化磁盘）
├── node-cron 进程内正常运行
└── 预计改动量：配置调整，< 1 小时

Phase 2 — 多用户（需要开发）
├── 数据库：SQLite → PostgreSQL（Drizzle 换驱动）
├── 账户：Better Auth（Express 中间件）
├── 所有表加 userId 外键
├── API 路由加 auth 中间件
├── 前端加登录/注册页
└── 预计工作量：1-2 周

Phase 3 — 邮件推送
├── 集成 Resend
├── React Email 模板（复用日报排版）
├── 推送调度逻辑（按用户时区）
├── 设置页：推送时间偏好
└── 预计工作量：3-5 天

Phase 4 — 打磨
├── Onboarding 引导流程
├── 冷启动推荐列表
├── 移动端适配
├── 性能优化（虚拟滚动、API 缓存）
└── 预计工作量：按需迭代
```

---

## 11. 成本预测

### AI 成本（gpt-5-nano）

| 订阅数 | 日均文章 | 月 AI 成本 |
|--------|---------|-----------|
| 3 | ~2 | $0.02 |
| 10 | ~7 | $0.07 |
| 30 | ~20 | $0.20 |
| 100 | ~70 | $0.70 |

### 平台成本

| 阶段 | 平台 | 月成本 |
|------|------|--------|
| 免费玩 | Render Free | $0 |
| 正式自用 | Railway | $5-7 |
| 多用户 (< 50) | Railway + PostgreSQL | $10-15 |
| 规模化 | Railway/VPS + PostgreSQL + Redis | $20-40 |

### 邮件成本（Resend）

| 用户数 | 月邮件量 | 月成本 |
|--------|---------|--------|
| 1-80 | < 3,000 | $0（免费层） |
| 80-500 | 3,000-17,000 | $20（Pro 计划） |

### 总成本

| 阶段 | 月总成本 |
|------|---------|
| 自用 MVP | **$0**（Render Free + gpt-5-nano $0.02） |
| 正式自用 | **$5-7**（Railway） |
| 小规模多用户 (< 50) | **$15-25** |
| 中等规模 (< 500) | **$40-60** |

---

## 12. 关键结论

1. **技术栈不用换。** Express + React + Vite + Drizzle 这套组合可以从 MVP 走到 SaaS，每一步都有平滑的升级路径。

2. **数据库不用急着换。** SQLite 在单用户和小规模场景完全够用。Drizzle ORM 让 SQLite → PostgreSQL 的迁移成本很低，等真正需要时再迁移。

3. **先部署再说。** Render Free 零成本上线，验证产品价值比优化架构重要。

4. **每一步演进都是增量的。** 没有任何阶段需要"大重写"，这是当前架构最大的优势。
