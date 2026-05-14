# DigestDesk History

> 记录项目演进中的关键诊断、AI 协作结论、工程决策和后续验证项。核心原则：只保留会影响未来判断的结论，不保存聊天流水账。

本文档是 DigestDesk 的项目记忆层。架构稳定事实写入 `docs/context.md`，部署和运行事实写入 `docs/operations.md`；排查过程、成本诊断、阶段性决策、明天要看的指标写入本文，成熟后再沉淀回对应主题文档。

## 记录规则

应该写入：

- 和 AI 协作排查出的关键问题和结论
- 成本、日志、外部 API、调度、摘要链路等阶段性诊断
- 会影响后续实现方式的工程决策
- 下一次需要验证的指标和命令

不应该写入：

- 原始聊天记录
- 完整运行日志粘贴
- 没有结论的临时猜测
- 已经稳定、应进入 context 或 operations 的长期事实

## 2026-05-14: 摘要成本与重复触发排查

### 背景

一次测试中，日报最终约 42 篇文章，但 OpenRouter Activity 显示约 520 次 `gpt-oss-120b` 请求。按当前“每篇未缓存文章一次摘要”的设计，42 篇未缓存文章应接近 42 次请求，520 次明显偏高。

### 当前架构链路

```
RSS 抓取 → 优先使用 RSS 正文，必要时 Jina fallback → 预摘要缓存 → 组装用户日报
```

### 外部 API 免费层级限制

| 服务 | 免费额度 | 关键限制 |
|---|---|---|
| **Jina Reader** | 1000 万 token（一次性） | 无 Key 20 RPM / 免费 Key 500 RPM；按输出 token 计数，一篇文章 ~10K token，1000 万 ≈ 1000 篇 |
| **AI 模型** | 取决于供应商配置（`AI_MODEL` + `AI_BASE_URL`） | RPM / TPM / TPD 均有上限；输入 token 越多消耗越快 |

### 相关历史问题

以 10 用户 × 30 篇/天 = 300 篇/天 为例：

| 指标 | 当前消耗 |
|---|---|
| Jina 调用 | 300 次/天 → **3 天用完全部免费额度** |
| AI 单次输入 | ~4000 token（全文直送） |
| AI 总 token/天 | ~120 万 |
| 日报生成耗时 | ~2 分钟/用户，全局串行排队 |

---

### 优化方案

#### 第一步：抓取优化 — RSS 优先，Jina 降级为 fallback

##### 原理

RSS `content:encoded` 是出版商**专门为 RSS 阅读器准备的纯正文 HTML**，天然不含网页导航、侧栏、广告等噪音。项目已有的 `turndown` 库可以在本地将 HTML 转为 Markdown，无需外部 API 调用。

##### 实测验证结果

| 数据源 | RSS 字段 | 内容质量 | 需要 Jina？ |
|---|---|---|---|
| **Substack** | `content:encoded` | ✅ 完整纯正文（实测 Lenny's Newsletter 3459-7964 字符，无噪音） | ❌ 不需要 |
| **RSS 博客** | `content:encoded` | ✅ 纯正文（实测 Stratechery 49838 字符完整全文；Ars Technica 1461 字符摘要级） | ⚠️ 仅内容 <500 字符时 |
| **YouTube** | `media:description` | ✅ 视频描述纯文本（实测 Fireship 682 字符） | ❌ 不需要（已不走 Jina） |
| **Podcast** | `itunes:summary` | ✅ 节目简介（已有 `cleanShownotes()` 清洗赞助链接/时间戳） | ❌ 不需要（已不走 Jina） |

> **关键发现**：付费文章（如 Stratechery 付费、Substack 付费）RSS 里只有摘要，但 Jina 同样过不了付费墙，所以 Jina 对付费内容也无额外价值。

##### 改动方案

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

#### 第二步：AI 摘要优化 — 输入上限 + 日报前预摘要

##### 2a. 输入上限

**涉及文件**：`server/src/services/summarizer.ts`

**当前实现**：在 `summarizeArticle` 函数中，通过 `AI_MAX_INPUT_CHARS` 控制送入 AI 的最大字符数。

```text
AI_MAX_INPUT_CHARS=0       # 不截断
AI_MAX_INPUT_CHARS=200000  # 当前测试配置，保留长文上下文
```

这个开关用于在“摘要质量”和“token 成本”之间做产品选择。早期方案曾评估过 1500 字符截断，但当前测试阶段选择 `200000`，因此成本优化重点不再假设 aggressive truncation，而是优先减少重复请求、提高缓存命中和避免无效预摘要。

| 配置 | 效果 | 风险 |
|---|---|---|
| `0` | 全文输入 | 成本不可控 |
| `1500-8000` | 成本明显下降 | 长文摘要可能丢上下文 |
| `200000` | 摘要质量优先，基本不截断 | 必须依赖去重、缓存和触发合并控成本 |

**伪代码**：

```typescript
const maxInputChars = Number(process.env.AI_MAX_INPUT_CHARS ?? 0);

export async function summarizeArticle(markdown: string, language: "zh" | "en" = "zh") {
  const input = maxInputChars > 0 && markdown.length > maxInputChars
    ? markdown.slice(0, maxInputChars)
    : markdown;

  const { object } = await generateObject({
    model,
    system: promptConfig.system,
    prompt: input,
    schema: /* ... */,
  });
}
```

**观测方式**：日志中的 `maxInputChars`、`totalInputChars`、`estimatedSentChars` 用于对账 OpenRouter token 消耗。

##### 2b. 日报执行前预摘要

**涉及文件**：`server/src/services/digest-execution.ts`、`server/src/services/presummarize.ts`

**当前实现**：日报执行入口统一走 `executeDailyDigestJob()`，先同步用户有效订阅，再按用户语言和目标日期执行 `presummarizeForUser()`，最后由 `generateDaily()` 组装日报。

```
早期:
  syncFeed → 存 article (无摘要)
  generateDaily → 逐篇调 AI → 写 digest

当前:
  executeDailyDigestJob
    → syncUserFeeds
    → presummarizeForUser (按用户语言补 articles.summary_zh/en)
    → generateDaily (优先读缓存，缓存缺失时保留 AI fallback)
```

**伪代码**：

```typescript
export async function executeDailyDigestJob(userId: string, targetDate?: string) {
  await syncUserFeeds(userId);
  await presummarizeForUser(userId, targetDate);
  return generateDaily(userId, targetDate);
}
```

**效果**：
- 所有手动生成、定时生成、新增订阅后的初次生成都走同一条链路
- `generateDaily()` 大多数情况下读摘要缓存并写 digest 快照
- 缓存缺失时仍保留 AI fallback，优先保证用户能看到结果

**注意事项**：
- 已有 `articles.summaryZh` / `articles.summaryEn` 缓存字段，数据库无需改动
- `presummarizeForUser()` 会读取用户的 `digest_language`，不是固定生成中文
- `generateDaily()` 已增加 cache hit/miss/fallback 统计日志，便于观察真实命中率
- 当前没有把 AI 摘要前移到每次 feed 同步后；除非真实日志显示日报窗口仍有明显 AI 峰值，否则暂不需要引入更复杂的异步预摘要编排

---

#### 第三步：调度优化 — 去全局锁 + 并行化

##### 3a. 去掉 `_dailyQueue` 全局串行锁

**涉及文件**：`server/src/services/digest.ts`

**优化前问题**：所有用户的 `generateDaily` 排进同一个 Promise 链串行执行。UserB 必须等 UserA 完成才开始。

```typescript
// 优化前 — 全局串行
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

##### 3b. Job Runner 批量并发执行

**涉及文件**：`server/src/services/digest-jobs.ts`

**优化前问题**：`runPendingDigestJobs` 中 claimed jobs 在 for 循环中串行执行。

```typescript
// 优化前 — 串行
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

##### 3c. Feed 同步并行化

**涉及文件**：`server/src/services/rss.ts`

**优化前问题**：`syncUserFeeds` 逐个 Feed 串行同步，每个 Feed 间还有 1 秒 sleep。

```typescript
// 优化前 — 串行 + sleep
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

### 当前优化效果汇总

以 10 用户 × 30 篇/天 = 300 篇/天 为基准：

| 指标 | 优化前 | 当前实现 | 变化 |
|---|---|---|---|
| Jina 调用/天 | 300 次 | ~30 次 | **-90%** |
| Jina 免费额度 | ~3 天用完 | ~30+ 天 | **10 倍** |
| AI 调用次数/天 | 300 次（集中在 `generateDaily`） | 约 300 次（前置到 `presummarizeForUser`，缓存缺失时兜底） | 次数不变，生成入口更一致 |
| AI 单次 token | ~4000 | 取决于 `AI_MAX_INPUT_CHARS` | 当前配置质量优先，不承诺固定降幅 |
| AI 总 token/天 | ~120 万 | 取决于新文章数、重复触发次数和缓存命中 | 通过去重和观测控制 |
| 日报生成耗时 | ~2 分钟/用户，串行排队 | 取决于预摘要命中率；命中缓存时接近纯 DB 写入 | 明显改善 |
| 多用户并行 | 全局串行（200 用户 ~6.6h） | 用户级并行 | **解除天花板** |

---

### 实施状态

本文只维护性能与成本相关的当前实现状态，以及会影响后续开发判断的少量关键决策。

| 状态 | 优化项 | 涉及文件 | 说明 |
|---|---|---|---|
| 已完成 | RSS 优先，Jina fallback | `substack-adapter.ts`, `rss-adapter.ts` | RSS 内容不足 500 字符才调 Jina |
| 已完成 | AI 输入上限 | `summarizer.ts` | 通过 `AI_MAX_INPUT_CHARS` 配置，当前测试为 200000 |
| 已完成 | 日报前预摘要 | `digest-execution.ts`, `presummarize.ts` | 按用户语言预生成摘要缓存，再组装 digest |
| 已完成 | 统一生成入口 | `feeds.ts`, `source-feed-router.ts`, `podcast-feeds.ts`, `digests.ts`, `digest-jobs.ts` | 路由层不再直接绕过执行器调用 `generateDaily()` |
| 已完成 | 初始 digest 请求合并 | `initial-digest-trigger.ts`, `feeds.ts`, `source-feed-router.ts`, `podcast-feeds.ts` | 新增订阅后按用户和目标日期防抖合并，减少重复摘要 |
| 已完成 | 预摘要过滤对齐 | `presummarize.ts`, `digest.ts` | 预摘要跳过 `before_subscription` 和未启用 source type 的文章 |
| 已完成 | AI 成本观测日志 | `presummarize.ts`, `digest.ts` | 输出 `aiRequests`、输入字符统计和 `maxInputChars` |
| 已完成 | 去全局锁，改用户级锁 | `digest.ts` | 同一用户串行，不同用户可并行 |
| 已完成 | Job Runner 并发执行 | `digest-jobs.ts` | `pLimit(3)` 并发执行 claimed jobs |
| 已完成 | Feed 同步并行化 | `rss.ts` | `pLimit(5)` 并发同步，近期同步自动跳过 |
| 观察后再定 | feed 同步后异步预摘要 | 待定 | 只有当日志显示 `summaryCacheMisses` 高或日报窗口 AI 峰值明显时再做 |

---

### 关键决策

#### 先合并重复触发，不做每日文章上限

一次测试中，日报最终约 42 篇文章，但 OpenRouter Activity 显示约 520 次 `gpt-oss-120b` 请求。按当前“每篇未缓存文章一次摘要”的设计，42 篇未缓存文章应接近 42 次请求，520 次明显偏高。

判断：优先风险是同一用户同一目标日期被多个入口重复触发，尤其是连续新增多个订阅时，每个新增订阅都触发一次初始 digest。

决策：

- 新增订阅后的初始 digest 按 `userId + targetDate` 合并，默认 30 秒防抖。
- 暂不设置每日文章数量上限。
- `presummarizeForUser()` 与 `generateDaily()` 对齐 source type 和 `startedAt` 过滤。
- 增加 `aiRequests`、`estimatedSentChars` 等成本观测日志。

验证：

- 连续新增订阅时，应看到多条 coalesced 日志，但同一用户同一日期只执行一次初始 digest。
- `presummarize aiRequests` 应接近真正需要摘要的新文章数。
- `digest aiRequests` 应接近 0，说明组装日报基本命中缓存。

---

### 四种数据源的完整链路

#### Substack

```
rss-parser 解析 Feed
  → 取 content:encoded (纯正文 HTML)
  → turndown 本地转 Markdown (0 次外部调用)
  → 按 AI_MAX_INPUT_CHARS 控制输入上限
  → 日报执行前按用户语言预摘要
  → 缓存到 articles.summary_zh/en
```

#### RSS 博客

```
rss-parser 解析 Feed
  → 取 content:encoded
  → turndown 本地转 Markdown
  → 内容 >= 500 字符? → 直接用 (0 次外部调用)
  → 内容 < 500 字符? → 调 Jina 抓取网页 (仅此时消耗 Jina 额度)
  → 按 AI_MAX_INPUT_CHARS 控制输入上限
  → 日报执行前按用户语言预摘要
  → 缓存到 articles.summary_zh/en
```

#### YouTube

```
rss-parser 解析 Atom Feed
  → 取 media:description (视频描述纯文本)
  → 不调 Jina
  → 内容通常 < 50 字符 → 跳过 AI, 用预设文案
  → 不需要摘要缓存
```

#### Podcast

```
rss-parser 解析 Feed
  → 取 itunes:summary (节目简介)
  → cleanShownotes() 清洗 (删赞助链接/URL/时间戳)
  → 不调 Jina
  → 内容 >= 50 字符? → 按 AI_MAX_INPUT_CHARS 控制输入上限 → 调 AI
  → 内容 < 50 字符? → 跳过 AI, 用预设文案
  → 缓存到 articles.summary_zh/en
```

---

### 注意事项

1. **模型不变**：所有优化不涉及 `AI_MODEL` 和 `AI_BASE_URL` 配置，使用现有模型
2. **数据库不变**：`articles.summary_zh/en` 缓存字段已存在，无需 schema 变更
3. **向后兼容**：日报生成逻辑已有缓存读取和 fallback 机制，优化不影响现有功能
4. **不过度工程化**：当前产品阶段先保持 `web + scheduler + postgres`，根据真实日志再决定是否把摘要进一步前移或拆分 runner
5. **关键观测指标**：关注 `summaryCacheHits`、`summaryCacheMisses`、`summaryGenerated`、`summaryFallbacks`，用真实数据决定下一步
