# RSS 通用源支持 — 实现方案

## Context

DigestDesk 已完整支持 Substack 订阅源。产品规划支持三个平台：Substack、YouTube、RSS。本次实现第二个平台 — 通用 RSS 源支持。

核心发现：现有的 `syncFeed()` 数据管线（RSS 解析 → Jina Reader 提取 → Markdown 转换 → AI 总结）已经是通用的，不限 Substack。唯一需要新增的核心逻辑是 **RSS Feed URL 自动探测**。

---

## 一、数据模型变更

### 1.1 feeds 表新增 `sourceType` 字段

**文件**: `server/src/db/schema.ts`

```
sourceType: text("source_type", { enum: ["substack", "rss", "youtube"] }).notNull().default("substack")
```

- 现有数据全部默认为 `"substack"`
- 新增 RSS 源写入 `"rss"`
- 为后续 YouTube 预留 `"youtube"`

### 1.2 shared/types.ts 更新 Feed 类型

```typescript
export type Feed = {
  // ... 现有字段
  sourceType: "substack" | "rss" | "youtube";
};
```

### 1.3 数据库迁移

- 使用 Drizzle 的 push 或手动 ALTER TABLE 添加列
- 已有数据默认值为 `"substack"`，无破坏性

---

## 二、后端变更

### 2.1 新增服务：RSS Feed 自动探测

**新文件**: `server/src/services/rss-discovery.ts`

**核心函数**: `discoverFeed(url: string): Promise<DiscoveredFeed>`

探测逻辑（按优先级）：
1. **直接解析** — 尝试用 rss-parser 直接解析用户输入的 URL（用户可能贴的就是 feed URL）
2. **HTML `<link>` 标签** — 抓取网页 HTML，解析 `<link rel="alternate" type="application/rss+xml" href="...">`
3. **常见路径尝试** — 依次尝试 `/feed`、`/rss`、`/atom.xml`、`/index.xml`、`/rss.xml`、`/feed.xml`

返回值：
```typescript
interface DiscoveredFeed {
  feedUrl: string;        // 发现的 RSS feed URL
  title: string;          // 从 feed 头部解析
  description: string;    // 从 feed 头部解析
  logoUrl: string;        // feed.image?.url
  authorName: string;     // 第一篇文章的 creator
  siteUrl: string;        // 网站首页 URL
}
```

元数据提取复用现有 `getSubstackInfo()` 的模式 — 从 RSS feed 头部字段读取 title、description、image.url、首篇文章的 creator。

### 2.2 新增路由：RSS Feed 管理

**新文件**: `server/src/routes/rss-feeds.ts`

| 端点 | 说明 |
|------|------|
| `POST /api/rss-feeds/discover` | 接收 URL，调用 discoverFeed()，返回探测结果预览 |
| `POST /api/rss-feeds` | 确认添加，写入 feeds 表（sourceType="rss"），触发后台 syncFeed |
| `GET /api/rss-feeds` | 查询 sourceType="rss" 的 feeds |
| `DELETE /api/rss-feeds/:id` | 删除（复用现有 feeds 删除逻辑） |
| `DELETE /api/rss-feeds/batch` | 批量删除（复用现有逻辑） |

为什么独立路由而不是扩展现有 `/api/feeds`：
- Substack 路由含 `getSubstackInfo()` 等专属逻辑，混在一起会变复杂
- 前端页面独立，API 也独立更清晰
- 共享逻辑（syncFeed、删除）通过 import 复用

### 2.3 修改现有 feeds 路由

**文件**: `server/src/routes/feeds.ts`

- `toFeed()` 函数增加 `sourceType` 字段映射
- `GET /api/feeds` 支持可选 `?sourceType=` 查询参数过滤

### 2.4 数据抓取 & 清洗流程（无需修改！）

**文件**: `server/src/services/rss.ts` — **不需要改动**

现有 `syncFeed()` 已经是通用的：
- `rssParser.parseURL(feed.feedUrl)` — 支持任何标准 RSS/Atom
- `fetchMarkdown(articleUrl)` — Jina Reader 支持任何 URL
- `htmlToMarkdown()` — Turndown 通用转换
- 文章去重、存储逻辑全部通用

### 2.5 日报生成（无需修改！）

**文件**: `server/src/services/digest.ts` — **不需要改动**

`generateDaily()` 查询的是所有 24h 内的 articles，不区分 feed 来源。RSS 源的文章自动纳入日报。

### 2.6 注册路由

**文件**: `server/src/index.ts`

```typescript
import { rssFeedsRouter } from "./routes/rss-feeds.js";
app.use("/api/rss-feeds", rssFeedsRouter);
```

---

## 三、前端变更

### 3.1 侧边栏新增入口

**文件**: `src/components/AppShell.tsx`

在 `manageNav` 数组中新增：
```typescript
{
  href: "/rss",
  label: text("RSS 订阅", "RSS Feeds"),
  icon: <img src="/logos/rss.svg" alt="RSS" className="h-4 w-4" />
}
```

图标 `rss.svg` 已存在于 `public/logos/` 目录（header 中已在使用）。

### 3.2 新增路由

**文件**: `src/App.tsx`

```typescript
<Route path="/rss" component={RssFeeds} />
```

### 3.3 新增页面：RSS 订阅管理

**新文件**: `src/pages/RssFeeds.tsx`

参照 `Subscriptions.tsx` 的结构，核心差异：

**添加流程（替换 Substack 的搜索流程）：**
1. 输入框：用户粘贴 URL
2. 点击"探测" → 调用 `POST /api/rss-feeds/discover`
3. 显示预览卡片：feed 名称、描述、logo、最近文章
4. 用户确认 → 调用 `POST /api/rss-feeds` 完成添加

**复用部分（与 Subscriptions.tsx 相同）：**
- Feed 列表展示（卡片样式）
- 单个删除（确认弹窗）
- 批量删除模式（全选/反选/确认）
- 空状态提示
- i18n 支持

**不需要的部分：**
- Substack 搜索（searchSubstack）
- 批量导入对话框（ImportDialog）— RSS 没有统一的"用户主页"可导入

### 3.4 API 客户端

**文件**: `src/lib/api.ts`

新增：
```typescript
discoverRssFeed(url: string): Promise<DiscoveredFeed>
createRssFeed(data): Promise<Feed>
getRssFeeds(): Promise<Feed[]>
deleteRssFeed(id: string): Promise<void>
batchDeleteRssFeeds(ids: string[]): Promise<{ deleted: number }>
```

### 3.5 类型定义

**文件**: `shared/types.ts`

新增：
```typescript
export type DiscoveredFeed = {
  feedUrl: string;
  title: string;
  description: string;
  logoUrl: string;
  authorName: string;
  siteUrl: string;
};
```

更新 `Feed` 类型增加 `sourceType`。

---

## 四、关键文件清单

| 文件 | 操作 |
|------|------|
| `server/src/db/schema.ts` | 修改 — feeds 表加 sourceType |
| `shared/types.ts` | 修改 — Feed 加 sourceType，新增 DiscoveredFeed |
| `server/src/services/rss-discovery.ts` | **新建** — Feed 自动探测服务 |
| `server/src/routes/rss-feeds.ts` | **新建** — RSS Feed CRUD 路由 |
| `server/src/routes/feeds.ts` | 修改 — toFeed 映射加 sourceType |
| `server/src/index.ts` | 修改 — 注册新路由 |
| `src/pages/RssFeeds.tsx` | **新建** — RSS 订阅管理页面 |
| `src/components/AppShell.tsx` | 修改 — manageNav 加 RSS 入口 |
| `src/App.tsx` | 修改 — 加路由 |
| `src/lib/api.ts` | 修改 — 新增 RSS API 函数 |
| `server/src/services/rss.ts` | **不改** |
| `server/src/services/digest.ts` | **不改** |
| `server/src/services/summarizer.ts` | **不改** |

---

## 五、验证方案

1. **Feed 探测**: 粘贴几个知名 RSS 源 URL 测试自动探测
   - 直接 feed URL: `https://feeds.feedburner.com/xxx`
   - 网站 URL: `https://blog.example.com`（需要从 HTML 发现）
   - 带常见路径的: `https://example.com`（尝试 /feed、/rss 等）

2. **添加 & 同步**: 确认添加后文章正确抓取、Markdown 内容正常

3. **日报整合**: 生成日报，确认 RSS 源的文章和 Substack 文章一起出现

4. **页面功能**: 列表展示、删除、批量删除正常工作

5. **侧边栏**: RSS 入口显示正确，活跃状态高亮正常
