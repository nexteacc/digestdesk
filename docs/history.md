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

## 2026-05-15: OpenRouter 用量与 2026-05-14 日报对账

### 背景

用户在页面看到自己的 2026-05-14 中文日报只有 38 篇文章，但 OpenRouter Activity 的 1 Day 统计显示：

| 指标 | 数值 |
|---|---:|
| Requests | 249 |
| Tokens | 1.31M |
| Spend | $0.191 |

初看容易误判为“38 篇文章触发了 249 次请求”。通过 Zeabur MCP 查询 `scheduler` runtime logs 和生产库后，确认这是全系统视角和单用户视角混淆。

### 生产状态

`scheduler` 服务状态正常：

- 服务状态：`RUNNING`
- dispatch 周期：每 15 分钟
- runner 周期：每 5 分钟
- 当前日志显示 runner `candidates=0`
- `digest_jobs` 无 pending/running/failed 积压

`digest_jobs` 总体状态：

| status | count |
|---|---:|
| succeeded | 243 |
| skipped | 71 |
| failed | 0 |
| pending | 0 |
| running | 0 |

最近三天每个 target date 均为 8 个用户 job，其中 6 个成功、2 个空日报跳过：

| target date | succeeded | skipped |
|---|---:|---:|
| 2026-05-14 | 6 | 2 |
| 2026-05-13 | 6 | 2 |
| 2026-05-12 | 6 | 2 |

### 2026-05-14 实际处理规模

页面上看到的 38 篇只是其中一个中文用户的日报。

生产库中 2026-05-14 共有 6 份成功日报：

| 语言 | digest 数 | digest item 数 | 唯一文章数 |
|---|---:|---:|---:|
| en | 1 | 138 | 138 |
| zh | 5 | 114 | 65 |
| 合计 | 6 | 252 | 203 |

关键结论：

- 2026-05-14 全系统真实进入日报的唯一文章数是 203 篇，不是单用户页面上的 38 篇。
- 中文用户之间有订阅重叠，所以 114 条中文 digest items 只对应 65 篇唯一文章。
- 英文日报对应 138 篇唯一文章。
- 该日中英文日报文章集合没有重叠，因此按 `article + language` 缓存口径，理论首次摘要规模约为 203 次。

OpenRouter 的 249 次请求比 203 篇唯一文章多 46 次，当前判断在合理范围内，可能来自：

- OpenRouter 1 Day 统计窗口覆盖了其他手动测试或邻近日期请求
- 手动刷新、重试或失败 fallback
- 首次缓存写入前的少量重复触发

与 2026-05-14 的 520 次请求异常相比，本次 249 次请求已经接近可解释区间。

### 成本换算

按 OpenRouter 统计：

| 口径 | 计算 | 结果 |
|---|---|---:|
| tokens / request | 1.31M / 249 | ~5,261 |
| tokens / unique article | 1.31M / 203 | ~6,453 |
| cost / request | $0.191 / 249 | ~$0.00077 |
| cost / unique article | $0.191 / 203 | ~$0.00094 |

结论：203 篇唯一文章消耗约 1.31M tokens、约 $0.19，按当前全文质量优先策略基本合理。

### 重要配置发现

用户原以为 Zeabur 云平台配置的 `AI_MAX_INPUT_CHARS` 是 `12000`，但直接在当前运行容器中检查，`web` 和 `scheduler` 实际读到的都是：

```text
AI_MAX_INPUT_CHARS=200000
```

这说明本次 OpenRouter token 消耗是在运行时 `200000` 字符上限下产生的。

对 2026-05-14 进入日报的 203 篇唯一文章统计正文长度：

| 指标 | 数值 |
|---|---:|
| 平均正文字符 | 12,522 |
| 最大正文字符 | 72,504 |
| 超过 12,000 字符 | 53 篇 |
| 超过 200,000 字符 | 0 篇 |
| 原始总正文字符 | 2,541,882 |
| 如果按 12,000 截断 | 856,266 |
| 如果按 200,000 截断 | 2,541,882 |

如果生产运行值改为 `12000`，这批文章送入 AI 的正文字符会从约 254 万降到约 86 万，理论 token 成本会明显下降，但长文摘要质量可能下降。

### 后续验证项

- 在 Zeabur 中统一确认 `web` 和 `scheduler` 的 `AI_MAX_INPUT_CHARS`，修改后必须重启或重新部署服务，并在容器内再次确认运行时值。
- 如果要以成本优先，建议先把 `AI_MAX_INPUT_CHARS` 调到 `12000` 或 `20000` 做一天 A/B 观察。
- 继续用 `[presummarize] Complete` 与 `[digest] Daily digest updated` 日志对账 `aiRequests` 和 `summaryCacheMisses`。
- 避免再次调用会完整返回环境变量值的 Zeabur MCP 变量接口；如已暴露敏感值，应轮换相关 token/key。

### 2026-05-15 后续实现：Markdown 结构化输入压缩

为避免 `AI_MAX_INPUT_CHARS` 只做前缀截断导致长文结论丢失，`summarizer.ts` 已将纯 `markdown.slice(0, maxInputChars)` 改为 Markdown block 级输入压缩。

当前策略：

- 内容未超过 `AI_MAX_INPUT_CHARS` 时仍送全文。
- 内容超过上限时，本地按 Markdown block 拆分和打分，不增加额外 AI 调用。
- 优先保留开头、结尾、标题、列表、数据段、结论/要点段。
- 过滤订阅、退订、广告、赞助、推荐阅读等低价值段落。
- 最终按原文顺序拼回上限内，保持文章阅读顺序。

这个改动主要影响 RSS 和 Substack 长文；YouTube 和 Podcast 通常内容较短，基本不会触发压缩。

后续观察：

- `sentLength` 应稳定接近但不超过 `AI_MAX_INPUT_CHARS`。
- 对长文抽样检查摘要是否仍能覆盖结论和关键数据。
- 如果质量不足，优先调整 block 打分和预算比例，而不是直接把上限恢复到 200000。

### 2026-05-16 跟踪清单

上线 `AI_MAX_INPUT_CHARS=12000` 与 Markdown 结构化输入压缩后，下一次评估按以下顺序检查。

1. 确认运行时配置：

```text
web       AI_MAX_INPUT_CHARS=12000
scheduler AI_MAX_INPUT_CHARS=12000
```

重点确认 `scheduler`，因为定时日报主要由 scheduler 执行。

2. 对比 OpenRouter 1 Day 成本：

| 指标 | 2026-05-15 基线 | 2026-05-16 观察 |
|---|---:|---:|
| Requests | 249 | 待填 |
| Tokens | 1.31M | 待填 |
| Spend | $0.191 | 待填 |
| tokens / request | ~5,261 | 待填 |
| tokens / unique article | ~6,453 | 待填 |
| cost / unique article | ~$0.00094 | 待填 |

3. 对比生产库实际处理规模：

```sql
-- 按 target date 查成功/跳过/失败 job
select target_date, status, count(*)
from digest_jobs
where target_date >= '2026-05-15'
group by target_date, status
order by target_date desc, status;

-- 按 digest date 查 item 数
select d.date,
       count(distinct d.id) as digests,
       count(di.id) as items
from digests d
left join digest_items di on di.digest_id = d.id
where d.date >= '2026-05-15'
group by d.date
order by d.date desc;
```

4. 看日志指标：

```text
[summarizer] inputLength=... sentLength=... maxInputChars=...
[presummarize] aiRequests=... estimatedSentChars=...
[digest] summaryCacheHits=... summaryCacheMisses=... aiRequests=...
```

预期：

- `sentLength` 不超过 12000。
- `estimatedSentChars / unique article` 明显低于 2026-05-15。
- `digest aiRequests` 仍应接近 0，说明日报组装主要命中缓存。

5. 抽样检查摘要质量：

- RSS 长文是否保留核心结论。
- Substack 长文是否保留关键数据、列表和结尾观点。
- `oneLiner` 是否具体，不只是泛泛描述。
- `keyInsights` 是否仍有数据、方法或洞察。
- 中文/英文输出语言是否正确。

判断：

- 成本明显下降且摘要质量可接受：保持 `AI_MAX_INPUT_CHARS=12000`。
- 成本下降但长文摘要明显变差：先调 block 打分和预算比例，再考虑上调到 `16000`。
- 成本没有明显下降：检查运行时变量是否未生效、OpenRouter 统计窗口是否混入其他请求。
- Requests 异常升高：继续排查重复触发、fallback、手动刷新和失败重试。

### 2026-05-16 晚间实现：并发预摘要去重与请求数对账日志

基于 2026-05-15 日报对账，确认好消息：

- 单用户看到的 42 篇日报内容已完整生成，没有摘要缺失。
- OpenRouter token 从 2026-05-14 基线的约 1.31M 降到约 877K，说明 `AI_MAX_INPUT_CHARS=12000` 与 Markdown 结构化压缩已生效。

进一步查 scheduler runtime logs 后，定位到 requests 偏高的两个主要来源：

- 两个中文用户的 2026-05-15 job 在 `2026-05-16T01:05:00Z` 同时启动，分别生成 42 和 45 篇，且两份日报有 32 篇文章重叠。此前 `presummarizeForUser()` 按用户独立执行，可能在缓存写入前并发总结同一篇 `article + language`。
- 部分模型输出未通过结构化 schema 校验，触发 `summarizeArticle()` 内部第二次尝试；日志中可见 `AI summary failed validation; retrying once`、`attempt=2`、`No object generated: response did not match schema`。

本次改动：

- `presummarize.ts` 增加进程内 `articleId + language` in-flight 去重锁。并发任务遇到同一文章同一语言时等待首个任务完成，再重新读取缓存；如果缓存有效则不再调用 AI。
- `summarizer.ts` 增加 `onAttempt` 回调，用于统计每篇摘要实际模型请求次数。
- `presummarize.ts` 完成日志新增 `articlesToProcess`、`modelRequests`、`retryRequests`、`dedupedWaits`、`cacheHitsAfterWait`。
- `digest.ts` fallback 摘要路径也把 `aiRequests` 改成实际模型请求数，并新增 `modelRequests`、`retryRequests`，避免把文章数误当 OpenRouter 请求数。

验证：

```text
pnpm --filter substack-digest-server build
pnpm lint
```

2026-05-17 检查重点：

1. OpenRouter Activity：
   - Requests 是否更接近全系统 `article + language` 唯一摘要数。
   - Tokens 是否继续低于 2026-05-14 的 1.31M 基线。
   - Spend 是否随 requests 回落。

2. scheduler 日志：

```text
[presummarize] Complete ... articlesToProcess=... aiRequests=... modelRequests=... retryRequests=... dedupedWaits=... cacheHitsAfterWait=...
[digest] Daily digest updated ... summaryCacheHits=... summaryCacheMisses=... aiRequests=... retryRequests=...
```

预期：

- 有重叠用户并发时，`dedupedWaits` 和 `cacheHitsAfterWait` 应大于 0。
- `modelRequests - articlesToProcess` 主要应由 `retryRequests` 解释。
- `digest aiRequests` 仍应接近 0，说明日报组装阶段基本命中缓存。
- 如果 `modelRequests` 仍明显高于 `articlesToProcess + retryRequests`，再考虑数据库级 `article + language` 锁，覆盖 web 与 scheduler 跨进程并发。

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

## 2026-05-17: OpenRouter 1 Day 调用量与多用户日报对账

### 背景

OpenRouter Activity 显示 1 Day 窗口内：

- Requests: 248
- `gpt-oss-120b`: 239 requests / 754K tokens
- `GPT-5.4 Nano`: 9 requests / 4.45K tokens
- Total tokens: 758K
- Spend: $0.129

前端当前截图中显示某个用户的 `2026-05-16` 日报为 28 篇文章，因此第一眼看起来像是“28 篇触发了 239 次 AI 调用”。

### 数据库核对结论

通过生产库只读查询确认：截图中的 28 篇日报不是 239 次请求的唯一来源。

`digests.date = 2026-05-16` 当天共有：

- 成功 daily digest: 5 份
- digest item rows: 208
- 去重文章: 170
- 可摘要文章: 170
- digest jobs: 5 个 `succeeded`，3 个 `skipped`
- 所有 job 的 `attempt_count` 都是 1，没有看到 job 级重试风暴

按来源拆分：

| source_type | item rows | unique articles | cached articles | notes |
|---|---:|---:|---:|---|
| rss | 169 | 144 | 19 zh cached | 当天主要请求来源 |
| substack | 35 | 22 | 22 zh cached | 缓存正常 |
| podcast | 2 | 2 | 0 zh cached | 数量很小 |
| youtube | 2 | 2 | 1 zh cached | 数量很小 |

截图中那份 28 篇日报：

- digest id: `ypvNKtlichL_xX5nK6h5m`
- generated_at: `2026-05-17T01:08:49.342Z`
- items: 28
- distinct articles: 28
- summarizable articles: 28
- `summary_zh` present: 28
- AI fallback items: 0

因此这份 28 篇日报本身表现正常，组装阶段应主要读缓存。

### 1 Day 窗口解释

OpenRouter 的 1 Day 是账号全局统计窗口，不是单个 digest。

按 `generated_at` 近 24 小时窗口看：

- digest count: 6
- item rows: 253
- unique articles: 214
- unique `summary_zh` cached articles: 86
- unique `summary_en` cached articles: 126
- fallback item rows: 2

这和 OpenRouter 的 `gpt-oss-120b` 239 requests 基本可解释：

```
214 unique articles needing summary
  + schema validation retries
  + OpenRouter 1 Day 窗口边界差异
  + 少量手动触发/其他请求
≈ 239 model requests
```

其中最大贡献来自另一份 128 篇的 `2026-05-16` digest：

- digest id: `AUZocuP478T75SJaaNhK-`
- generated_at: `2026-05-16T22:55:00.752Z`
- items: 128
- `summary_en` present: 126
- fallback items: 2
- average content chars: 16443.6
- max content chars: 60810

### 当前判断

这次测试日的 OpenRouter 数据属于合理范围，不像重复触发失控：

- 请求数和 24 小时窗口内的去重文章数接近。
- job 没有反复失败重试。
- 28 篇截图日报本身缓存完整。
- 128 篇大 digest 会自然拉高 1 Day 全局 requests。
- 当前更像“测试日多用户、多 digest、导入和 scheduled job 混合”的正常消耗。

### 2026-05-18 测试重点

明天重点验证稳态，而不是只看 OpenRouter 总数。

#### 1. OpenRouter Activity

记录 1 Day 窗口：

- Requests
- Tokens
- Spend
- 按模型拆分的 requests/tokens

预期：

- 如果没有大批量导入或手动重算，requests 应接近当天新增的 `article + language` 唯一摘要数。
- 如果用户之间文章重叠，缓存命中后 requests 应明显低于 digest item rows。
- Tokens 应继续明显低于 2026-05-14 的 1.31M 基线。

#### 2. 数据库对账

对 `target_date = 2026-05-17` 查询：

- daily digest 数量
- digest item rows
- 去重文章数
- `summary_zh` / `summary_en` 缓存数量
- fallback item 数量
- `digest_jobs` 各状态和 `attempt_count`

预期：

- `succeeded` job 数量应等于实际需要生成日报的用户数。
- `skipped` 只应来自没有可用内容的用户。
- `attempt_count` 应大多为 1。
- fallback item 数量应接近 0。

#### 3. Scheduler 日志

重点看：

```text
[presummarize] Complete ... articlesToProcess=... modelRequests=... retryRequests=... dedupedWaits=... cacheHitsAfterWait=...
[digest] Daily digest updated ... summaryCacheHits=... summaryCacheMisses=... aiRequests=... retryRequests=...
```

预期：

- `digest` 阶段的 `summaryCacheMisses` 和 `aiRequests` 应接近 0。
- `modelRequests - articlesToProcess` 应主要由 `retryRequests` 解释。
- 如果多个用户并发共享文章，`dedupedWaits` 或 `cacheHitsAfterWait` 应能解释省下来的重复请求。

#### 4. 异常触发条件

如果出现以下情况，需要继续排查：

- OpenRouter requests 明显大于 `unique articles + retryRequests`。
- 同一 `user + targetDate` 出现多次 `executeDailyDigestJob`。
- `digest` 阶段仍有大量 `summaryCacheMisses`。
- `attempt_count > 1` 的 job 增多。
- fallback item 明显增多。

下一步若仍异常，再考虑数据库级 `article + language` 摘要锁，覆盖 web 与 scheduler 跨进程并发。

---

## 2026-05-17: 中文摘要输出长度与版式约束对齐

### 现象

生产库中 `Institutional Adoption Report Q1 2026` 的中文摘要出现残句：

- `digest_items.one_liner` 与 `articles.summary_zh.oneLiner` 完全一致
- 两者长度均为 70
- 第一条 `keyInsights` 也长度为 70，并停在不完整表达

这说明问题不是前端或 API 读取截断，而是模型生成了长度合规但语义未闭合的摘要，随后被缓存并快照化。

### 判断

此前 prompt 写的是中文 `oneLiner` 不超过 30 字、`keyInsights` 每条不超过 45 个汉字，但 schema 实际允许：

- `oneLinerChars = 70`
- `keyInsightChars = 70`

在 structured output 下，模型更容易贴近 schema 最大值输出；长度校验只能保证字段不超过上限，不能保证句子完整。

### 决策

根据全屏 digest 卡片版式估算：

- 一句话总结区域每行约 46 个中文字符，两行约 90-95 个字符
- 关键洞察每行约 55-65 个中文字符，两行约 110-130 个字符

为了避免字段贴近视觉极限并减少数字堆砌，生成硬约束统一为：

- 中文 `oneLiner`: 60 个字符（含数字和标点）
- 中文 `keyInsight`: 76 个字符（含数字和标点）

同步修改 prompt，要求 `oneLiner` 只表达一个核心结论，数字、比例、金额、日期等细节优先放入 `keyInsights`。

### 后续

已有坏数据仍存在于 `articles.summary_zh` 和 `digest_items` 快照中；需要清理缓存或 force regenerate 才会反映新规则。
