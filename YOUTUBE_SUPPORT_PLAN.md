# YouTube 频道支持 — 架构与实现总结

## Context

DigestDesk 已支持 Substack 和 RSS 两个平台。本项目通过引入工厂模式（Factory Pattern）和适配器架构（Adapter Architecture），优雅地实现了第三个平台 — YouTube 频道订阅。

核心策略：**更新通知优先，内容总结后置**。

- 第一阶段（当前）：用户订阅 YouTube 频道，日报中展示新视频的标题、缩略图和链接，作为"更新通知"
- 第二阶段（未来）：引入 Gemini 等多模态模型，对视频内容进行摘要

核心发现：YouTube 频道官方提供 Atom feed（`https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID`），可被 rss-parser 直接解析。但与 RSS/Substack 不同的是，视频内容无法通过 Jina Reader 提取文本，需要跳过内容抓取和 AI 总结环节，直接提取 feed 中的描述和缩略图。

---

## 〇、YouTube RSS Feed 限制调查

### 已验证的限制

| 限制项 | 实际情况 | 对 DigestDesk 的影响 |
|--------|---------|-------------------|
| **条目数量** | 固定返回最新 **15 条**，无分页参数，不可调整 | 影响极小 — cron 每天跑一次，绝大多数频道日更不超过 15 个视频 |
| **频率限制** | 短时间内重复请求同一频道会返回空响应 | 影响极小 — `syncAllFeeds()` 每个 feed 间隔 1 秒，不会触发 |
| **历史内容** | 只返回最近 15 个视频，无法获取更早的内容 | 可接受 — 产品定位是"每日更新通知"，不需要历史回溯 |
| **无官方文档** | 该 feed 端点无官方 API 文档，但自 2015 年至今持续可用 | 低风险 — 大量 RSS 阅读器依赖此端点，YouTube 不太可能下线 |

### 时间字段说明

每个 `<entry>` 包含两个时间字段：

```xml
<published>2026-03-09T15:01:05+00:00</published>  ← 视频首次发布时间
<updated>2026-03-09T19:09:41+00:00</updated>      ← 最后修改时间（编辑标题/描述会变）
```

**排序应使用 `published`**，不用 `updated`。rss-parser 解析后对应 `item.isoDate`（取自 `published`），与现有代码 `publishedAt: item.isoDate` 一致，无需额外处理。

---

## 一、架构升级：工厂适配器模式

在实现 YouTube 支持时，为了避免在共用的同步服务（`rss.ts`）中出现破坏开闭原则（OCP）的 `if (isYouTube)` 分支，系统升级了 `SourceAdapter` 抽象层。

### 1.1 SourceAdapter 契约

定义了严格的多态契约，每种数据源（Substack, RSS, YouTube）负责自己的探测、写入和内容提取：

```typescript
export interface SourceAdapter {
  readonly sourceType: SourceType;
  discover(rawUrl: string): Promise<unknown>;
  createFeedDraft(input: Record<string, unknown>): FeedDraft | Promise<FeedDraft>;
  // 核心解耦点：提取同步条目内容（多态）
  extractSyncItemContent(
    item: Record<string, unknown>,
    articleUrl: string,
  ): Promise<SyncItemContent>;
}
```

### 1.2 YouTube 适配器 (`youtube-adapter.ts`)

封装了所有 YouTube 特有的脏数据处理逻辑：
- `extractThumbnail`：处理嵌套的 `mediaGroup?.['media:thumbnail']` 或通过 URL 回退。
- `getDescription`：处理视频短描述。
- `extractOneLiner`：剔除广告和空段落，获取纯文本视频通知摘要。

### 1.3 核心服务解耦 (`rss.ts` & `content-extractor.ts`)

`rss.ts` 中的 `syncFeed` 去除了对于 Jina Reader 的依赖，变成了纯粹的调度器。
相关的 Markdown 拉取和 HTML 转换逻辑剥离到了专用的 `content-extractor.ts` 中，供 Substack 和 RSS 适配器复用。

```typescript
// rss.ts: 策略模式应用
const adapter = getSourceAdapter(feed.sourceType as SourceType);
const { contentMarkdown, coverImageUrl } =
  await adapter.extractSyncItemContent(item as unknown as Record<string, unknown>, articleUrl);
```

### 1.4 路由工厂 (`source-feed-router.ts`)

RSS 和 YouTube 的路由端点（discover / create / list）结构完全相同，仅 Zod schema、适配器实例和错误文案不同。通过 `createSourceFeedRouter(opts)` 工厂函数消除了这一重复：

```typescript
// rss-feeds.ts — 仅 24 行配置
export const rssFeedsRouter = createSourceFeedRouter({
  adapter: getRssAdapter(),
  discoverSchema,
  createSchema: createRssFeedSchema,
  sourceType: "rss",
  logPrefix: "[rss]",
});
```

YouTube 路由同理。工厂内部统一处理 Zod 校验、查重、入库、后台同步和 `toAppError` 错误映射。

---

## 二、数据模型与存储

### 2.1 feeds 表
`sourceType` 字段支持了 `"youtube"` 枚举值。

### 2.2 articles 表 — 利用现有字段

| 现有字段 | YouTube 用途 |
|----------|-------------|
| `title` | 视频标题 |
| `url` | 视频链接（`youtube.com/watch?v=xxx`） |
| `author` | 频道名称 |
| `publishedAt` | 发布时间 |
| `coverImageUrl` | 视频缩略图（`media:thumbnail`） |
| `contentText` | 视频描述（`media:description`），通常很短 |

通过 `YouTubeAdapter.extractSyncItemContent()` 无缝将 YouTube 数据清洗为符合此表结构的数据。

---

## 三、接口设计与后端实现

### 3.1 探测服务 (`youtube-discovery.ts`)

针对各种 YouTube 用户输入格式进行探测：
| 用户输入格式 | 提取方式 |
|-------------|---------|
| `youtube.com/channel/UCxxxxxx` | 直接从路径提取 channelId |
| `youtube.com/@handle` | 抓取页面 HTML，从 `<meta itemprop="channelId">` 等标签提取 |
| `youtube.com/c/ChannelName` | 同上 |
| `youtube.com/watch?v=VIDEO_ID` | 同上 |

- 自定义了 `YouTubeDiscoveryError`（继承 `AppError`）以提供友好的探测失败信息。

### 3.2 路由端点

通过路由工厂 `createSourceFeedRouter` 生成，`youtube-feeds.ts` 仅声明 Zod schema 和配置：
- `POST /api/youtube-feeds/discover` — 探测频道
- `POST /api/youtube-feeds` — 添加订阅
- `GET /api/youtube-feeds` — 列出 YouTube 订阅

路由工厂统一处理查重（409）、入库、后台 `syncFeed` 触发以及 `toAppError` 错误映射。

### 3.3 日报生成调整 (`digest.ts`)

YouTube 的内容往往非常短，不满 50 字会跳过 AI 摘要。通过直接调用 `YouTubeAdapter.extractOneLiner` 生成"新视频通知"样式的一句话摘要。

```typescript
const isYouTube = feedSourceMap.get(article.feedId) === "youtube";
return {
  ...base,
  oneLiner: isYouTube
    ? YouTubeAdapter.extractOneLiner(contentText || "", article.title)
    : "内容过短，无法生成摘要",
  keyInsights: [],
};
```

---

## 四、前端实现

### 4.1 共享组件层

三个订阅管理页面（Substack / RSS / YouTube）的批量操作和列表渲染逻辑高度相似，通过两个共享模块消除重复：

- **`useBatchMode` hook** (`src/hooks/useBatchMode.ts`)：封装批量选择/全选/删除的状态管理和 API 调用，各页面只需传入 `deleteFn` 和 `onDeleted` 回调。
- **`FeedListSection` 组件** (`src/components/FeedListSection.tsx`)：封装"已订阅 · N"标题行、批量操作栏、加载骨架、空状态卡片和订阅项卡片（含单项删除确认对话框）。三页间的差异通过 props 注入：`renderAvatarFallback`（头像回退）、`showAuthor`（YouTube 不显示作者）、`emptyText`。

### 4.2 管理入口与路由
在 `src/components/AppShell.tsx` 中新增了 YouTube 管理入口，引入新页面 `YouTubeFeeds.tsx` 专门处理 YouTube 频道的发现和订阅管理。

### 4.3 统一的 API 客户端 (`api.ts`)
新增针对 YouTube 端点的方法封装：`discoverYouTubeChannel`, `createYouTubeFeed`, `fetchYouTubeFeeds`, 并复用 `deleteFeed` 进行管理。

### 4.4 共享类型定义 (`shared/types.ts`)
引入 `DiscoveredYouTubeChannel` 以支持从探测到确认订阅全链路的强类型验证。

---

## 五、关键文件分布总览

| 模块 | 文件 | 核心作用 |
|------|------|----------|
| **共享类型** | `shared/types.ts` | 前后端共用的领域类型 (Feed, Digest, DigestItem...) |
| **适配器层** | `server/src/sources/types.ts` | `SourceAdapter` 接口契约 + `SyncItemContent` |
| | `server/src/sources/factory.ts` | 工厂：按 sourceType 分发适配器单例 |
| | `server/src/sources/adapters/youtube-adapter.ts` | YouTube 探测、建稿、内容提取、oneLiner |
| | `server/src/sources/adapters/substack-adapter.ts` | Substack 探测、建稿、内容提取 |
| | `server/src/sources/adapters/rss-adapter.ts` | RSS 探测、建稿、内容提取 |
| **服务层** | `server/src/services/youtube-discovery.ts` | 多策略 HTML 抓取，解析 channelId |
| | `server/src/services/content-extractor.ts` | Jina Reader 限流 + Turndown HTML→Markdown |
| | `server/src/services/rss.ts` | 同步调度器：调 adapter.extractSyncItemContent |
| | `server/src/services/digest.ts` | 日报生成 + AI 摘要编排 |
| **路由层** | `server/src/routes/source-feed-router.ts` | 路由工厂：discover / create / list 模板 |
| | `server/src/routes/youtube-feeds.ts` | YouTube 路由配置（Zod schema → 调工厂） |
| | `server/src/routes/rss-feeds.ts` | RSS 路由配置（同上） |
| **定时任务** | `server/src/cron/scheduler.ts` | 每 4h 同步 + 每日定时生成日报 |
| **前端共享** | `src/hooks/useBatchMode.ts` | 批量选择/删除状态管理 hook |
| | `src/components/FeedListSection.tsx` | 订阅列表 + 批量操作 + 删除确认 |
| **前端页面** | `src/pages/YouTubeFeeds.tsx` | YouTube 频道发现与管理 |
| | `src/components/AppShell.tsx` | 侧边导航（含 YouTube 入口） |

---

## 六、后续演进机会

### 已评估，当前方案可行

以下事项经过代码审计和讨论，结论是当前实现合理，暂不修改：

1. **parseURL 无 retry**：`rss.ts` 的 `rssParser.parseURL` 是单次调用，失败返回 0。但 `syncAllFeeds` 有 try/catch 容错且每 4 小时轮询，天然形成 retry。除非遇到持续性网络问题，否则不影响数据完整性。
2. **digest.ts 仍有 isYouTube 特判**：这是"摘要降级策略"（内容太短时给用户看什么），不是"内容提取策略"。前者属于日报编排逻辑，不属于源适配器职责。如果未来第 3 个源类型也需要特殊降级，再抽象到 adapter 契约中。
3. **feeds.ts import 写死 substack**：`/api/feeds/import` 是 Substack 阅读列表专用的导入端点，URL 规范化逻辑也是 Substack 特有的。如果未来需要通用导入（如 OPML），应新建端点而非改造此端点。
4. **SourceAdapter 接口用 unknown**：`discover` 返回 `Promise<unknown>`，`createFeedDraft` 接受 `Record<string, unknown>`——这是刻意的取舍。三种适配器的输入输出类型完全不同，加泛型会传染到 factory 和 route 的每一处使用。当前方案：接口层宽松保多态，Zod 保运行时安全，具体适配器类各自收窄。

### 未来可做

5. **多模态视频摘要**：引入 Gemini 等多模态模型，对 YouTube 视频内容生成结构化摘要，替代当前的"更新通知"模式。
6. **DB 迁移系统**：将 `db/index.ts` 中的 raw SQL 建表逻辑迁移到 Drizzle Kit 迁移系统，随着 schema 演进降低维护成本。
