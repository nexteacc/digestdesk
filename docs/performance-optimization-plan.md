# DigestDesk 性能优化方案

> 基于实际数据验证的综合优化方案，核心原则：**调用得更少，而不是跑得更快。**

## 背景

### 当前架构链路

```
RSS 抓取 → Jina 提取正文 → AI 生成摘要 → 存入数据库 → 用户查看日报
```

### 外部 API 免费层级限制

| 服务 | 免费额度 | 关键限制 |
|---|---|---|
| **Jina Reader** | 1000 万 token（一次性） | 无 Key 20 RPM / 免费 Key 500 RPM；按输出 token 计数，一篇文章 ~10K token，1000 万 ≈ 1000 篇 |
| **AI 模型** | 取决于供应商配置（`AI_MODEL` + `AI_BASE_URL`） | RPM / TPM / TPD 均有上限；输入 token 越多消耗越快 |

### 当前问题

以 10 用户 × 30 篇/天 = 300 篇/天 为例：

| 指标 | 当前消耗 |
|---|---|
| Jina 调用 | 300 次/天 → **3 天用完全部免费额度** |
| AI 单次输入 | ~4000 token（全文直送） |
| AI 总 token/天 | ~120 万 |
| 日报生成耗时 | ~2 分钟/用户，全局串行排队 |

---

## 优化方案

### 第一步：抓取优化 — RSS 优先，Jina 降级为 fallback

#### 原理

RSS `content:encoded` 是出版商**专门为 RSS 阅读器准备的纯正文 HTML**，天然不含网页导航、侧栏、广告等噪音。项目已有的 `turndown` 库可以在本地将 HTML 转为 Markdown，无需外部 API 调用。

#### 实测验证结果

| 数据源 | RSS 字段 | 内容质量 | 需要 Jina？ |
|---|---|---|---|
| **Substack** | `content:encoded` | ✅ 完整纯正文（实测 Lenny's Newsletter 3459-7964 字符，无噪音） | ❌ 不需要 |
| **RSS 博客** | `content:encoded` | ✅ 纯正文（实测 Stratechery 49838 字符完整全文；Ars Technica 1461 字符摘要级） | ⚠️ 仅内容 <500 字符时 |
| **YouTube** | `media:description` | ✅ 视频描述纯文本（实测 Fireship 682 字符） | ❌ 不需要（已不走 Jina） |
| **Podcast** | `itunes:summary` | ✅ 节目简介（已有 `cleanShownotes()` 清洗赞助链接/时间戳） | ❌ 不需要（已不走 Jina） |

> **关键发现**：付费文章（如 Stratechery 付费、Substack 付费）RSS 里只有摘要，但 Jina 同样过不了付费墙，所以 Jina 对付费内容也无额外价值。

#### 改动方案

**涉及文件**：`server/src/sources/adapters/substack-adapter.ts`、`server/src/sources/adapters/rss-adapter.ts`

**改动逻辑**：将 `extractSyncItemContent` 方法中 Jina 和 RSS HTML 的优先级**反转**：

```
现在:  fetchMarkdown(jina) → 失败 → htmlToMarkdown(rss)
优化:  htmlToMarkdown(rss) → 内容 < 500字符 → fetchMarkdown(jina)
```

**伪代码**：

```typescript
async extractSyncItemContent(item, articleUrl): Promise<SyncItemContent> {
  // 1. 先尝试 RSS 自带内容（免费、本地、毫秒级）
  const contentHtml = item["content:encoded"] || item.content || "";
  let contentMarkdown = contentHtml ? htmlToMarkdown(contentHtml) : "";
  let extractionMethod = contentHtml ? "rss_html" : "empty";

  // 2. RSS 内容不足时才调 Jina（消耗外部 API 额度）
  if (!contentMarkdown || contentMarkdown.length < 500) {
    const jinaResult = await fetchMarkdown(articleUrl);
    if (jinaResult) {
      contentMarkdown = jinaResult;
      extractionMethod = "jina_fallback";
    }
  }

  return { contentMarkdown, coverImageUrl };
}
```

**预期效果**：Jina 调用量从 300 次/天降至 **~30 次/天**，免费额度从 3 天延长至 **30+ 天**。

---

### 第二步：AI 摘要优化 — 截断输入 + 同步时预生成

#### 2a. 输入截断

**涉及文件**：`server/src/services/summarizer.ts`

**改动逻辑**：在 `summarizeArticle` 函数中，送入 AI 前截断到 1500 字符。

**为什么 1500 字符**：

| 源 | 实测全文 | 截断 1500 字符 | 覆盖比例 |
|---|---|---|---|
| Lenny (Substack) | 3459 字符 | 1500 字符 | 43%（开头信息最密集） |
| Ars Technica | 1461 字符 | 1461 字符 | 100%（无需截断） |
| Stratechery | 49838 字符 | 1500 字符 | 3%（但开头已含核心论点） |

文章开头的信息密度最高，1500 字符（约 1000 token 输入 + 200 token 输出 = ~1200 token/次）足以产出高质量摘要。

**伪代码**：

```typescript
const MAX_CONTENT_CHARS = 1500;

export async function summarizeArticle(markdown: string, language: "zh" | "en" = "zh") {
  const truncated = markdown.length > MAX_CONTENT_CHARS
    ? markdown.slice(0, MAX_CONTENT_CHARS)
    : markdown;

  // 使用 truncated 替代 markdown 送入 AI
  const { object } = await generateObject({
    model,
    system: promptConfig.system,
    prompt: truncated,
    schema: /* ... */,
  });
}
```

**预期效果**：AI 单次 token 从 ~4000 降至 ~1200，总 token/天从 120 万降至 **~36 万**（-70%）。

#### 2b. 同步时预生成摘要

**涉及文件**：`server/src/services/rss.ts`（`syncFeedInternal` 函数）

**改动逻辑**：在存入文章后立即调用 AI 生成摘要并缓存，而不是等日报生成时批量调用。

```
现在:
  syncFeed → 存 article (无摘要)
  generateDaily → 逐篇调 AI → 写 digest  (集中爆发)

优化后:
  syncFeed → 存 article → 调 AI → 缓存到 summary_zh/en  (分散全天)
  generateDaily → 读缓存 → 写 digest  (0 次 AI 调用)
```

**伪代码**（在 `syncFeedInternal` 的文章插入成功后添加）：

```typescript
// 文章存入成功后，立即预生成摘要
if (contentMarkdown && contentMarkdown.length >= 50 && newCount > 0) {
  try {
    const summary = await summarizeArticle(contentMarkdown, "zh");
    const summaryJson = JSON.stringify(summary);
    await db.update(articles)
      .set({ summaryZh: summaryJson })
      .where(eq(articles.id, article.id));
  } catch (e) {
    // 摘要失败不影响同步，日报生成时有 fallback 机制
    console.warn(`[rss] Pre-summary failed for ${articleUrl}:`, e);
  }
}
```

**预期效果**：
- AI 调用从集中在日报生成时段 → **分散在全天各次 Feed 同步中**
- 日报生成从 ~2 分钟 → **< 1 秒**（纯 DB 读取）
- 永不出现短时间内大量 AI 调用触发 RPM 限制的问题

**注意事项**：
- 已有 `articles.summaryZh` / `articles.summaryEn` 缓存字段，数据库无需改动
- 已有摘要缓存读取逻辑（`digest.ts:201-215`），日报生成时会自动命中缓存
- 预摘要失败不阻塞同步流程，日报生成时有 fallback 机制兜底
- 预摘要语言暂用默认 `"zh"`，后续可根据用户设置优化

---

### 第三步：调度优化 — 去全局锁 + 并行化

#### 3a. 去掉 `_dailyQueue` 全局串行锁

**涉及文件**：`server/src/services/digest.ts`

**问题**：所有用户的 `generateDaily` 排进同一个 Promise 链串行执行。UserB 必须等 UserA 完成才开始。

```typescript
// 现在（digest.ts:17-23）— 全局串行
let _dailyQueue: Promise<string | void> = Promise.resolve();
export function generateDaily(userId, date) {
  const task = _dailyQueue.catch(() => {}).then(() => _generateDailyCore(userId, date));
  _dailyQueue = task;
  return task;
}
```

**改为用户级锁**：同一用户防重复，不同用户互不阻塞。

```typescript
// 优化后 — 用户级锁
const _userQueues = new Map<string, Promise<string | void>>();

export function generateDaily(userId: string, date?: string): Promise<string> {
  const prev = _userQueues.get(userId) ?? Promise.resolve();
  const task = prev.catch(() => {}).then(() => _generateDailyCore(userId, date));
  _userQueues.set(userId, task);
  task.finally(() => {
    if (_userQueues.get(userId) === task) {
      _userQueues.delete(userId);
    }
  });
  return task;
}
```

**预期效果**：200 用户场景从串行排队 ~6.6 小时 → 可并行处理。

#### 3b. Job Runner 批量并发执行

**涉及文件**：`server/src/services/digest-jobs.ts`

**问题**：`runPendingDigestJobs` 中 claimed jobs 在 for 循环中串行执行。

```typescript
// 现在（digest-jobs.ts:183）— 串行
for (const job of claimed) {
  await executeDailyDigestJob(job.userId, job.targetDate);
}
```

**改为 pLimit 并发**：

```typescript
import pLimit from "p-limit";

// 优化后 — 并发执行不同用户的 Job
const jobLimit = pLimit(3);
await Promise.all(
  claimed.map(job => jobLimit(async () => {
    // ... 原有的 try/catch 逻辑
    const digestId = await executeDailyDigestJob(job.userId, job.targetDate);
    // ... 更新 job 状态
  }))
);
```

#### 3c. Feed 同步并行化

**涉及文件**：`server/src/services/rss.ts`

**问题**：`syncUserFeeds` 逐个 Feed 串行同步，每个 Feed 间还有 1 秒 sleep。

```typescript
// 现在（rss.ts:111-128）— 串行 + sleep
for (const row of rows) {
  await syncFeed(row.feedId);
  await new Promise((r) => setTimeout(r, 1000));  // 额外等 1 秒
}
```

**改为 pLimit 并发**（Jina 已有 Bottleneck 全局限流，不怕并行超限）：

```typescript
import pLimit from "p-limit";

// 优化后 — 并行同步不同 Feed
const syncLimit = pLimit(5);
await Promise.all(
  rows
    .filter(row => !wasSyncedRecently(row.lastFetchedAt, freshnessWindowMs))
    .map(row => syncLimit(() => syncFeed(row.feedId)))
);
```

**预期效果**：20 个 Feed 的同步从 ~6 分钟降至 **~1-2 分钟**。

---

## 优化效果汇总

以 10 用户 × 30 篇/天 = 300 篇/天 为基准：

| 指标 | 优化前 | 优化后 | 变化 |
|---|---|---|---|
| Jina 调用/天 | 300 次 | ~30 次 | **-90%** |
| Jina 免费额度 | ~3 天用完 | ~30+ 天 | **10 倍** |
| AI 调用次数/天 | 300 次（集中在几分钟内） | 300 次（分散在全天） | 次数不变，**负载均匀** |
| AI 单次 token | ~4000 | ~1200 | **-70%** |
| AI 总 token/天 | ~120 万 | ~36 万 | **-70%** |
| 日报生成耗时 | ~2 分钟/用户，串行排队 | **< 1 秒/用户** | 质变 |
| 多用户并行 | 全局串行（200 用户 ~6.6h） | 用户级并行 | **解除天花板** |

---

## 实施优先级

| 优先级 | 优化项 | 涉及文件 | 改动量 | 效果 |
|---|---|---|---|---|
| **P0** | RSS 优先，Jina fallback | `substack-adapter.ts`, `rss-adapter.ts` | ~15 行 | Jina 调用 -90% |
| **P0** | AI 输入截断 | `summarizer.ts` | ~3 行 | AI Token -70% |
| **P1** | 同步时预生成摘要 | `rss.ts` | ~20 行 | 日报生成 <1s；AI 负载均匀 |
| **P1** | 去全局锁，改用户级锁 | `digest.ts` | ~10 行 | 多用户可并行 |
| **P2** | Job Runner 并发执行 | `digest-jobs.ts` | ~10 行 | Job 处理 3-5x 提速 |
| **P2** | Feed 同步并行化 | `rss.ts` | ~10 行 | Feed 同步 5x 提速 |

---

## 四种数据源的完整链路

### Substack

```
rss-parser 解析 Feed
  → 取 content:encoded (纯正文 HTML)
  → turndown 本地转 Markdown (0 次外部调用)
  → 截断到 1500 字符
  → 调 AI 生成摘要 (同步时预生成)
  → 缓存到 articles.summary_zh/en
```

### RSS 博客

```
rss-parser 解析 Feed
  → 取 content:encoded
  → turndown 本地转 Markdown
  → 内容 >= 500 字符? → 直接用 (0 次外部调用)
  → 内容 < 500 字符? → 调 Jina 抓取网页 (仅此时消耗 Jina 额度)
  → 截断到 1500 字符
  → 调 AI 生成摘要 (同步时预生成)
  → 缓存到 articles.summary_zh/en
```

### YouTube

```
rss-parser 解析 Atom Feed
  → 取 media:description (视频描述纯文本)
  → 不调 Jina
  → 内容通常 < 50 字符 → 跳过 AI, 用预设文案
  → 不需要摘要缓存
```

### Podcast

```
rss-parser 解析 Feed
  → 取 itunes:summary (节目简介)
  → cleanShownotes() 清洗 (删赞助链接/URL/时间戳)
  → 不调 Jina
  → 内容 >= 50 字符? → 截断到 1500 字符 → 调 AI
  → 内容 < 50 字符? → 跳过 AI, 用预设文案
  → 缓存到 articles.summary_zh/en
```

---

## 注意事项

1. **模型不变**：所有优化不涉及 `AI_MODEL` 和 `AI_BASE_URL` 配置，使用现有模型
2. **数据库不变**：`articles.summary_zh/en` 缓存字段已存在，无需 schema 变更
3. **向后兼容**：日报生成逻辑已有缓存读取和 fallback 机制，优化不影响现有功能
4. **渐进实施**：P0 → P1 → P2 顺序实施，每步独立可验证，不存在依赖关系
