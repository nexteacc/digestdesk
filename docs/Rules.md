# DigestDesk — Rules

> 告诉 AI 如何在这个项目中行为。

---

## 项目身份

你正在构建 **DigestDesk** — 一个个人编辑助手，帮助用户将订阅的 Substack Newsletter 自动编辑成每日/每周 Digest。

---

## 核心原则

### 1. 产品定位

- DigestDesk 是**个人编辑助手**，不是阅读器，不是 RSS 客户端
- 核心价值是**压缩**：帮用户从"读 30 分钟"变成"读 5 分钟"
- 产品的交付物是**日报和周报**，这是用户每天接触的核心界面
- 推送渠道是**网页 + 浏览器推送通知**

### 2. MVP 范围

- 当前 MVP **只支持 Substack** 作为信息源
- YouTube 频道是 Phase 2，当前不要实现
- **MVP 不含用户账户体系** — 单用户模式，无注册/登录
- **MVP 不含浏览器推送通知** — 用户手动打开网页查看 Digest
- 添加订阅支持两种方式：**搜索名称** + **粘贴 URL**
- 不包含邮件投递、Telegram Bot 等其他推送渠道
- 不包含社交功能（分享、协作）

### 3. 设计语言

- 遵循 **瑞士现代主义 × 报纸编辑台** 的设计风格
- 克制、精确、高信息密度
- 不使用花哨的动效、渐变、阴影
- UI 退到最后面，内容是主角
- 详见 `docs/Design Guidelines.md`

---

## 技术规范

### 技术栈

**前端：**
- **框架**：React 19 + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui
- **路由**：wouter（hash-based）
- **状态管理**：React hooks + Context（不引入 Redux 等重型方案）
- **组件库**：shadcn/ui（Radix UI 基础）
- **图标**：Lucide React
- **通知**：Sonner
- **日期处理**：date-fns（支持 zhCN locale）
- **ID 生成**：nanoid

**后端：**
- **框架**：Express.js v5
- **数据库**：SQLite + Drizzle ORM（better-sqlite3 驱动，WAL 模式）
- **AI**：Vercel AI SDK（`ai` + `@ai-sdk/google` + `@ai-sdk/openai`），默认 Gemini 2.5 Flash，Zod schema 结构化输出
- **并发控制**：p-limit（5 篇并发摘要）
- **环境管理**：dotenv
- **内容抓取**：Jina Reader API（主） + Turndown（兜底）
- **定时任务**：node-cron（每小时同步 RSS）
- **RSS 解析**：rss-parser
- **跨域**：cors 中间件

### 技术决策记录

| 决策 | 选型 | 理由 |
|------|------|------|
| 后端框架 | Express v5（非 Hono/Fastify） | 生态成熟，MVP 快速搭建，v5 支持 async 中间件 |
| 数据库 | SQLite + Drizzle ORM | 单文件部署零运维，Drizzle 类型安全轻量，better-sqlite3 同步驱动性能好 |
| AI 模型 | Gemini 2.5 Flash（默认） | 1M 上下文窗口无需截断全文，价格与 gpt-4o-mini 相当，多语言理解优秀；通过 Vercel AI SDK 可一行切换 OpenAI 等其他模型 |
| AI 输出 | Zod + Vercel AI SDK `generateObject` | 统一接口支持多模型结构化输出，schema 即文档即验证 |
| 内容抓取 | Jina Reader + Turndown | Jina 返回高质量 Markdown（保留结构），Turndown 兜底覆盖 Jina 失败场景 |
| 项目结构 | Monorepo（`/` 前端 + `/server` 后端） | 共享类型方便，MVP 阶段简单 |

### 部署与环境

- **前端**：Vite 构建，静态文件部署（可部署至任意静态托管）
- **后端**：Node.js 进程，端口 `3001`
- **数据库文件**：`server/data/digestdesk.db`（自动创建）
- **环境变量**：
  - `GOOGLE_GENERATIVE_AI_API_KEY` — Google AI API 密钥（推荐，Gemini Flash）
  - `OPENAI_API_KEY` — OpenAI API 密钥（备选）
  - `AI_MODEL` — 自定义模型 ID（可选，默认 gemini-2.5-flash-preview-05-20）
  - `PORT` — 后端端口（默认 3001）
- **前后端分离部署**：前端通过 API 调用后端，开发时前端 Vite dev server 代理到后端

### 代码风格

- 使用 TypeScript 严格模式
- 组件使用函数式组件 + hooks
- 路径别名：`@/` 指向 `src/`
- 组件命名：PascalCase
- 文件命名：组件文件 PascalCase，工具文件 camelCase
- 每个页面组件放在 `src/pages/` 目录
- 共享组件放在 `src/components/`
- shadcn/ui 组件放在 `src/components/ui/`
- 工具函数放在 `src/lib/`
- 自定义 hooks 放在 `src/hooks/`
- Context providers 放在 `src/contexts/`

### 样式规则

- 使用 Tailwind CSS utility classes，不写自定义 CSS（除 `index.css` 中的全局样式）
- 使用 `cn()` 函数合并 class（来自 `@/lib/utils`）
- 颜色使用 CSS 变量（`text-foreground`, `bg-background`, `text-muted-foreground` 等）
- 不使用硬编码颜色值
- 间距使用 Tailwind 标准值（`gap-4`, `p-5`, `mt-2` 等）

### 关键文件

**前端：**

| 文件 | 职责 |
|------|------|
| `src/lib/types.ts` | 所有 TypeScript 类型定义 |
| `src/lib/api.ts` | 统一 API 客户端（封装所有后端调用） |
| `src/lib/storage.ts` | URL 归一化工具函数 |
| `src/components/AppShell.tsx` | 全局布局（masthead + sidebar + main） |
| `src/App.tsx` | 路由和 Provider 配置 |
| `src/pages/DailyDigest.tsx` | 日报阅读页（同时作为首页，路由 `/`） |
| `src/pages/WeeklyDigest.tsx` | 周报阅读页（路由 `/weekly`） |
| `src/pages/Subscriptions.tsx` | 订阅管理页（搜索/URL 双 Tab） |

**后端：**

| 文件 | 职责 |
|------|------|
| `server/src/index.ts` | Express v5 入口，挂载路由和 cron |
| `server/src/db/schema.ts` | Drizzle ORM 表定义（feeds, articles, digests, digest_items） |
| `server/src/db/index.ts` | SQLite 连接初始化（better-sqlite3, WAL 模式） |
| `server/src/services/rss.ts` | RSS 抓取 + Jina Reader + Turndown 兜底 |
| `server/src/services/summarizer.ts` | AI 摘要（Vercel AI SDK + Zod schema，多模型支持） |
| `server/src/services/digest.ts` | 日报/周报编排逻辑 |
| `server/src/cron/scheduler.ts` | node-cron 定时同步（每小时） |

---

## Substack 数据获取

> 详细技术方案见 `Implementation Plan.md` Phase 0。

### 数据源优先级

1. **RSS Feed** — 首选，官方支持，稳定可靠
2. **Substack 搜索 API** — 出版物发现，需后端代理（CORS）
3. **非官方 API** — 补充数据，不作为唯一依赖

### 数据获取原则

- RSS 为主，API 为辅
- 请求频率：不超过 1 次/秒
- 实现缓存，避免重复请求
- 优雅降级：API 失败时回退到 RSS
- 尊重 robots.txt 和 ToS

### 内容抓取

- 两层策略：Jina Reader（主） + Turndown（兜底），输出 Markdown
- 最低内容阈值 500 字符，< 50 字符跳过 AI 摘要
- 详细实现见 `Implementation Plan.md` 0.2 节

---

## AI 摘要规范

> AI 引擎的技术实现细节见 `Implementation Plan.md` Phase 1。

### AI 输出控制

- Zod schema 定义输出结构，`generateObject()` 结构化输出
- 温度：文章 0.3，周报 0.4
- 并发：5 篇（p-limit）

### 摘要质量标准

- **一句话总结**：提炼文章最核心的一个观点或结论，不超过 50 字
- **关键洞察**：3 条，每条具体、可执行、有信息量
  - 好的：「PLG 公司的 NDR 比 Sales-led 高 15-20%」
  - 差的：「作者认为 PLG 很重要」
- **阅读价值**：AI 判断该文章对用户的阅读价值（high/medium/low）

### 日报编排规则

- 按发布时间排序，体现订阅源的时间节奏
- 保留全部符合条件的摘要，通过前端分页/加载更多控制阅读负担
- 无新内容时不生成空日报

### 周报编排规则

- 本周主题归纳：2-3 个跨源共性话题
- 逐日回顾：可折叠
- 总阅读时长控制在 10 分钟

---

## 用户体验原则

### 首次使用

- **3 分钟内看到第一份 Digest** — 这是转化的关键节点
- 首份 Digest 基于过去 7 天的文章生成（数据更丰满）
- 添加订阅支持两种方式：**搜索名称**（默认推荐） + **粘贴 URL**（备选）
- 搜索结果必须展示 Logo、名称、简介（帮用户确认"这就是我要的"）
- 推荐热门 Substack 降低冷启动门槛（MVP 后迭代）

### 日常使用

- MVP 阶段：用户手动打开网页查看 Digest
- MVP 后：推送 → 打开 → 开始阅读 → 全程不超过 3 秒
- TOC 是"10 秒决策"工具
- 读完 Digest = 获取原文 80% 的价值
- 没有新内容时不生成空日报

### 错误处理

- 所有错误给出友好的中文提示
- 网络错误："网络连接失败，请稍后重试"
- 无效 URL："请输入有效的 Substack 链接"
- 搜索无结果："未找到匹配的出版物，试试其他关键词"
- 重复订阅："该订阅源已添加"
- 使用 Sonner Toast 组件展示反馈

---

## 文件组织

```
src/
├── components/
│   ├── ui/              # shadcn/ui 组件（不手动修改）
│   ├── AppShell.tsx      # 全局布局
│   └── ErrorBoundary.tsx # 错误边界
├── pages/
│   ├── DailyDigest.tsx   # 日报阅读页（同时作为首页，路由 /）
│   ├── WeeklyDigest.tsx  # 周报阅读页（路由 /weekly）
│   ├── Subscriptions.tsx # 订阅管理页（路由 /subscriptions）
│   └── NotFound.tsx      # 404 页面
├── lib/
│   ├── types.ts          # 类型定义（re-export shared/types）
│   ├── api.ts            # 统一 API 客户端
│   ├── storage.ts        # URL 归一化工具（normalizeSubstackUrl）
│   └── utils.ts          # 工具函数（cn）
├── contexts/
│   ├── ThemeContext.tsx   # 主题 Provider
│   └── ThemeTypes.ts     # 主题类型定义
├── hooks/
│   ├── use-mobile.ts     # 响应式设计 hook
│   └── useTheme.tsx      # 主题切换 hook
├── App.tsx               # 路由和 Provider 配置
├── main.tsx
└── index.css

docs/
├── Master Plan.md
├── Implementation Plan.md
├── Design Guidelines.md
├── User Journeys.md
├── Tasks.md
└── Rules.md

server/src/
├── index.ts              # Express v5 入口（端口 3001）
├── db/
│   ├── index.ts          # SQLite + Drizzle 初始化（WAL 模式）
│   └── schema.ts         # Drizzle 表定义
├── routes/
│   ├── feeds.ts          # /api/feeds CRUD
│   ├── digests.ts        # /api/digests 生成与查询
│   └── substack.ts       # /api/substack/search + info 代理
├── services/
│   ├── rss.ts            # RSS 抓取 + Jina Reader + Turndown
│   ├── summarizer.ts     # Vercel AI SDK + Zod schema（多模型）
│   ├── digest.ts         # 日报/周报编排逻辑
│   └── substack.ts       # Substack API 调用封装
└── cron/
    └── scheduler.ts      # node-cron 每小时同步
```

---

## 行为准则

1. **改造优先于新建** — 在现有文件上修改，不随意创建新文件
2. **保持设计一致** — 新增UI必须遵循现有的瑞士现代主义风格
3. **类型安全** — 所有数据结构修改先更新 `types.ts`
4. **API 优先** — 所有数据通过 src/lib/api.ts 调用后端，不使用 localStorage
5. **中文优先** — 用户界面文案使用中文，代码注释可中英混合
6. **不过度工程** — MVP 阶段不引入不必要的复杂度
7. **参考 PRD** — 所有功能决策参考 `docs/` 下的 PRD 文档
