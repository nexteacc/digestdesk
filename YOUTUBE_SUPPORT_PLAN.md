# YouTube 频道支持 — 实现方案

## Context

DigestDesk 已支持 Substack 和 RSS 两个平台。本次实现第三个平台 — YouTube 频道订阅。

核心策略：**更新通知优先，内容总结后置**。

- 第一阶段（本次）：用户订阅 YouTube 频道，日报中展示新视频的标题、缩略图和链接，作为"更新通知"
- 第二阶段（未来）：引入 Gemini 等多模态模型，对视频内容进行摘要

核心发现：YouTube 频道官方提供 Atom feed（`https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID`），可被 rss-parser 直接解析。但与 RSS/Substack 不同的是，视频内容无法通过 Jina Reader 提取文本，需要跳过内容抓取和 AI 总结环节。

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

### 验证数据（2026-03-11 实测）

```
频道: Android Developers (UCVHFbqXqoYvEWM1Ddxl0QDg) → 返回 15 条
频道: Google for Developers (UC_x5XG1OV2P6uZZ5FSM9Ttw) → 返回 15 条
Feed URL 格式: https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
包含字段: yt:videoId, title, link, published, updated, media:group(media:title, media:description, media:thumbnail)
```

---

## 一、数据模型变更

### 1.1 feeds 表 — 无需修改

`sourceType` 字段已支持 `"youtube"` 枚举值，无需改动 schema。

### 1.2 articles 表 — 利用现有字段

| 现有字段 | YouTube 用途 |
|----------|-------------|
| `title` | 视频标题 |
| `url` | 视频链接（`youtube.com/watch?v=xxx`） |
| `author` | 频道名称 |
| `publishedAt` | 发布时间 |
| `coverImageUrl` | 视频缩略图（`media:thumbnail`） |
| `contentText` | 视频描述（`media:description`），通常很短 |

不需要新增字段。

### 1.3 shared/types.ts — 无需修改

`Feed`、`DigestItem` 等类型已覆盖所有需要的字段。

---

## 二、后端变更

### 2.1 新增服务：YouTube 频道探测

**新文件**: `server/src/services/youtube-discovery.ts`

**核心函数**: `discoverYouTubeChannel(url: string): Promise<DiscoveredYouTubeChannel>`

YouTube URL 格式多样，需要统一处理：

| 用户输入格式 | 提取方式 |
|-------------|---------|
| `youtube.com/channel/UCxxxxxx` | 直接从路径提取 channel_id |
| `youtube.com/@handle` | 抓取页面 HTML，从 `<link rel="canonical">` 或 `<meta>` 提取 channel_id |
| `youtube.com/c/ChannelName` | 同上，抓取页面提取 |
| `youtube.com/watch?v=VIDEO_ID` | 抓取视频页面，提取频道的 channel_id |

提取到 channel_id 后：
1. 拼接 feed URL: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
2. 用 rss-parser 解析，获取频道名称、最近视频等元数据
3. 缩略图/logo 使用 YouTube 默认头像: `https://www.youtube.com/channel/${channelId}`（从 feed 无法直接获取频道头像）

返回值：
```typescript
interface DiscoveredYouTubeChannel {
  channelId: string;
  feedUrl: string;       // https://www.youtube.com/feeds/videos.xml?channel_id=xxx
  title: string;         // 频道名称
  channelUrl: string;    // https://www.youtube.com/channel/UCxxx
  recentVideos: Array<{
    title: string;
    url: string;
    thumbnailUrl: string;
    publishedAt: string;
  }>;
}
```

### 2.2 新增路由：YouTube 频道管理

**新文件**: `server/src/routes/youtube-feeds.ts`

| 端点 | 说明 |
|------|------|
| `POST /api/youtube-feeds/discover` | 接收 YouTube URL，调用探测服务，返回频道预览 |
| `POST /api/youtube-feeds` | 确认添加，写入 feeds 表（sourceType="youtube"），触发后台 syncFeed |
| `DELETE /api/youtube-feeds/:id` | 删除 |
| `DELETE /api/youtube-feeds/batch` | 批量删除 |

路由结构与 `rss-feeds.ts` 一致。

### 2.3 修改数据抓取服务 ⚠️

**文件**: `server/src/services/rss.ts` — **需要修改**

这是与 RSS 方案的关键区别。现有 `syncFeed()` 会对每篇文章调用 Jina Reader 提取全文，但对 YouTube 视频：
- Jina Reader 无法提取有意义的视频内容
- 视频描述已在 Atom feed 的 `media:description` 中
- 缩略图在 `media:thumbnail` 中

修改点：

```typescript
// syncFeed() 中，根据 sourceType 决定是否跳过 Jina Reader
const isYouTube = feed.sourceType === "youtube";

for (const item of parsed.items || []) {
  // ...existing dedup logic...

  let contentMarkdown: string | null = null;

  if (isYouTube) {
    // YouTube: 直接使用 feed 中的描述，不调用 Jina
    contentMarkdown = item["media:description"] || item.contentSnippet || "";
  } else {
    // Substack / RSS: 走现有 Jina + fallback 流程
    contentMarkdown = await fetchMarkdown(articleUrl);
    if (!contentMarkdown) {
      const contentHtml = item["content:encoded"] || item.content || "";
      contentMarkdown = contentHtml ? htmlToMarkdown(contentHtml) : "";
    }
  }

  const article = {
    // ...existing fields...
    contentText: contentMarkdown || null,
    // YouTube 缩略图从 media:group 提取
    coverImageUrl: isYouTube
      ? extractYouTubeThumbnail(item)
      : (item.enclosure?.url || null),
  };
}
```

rss-parser 需要配置 `customFields` 以解析 YouTube Atom 的 `media:group` 子字段：

```typescript
const rssParser = new RssParser({
  timeout: 15000,
  headers: { "User-Agent": "DigestDesk/1.0 (RSS Reader)" },
  customFields: {
    item: [
      ["media:group", "mediaGroup"],
    ],
  },
});
```

辅助函数从 mediaGroup 中提取缩略图 URL：

```typescript
function extractYouTubeThumbnail(item: Record<string, unknown>): string | null {
  // rss-parser 将 media:group 解析为嵌套对象
  // media:thumbnail 的 url 在 $.url 属性中
  try {
    const group = item.mediaGroup as Record<string, unknown>;
    const thumb = group?.["media:thumbnail"] as Record<string, unknown>;
    return (thumb?.$ as Record<string, string>)?.url || null;
  } catch {
    return null;
  }
}
```

### 2.4 日报生成 — 需要小幅调整

**文件**: `server/src/services/digest.ts` — **小幅修改**

现有逻辑中，contentText 长度 < 50 的文章会跳过 AI 总结，显示"内容过短，无法生成摘要"。YouTube 视频描述通常很短，会自动命中这个分支。

但"内容过短，无法生成摘要"这个提示不适合 YouTube 条目。建议改为区分来源：

```typescript
if (!contentText || contentText.length < 50) {
  // 判断是否为 YouTube 源
  const isYouTube = feedSourceTypes.get(article.feedId) === "youtube";
  return {
    ...base,
    oneLiner: isYouTube
      ? (contentText || "新视频更新")  // YouTube: 用描述或默认文案
      : "内容过短，无法生成摘要",
    keyInsights: [],
  };
}
```

需要在查询文章时关联 feeds 表获取 sourceType。

### 2.5 注册路由

**文件**: `server/src/index.ts`

```typescript
import { youtubeFeedsRouter } from "./routes/youtube-feeds.js";
app.use("/api/youtube-feeds", youtubeFeedsRouter);
```

---

## 三、前端变更

### 3.1 侧边栏新增入口

**文件**: `src/components/AppShell.tsx`

在 `manageNav` 数组中新增：
```typescript
{
  href: "/youtube",
  label: text("YouTube 频道", "YouTube Channels"),
  icon: <img src="/logos/youtube.svg" alt="YouTube" className="h-4 w-4" />
}
```

图标 `youtube.svg` 已存在于 `public/logos/` 目录。

### 3.2 新增路由

**文件**: `src/App.tsx`

```typescript
<Route path="/youtube" component={YouTubeFeeds} />
```

### 3.3 新增页面：YouTube 频道管理

**新文件**: `src/pages/YouTubeFeeds.tsx`

参照 `RssFeeds.tsx` 的结构，核心差异：

**添加流程：**
1. 输入框：用户粘贴 YouTube 频道 URL（支持 `@handle`、`/channel/`、`/c/` 等格式）
2. 点击"探测" → 调用 `POST /api/youtube-feeds/discover`
3. 显示预览：频道名称 + 最近视频列表（带缩略图）
4. 用户确认 → 调用 `POST /api/youtube-feeds` 完成添加

**与 RssFeeds.tsx 相同部分：**
- Feed 列表展示、单个删除、批量删除、空状态、i18n

### 3.4 API 客户端

**文件**: `src/lib/api.ts`

新增：
```typescript
discoverYouTubeChannel(url: string): Promise<DiscoveredYouTubeChannel>
createYouTubeFeed(data): Promise<Feed>
deleteYouTubeFeed(id: string): Promise<void>
batchDeleteYouTubeFeeds(ids: string[]): Promise<{ deleted: number }>
```

### 3.5 类型定义

**文件**: `shared/types.ts`

新增：
```typescript
export type DiscoveredYouTubeChannel = {
  channelId: string;
  feedUrl: string;
  title: string;
  channelUrl: string;
  recentVideos: Array<{
    title: string;
    url: string;
    thumbnailUrl: string;
    publishedAt: string;
  }>;
};
```

---

## 四、与 RSS 方案的关键差异

| 维度 | RSS | YouTube |
|------|-----|---------|
| Feed 来源 | 用户粘贴任意 URL，后端探测 | 用户粘贴频道 URL，后端提取 channel_id |
| 内容抓取 | Jina Reader 全文提取 | **跳过 Jina**，直接用 feed 中的描述 |
| AI 总结 | 全文摘要（oneLiner + keyInsights） | **跳过 AI**，用视频描述或"新视频更新" |
| 日报展示 | 完整摘要卡片 | 更新通知（标题 + 缩略图 + 链接） |
| rss.ts 改动 | 不改 | **需要改**（按 sourceType 分支） |
| digest.ts 改动 | 不改 | **小幅改**（YouTube 条目的 oneLiner 文案） |

---

## 五、关键文件清单

| 文件 | 操作 |
|------|------|
| `server/src/services/youtube-discovery.ts` | **新建** — 频道探测服务 |
| `server/src/routes/youtube-feeds.ts` | **新建** — YouTube 频道 CRUD 路由 |
| `server/src/services/rss.ts` | 修改 — syncFeed 按 sourceType 分支，YouTube 跳过 Jina |
| `server/src/services/digest.ts` | 修改 — YouTube 条目 oneLiner 文案调整 |
| `server/src/index.ts` | 修改 — 注册新路由 |
| `shared/types.ts` | 修改 — 新增 DiscoveredYouTubeChannel |
| `src/pages/YouTubeFeeds.tsx` | **新建** — YouTube 频道管理页面 |
| `src/components/AppShell.tsx` | 修改 — manageNav 加 YouTube 入口 |
| `src/App.tsx` | 修改 — 加路由 |
| `src/lib/api.ts` | 修改 — 新增 YouTube API 函数 |
| `src/lib/types.ts` | 修改 — re-export DiscoveredYouTubeChannel |
| `server/src/db/schema.ts` | **不改** — sourceType 已支持 youtube |
| `server/src/db/index.ts` | **不改** — 无需数据库迁移 |
| `server/src/services/summarizer.ts` | **不改** |

---

## 六、验证方案

1. **频道探测**: 测试多种 URL 格式
   - `https://www.youtube.com/@GoogleDevelopers`
   - `https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw`
   - `https://www.youtube.com/watch?v=dQw4w9WgXcQ`（从视频页提取频道）

2. **添加 & 同步**: 确认添加后视频条目正确存入 articles 表，coverImageUrl 有缩略图

3. **日报整合**: 生成日报，确认 YouTube 视频和 Substack/RSS 文章一起出现，YouTube 条目显示"更新通知"样式

4. **不触发 Jina**: 确认同步 YouTube 频道时没有调用 Jina Reader，不浪费额度

5. **页面功能**: 列表展示、删除、批量删除正常工作

---

## 七、后续演进（不在本次范围）

- **Gemini 视频总结**: 引入 `GEMINI_API_KEY`，对 YouTube 视频调用 Gemini 1.5 Flash 生成内容摘要
- **多用户系统**: 新增 users、user_feeds 表，内容层（feeds/articles）共享，订阅和日报按用户隔离
- **YouTube 字幕提取**: 如果未来有可靠的字幕获取方案，可复用现有 AI 管线做总结

————————————————————————————————
## 额外的调查发现
「取第一段」规则大约覆盖 60-70% 的频道，但有三类明显失败：

全是链接（老高、Academy of Ideas）— 第一段就是推广链接
空描述（小Lin说部分视频、BBC 部分视频）
第一段是广告（Kurzgesagt）

所以需要更健壮的提取逻辑：

function extractOneLiner(description: string, videoTitle: string): string {
  if (!description?.trim()) return videoTitle;  // 空描述 → 用标题

  // 按段落拆分，找第一个「有意义」的段落
  const paragraphs = description.split(/\n\s*\n/);
  for (const p of paragraphs) {
    const cleaned = p
      .replace(/https?:\/\/\S+/g, "")     // 去链接
      .replace(/#\S+/g, "")               // 去 hashtag
      .replace(/【[^】]*】/g, "")           // 去【订阅】【加入】
      .trim();
    // 剩余内容超过 15 字才算有效段落
    if (cleaned.length > 15) {
      return cleaned.slice(0, 100);
    }
  }

  return videoTitle;  // 所有段落都是噪音 → 用标题兜底
}