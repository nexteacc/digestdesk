# DigestDesk 项目分析文档

> 个人编辑助手：自动阅读你订阅的 Substack，每天为你编辑一份专属 Digest

---

## 1. 项目概览表格

| 项目属性 | 详细信息 |
|---------|---------|
| 项目名称 | DigestDesk |
| 项目类型 | 全栈 Web 应用 (SPA + RESTful API) |
| 核心功能 | Substack 订阅管理 + AI 智能摘要 + 每日 Digest 生成 |
| 开发语言 | TypeScript (100%) |
| 架构模式 | Monorepo + 前后端分离 + 定时任务 |
| 数据库 | SQLite (文件数据库) |
| AI 能力 | OpenAI API / 兼容协议 (Kimi, DeepSeek, Zhipu) |
| 部署方式 | Docker 容器化部署 |
| 目标用户 | Substack 重度用户、信息管理者 |
| 开发状态 | 原型阶段 (v0.0.0) |

---

## 2. 技术栈版本表格

### 前端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 19.2.0 | UI 框架 |
| TypeScript | 5.9.3 | 类型系统 |
| Vite | 7.2.4 | 构建工具 |
| Wouter | 3.9.0 | 轻量级路由 |
| Tailwind CSS | 4.1.18 | 样式框架 |
| Radix UI | 1.x | 无障碍组件库 |
| Lucide React | 0.563.0 | 图标库 |
| date-fns | 4.1.0 | 日期处理 |
| Sonner | 2.0.7 | Toast 通知 |


### 后端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | - | 运行时环境 |
| Express | 5.1.0 | Web 框架 |
| TypeScript | 5.9.3 | 类型系统 |
| Better-SQLite3 | 11.9.1 | SQLite 驱动 |
| Drizzle ORM | 0.44.2 | ORM 框架 |
| Vercel AI SDK | 6.0.86 | AI 集成 |
| RSS Parser | 3.13.0 | RSS 解析 |
| Node-Cron | 4.0.7 | 定时任务 |
| Turndown | 7.2.2 | HTML 转 Markdown |
| Zod | 3.25.76 | 数据验证 |

### 开发工具

| 工具 | 版本 | 用途 |
|------|------|------|
| pnpm | - | 包管理器 (Monorepo) |
| ESLint | 9.39.1 | 代码检查 |
| Prettier | 3.8.1 | 代码格式化 |
| Vitest | 4.0.18 | 单元测试 |
| tsx | 4.19.4 | TypeScript 执行器 |
| Docker | - | 容器化部署 |

---

## 3. 项目文件结构树

```
DigestDesk/
├── src/                          # 前端源码
│   ├── components/               # React 组件
│   │   ├── ui/                   # Radix UI 基础组件
│   │   ├── AppShell.tsx          # 应用外壳 (导航/布局)
│   │   ├── ErrorBoundary.tsx     # 错误边界
│   │   └── ImportDialog.tsx      # 批量导入对话框
│   ├── contexts/                 # React Context
│   │   ├── ThemeContext.tsx      # 主题管理
│   │   └── ThemeTypes.ts         # 主题类型定义
│   ├── hooks/                    # 自定义 Hooks
│   │   ├── useTheme.tsx          # 主题切换
│   │   └── useZenMode.tsx        # 禅模式 (专注阅读)
│   ├── lib/                      # 工具库
│   │   ├── api.ts                # API 客户端
│   │   ├── types.ts              # 类型定义 (引用 shared)
│   │   └── utils.ts              # 工具函数
│   ├── pages/                    # 页面组件
│   │   ├── DailyDigest.tsx       # 每日摘要页
│   │   ├── Subscriptions.tsx     # 订阅管理页
│   │   └── NotFound.tsx          # 404 页面
│   ├── App.tsx                   # 应用入口
│   ├── main.tsx                  # React 挂载
│   └── index.css                 # 全局样式
│
├── server/                       # 后端源码
│   ├── src/
│   │   ├── db/                   # 数据库层
│   │   │   ├── schema.ts         # Drizzle Schema 定义
│   │   │   └── index.ts          # 数据库初始化
│   │   ├── routes/               # API 路由
│   │   │   ├── feeds.ts          # 订阅源管理
│   │   │   ├── digests.ts        # 摘要生成
│   │   │   └── substack.ts       # Substack 搜索/信息
│   │   ├── services/             # 业务逻辑层
│   │   │   ├── rss.ts            # RSS 抓取/同步
│   │   │   ├── digest.ts         # 摘要生成逻辑
│   │   │   ├── summarizer.ts     # AI 摘要服务
│   │   │   └── substack.ts       # Substack API 封装
│   │   ├── cron/                 # 定时任务
│   │   │   └── scheduler.ts      # 每日 08:00 自动生成
│   │   └── index.ts              # Express 服务器入口
│   ├── data/                     # SQLite 数据库文件
│   │   └── digestdesk.db         # 持久化数据
│   └── package.json              # 后端依赖
│
├── shared/                       # 前后端共享代码
│   └── types.ts                  # 共享类型定义
│
├── public/                       # 静态资源
├── dist/                         # 前端构建产物
├── docs/                         # 文档目录
├── scripts/                      # 构建脚本
│   └── babel-plugin-jsx-source-location.cjs
│
├── Dockerfile                    # Docker 镜像定义
├── DEPLOY.md                     # 部署指南
├── package.json                  # 根项目配置 (Monorepo)
├── pnpm-workspace.yaml           # pnpm Workspace 配置
├── vite.config.ts                # Vite 配置
├── tsconfig.json                 # TypeScript 配置
└── README.md                     # 项目说明
```

---

## 4. 数据模型 ER 图

```mermaid
erDiagram
    FEEDS ||--o{ ARTICLES : "has many"
    ARTICLES ||--o| DIGEST_ITEMS : "referenced by"
    DIGESTS ||--o{ DIGEST_ITEMS : "contains"

    FEEDS {
        text id PK "nanoid"
        text name "订阅源名称"
        text description "描述"
        text logo_url "Logo URL"
        text author_name "作者名"
        text publication_url "发布地址"
        text feed_url UK "RSS Feed URL"
        text created_at "创建时间 ISO"
        text last_fetched_at "最后抓取时间"
    }

    ARTICLES {
        text id PK "nanoid"
        text feed_id FK "关联订阅源"
        text title "文章标题"
        text author "作者"
        text url UK "文章链接"
        text guid "RSS GUID"
        text published_at "发布时间 ISO"
        text content_text "正文 (Markdown)"
        text cover_image_url "封面图"
        text fetched_at "抓取时间 ISO"
    }

    DIGESTS {
        text id PK "nanoid"
        text type "类型: daily"
        text date UK "日期 YYYY-MM-DD"
        text generated_at "生成时间 ISO"
    }

    DIGEST_ITEMS {
        text id PK "nanoid"
        text digest_id FK "关联 Digest"
        text article_id "关联文章 (可选)"
        text feed_name "订阅源名称"
        text article_title "文章标题"
        text author "作者"
        text url "文章链接"
        text one_liner "一句话总结"
        text key_insights "核心洞察 JSON"
        text published_at "发布时间 ISO"
        integer sort_order "排序权重"
    }
```

### 数据关系说明

- **FEEDS → ARTICLES**: 一对多，级联删除
- **ARTICLES → DIGEST_ITEMS**: 一对一 (可选引用)
- **DIGESTS → DIGEST_ITEMS**: 一对多，级联删除
- **唯一约束**: `feed_url`, `article.url`, `digest.date`

---

## 5. 核心业务流程图

### 5.1 每日 Digest 自动生成流程

```mermaid
flowchart TD
    Start([每日 08:00 定时触发]) --> SyncStart[开始同步 RSS]
    SyncStart --> GetFeeds[获取所有订阅源]
    GetFeeds --> LoopFeeds{遍历订阅源}
    
    LoopFeeds -->|每个订阅源| FetchRSS[抓取 RSS Feed]
    FetchRSS --> ParseHTML[解析 HTML]
    ParseHTML --> ToMarkdown[转换为 Markdown]
    ToMarkdown --> CheckDup{文章已存在?}
    CheckDup -->|是| LoopFeeds
    CheckDup -->|否| SaveArticle[保存到数据库]
    SaveArticle --> LoopFeeds
    
    LoopFeeds -->|全部完成| QueryNew[查询今日新文章]
    QueryNew --> HasNew{有新文章?}
    
    HasNew -->|否| EndFail([结束: 无新文章])
    HasNew -->|是| LoopArticles{遍历文章}
    
    LoopArticles -->|每篇文章| CallAI[调用 AI API]
    CallAI --> GenSummary[生成一句话总结]
    GenSummary --> GenInsights[提取核心洞察]
    GenInsights --> SaveItem[保存 DigestItem]
    SaveItem --> LoopArticles
    
    LoopArticles -->|全部完成| CreateDigest[创建 Digest 记录]
    CreateDigest --> EndSuccess([结束: 生成成功])
    
    style Start fill:#e1f5e1
    style EndSuccess fill:#e1f5e1
    style EndFail fill:#ffe1e1
    style CallAI fill:#fff4e1
```

### 5.2 用户订阅 Substack 流程

```mermaid
flowchart TD
    Start([用户进入订阅页面]) --> ChooseMethod{选择添加方式}
    
    ChooseMethod -->|搜索| InputQuery[输入关键词]
    InputQuery --> SearchAPI[调用搜索 API]
    SearchAPI --> ShowResults[展示搜索结果]
    ShowResults --> ClickSub[点击订阅按钮]
    
    ChooseMethod -->|URL| InputURL[输入 Substack URL]
    InputURL --> GetInfo[获取订阅源信息]
    GetInfo --> ShowPreview[展示预览信息]
    ShowPreview --> ConfirmSub[确认订阅]
    
    ChooseMethod -->|批量导入| UploadJSON[上传 JSON 文件]
    UploadJSON --> BatchAPI[调用批量导入 API]
    
    ClickSub --> CreateFeed[POST /api/feeds]
    ConfirmSub --> CreateFeed
    
    CreateFeed --> ParseRSS[解析 RSS Feed]
    ParseRSS --> CheckExist{订阅源已存在?}
    
    CheckExist -->|是| ShowError([提示: 已订阅])
    CheckExist -->|否| SaveFeed[保存订阅源]
    SaveFeed --> FetchArticles[抓取最新文章]
    FetchArticles --> SaveArticles[保存文章到数据库]
    SaveArticles --> ShowSuccess([提示: 订阅成功])
    
    BatchAPI --> BatchLoop{遍历导入项}
    BatchLoop --> BatchCreate[创建订阅源]
    BatchCreate --> BatchLoop
    BatchLoop -->|完成| ShowBatchResult([显示导入结果])
    
    style Start fill:#e1f5e1
    style ShowSuccess fill:#e1f5e1
    style ShowBatchResult fill:#e1f5e1
    style ShowError fill:#ffe1e1
```

---

## 6. API 模块接口功能表格

### 6.1 订阅源管理 (/api/feeds)

| 方法 | 路径 | 功能 | 请求参数 | 响应 |
|------|------|------|---------|------|
| GET | /api/feeds | 获取所有订阅源 | - | `Feed[]` |
| POST | /api/feeds | 创建订阅源 | `{ url: string }` | `Feed` |
| DELETE | /api/feeds/:id | 删除订阅源 | - | `void` |
| POST | /api/feeds/import | 批量导入订阅源 | `{ items: Array<{url, name?, ...}> }` | `{ created, skipped }` |
| DELETE | /api/feeds/batch | 批量删除订阅源 | `{ ids: string[] }` | `{ deleted: number }` |

### 6.2 摘要管理 (/api/digests)

| 方法 | 路径 | 功能 | 请求参数 | 响应 |
|------|------|------|---------|------|
| GET | /api/digests | 获取摘要列表 | `?type=daily` | `DigestListItem[]` |
| GET | /api/digests/:id | 获取摘要详情 | - | `Digest` (含 items) |
| POST | /api/digests/generate | 生成摘要 | `{ type, date?, force? }` | `{ id: string }` |

### 6.3 Substack 集成 (/api/substack)

| 方法 | 路径 | 功能 | 请求参数 | 响应 |
|------|------|------|---------|------|
| GET | /api/substack/search | 搜索 Substack | `?query=xxx` | `{ results: SubstackSearchResult[] }` |
| GET | /api/substack/info | 获取详细信息 | `?url=xxx` | `SubstackInfo` |
| GET | /api/substack/reads | 获取用户订阅列表 | `?username=xxx` | `{ results: SubstackSearchResult[] }` |

### 6.4 健康检查

| 方法 | 路径 | 功能 | 响应 |
|------|------|------|------|
| GET | /api/health | 健康检查 | `{ status: "ok", timestamp }` |

---

## 7. 前端特色功能表格

| 功能模块 | 技术实现 | 用户价值 | 亮点 |
|---------|---------|---------|------|
| **禅模式** | useZenMode Hook + Context | 专注阅读体验，隐藏导航栏 | 一键切换，沉浸式阅读 |
| **主题切换** | ThemeContext + CSS Variables | 明暗模式自由切换 | 保护视力，适应不同场景 |
| **响应式设计** | Tailwind CSS + Radix UI | 移动端/平板/桌面完美适配 | 无缝跨设备体验 |
| **实时搜索** | 防抖 + 请求 ID 去重 | 快速查找 Substack 订阅源 | 避免重复请求，性能优化 |
| **批量操作** | 多选模式 + 批量 API | 一键删除多个订阅源 | 提升管理效率 |
| **URL 预览** | 异步加载 + Skeleton | 添加前预览订阅源信息 | 避免误订阅，提升信心 |
| **进度提示** | 分阶段文案 + 动画 | 生成摘要时显示进度 | 降低等待焦虑 |
| **错误边界** | ErrorBoundary 组件 | 捕获 React 错误，优雅降级 | 提升稳定性 |
| **Toast 通知** | Sonner 库 | 操作反馈 (成功/失败) | 即时反馈，用户友好 |
| **日期本地化** | date-fns + zhCN | 中文日期格式化 | 符合中文用户习惯 |
| **锚点导航** | Hash 路由 + 平滑滚动 | 快速跳转到指定订阅源 | 提升长列表浏览效率 |
| **空状态设计** | 插画 + 引导文案 | 无数据时引导用户操作 | 降低学习成本 |

---

## 8. 部署架构图

```mermaid
graph LR
    A[用户浏览器] -->|HTTPS| B[Express :8080]
    B -->|读写| C[(SQLite)]
    B -->|RSS 抓取| D[Substack API]
    B -->|AI 摘要| E[OpenAI API]
    F[定时任务<br/>08:00] -.->|触发| B
    
    subgraph Docker 容器
        B
        C
        F
    end
    
    subgraph 外部服务
        D
        E
    end
    
    style B fill:#4A90E2,color:#fff,stroke:#2E5C8A,stroke-width:2px
    style C fill:#7B68EE,color:#fff,stroke:#5A4DB8,stroke-width:2px
    style Docker fill:#E8F4F8,stroke:#4A90E2,stroke-width:2px
    style 外部服务 fill:#F0F8F0,stroke:#52C41A,stroke-width:2px
```

**关键配置**

| 项目 | 配置 |
|------|------|
| 容器平台 | Zeabur / Railway / Fly.io |
| Volume 挂载 | `/app/server/data` (必须) |
| 环境变量 | `AI_API_KEY` (必填) |
| 端口 | 8080 |
| 健康检查 | `GET /api/health` |

### 部署要点

| 组件 | 配置要求 | 说明 |
|------|---------|------|
| **容器平台** | 支持 Docker + Volume | Zeabur / Railway / Fly.io |
| **Volume 挂载** | `/app/server/data` | 必须配置，否则数据丢失 |
| **环境变量** | `AI_API_KEY` (必填) | AI 服务密钥 |
| **端口** | 8080 | 容器内部端口 |
| **健康检查** | `GET /api/health` | 用于平台探针 |
| **构建命令** | `pnpm build:all` | 前后端一起构建 |
| **启动命令** | `node server/dist/index.js` | 生产环境启动 |

---

## 10. 工程亮点表格

| 亮点类别 | 具体实现 | 技术价值 | 业务价值 |
|---------|---------|---------|---------|
| **Monorepo 架构** | pnpm Workspace + 共享类型 | 代码复用，类型安全 | 降低维护成本 |
| **类型安全** | TypeScript 全栈 + Zod 验证 | 编译时错误检查 | 减少运行时 Bug |
| **ORM 抽象** | Drizzle ORM + Schema 定义 | 类型安全的数据库操作 | 提升开发效率 |
| **AI 集成** | Vercel AI SDK + 多厂商支持 | 统一接口，易于切换 | 降低 AI 成本 |
| **定时任务** | node-cron + 优雅错误处理 | 自动化内容同步 | 无需人工干预 |
| **并发控制** | p-limit 限流 | 避免 API 限流 | 提升稳定性 |
| **增量更新** | RSS GUID 去重 | 避免重复抓取 | 节省资源 |
| **级联删除** | Drizzle ORM 外键约束 | 数据一致性保证 | 避免脏数据 |
| **SPA Fallback** | Express 静态托管 + 路由回退 | 支持前端路由 | 用户体验流畅 |
| **健康检查** | 独立端点 + 快速响应 | 容器平台探针支持 | 提升部署成功率 |
| **延迟初始化** | 端口监听后再初始化 DB | 避免阻塞启动探针 | 通过平台健康检查 |
| **代理支持** | Cloudflare Worker 可选 | 绕过 Substack 限制 | 提升可用性 |
| **HTML 转换** | Turndown 库 | 统一内容格式 | 便于 AI 处理 |
| **错误边界** | React ErrorBoundary | 局部错误隔离 | 提升用户体验 |
| **无障碍设计** | Radix UI 组件库 | 键盘导航 + 屏幕阅读器 | 包容性设计 |
| **性能优化** | Vite 构建 + 代码分割 | 快速加载 | 降低跳出率 |
| **开发体验** | tsx watch + Vite HMR | 热更新 | 提升开发效率 |
| **容器化** | Dockerfile + 多阶段构建 | 一致的运行环境 | 简化部署流程 |

---

## 总结

DigestDesk 是一个技术栈现代、架构清晰的全栈应用，核心亮点包括：

1. **AI 驱动**: 利用 AI 自动生成高质量摘要，解决信息过载问题
2. **自动化**: 定时任务 + RSS 同步，无需人工干预
3. **类型安全**: TypeScript 全栈 + Drizzle ORM，减少运行时错误
4. **用户体验**: 响应式设计 + 禅模式 + 主题切换，关注细节
5. **易部署**: Docker 容器化 + 详细文档，降低部署门槛

适合作为 Substack 重度用户的个人工具，也可作为全栈项目学习参考。
