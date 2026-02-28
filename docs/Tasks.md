# DigestDesk — Tasks

> 详细任务清单，基于现有前端原型的改造与新功能构建。
> 任务已按 **MVP 最小范围** 和 **MVP 后迭代** 划分。

---

## 任务总览

| 分类 | 任务数 | 范围 | 描述 |
|------|--------|------|------|
| MVP — 数据通路 | 6 | MVP ✅ | T0.1–T0.7：URL 解析、信息获取、搜索添加、RSS 抓取、数据库+API、前端 API 客户端 |
| MVP — AI 引擎 | 3 | MVP ✅ | T1.1–T1.3：摘要 Prompt（Vercel AI SDK + Gemini Flash）、日报生成（5 篇并发）、周报生成 |
| MVP — 前端改造 | 2 | MVP ✅ | T2.1、T2.2+T2.4：类型扩展、订阅页+Digest 页+首页+AppShell 全面改造 |
| 后续 — 前端完善 | 4 | T2.3 ✅ T2.5 ✅ | T2.3、T2.5：首页空状态+品牌（已完成）；T2.6、T2.7：设置、Onboarding（待做） |
| 后续 — 推送与账户 | 4 | 迭代 | T3.1–T3.4：账户体系、浏览器推送、调度、偏好 |
| 后续 — 打磨优化 | 4 | T4.5 ✅ T4.6 ✅ | T4.1–T4.4：推荐、统计、移动端、性能；T4.5：数据库层优化（已完成）；T4.6：后端容错改进（已完成） |
| 后续 — 质量保障 | 2 | 迭代 | T1.4、T1.5：反馈机制、缓存去重 |

**MVP 最小范围：11 项任务** — 单用户模式，无账户体系，无浏览器推送，手动打开查看。
**MVP 后迭代：14 项任务** — 多用户、推送、打磨。

---

# 🟢 MVP 最小范围（11 项）

> 目标：一个人可以用的、能跑通核心价值链路的最小产品。
> 限制：单用户、无注册登录、无推送通知、手动打开网页查看 Digest。

---

## T0：Substack 数据通路（MVP）

### T0.1 — Substack URL 解析与归一化

**描述：** 用户输入的 URL 格式多样，需要统一处理。

输入格式兼容：
- `lennysnewsletter.com`
- `https://www.lennysnewsletter.com`
- `lennysnewsletter.substack.com`
- `https://lennysnewsletter.substack.com/`
- 带路径的 URL（提取根域名）

输出：
- 归一化后的 publication URL
- RSS Feed URL（`{base}/feed`）

改造位置：`src/lib/storage.ts` 中的 `normalizeSubstackUrl()` 函数

验收标准：
- [ ] 以上 5 种格式都能正确解析
- [ ] 无效 URL 给出明确错误提示
- [ ] 非 Substack URL 也能尝试（通用 RSS 兼容）

---

### T0.2 — Substack 公开信息获取服务

**描述：** 调用 Substack RSS Feed 和 API，获取出版物的公开元信息。

获取内容：
- 出版物名称（RSS `<channel><title>`）
- 出版物描述（RSS `<channel><description>`）
- 出版物 Logo（RSS `<channel><image><url>`）
- 作者名（RSS `<dc:creator>`）
- 最近文章列表（RSS `<item>` 前 5 篇）

技术方案：
- 后端代理服务（解决前端 CORS 限制）
- 请求 `{publication}/feed` 解析 RSS XML
- 可选：请求 `/api/v1/archive?limit=5` 获取封面图和互动数据

API 接口设计：
```
GET /api/substack/info?url={publication_url}

Response:
{
  name: string,
  description: string,
  logoUrl: string,
  authorName: string,
  feedUrl: string,
  recentPosts: [
    { title, url, publishedAt, author }
  ]
}
```

验收标准：
- [ ] 输入合法 Substack URL → 返回完整元信息
- [ ] 输入无效 URL → 返回明确错误
- [ ] 响应时间 < 3 秒
- [ ] 处理自定义域名（如 stratechery.com）

---

### T0.7 — Substack 搜索添加 🆕

**描述：** 除 URL 粘贴外，用户还可以通过关键词搜索来发现和添加订阅。详细端点定义见 `Implementation Plan.md` Phase 0.4。

功能：
- 用户输入关键词（作者名、主题、出版物名称）
- 后端代理请求 Substack 搜索 API（解决 CORS）
- 返回匹配的出版物列表

搜索结果展示：
- 出版物名称
- Logo / 头像
- 简介描述
- 订阅按钮

与 URL 添加并列为两种添加方式：
- **方式 A — 搜索添加**：输入关键词 → 搜索结果列表 → 点击订阅
- **方式 B — URL 添加**：粘贴链接 → 自动识别 → 确认订阅

验收标准：
- [ ] 输入关键词 → 返回相关出版物列表
- [ ] 搜索结果展示 Logo、名称、简介
- [ ] 点击搜索结果可直接订阅
- [ ] 搜索为空时有友好提示
- [ ] 后端代理正常工作（CORS 解决）

---

### T0.3 — RSS 内容抓取与解析

**描述：** 定时抓取已订阅源的 RSS Feed，解析文章内容。详细技术方案见 `Implementation Plan.md` Phase 0.2。

功能：
- 定时任务：node-cron 每小时检查所有订阅源
- 两层内容抓取：Jina Reader（主） + Turndown（兜底），输出 Markdown
- 按文章 URL/GUID 增量去重
- 存储文章到数据库

每篇文章提取：
```
{
  feedId: string,
  title: string,
  author: string,
  url: string,
  publishedAt: string,
  contentText: string,   // Markdown 格式（Jina Reader 或 Turndown 输出）
  coverImageUrl?: string
}
```

验收标准：
- [x] 能正确解析 Substack RSS 格式
- [x] 增量去重：同一篇文章不重复入库
- [x] Jina Reader 全文 Markdown 抓取正常工作
- [x] Turndown 兜底逻辑在 Jina 失败时自动启用
- [x] 处理 RSS 中的 CDATA 和特殊字符
- [ ] 跳过付费墙截断的文章（或标注为"付费内容"）

---

### T0.4 — 数据模型与后端 API 框架

**描述：** 从 localStorage 迁移到持久化数据库，搭建后端 API 服务。

> 原 T0.4（数据库设计）与 T0.5（API 框架）合并精简为一项任务。

核心数据模型：

```
Feeds (订阅源) — MVP 阶段无 userId，单用户模式
  id, name, description, logoUrl, authorName,
  publicationUrl, feedUrl, createdAt, lastFetchedAt

Articles (文章)
  id, feedId, title, author, url, publishedAt,
  contentText, coverImageUrl, fetchedAt

Digests (日报/周报)
  id, type (daily|weekly), date, generatedAt

DigestItems (摘要条目)
  id, digestId, articleId, feedName, articleTitle,
  author, url, oneLiner, keyInsights (JSON array),
  publishedAt, sortOrder
```

核心 API 端点：
```
# 订阅管理
GET    /api/feeds              # 获取所有订阅（按 createdAt DESC）
POST   /api/feeds              # 添加订阅（含自动获取信息 + fire-and-forget 同步）
DELETE /api/feeds/:id          # 删除单个订阅
DELETE /api/feeds/batch        # 批量删除订阅（{ ids: string[] }）
POST   /api/feeds/import       # 批量导入订阅源
POST   /api/feeds/sync         # 手动触发 RSS 同步

# Substack 信息
GET    /api/substack/search    # 搜索出版物（本地 DB + 远程去重）

# Digest
GET    /api/digests            # 获取所有 Digest 列表
GET    /api/digests/:id        # 获取单份 Digest 详情
POST   /api/digests/generate   # 手动触发生成

# 健康检查
GET    /api/health             # 服务健康检查
```

> 注意：MVP 阶段不含 `/api/auth/*` 用户认证端点，单用户模式。

验收标准：
- [ ] 数据模型支持 MVP 所有功能
- [ ] 现有 localStorage 数据可迁移
- [ ] API 接口与前端 types.ts 对齐
- [ ] RESTful API 结构清晰
- [ ] 错误响应格式统一
- [ ] 支持跨域（CORS 配置）

---

### T0.6 — 前端 Storage 层抽象

**描述：** ✅ 已完成。新建 `src/lib/api.ts` 统一 API 客户端，`storage.ts` 精简为仅保留 URL 归一化工具。

已完成改造：
- 新建 `src/lib/api.ts`：封装 8 个后端 API 调用（fetchFeeds, createFeed, deleteFeed, searchSubstack, getSubstackInfo, fetchDigests, fetchDigest, generateDigest）
- `storage.ts` 从 142 行精简到 36 行，仅保留 `normalizeSubstackUrl()`
- 删除 `demoDigest.ts`（219 行 mock 数据）
- 所有页面改为异步加载 + Skeleton loading + toast 错误处理

验收标准：
- [x] 现有页面功能不变
- [x] 数据来自后端 API 而非 localStorage
- [x] 网络错误时有友好提示

---

## T1：AI 摘要引擎（MVP）

### T1.1 — 单篇文章摘要 Prompt 设计

**描述：** 设计 LLM Prompt，将一篇文章转化为结构化摘要。详细 AI 实现方案见 `Implementation Plan.md` Phase 1.1。

输入：文章全文 Markdown
输出（Zod schema — `ArticleSummarySchema`）：
```json
{
  "oneLiner": "一句话核心观点（不超过 50 字）",
  "keyInsights": [
    "洞察1：具体、可执行、有信息量",
    "洞察2：...",
    "洞察3：..."
  ]
}
```

Prompt 设计原则：
- 提炼观点，不是概述内容
- 关键洞察要具体，不要泛泛而谈（"作者认为X很重要"是坏的，"X 的市场规模在2年内增长了3倍"是好的）
- 支持中英文输出（根据用户偏好）
- 保持一致的格式和质量

验收标准：
- [x] 对 10 篇不同 Substack 文章测试，摘要质量可接受
- [x] 输出格式通过 Zod schema 验证，类型安全
- [x] 单篇处理时间 < 10 秒
- [x] 长文章（>5000 字）也能正确处理（Gemini Flash 1M 上下文，全文送入）

---

### T1.2 — 日报生成逻辑

**描述：** 将当日所有新文章的摘要编排成一份日报。

逻辑：
1. 获取过去 24 小时（或上次生成以来）所有新文章
2. 对每篇文章调用 T1.1 生成摘要
3. 按发布时间排序（最新在前），体现信息源时间顺序
4. 保留全部符合条件的文章摘要，通过前端分页/加载更多控制阅读节奏
5. 生成日报元信息（日期、文章数、预计阅读时长）
6. 存储 Digest 到数据库

MVP 阶段触发方式：
- 手动触发（页面上的"生成日报"按钮）
- 后续迭代再加定时自动生成 + 推送

验收标准：
- [ ] 手动触发可生成日报
- [ ] 内容按时间顺序清晰展示
- [ ] 前端分页/加载更多在文章多时依然可读
- [ ] 无新文章时提示"暂无新内容"

---

### T1.3 — 周报生成逻辑

**描述：** 汇总本周日报，生成更高层次的周报。

周报内容结构：
1. **本周主题**：跨源归纳 2-3 个共性话题
2. **逐日回顾**：本周每日日报的精简版（可折叠）

生成逻辑：
1. 收集本周所有日报的 DigestItems
2. 用 LLM 做跨文章的主题归纳
3. 按日期组织逐日回顾

MVP 阶段触发方式：
- 手动触发

验收标准：
- [ ] 主题归纳准确反映本周讨论热点
- [ ] 周报阅读时长控制在 10 分钟

---

## T2：前端改造（MVP 部分）

### T2.1 — Feed 类型扩展

**描述：** 更新 `types.ts`，增加 Substack 元信息字段。

```typescript
export type Feed = {
  id: string;
  title: string;          // ← 自动获取的出版物名称
  description?: string;   // 新增：出版物简介
  logoUrl?: string;       // 新增：出版物 Logo
  authorName?: string;    // 新增：作者名
  url: string;            // 出版物主页 URL
  feedUrl: string;        // RSS Feed URL
  lastFetchedAt?: string; // 新增：最后抓取时间
  createdAt: string;
};

export type Digest = {
  id: string;
  type: 'daily' | 'weekly';  // 新增：日报/周报类型
  date: string;
  generatedAt: string;
  items: DigestItem[];
  weeklyThemes?: string[];       // 新增：周报主题
};

export type DigestItem = {
  id: string;
  feedTitle: string;
  title: string;
  author?: string;
  url: string;
  oneLiner: string;
  keyInsights: string[];
  publishedAt: string;
};
```

验收标准：
- [ ] 类型定义覆盖所有 PRD 需求
- [ ] 向后兼容现有 Mock 数据
- [ ] 前后端类型对齐

---

### T2.2 — 订阅管理页 + Digest 阅读页改造

**描述：** 改造 `Subscriptions.tsx`、`DailyDigest.tsx` 和 `WeeklyDigest.tsx`，支持搜索添加、自动获取信息、真实数据。

> 原 T2.2（订阅页）与 T2.4（Digest 页）合并为一项任务。

**订阅管理页改造（Subscriptions.tsx）：**

1. 新增搜索添加入口：
   - Tab 切换：「搜索添加」 / 「URL 添加」
   - 搜索：输入关键词 → 调用搜索 API → 展示结果列表（Logo、名称、简介）→ 点击订阅
   - URL：粘贴链接 → 调用信息获取 API → 预览卡片 → 确认订阅
2. 去除手动"显示名称"输入框
3. 订阅列表改为卡片式展示（Logo + 名称 + 最近更新）

新增交互：
- 搜索输入的 loading 和空状态
- URL 输入后的 loading 状态
- 获取失败时的错误处理
- 订阅确认对话框

**Digest 阅读页改造（DailyDigest.tsx + WeeklyDigest.tsx）：**

1. DailyDigest 同时作为首页（路由 `/`），展示今日日报
2. WeeklyDigest 独立页面（路由 `/weekly`），展示周报主题归纳 + 逐日回顾
3. 归档选择器支持日报/周报分开浏览
4. 接入真实 API 数据

验收标准：
- [x] 搜索添加和 URL 添加双入口可用
- [x] 搜索结果展示 Logo、名称、简介
- [x] 输入 URL → 自动展示预览信息
- [x] 用户无需手动输入任何信息
- [x] 订阅列表展示 Logo 和名称
- [x] 日报视图保留现有排版（TOC + 卡片）
- [x] 周报视图新增主题 + 回顾
- [x] 从 API 获取真实数据
- [x] 加载状态和错误状态处理完善

---

# 🔵 MVP 后迭代（14 项）

> 以下任务在 MVP 核心链路跑通后逐步推进。

---

## T2：前端改造（后续部分）

### T2.3 — 首页优化 ✅

**描述：** 当前首页即 `DailyDigest.tsx`（路由 `/`）。优化空状态和引导体验。

> 已在 MVP 前端整合（T2.2）阶段一并完成。

已完成改造：
1. 无订阅源时展示 WelcomeSearch 欢迎引导（标题"集中跟踪，轻松读完"+ 内联搜索，用户无需跳转即可添加首个订阅）
2. 有订阅但无日报时自动触发生成 + GeneratingProgress 四阶段进度动画正确展示
3. 顶部状态栏：订阅源数 + 做编辑的第 N 天 + 文章篇数
4. 品牌名 DigestDesk 全局统一
5. "回到目录"锚点改为 scrollIntoView 平滑滚动到 TOC 区域
6. 自动生成失败时 toast 提示（不再静默吞掉错误）

验收标准：
- [x] 无内容时有友好的空状态引导
- [x] 品牌名更新为 DigestDesk

---

### T2.5 — AppShell 品牌更新 ✅

**描述：** 更新 `AppShell.tsx` 中的品牌信息和导航结构。

> 已在 MVP 前端整合（T2.2）阶段一并完成。

已完成改造：
1. 品牌名 "DigestDesk"，报纸式 masthead 风格
2. 导航分层：内容消费组（今日日报 / 周报）+ 管理组（订阅源），用分隔线和"管理"标签区分
3. 设计风格保持一致

验收标准：
- [x] 品牌信息一致
- [x] 导航项覆盖所有现有页面
- [x] 设计风格不变

> 注：设置页（T2.6）完成后需补充导航项。

---

### T2.6 — 设置页（新增）

**描述：** 新增 `Settings.tsx` 页面。

功能：
- 推送设置：日报推送时间、周报推送日/时间、开关
- 摘要偏好：语言（中文/英文/跟随原文）、详略程度
- 账户信息：邮箱、退出登录
- 数据管理：导出订阅列表

验收标准：
- [ ] 设置修改后即时生效
- [ ] 推送时间选择器可用
- [ ] 保存成功有 Toast 反馈

---

### T2.7 — Onboarding 引导流程（新增）

**描述：** 新用户首次使用的引导流程。

流程步骤：
1. 欢迎页：简要说明产品价值
2. 添加订阅：搜索关键词或输入 URL
3. 生成首份 Digest：等待 + 加载动画
4. 设置推送：申请通知权限 + 选择时间
5. 完成

验收标准：
- [ ] 3 分钟内完成全流程
- [ ] 支持跳过（直接进入主界面）
- [ ] 首次进入自动触发
- [ ] 完成后不再出现

---

## T3：推送与账户（MVP 后）

### T3.1 — 用户注册/登录

**描述：** 实现基础账户体系。

功能：
- 邮箱 + 密码注册
- 登录 / 登出
- JWT Token 管理
- 登录状态保持

验收标准：
- [ ] 注册、登录、登出流程完整
- [ ] Token 过期处理
- [ ] 未登录用户重定向到登录页

---

### T3.2 — 浏览器推送通知

**描述：** 使用 Web Push API 实现浏览器推送。

功能：
- 申请通知权限
- Digest 生成后发送推送
- 推送内容："你的今日日报已就绪 · 2026-02-15"
- 点击推送跳转到对应 Digest
- 按用户设置的时间推送

技术：
- Service Worker 注册
- Web Push API（VAPID keys）
- 后端推送调度服务

验收标准：
- [ ] 推送权限申请流程友好
- [ ] 推送准时到达（误差 < 5 分钟）
- [ ] 点击推送正确跳转
- [ ] 用户可关闭推送

---

### T3.3 — 推送调度服务

**描述：** 后端定时任务，按用户配置的时间触发推送。

逻辑：
- 按用户时区和设定时间调度
- 日报：每日指定时间
- 周报：指定星期几的指定时间
- 无新内容时不推送
- 推送前确保 Digest 已生成

验收标准：
- [ ] 多时区支持
- [ ] 无内容不推送
- [ ] 推送失败有重试机制

---

### T3.4 — 推送偏好设置

**描述：** 用户可配置推送偏好。

选项：
- 日报开关 + 时间（默认 08:00）
- 周报开关 + 星期几 + 时间（默认周日 20:00）
- 免打扰时段
- 一键关闭所有推送

验收标准：
- [ ] 设置即时生效
- [ ] 默认值合理
- [ ] 与 T2.6 设置页联动

---

## T1：AI 引擎（后续部分）

### T1.4 — 摘要质量评估机制

**描述：** 收集用户反馈，持续改进摘要质量。

功能：
- 每篇摘要底部添加"有用 / 没用"按钮
- 记录用户反馈到数据库
- 定期分析低分摘要，调整 Prompt

验收标准：
- [ ] 反馈按钮不干扰阅读体验
- [ ] 反馈数据可查询和分析

---

### T1.5 — 摘要缓存与去重

**描述：** 同一篇文章不重复调用 LLM。

逻辑：
- 文章入库时生成 contentHash
- 生成摘要前检查是否已有缓存
- 文章内容变更（更新）时重新生成

验收标准：
- [ ] 同一文章只调用一次 LLM
- [ ] 文章更新后能重新生成摘要

---

## T4：打磨与优化（MVP 后）

### T4.1 — 冷启动推荐列表

**描述：** 为新用户提供热门 Substack 推荐。

内容：
- 按类别分组：科技、商业、投资、创业、产品、AI
- 每个类别 5-10 个推荐
- 展示：名称、Logo、简介、订阅者规模

验收标准：
- [ ] 推荐列表内容丰富
- [ ] 一键订阅功能
- [ ] 出现在 Onboarding 和订阅管理页

---

### T4.2 — 阅读统计仪表盘

**描述：** 用户的个人阅读数据。

指标：
- 本周/本月日报打开次数
- 原文点击次数
- 订阅源活跃度排名
- 阅读趋势图

验收标准：
- [ ] 数据准确
- [ ] 可视化清晰
- [ ] 放在首页或独立页面

---

### T4.3 — 移动端适配优化

**描述：** 优化移动端体验（日报是高频移动端使用场景）。

改造点：
- 侧边栏改为底部 Tab 导航
- TOC 改为可折叠顶部区域
- 文章卡片全宽展示
- 触控友好的交互区域

验收标准：
- [ ] iPhone / Android 主流机型测试通过
- [ ] 阅读体验流畅
- [ ] 触控操作无误

---

### T4.4 — 性能优化

**描述：** 确保 Digest 页面加载快速。

优化点：
- Digest 内容分页/虚拟滚动（文章多时）
- 图片懒加载
- API 响应缓存
- Service Worker 离线缓存

验收标准：
- [ ] 首屏加载 < 2 秒
- [ ] 滚动流畅无卡顿
- [ ] 离线可查看最近一期 Digest

---

### T4.5 — 数据库层优化 ✅

**描述：** 修正 SQLite 数据库层的查询写法、事务使用和配置，属于"写对代码"而非性能优化。

**完成日期：** 2026-02-27

改动清单（3 个文件，约 20 行变更）：

1. **补充 SQLite Pragma**（`server/src/db/index.ts`）
   - `busy_timeout = 5000`：防止并发时 SQLITE_BUSY 报错
   - `cache_size = -20000`：页缓存从默认 2MB 提升到 20MB
   - `synchronous = NORMAL`：WAL 模式下的标准安全配置

2. **新增索引 `idx_articles_published_at`**（`server/src/db/index.ts`）
   - 日报生成的核心查询对 `published_at` 做范围筛选，补索引是基本功

3. **修复 `getWeeklyItems` 查询**（`server/src/services/digest.ts`）
   - 从 `.all().filter()`（全表加载到内存再过滤）改为 `.where(inArray(...))`（SQL 层过滤）

4. **事务包裹 digest 写入**（`server/src/services/digest.ts`）
   - 将 digest 的 UPSERT + items 的 delete/insert 合并为单一事务，保证原子性

5. **feeds 排序下推 SQL**（`server/src/routes/feeds.ts`）
   - 从 JS 层 `.sort()` 改为 SQL `ORDER BY desc(created_at)`

6. **清理遗留代码**
   - 删除建表 SQL 中的 `content_html` 列定义（Drizzle schema 已移除）
   - 删除 `rss.ts` 中 `contentHtml` 死代码变量

验收标准：
- [x] TypeScript 编译无错误
- [x] 前后端数据联调一致，无 breaking change
- [x] 服务启动日志正常

---

### T4.6 — 后端容错性改进 ✅

**描述：** 修正后端服务层的异常处理、重试逻辑和类型安全问题，提升服务在异常场景下的稳定性。

**完成日期：** 2026-02-27

改动清单（2 个文件，4 处变更）：

1. **无文章时不再抛异常**（`server/src/services/digest.ts:79-81`）
   - 新用户、凌晨无更新、feed 未同步完等正常场景下 `generateDaily()` 不再 throw
   - 改为 `console.log` + `return ""`，避免 cron 打 error 日志、前端收到 500

2. **`fetchWithRetry` 扩展可重试状态码**（`server/src/services/rss.ts:31`）
   - 从仅重试 429（Rate Limit）扩展到 429/502/503/504
   - 502/503/504 为暂时性网关错误，重试可恢复

3. **`fetchWithRetry` 参数类型修正**（`server/src/services/rss.ts:28`）
   - `options: any` → `options: RequestInit`，消除 strict TypeScript 下的类型破窗

4. **周报 AI 分析加 try-catch**（`server/src/services/digest.ts:222`）
   - `generateWeeklyAnalysis()` 调用原先无容错，AI API 临时故障会导致整个周报生成崩溃
   - 与日报中 `summarizeArticle()` 的容错模式保持一致：catch 后 fallback 为空 `weeklyThemes`

验收标准：
- [x] TypeScript 编译无错误
- [x] 无文章时 cron 不再打 error 日志
- [x] AI API 故障时周报仍可生成（主题为空）

---

# 任务依赖关系

```
── MVP 关键路径 ──

T0.1 (URL解析)
  └─→ T0.2 (信息获取)
        ├─→ T0.7 (搜索添加) ──→ T2.2 (订阅页+Digest页改造)
        └─→ T0.3 (RSS抓取)
              └─→ T0.4 (数据库+API) ──→ T0.6 (前端Storage抽象)

T1.1 (摘要Prompt)
  ├─→ T1.2 (日报生成) ──→ T2.2 (订阅页+Digest页改造)
  └─→ T1.3 (周报生成) ──→ T2.2

T2.1 (类型扩展) ──→ T2.2

── MVP 后 ──

T2.2 ──→ T2.3 (首页改造)
T2.2 ──→ T2.5 (品牌更新)
T2.2 ──→ T2.6 (设置页)
T2.6 ──→ T2.7 (Onboarding) 依赖 T0.7 + T1.2

T3.1 (账户) ──→ T3.2 (推送) ──→ T3.3 (调度) ──→ T3.4 (偏好)

T4.* 可并行，在 MVP 完成后启动
T1.4 (反馈)、T1.5 (缓存) 可在 MVP 后任意时间点加入
```

---

# 优先级排序

## MVP 关键路径

**Phase 1 — 数据通路：**
T0.1 → T0.2 → T0.7 → T0.4 → T0.3 → T0.6

**Phase 2 — AI 引擎：**
T1.1 → T1.2 → T1.3

**Phase 3 — 前端整合：**
T2.1 → T2.2

## MVP 后迭代

**优先级 A — 体验完善：**
T2.3 ✅ → T2.5 ✅ → T2.6

**优先级 B — 用户体系：**
T3.1 → T3.2 → T3.3 → T3.4 → T2.7

**优先级 C — 打磨：**
T1.4、T1.5、T4.1 → T4.2 → T4.3 → T4.4
