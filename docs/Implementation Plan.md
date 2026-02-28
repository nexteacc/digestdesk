# DigestDesk — Implementation Plan

> 在现有前端原型基础上，分阶段构建 DigestDesk。
> Phase 0 + Phase 1 = **MVP 最小范围**（单用户、无账户、无推送）。
> Phase 2 + Phase 3 = **MVP 后迭代**。

---

## 当前状态

### 已完成（前端原型）

- [x] 项目脚手架（React 19 + TypeScript + Vite + Tailwind + shadcn/ui）
- [x] AppShell 布局（报纸式 masthead + 侧边栏 + 主内容区）
- [x] 日报阅读页 DailyDigest（TOC + 文章卡片，同时作为首页）
- [x] 周报阅读页 WeeklyDigest（主题归纳 + 逐日回顾）
- [x] 订阅管理页 Subscriptions（搜索/URL 双 Tab 添加）
- [x] 统一 API 客户端层（src/lib/api.ts）
- [x] URL 归一化工具（src/lib/storage.ts）

### 已完成（MVP 后端）

- [x] 后端服务框架（Express v5 :8080，cors 中间件）
- [x] 数据库（SQLite + Drizzle ORM + better-sqlite3，WAL 模式）
- [x] 订阅源 CRUD API（`/api/feeds`）
- [x] Substack 搜索代理（`/api/substack/search`）
- [x] Substack 信息获取（`/api/substack/info`）
- [x] RSS 抓取与解析（rss-parser，node-cron 每天 8:00 同步）
- [x] 内容抓取：Jina Reader API + Turndown HTML→Markdown 兜底
- [x] AI 摘要引擎（Vercel AI SDK，默认 Gemini 2.5 Flash，Zod schema 结构化输出）
- [x] 日报/周报生成逻辑（`/api/digests/generate`）

### 需要构建（MVP 剩余）

- [x] Substack 公开信息自动获取（作者名、头像、简介）
- [x] **Substack 搜索添加**（关键词搜索出版物）
- [x] RSS 抓取与内容解析
- [x] AI 摘要生成引擎
- [x] 日报/周报生成逻辑
- [x] 后端服务与数据库（单用户模式）
- [x] 前端页面改造（订阅页搜索入口 + Digest 页真实数据）

### 需要构建（MVP 后）

- [ ] 用户账户体系（注册/登录）
- [ ] 浏览器推送通知
- [ ] 设置页、Onboarding
- [ ] 打磨优化（推荐列表、统计、移动端、性能）

---

## 构建顺序

### Phase 0：Substack 数据通路（基础设施）🟢 MVP

**目标：** 打通"输入 URL / 搜索关键词 → 获取 Substack 公开信息 → 抓取文章内容"的数据链路。

#### 0.1 Substack 信息获取服务

用户输入一个 Substack URL 后，系统应自动获取：

| 信息 | 来源 | 用途 |
|------|------|------|
| 出版物名称 | RSS `<channel><title>` | 显示名称（替代用户手动输入） |
| 出版物描述 | RSS `<channel><description>` | 订阅卡片展示 |
| 出版物 Logo | RSS `<channel><image><url>` | 头像展示 |
| 作者名 | RSS `<dc:creator>` | 文章归属 |
| 最近文章列表 | RSS `<item>` | 验证订阅有效 + 首次 Digest 数据 |

**技术方案：**
- 主方案：解析 RSS Feed（`{url}/feed`），官方支持，稳定可靠
- 补充方案：调用 `/api/v1/archive?limit=5` 获取封面图和互动数据
- 前端直接请求会遇到 CORS，需要后端代理或 Serverless Function

#### 0.2 RSS 内容解析

- 定时抓取已订阅源的 RSS Feed（node-cron，每天 8:00 执行）
- 解析文章：标题、作者、发布时间、全文内容、原文链接
- **两层内容抓取策略（输出 Markdown，非纯文本）：**
  1. **Jina Reader（主方案）：** 请求 `https://r.jina.ai/{articleUrl}`，返回结构化 Markdown。保留标题层级、列表、代码块等结构，LLM 理解效果优于纯文本。超时 20 秒。
  2. **Turndown（兜底）：** 当 Jina 失败或返回内容 < 500 字符时，从 RSS `content:encoded` 提取 HTML，用 Turndown 转 Markdown。转换前移除 `script`/`style`/`nav` 等噪声标签。
- 最低内容阈值 500 字符，低于此视为抓取失败触发兜底
- 增量去重（按文章 URL 或 GUID）
- 处理节奏：每天 8:00 检查新内容，Feed 间隔 1 秒（限速）

#### 0.3 数据存储

- 替换 localStorage，引入数据库
- MVP 阶段核心表：Feeds、Articles、Digests、DigestItems（无 Users 表，单用户模式）
- 文章内容缓存（避免重复抓取）

#### 0.4 Substack 搜索 API 对接 🆕

用户输入关键词后，系统通过 Substack 搜索 API 返回匹配的出版物。

**搜索端点：**
```
GET https://substack.com/api/v1/publication/search?query={query}&page=0&limit=10
```

**生产环境问题：** Substack 封锁云服务器 IP（如 Render），导致后端直接调用搜索 API 被 403。本地开发（家庭网络）不受影响。

**解决方案：Cloudflare Worker 代理**
```
后端 searchSubstack()
  ↓ 有 CF_SEARCH_PROXY_URL 环境变量？
  ├── 有 → CF Worker（边缘节点 IP，不被封）→ Substack 搜索 API
  └── 没有 → 直接调 Substack（本地开发兼容）
```

- Worker 代码通过 Cloudflare Dashboard 部署和管理（~60 行 JS）
- Worker 端点：`GET /search?query=xxx&page=0&limit=10`
- 防滥用：通过 `PROXY_TOKEN` secret + `Authorization: Bearer` 验证
- 后端通过 `CF_SEARCH_PROXY_URL` 和 `CF_SEARCH_PROXY_TOKEN` 环境变量配置

**后端代理（CORS + CF Worker 代理）：**
```
GET /api/substack/search?query={query}&page=0&limit=10

Response:
{
  results: [
    {
      name: string,        // 出版物名称
      logoUrl: string,     // Logo / 头像
      description: string, // 简介
      url: string,         // 出版物主页 URL
      authorName: string   // 作者名
    }
  ]
}
```

**与信息获取服务的关系：**
- 搜索 → 返回出版物列表（名称、Logo、简介）→ 需要 CF Worker（生产环境）
- 用户选择后 → 调用 0.1 信息获取服务（RSS Feed，公开协议，不需要代理）→ 订阅

---

### Phase 1：AI 摘要引擎（核心价值）🟢 MVP

**目标：** 实现"文章 → AI 摘要"的转化，这是产品的灵魂。

#### 1.1 单篇文章摘要

输入：一篇 Substack 文章的 Markdown（经 Jina Reader 或 Turndown 转换）
输出：
```
{
  oneLiner: "一句话核心观点",
  keyInsights: ["洞察1", "洞察2", "洞察3"]
}
```

**AI 实现细节：**
- 模型：默认 **Gemini 2.5 Flash**（可切换 GPT-4o-mini）
- 输出结构：使用 **Zod schema**（`ArticleSummarySchema`）定义，通过 Vercel AI SDK `generateObject` 结构化输出
- API 方法：Vercel AI SDK 的 `generateObject()` — 统一接口支持 Google / OpenAI 等多家模型
- 温度：`0.3`（偏确定性）
- 输入：全文送入（Gemini Flash 1M 上下文窗口，无需截断）
- 跳过逻辑：内容 < 50 字符的文章直接返回默认摘要，不调用 LLM

摘要要求：
- 一句话总结：提炼文章最核心的一个观点或结论
- 3 条关键洞察：可执行、有信息量的要点，非泛泛概述
- 语言：跟随用户设置（中文/英文/跟随原文）

#### 1.2 日报编排

输入：当日所有订阅源的新文章摘要（对每篇文章调用 T1.1 生成摘要，5 篇并发，使用 p-limit）
输出：一份完整日报

编排逻辑：
- 以发布时间为主排序，按时间顺序展示订阅源更新
- 保留全部符合条件的文章摘要，全量展示无分页

已实现：定时自动生成（每天 8:00 + 启动时执行） + 手动触发。日报生成使用 24 小时滚动窗口，并发调用串行化排队。

#### 1.3 周报编排

输入：本周所有日报内容
输出：一份周报

周报额外内容：
- 本周热门主题提炼（跨源归纳共性话题）
- 简要趋势观察（"本周你关注的领域在讨论什么"）

MVP 阶段：手动触发 + 每周一自动生成。AI 分析失败时 fallback 为空主题列表，不阻塞周报创建。

#### 1.4 前端整合（MVP 收尾） ✅ 已完成

- 类型扩展（shared/types.ts 定义 Feed/Digest/DigestItem 等类型）
- 订阅管理页（Subscriptions.tsx）：搜索添加 + URL 添加双入口、预览卡片
- 日报阅读页（DailyDigest.tsx）：TOC + 文章卡片，接入真实数据
- 周报阅读页（WeeklyDigest.tsx）：主题归纳 + 逐日回顾
- Storage 层抽象：localStorage → API 调用（api.ts）

---

### Phase 2：用户体验闭环 🔵 MVP 后

**目标：** 多用户支持、推送通知、完整体验闭环。

> ⚠️ 以下内容为 MVP 后迭代，MVP 阶段先以单用户、手动打开网页查看为主。

#### 2.1 用户账户

- 注册 / 登录（邮箱 + 密码，或 OAuth）
- 用户数据云端存储
- 跨设备同步

#### 2.2 订阅流程进一步优化

- ~~首页改造（今日 Digest 直接展示）~~ ✅ T2.3 已完成
- ~~品牌更新（DigestDesk）~~ ✅ T2.5 已完成
- 设置页（推送时间、摘要偏好）— T2.6 待做

#### 2.3 浏览器推送

- 用户授权浏览器通知权限
- 日报生成后推送通知："你的今日 Digest 已就绪"
- 点击通知 → 直达当日 Digest 页面
- 用户可设置推送时间（默认日报 8:00，周报周日 20:00）
- 推送调度服务 + 偏好设置

#### 2.4 Onboarding 引导流程

- 欢迎页 + 引导添加订阅（搜索/URL）
- 生成首份 Digest
- 设置推送
- 完成引导

---

### Phase 3：打磨与增长 🔵 MVP 后

**目标：** 优化体验，准备规模化。

#### 3.1 冷启动优化

- 热门 Substack 推荐列表（按类别：科技、商业、投资、创业等）
- "一键导入"：从邮箱扫描已订阅的 Substack（如技术可行）

#### 3.2 个性化

- 摘要详略程度设置（精简 / 标准 / 详细）
- 摘要语言偏好
- 推送频率调整（仅日报 / 仅周报 / 都要）
- 关注主题权重（AI 优先展示相关内容）

#### 3.3 质量与数据

- 摘要质量反馈机制（有用/没用）
- 摘要缓存与去重
- 个人阅读统计（本周读了多少、点了多少原文）
- 订阅源活跃度（哪些源更新频繁、哪些沉寂了）

#### 3.4 性能与适配

- 移动端适配优化
- Digest 内容分页/虚拟滚动
- 图片懒加载 + API 缓存
- Service Worker 离线缓存

---

## 技术架构概览

```
┌─────────────────────────────────────────────────────┐
│                   前端（已有）                         │
│  React 19 + TypeScript + Vite + shadcn/ui            │
│  页面：DailyDigest(首页) / WeeklyDigest / Subscriptions│
│  ┌─────────────────────────────────────────────┐     │
│  │  MVP 改造：搜索添加入口 / Digest 真实数据    │     │
│  └─────────────────────────────────────────────┘     │
└─────────────────┬───────────────────────────────────┘
                  │ API 调用
┌─────────────────▼───────────────────────────────────┐
│              后端服务（Express v5 :8080）              │
│  ┌──────────┐ ┌──────────┐ ┌───────────────────┐    │
│  │ RSS 抓取  │ │ AI 摘要  │ │ Substack 搜索代理 │    │
│  │ node-cron │ │ Vercel   │ │ → CF Worker 转发  │    │
│  │ 每天8:00 │ │ AI SDK   │ │ (生产环境绕过     │    │
│  │ rss-parser│ │Gemini/GPT│ │  IP 封锁)         │    │
│  └──────────┘ └──────────┘ └───────────────────┘    │
│  ┌──────────────────────────────────────┐           │
│  │   内容抓取：Jina Reader + Turndown   │           │
│  │   输出 Markdown（非纯文本）          │           │
│  └──────────────────────────────────────┘           │
│  ┌──────────────────────────────────────┐           │
│  │  AI 输出控制：Zod + generateObject    │           │
│  │  多模型统一接口，类型安全             │           │
│  └──────────────────────────────────────┘           │
│  ┌──────────────────────────────────────┐           │
│  │    推送调度 (Web Push) [MVP 后]       │           │
│  └──────────────────────────────────────┘           │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│        数据层（SQLite + Drizzle ORM）                 │
│  驱动：better-sqlite3（WAL 模式）                     │
│  MVP：订阅源 / 文章 / Digest（单用户，无 Users 表）   │
│  MVP 后：+ 用户 / 推送配置                           │
└─────────────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│           外部服务                                    │
│  Substack RSS Feed     │ Gemini Flash / OpenAI       │
│  CF Worker 搜索代理     │ Web Push [MVP 后]           │
│  Jina Reader API       │                             │
└─────────────────────────────────────────────────────┘
```

---

## 前端改造清单

在现有原型基础上，需要改造的前端部分：

### MVP 改造 ✅ 已完成

| 页面/组件 | 改造内容 | 状态 |
|-----------|----------|------|
| **DailyDigest** | 日报阅读页，同时作为首页（路由 `/`）；接入真实 API 数据 | ✅ |
| **WeeklyDigest** | 周报阅读页（路由 `/weekly`）；主题归纳 + 逐日回顾 | ✅ |
| **Subscriptions** | 搜索添加 Tab + URL 预览添加；真实 API 数据 | ✅ |
| **AppShell** | 品牌 DigestDesk；中文导航（今日日报/订阅源/周报） | ✅ |
| **types.ts** | Feed/Digest/DigestListItem/SubstackInfo 类型 | ✅ |
| **api.ts** | 新建统一 API 客户端（替代 localStorage） | ✅ |
| **storage.ts** | 精简为仅 URL 归一化工具（normalizeSubstackUrl） | ✅ |
| **demoDigest.ts** | 已删除 | ✅ |

### MVP 后改造

| 页面/组件 | 改造内容 | 状态 |
|-----------|----------|------|
| **DailyDigest** | 空状态优化、引导添加订阅 | ✅ T2.3 已完成 |
| **AppShell** | 品牌 DigestDesk、导航覆盖所有页面 | ✅ T2.5 已完成 |
| **新增：Settings** | 推送时间设置、摘要偏好、账户管理 | 待做 (T2.6) |
| **新增：Onboarding** | 首次使用引导流程（支持搜索 + URL 两种添加方式） | 待做 (T2.7) |

---

## 交付里程碑

### MVP 里程碑

| 里程碑 | 交付物 | 验证标准 |
|--------|--------|----------|
| M0 | Substack 信息获取 + **搜索添加** | 输入 URL → 返回出版物名称、Logo、最近文章；输入关键词 → 返回匹配出版物列表 |
| M1 | AI 摘要引擎 | 输入文章 → 输出一句话+3条洞察，质量可接受 |
| M2 | 日报生成 | 手动触发生成 Digest，内容来自真实订阅 |
| M3 | 周报生成 + 前端整合 | 周报可生成；订阅页搜索入口可用；Digest 页展示真实数据 |

### MVP 后里程碑

| 里程碑 | 交付物 | 验证标准 |
|--------|--------|----------|
| M4 | 用户账户 + 推送 | 注册登录，浏览器推送准时到达 |
| M5 | 前端改造完成 | 全流程跑通：注册→订阅→收推送→读 Digest |
| M6 | 打磨优化 | 推荐列表、阅读统计、移动端适配、性能优化 |
