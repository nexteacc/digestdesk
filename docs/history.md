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

### 追加决策：默认 OSS，校验失败重试 Qwen

生产默认模型继续使用 OpenRouter 上的 `openai/gpt-oss-120b` 控制成本。`summarizer.ts` 增加 `AI_RETRY_MODEL`：

- 第一次尝试使用 `AI_MODEL`
- 只有结构化输出、长度、质量校验类错误才进入第二次尝试
- 第二次尝试使用 `AI_RETRY_MODEL`
- 未配置 `AI_RETRY_MODEL` 且 `AI_BASE_URL` 是 OpenRouter 时，默认重试模型为 `qwen/qwen3.5-flash-02-23`

明天观察重点：

- `[summarizer] Starting AI summary ... model=... retryModel=...`
- `[summarizer] AI summary complete attempt=2 model=qwen/qwen3.5-flash-02-23`
- `retryRequests` 是否集中在少数文章
- Qwen 是否能救回 OSS 的 schema/长度/质量失败
- `summaryFallbacks` 是否仍接近 0

### 2026-05-18 摘要成本与质量复盘

#### Summary

本次复盘验证昨天摘要链路优化后的两个结果：

1. 成本线：OpenRouter requests / tokens / spend 是否从 2026-05-14 的异常高位回落。
2. 质量线：中文 `oneLiner` 和 `keyInsights` 是否仍出现长度合规但语义未闭合的残句。

#### Impact

成本影响明显改善：

- requests 从早期约 520 降到 125，下降约 76%
- tokens 从早期约 1.31M 降到 522K，下降约 60%
- 1 Day spend 为 `$0.095`

质量影响仍存在：

- 部分中文摘要进入 `articles.summary_zh` 和 `digest_items` 后仍是残句
- 这些摘要会被缓存和日报快照复用，代码修复不会自动修正旧数据

#### Detection & Evidence

模型供应商 1 Day 窗口截图：

- Spend: `$0.095`
- Requests: `125`
- Tokens: `522K`
- Model: `gpt-oss-120b`

生产库按 Asia/Ho_Chi_Minh 今日窗口查询：

- digest count: 5
- digest item rows: 137
- unique articles: 104
- succeeded jobs: 5
- skipped jobs: 3
- failed jobs: 0
- fallback items: 6

质量复查，对 `digests.date = 2026-05-17`：

- 中文 item 共 72 条
- `one_liner` 正好 60 字符：21 条
- 其中 19 条不是闭合标点结尾，存在明显残句
- `keyInsights` 共 216 条
- key insight 正好 76 字符：46 条
- 其中 43 条不是闭合标点结尾

#### Timeline

- 2026-05-17: 对齐中文摘要 prompt/schema 到 60/76，并加入 OSS 失败后 Qwen retry
- 2026-05-18: scheduler 生成 `digests.date = 2026-05-17` 的日报
- 2026-05-18: 数据库复查确认成本下降，但 60/76 边界残句仍存在

#### Root Cause & Contributing Factors

质量问题仍存在：

- schema 的字段 `max` 让模型贴着 structured output 的 `maxLength` 边界生成
- 模型在边界处停止，导致“长度合规但语义未闭合”的摘要入库
- Qwen fallback 没有触发，因为这些输出通过了 schema 长度校验

促成因素：

- prompt 目标长度与 schema 硬边界混用
- 当前校验只能识别长度、空值和明显低质量文本，不能可靠判断中文句子是否自然闭合
- 摘要缓存和 digest 快照会放大坏输出

#### Mitigation / Changes

已完成或正在提交的修复方向：

- prompt 使用简洁任务型写法，不再列语法黑名单
- 中文 `oneLiner` 目标范围改为 35-70 个中文字符
- 中文 `keyInsights` 目标范围改为 55-90 个中文字符
- 英文 `oneLiner` 目标范围改为 14-30 words，英文 `keyInsights` 目标范围改为 18-40 words
- schema 取消字段 `max`，只保留结构和最小长度
- 后处理保留宽松异常上限：中文 `oneLiner > 90`、`keyInsight > 130` 才判失败

#### Follow-up Actions

| Action | Owner | Status | Notes |
|---|---|---|---|
| 观察新 prompt + no schema max 后的中文残句率 | AI agent | Pending | 看 `one_liner` 是否仍大量贴近 90 或出现残句 |
| 观察 token / requests 是否保持低位 | AI agent | Pending | 供应商 1 Day 窗口 + 数据库 unique articles 交叉验证 |
| 评估是否需要清理旧 `summary_zh/en` 缓存 | AI agent + user | Pending | 只在旧坏摘要继续影响页面时处理 |
| 评估是否需要摘要 meta/version | AI agent + user | Deferred | 只有持续排查困难时再加，避免过度工程化 |

#### Next Review

- 新生成摘要是否还出现大量“正好等于异常上限”的文本
- `oneLiner` 是否仍出现明显残句
- `keyInsights` 是否仍出现半句或隐藏字符
- `retryRequests` 与 `summaryFallbacks` 是否保持合理
- OpenRouter requests 是否继续接近当天 `unique article + language` 摘要数

#### Review Template

后续每日摘要链路复盘按 SRE / incident review 的长期实践结构记录：

1. Summary：本次复盘验证什么，结论是什么。
2. Impact：对用户、成本、质量、稳定性的影响。
3. Detection & Evidence：供应商指标、数据库、日志、截图等事实证据。
4. Timeline：关键事件和变更顺序。
5. Root Cause & Contributing Factors：根因和促成因素。
6. Mitigation / Changes：已经采取的缓解和修复。
7. Follow-up Actions：行动项、owner、状态、备注。
8. Next Review：下一轮要看的指标和触发条件。

---

## 2026-05-19: OpenRouter structured-output adapter for retry summaries

### Summary

2026-05-18 日报出现 16 条摘要 fallback。Zeabur scheduler 日志确认调度和 `digest_jobs` 正常，失败集中在摘要生成：主模型输出未过 schema/质量校验后，retry 模型 `qwen/qwen3.5-flash-02-23` 经 OpenRouter/Alibaba 返回 `messages must contain the word 'json'`，导致 retry 没有真正兜住。

### Evidence

- `digest_jobs` 对 `target_date = 2026-05-18`：5 succeeded、4 skipped、0 failed，所有 `attempt_count = 1`。
- `digests.date = 2026-05-18`：5 份 daily digest、154 条 items、122 篇 unique articles、16 条 fallback/empty insights。
- scheduler 日志显示 fallback 前一跳常见错误：
  - 主模型：`too_long_oneLiner`、`No object generated: response did not match schema`
  - retry 模型：OpenRouter/Alibaba `response_format` JSON 协议错误

### Root Cause

模型路由只区分了 primary/retry model id，没有显式建模 OpenRouter structured-output 协议：

- Qwen/Alibaba 在 `response_format=json_object/json_schema` 路径下要求 messages 显式包含 `json`。
- `openai/gpt-oss-120b` 有多个 OpenRouter provider endpoint，不是每个 endpoint 都支持 `response_format` / `structured_outputs`。
- retry prompt 复用编辑型摘要思路，不是 Qwen 专用 strict JSON prompt。

### Mitigation / Changes

- `summarizer.ts` 新增 `MODEL_ADAPTERS`，把模型任务 prompt profile 与模型 ID 绑定：
  - `openai/gpt-oss-120b` -> `editorial`
  - `qwen/qwen3.5-flash-02-23` -> `strict-json`
- OpenRouter provider adapter 统一注入 `provider.require_parameters = true`，避免路由到不支持结构化参数的 provider。
- 所有 structured-output 摘要调用统一追加协议层 prompt：只返回匹配 schema 的 valid JSON，不输出 markdown 或 JSON 外文本。
- Qwen retry 使用独立 strict JSON prompt，明确对象形状和字段约束，不再依赖 primary prompt 的编辑型表达。
- 新增 `pnpm --filter substack-digest-server smoke:structured-output`，强制 primary 失败后验证 Qwen retry 能返回合法 structured output。

### Verification

- OpenRouter raw API smoke：
  - `openai/gpt-oss-120b` + `json_schema strict` + `provider.require_parameters=true` 成功。
  - `qwen/qwen3.5-flash-02-23` + `json_schema strict` + `provider.require_parameters=true` + JSON protocol prompt 成功。
- SDK smoke：
  - Qwen 不含 `json` protocol prompt 时复现生产错误。
  - Qwen strict JSON prompt 通过 `generateObject`。
  - 强制 primary failure 后 retry 到 Qwen 成功。
- 本地验证：
  - `pnpm --filter substack-digest-server build`
  - `pnpm lint`
- 决策：部署后不把手动运行 `smoke:structured-output` 作为用户侧必做步骤；该命令保留给 agent/运维排查使用。生产验收以次日 scheduler 日志和数据库对账为准。

### Discussion Record

本次讨论确认：

- 问题定位已经清楚：日报任务本身正常，失败发生在摘要 retry structured-output 路径。
- 主模型偶发 schema/质量失败属于可接受的正常波动，retry 接管是合理设计。
- 真正缺口是 retry 模型 Qwen/Alibaba 与 OpenRouter structured-output 协议未对齐，导致兜底没有生效。
- 修复不能只改 prompt 文案；需要把模型差异、OpenRouter provider routing、JSON 协议要求分层建模。
- `MODEL_ADAPTERS` 用于表达模型能力差异：primary 走编辑型 prompt，retry 走 strict JSON prompt。
- `provider.require_parameters=true` 用于约束 OpenRouter 不把 structured-output 请求路由到不支持参数的 endpoint。
- 明天重点不是看 `retryRequests` 是否为 0；retry 存在是正常的。重点看 retry 后是否还 fallback，以及是否还出现 JSON protocol error。

### Next Review

- 2026-05-20 看 `scheduler` 的 `[digest] Daily digest updated`：`summaryFallbacks` 应下降，`retryRequests` 不应再对应 OpenRouter/Alibaba JSON protocol 错误。
- 若仍有 fallback，按错误类别拆分为 schema/quality、provider invalid_request、rate limit、network，而不是只看总 fallback 数。
- 数据库对账 `digests.date = 2026-05-19`：
  - daily digest 数
  - digest item rows
  - unique articles
  - fallback/empty insights items
  - `digest_jobs` succeeded/skipped/failed/attempt_count
- 日志检查：
  - 不应再出现 `messages must contain the word 'json'`
  - `summaryFallbacks` / `fallbackCount` 应低于 2026-05-18 的 16 条
  - `retryRequests` 可以存在，但应能产出 `summaryGenerated` 或 cache，而不是集中转成 fallback

---

## 2026-05-20: Production log review for 2026-05-19 digest run

### Summary

按 2026-05-19 的 Next Review 对 Zeabur `scheduler` runtime logs 和生产库做复盘。`target_date = 2026-05-19` 的日报运行正常：调度、执行、摘要 retry 兜底和 digest 落库均符合预期。2026-05-19 修复的 OpenRouter/Qwen structured-output JSON 协议问题未再复现。

### Impact

- 用户侧：5 份 daily digest 正常生成；4 个无内容任务被正确跳过。
- 稳定性：无 `pending` / `running` / `failed` 积压。
- 摘要质量：0 条 fallback，0 条 empty insights。
- 成本：多数 digest assembly 命中摘要缓存；仅少量新增文章触发 AI 摘要。

### Detection & Evidence

生产库对账 `target_date = 2026-05-19`：

- `digest_jobs`：5 succeeded、4 skipped、0 failed，所有 `attempt_count = 1`。
- `digests.date = 2026-05-19`：5 份 daily digest。
- `digest_items`：195 条 items、154 篇 unique articles。
- fallback/empty insights：0 / 0。
- 当前 backlog：无 pending、running、failed。

scheduler 日志要点：

- 成功 digest 的 `[digest] Daily digest updated` 均为 `summaryFallbacks=0`、`fallbackCount=0`、`emptyInsightsCount=0`。
- 未见 `messages must contain the word 'json'`。
- 有 2 次 primary `openai/gpt-oss-120b` 因 `too_long_oneLiner` 触发 retry；retry 到 `qwen/qwen3.5-flash-02-23` 后成功产出摘要，没有转成 fallback。
- 一轮 Slashdot 用户新增 11 篇文章，`presummarize` 11/11 成功，`retryRequests=0`。

### Timeline

- 2026-05-19T22:05Z：Asia/Bangkok 05:00 用户开始执行 `targetDate=2026-05-19`。
- 2026-05-19T22:22Z：该用户生成 69 条 items；3 条 cache miss 在 digest assembly 中补摘要，2 次 retry 成功，0 fallback。
- 2026-05-20T00:00Z：Asia/Shanghai 08:00 批次 dispatch 创建 6 个 `targetDate=2026-05-19` jobs。
- 2026-05-20T00:00Z：Slashdot 用户生成 12 条 items；新增 11 篇预摘要全部成功。
- 2026-05-20T00:05Z：runner 处理 5 个 job，1 succeeded、4 skipped empty digest。
- 2026-05-20T01:08Z：Asia/Bangkok 08:00 两个用户完成，runner 汇总 `claimed=2 succeeded=2 skipped=0 failed=0`。

### Root Cause & Contributing Factors

本次没有生产事故。前一日的 retry structured-output 协议问题已被模型 adapter、strict JSON prompt 和 `provider.require_parameters=true` 缓解。

仍观察到两个正常波动/噪音：

- `openai/gpt-oss-120b` 仍可能生成过长 `oneLiner`，但 Qwen retry 已能兜住。
- 一个 YouTube feed fallback 返回 404，表现为 feed sync 噪音；对应 digest 仍成功，未影响日报生成。

### Mitigation / Changes

本次未做代码改动。结论是继续保留现有摘要 retry adapter 和 scheduler 架构。

### Follow-up Actions

| Action | Owner | Status | Notes |
|---|---|---|---|
| 继续观察 retry 后 fallback 是否为 0 | AI agent | Pending | 重点不是 retryRequests 是否为 0，而是 retry 是否成功兜底 |
| 观察 YouTube feed 404 是否反复出现 | AI agent | Pending | 若同一 feed 连续失败，再判断是否需要修正 feed URL 或频道解析 |
| 观察 primary `too_long_oneLiner` 频率 | AI agent | Pending | 若频率升高，再调 prompt 或后处理阈值 |

### Next Review

- 继续看 `target_date = 2026-05-20` 的 `digest_jobs` succeeded/skipped/failed 分布。
- 对账 fallback/empty insights 是否保持 0。
- 若出现 fallback，按 schema/quality、provider invalid_request、rate limit、network 分类，而不是只看总数。
- 留意是否再次出现 OpenRouter/Alibaba JSON protocol error。

---

## 2026-05-22: Production log review for 2026-05-21 English summary length drift

### Summary

按 2026-05-20 的 Next Review 检查 Zeabur `scheduler` runtime logs，并用用户提供的 OpenRouter Activity 1 Day 截图对账 `target_date = 2026-05-21` 的日报运行。调度和 job 执行总体正常，OpenRouter 214 requests 的量级可由多批用户预摘要、少量 digest assembly 补摘要和 retry 解释；本轮异常集中在一个英文摘要批次，`too_long_oneLiner` 在 primary 与 Qwen retry 后仍有残留，最终出现 2 条 digest fallback。

### Impact

- 稳定性：今天可见的 scheduler 批次均完成，后续 runner candidate scans 回到 0，未见 job 级失败风暴或 due-job 积压。
- 成本：OpenRouter 1 Day 显示 214 requests、822K tokens、`$0.131`；其中 `gpt-oss-120b` 176 requests、Qwen3.5-Flash 38 requests，retry 占比值得继续观察。
- 摘要质量：05:00 Asia/Bangkok 英文批次预摘要先失败 5 篇，digest assembly 补摘要后仍有 2 篇 fallback。
- 用户侧：成功 digest 仍生成，但英文批次的 fallback 会显示 `Summary unavailable for now.`。

### Detection & Evidence

OpenRouter 1 Day 截图：

- Spend: `$0.131`
- Requests: `214`
- Tokens: `822K`
- `gpt-oss-120b`: 176 requests、590K tokens、`$0.09`
- `Qwen3.5-Flash`: 38 requests、232K tokens、`$0.04`

scheduler 日志对账：

- 2026-05-21T22:00Z 的 Asia/Bangkok 05:00 英文 job 被创建，最终 succeeded。
- 该英文 job 的 `[presummarize] Complete`：
  - `articlesToProcess=67`
  - `modelRequests=89`
  - `retryRequests=22`
  - `succeeded=62`
  - `failed=5`
- 该英文 digest 的 `[digest] Daily digest updated`：
  - `items=67`
  - `summaryCacheHits=62`
  - `summaryCacheMisses=5`
  - `modelRequests=9`
  - `retryRequests=4`
  - `summaryGenerated=3`
  - `summaryFallbacks=2`
  - `fallbackCount=2`
  - `emptyInsightsCount=2`
- 失败样本集中在英文 `too_long_oneLiner`，包括 `presummarize` 失败后由 digest assembly 再补跑仍 fallback 的文章。
- 未见先前的 OpenRouter/Alibaba `messages must contain the word 'json'` 协议错误；Qwen retry 仍有多条 `attempt=2` 成功日志。
- 2026-05-22T00:09Z 的 Asia/Shanghai 批次 runner 汇总为 `claimed=5 succeeded=1 skipped=4 failed=0`；成功 digest 32 个 items，digest assembly 阶段 `modelRequests=0`、`summaryFallbacks=0`。
- 2026-05-22T01:11Z 的 Asia/Bangkok 08:00 批次 runner 汇总为 `claimed=2 succeeded=2 skipped=0 failed=0`；其中一份 digest 52 个 items 且全部 cache hit，另一份 digest 有 1 条 YouTube `content_too_short` empty insight，但无 fallback。

### Timeline

- 2026-05-21T22:00Z：scheduler dispatch 创建 Asia/Bangkok 05:00 英文 `targetDate=2026-05-21` job。
- 2026-05-21T22:26Z：英文预摘要结束，67 篇文章产生 89 次模型请求和 22 次 retry，5 篇因 `too_long_oneLiner` 失败。
- 2026-05-21T22:28Z：英文 digest assembly 对 5 个 cache miss 补摘要，最终 3 篇生成摘要、2 篇 fallback，job succeeded。
- 2026-05-22T00:09Z：Asia/Shanghai 08:00 批次处理完成，1 个 digest succeeded、4 个 empty digest skipped。
- 2026-05-22T01:09Z 至 01:11Z：Asia/Bangkok 08:00 两个 digest 完成，runner 汇总 2 succeeded。
- 2026-05-22T03:15Z 至 03:40Z：dispatch 继续看到已有 jobs，runner candidate scans 为 0。

### Root Cause & Contributing Factors

根因是英文摘要长度契约漂移：

- 英文 prompt 的目标长度已经按 words 表达：`oneLiner` 目标 `14-30 words`。
- `summarizer.ts` 后处理仍按旧字符上限拒绝英文 `oneLiner > 160 chars`。
- 正常的 25-30 word 英文完整句子在包含人名、公司名、金额或长术语时可超过 160 chars，因此会满足 prompt 目标却被 validator 判成 `too_long_oneLiner`。
- retry 仍经过同一 post-validation，所以 primary 与 Qwen retry 都可能被旧字符上限误杀。

促成因素：

- 前序复盘已经要求关注 prompt/schema/post-validation 边界，但本次才发现英文 prompt 单位切到 words 后，validator 的旧字符约束仍残留。
- 原日志只暴露 `too_long_oneLiner`，没有记录失败输出的 chars、words、limit 和 limit unit，导致先看到的是模型 retry/fallback 现象，而不是程序验收口径冲突。

### Mitigation / Changes

本轮本地改动：

- 英文 post-validation 改为按 word 异常上限拦截：
  - `oneLiner > 45 words`
  - `keyInsight > 60 words`
- 英文 retry prompt 与 Qwen strict JSON prompt 明确重申 word 目标：
  - `oneLiner` 目标 `14-30 words`
  - `keyInsights` 每条目标 `18-40 words`
- 摘要校验失败日志增加最小诊断元数据：`field`、`language`、`chars`、`words`、`limit`、`limitUnit`。
- 数值事实 spot check 后，摘要 prompt 增加金额/数量级/指标类型准确性约束；中文 prompt 收成短任务规格，并给出 `$124m -> 1.24 亿美元` 的换算例子。
- `AGENTS.md` 增加 behavior-changing fixes 与 AI output changes 的 change-safety 规则，要求把 `docs/history.md` 中的相关事故当作本次变更风险来验证。

### Verification

- 本地构建与 lint：
  - `pnpm --filter substack-digest-server build`
  - `pnpm lint`
- 本地 validator 定向检查：
  - 29 words / 190 chars 的英文 `oneLiner` 现在可通过。
  - 54 words / 427 chars 的英文 `oneLiner` 仍会被异常上限拒绝。

### Follow-up Actions

| Action | Owner | Status | Notes |
|---|---|---|---|
| 部署英文 word-based validator 和诊断日志 | AI agent + user | Pending | 部署前今天的生产日志仍反映旧 160-char 校验 |
| 复查下一轮英文摘要 fallback | AI agent | Pending | 重点看 `summaryFallbacks` 是否从本轮英文批次的 2 条回落 |
| 复查 `validation` 元数据 | AI agent | Pending | 若仍有 `too_long_oneLiner`，确认是否实际超过 45 words，而不是字符误判 |
| 继续看 retry 成功率 | AI agent | Pending | retry 可以存在，但应产出 summary/cache，不应集中转成 fallback |
| spot check 新生成的数值密集摘要 | AI agent | Pending | prompt 约束只影响新生成摘要；已缓存摘要和 digest 快照不会因 prompt 改动自动修正 |

### Next Review

- 部署后检查下一轮 scheduler runtime logs；重点看英文批次的 `[presummarize] Complete`、`[digest] Daily digest updated`、`[summarizer] AI summary failed`。
- 若仍有英文 `too_long_oneLiner`，按新日志里的 `words`、`limit`、`limitUnit` 判断是真过长，还是转成其他 schema/quality 失败。
- 对账 OpenRouter 1 Day 的 requests/tokens/spend 与 `modelRequests`、`retryRequests`，确认 retry 下降来自误判减少，而不是摘要漏生成。
- 抽查新生成的金额/百分比/数量摘要；若旧错误摘要仍在页面可见，再决定是否定向重生成对应缓存和 digest 快照。
- 继续确认未复现 OpenRouter/Alibaba JSON protocol error。
- 单独观察 YouTube `content_too_short` 是否只是无 transcript 噪音；不要把它和英文 validator fallback 混为同一问题。

---

## 2026-05-23: Admin access, duplicate Clerk users, and production data cleanup

### Summary

复查 2026-05-22 日报运行、OpenRouter Activity、Admin 页面统计和生产数据库后，确认日报生成质量正常，但 Admin 统计里存在历史测试/生产环境混写导致的重复用户记录。重复记录使用相同 email、不同 Clerk `user_id`，旧记录仍保留 active subscriptions，因此 scheduler 按 `users.id` 扫描时继续为旧用户生成日报。

第一步没有代码改动；先执行了一次生产数据库清理，删除两条旧用户记录及其关联 subscriptions、digest jobs、digests 和 digest items。随后补充了最小代码修复，让 Admin 停用状态进入普通 API 和 scheduler 的执行路径。

### Detection & Evidence

OpenRouter 1 Day 截图对账：

- Spend: `$0.148`
- Requests: `187`
- Tokens: `820K`
- `gpt-oss-120b`: 163 requests、587K tokens、约 `$0.10`
- `Qwen3.5-Flash`: 24 requests、232K tokens、约 `$0.05`

日志与数据库对账：

- `targetDate=2026-05-22` 的 `digest_jobs`：5 succeeded、4 skipped、0 failed。
- 当前 backlog：无 pending、running、failed。
- 5 份 digest，共 196 个展示 items、154 篇去重文章。
- 预摘要层实际摘要约 169 篇文章，`modelRequests=187`、`retryRequests=24`。
- `summaryFallbacks=0`、`emptyInsights=0`。

Admin 页面相关发现：

- 生产域名为 `https://digestdesk.nextbigtoy.com`。
- 前端使用 `wouter/use-hash-location`，实际 Admin URL 是 `https://digestdesk.nextbigtoy.com/#/admin`，不是裸 `/admin`。
- `ADMIN_EMAILS` 已在 Zeabur `digestdesk` web 服务生效，运行进程可读到 1 个 admin email。
- admin 权限由 `/api/admin/*` 后端按 `ADMIN_EMAILS` 校验；未配置或不匹配时，登录后应显示 `Admin email required`。

重复用户发现：

- `nexteacc@gmail.com` 有两条 `users` 记录，email 相同、Clerk id 不同：
  - 旧：`u7eySPJXwLxEqomFqDBgj`，last login `2026-03-26T05:04:31.887Z`
  - 新：`XH6oa2l-Y0cfFgIBT9ISD`，last login `2026-05-23T15:06:35.732Z`
- `pablopixes@gmail.com` 有两条 `users` 记录，email 相同、Clerk id 不同：
  - 旧：`UFYcMeKg9vTp5Xbt3k_zo`，last login `2026-03-26T03:11:03.299Z`
  - 新：`-QKtPrjaAAowJw4HC8vUa`，last login `2026-05-23T15:08:44.187Z`

旧记录仍影响调度：

- `UFYcMeKg9vTp5Xbt3k_zo` 仍有 1 个 active Slashdot subscription，尽管新 Pablo 账号已在主站取消订阅。
- `u7eySPJXwLxEqomFqDBgj` 仍有 111 个 active subscriptions。
- `dispatchDigestJobs()` 当前按 `users.id` 扫描所有用户，而不是按 email 去重，因此旧记录会继续生成日报。

### Root Cause & Contributing Factors

根因是历史环境隔离不足：

- 测试环境和生产环境曾连接同一个 Postgres。
- 同一 email 在不同 Clerk app/key 或重建后的 Clerk 用户中会得到不同 Clerk `user_id`。
- 应用登录逻辑按 `clerk_id` 查找用户；数据库约束是 `clerk_id unique`，email 不是 unique。
- 因此同一 email 可以生成多条 `users` 记录。

设计上继续按 Clerk `user_id` 做身份主键是正确的。email 适合做重复数据治理和 admin 告警，不适合替代 Clerk id 成为运行时身份主键。

### Mitigation / Changes

第一步直接在生产数据库执行事务清理，无代码变更、无需部署：

删除旧用户：

- `u7eySPJXwLxEqomFqDBgj`
- `UFYcMeKg9vTp5Xbt3k_zo`

同步删除关联数据：

- `digest_items`: 2855
- `digests`: 121
- `digest_jobs`: 124
- `subscriptions`: 112
- `user_settings`: 3
- `users`: 2

清理后生产统计：

- 用户：7
- active subscriptions：211
- 用户累计日报：162
- 重复 email：0
- pending/running/failed digest jobs：0
- Pablo 旧记录 active subscription：0

后续补充了一次最小代码修复，目标是让 Admin 停用状态真正进入用户旅程和 scheduler 闭环，但不引入复杂 RBAC 或用户合并系统：

- 普通 API 的 `resolveUser` 会拒绝 `access_status=revoked` 的非 admin 用户。
- `/api/auth/me` 里的 invite claim 不再把已停用的非 admin 用户自动恢复为 active。
- `dispatchDigestJobs()` 不再为 revoked 用户创建新的日报 job。
- `runPendingDigestJobs()` 在执行日报前再次检查 revoked 状态；若用户已停用，将 job 标记为 skipped，不调用 `executeDailyDigestJob`。
- Admin 用户管理默认只展示 active 用户，提供 active/revoked/all 过滤；顶部订阅数、接近上限、日报数改为只按 active 用户统计。
- Admin UI 后续进一步收敛：主界面移除“预授权邮箱/邀请”操作和列表，避免把未形成真实邀请闭环的技术能力暴露给日常 Admin；后端 invite 接口暂时保留但不作为主流程入口。
- Admin UI 去掉重复的 plan 标签列，额度方案文案改为“基础/内测/不限额”，明确这些方案只控制订阅源数量上限，不代表后台管理员权限。
- 停用用户增加确认弹窗，说明会停止 API 使用和日报生成，但保留历史数据。
- Admin 页面新增轻量 Tab：`用户与额度` / `运行状态`。运行状态第一版不抓平台 runtime logs，而是通过 `/api/admin/operations/summary?days=7` 聚合 `digest_jobs`、`digests`、`digest_items`，展示昨日任务/日报/条目数量、最近 7 天逐日运行列表，以及 failed、到点未完成 pending/running 任务。

### Decisions

- 运行时身份和调度继续使用 Clerk `user_id` / 本地 `users.id`，不改成按 email 去重。
- 短期通过生产数据清理解决旧用户重复推送。
- 中期不做重型“用户合并系统”；如需要，只在 Admin 页面增加轻量重复 email 检测和告警。
- 长期要隔离测试/生产数据库和 Clerk app/key，避免测试登录再次污染生产 `users` 表。

### Follow-up Actions

| Action | Owner | Status | Notes |
|---|---|---|---|
| 明天复查 scheduler 是否不再为旧 Pablo/nexteacc 生成 job | AI agent | Pending | 看 `digest_jobs` 是否只剩 7 个用户扫描 |
| 复查 Admin 页面统计 | User / AI agent | Pending | 预期用户 7、订阅 211、日报 162 |
| 核对测试环境和生产环境的 Postgres 是否仍共用 | User / AI agent | Pending | 不输出密钥，只比对连接目标/服务 |
| 考虑 Admin 增加重复 email 提示 | AI agent | Optional | 轻量查询即可，不进入 scheduler 主路径 |

### Next Review

- 检查 2026-05-23/2026-05-24 的 scheduler runtime logs，确认 scanned users 从 9 降为 7。
- 确认 `pablopixes@gmail.com` 不再收到 Slashdot 旧记录日报。
- 若重复 email 再出现，优先排查测试环境是否仍连接生产数据库，而不是修改 scheduler 按 email 去重。

## 2026-05-26: 2026-05-24 Slashdot summary quality incident

### Summary

复查 `target_date=2026-05-24` 的日报质量时，发现一篇 Slashdot 文章的中文摘要入库为结构完整但语义损坏的结果：`oneLiner` 只有 `Google`，第三条 `keyInsights` 含隐藏字符/乱码残片。该问题不是前端展示、日报组装或抓取为空导致，而是 AI 摘要阶段偶发坏输出后，被过松的硬校验误判为成功并写入 `articles.summary_zh` 缓存。

### Detection & Evidence

异常文章：

- Title: `Friday Google's AI-Powered Search Results Glitched on the Word 'Disregard'`
- Source: Slashdot RSS
- Article id: `PvwgqpsGQh9B52XDczmiQ`
- `content_text` length: 1891
- `inputLength=1891`、`sentLength=1891`、`maxInputChars=12000`

排查结论：

- 数据库正文包含 TechCrunch 报道、Google AI Overview 对 `disregard` 返回 `Understood...`、页面空白、新 Search 体验和 Google 后续修复等核心事实。
- 送入模型前没有裁剪；同一段 `content_text` 重新调用当前模型可生成正常摘要。
- 当时日志显示 `[summarizer] AI summary complete attempt=1 ... One-liner: Google...`，因此系统没有触发 retry。
- 后续 `generateDaily` 阶段全部命中缓存：`summaryCacheHits=26`、`summaryGenerated=0`、`aiRequests=0`，说明坏结果在 `presummarizeForUser()` 写入缓存后被日报快照复用。

### Root Cause & Contributing Factors

根因分两层：

- 模型层：`openai/gpt-oss-120b` 对这篇输入偶发输出坏摘要。返回对象结构完整，但 `oneLiner` 是单词残片，部分洞察含隐藏字符。
- 系统防线层：prompt 已要求中文 `oneLiner` 目标 `35-70` 字符，但 schema 和 `normalizeSummary()` 仍只要求 `oneLiner >= 6` 字符；`Google` 刚好满足硬校验，因此未进入 retry。

这不是抓取链路问题，也不是调度抢占问题。任务抢占只负责将 `digest_jobs` 标记为 `running`，文章级去重只负责避免同一进程内重复摘要；二者不是坏摘要的直接原因。

### Mitigation / Changes

本次做最小代码修复，不重定义产品规则、不更换模型、不改摘要链路：

- 中文 `oneLiner` 硬下限从 `6` 个字符对齐到现有 prompt 下限 `35` 个可见字符。
- 英文 `oneLiner` 增加现有 prompt 下限，少于 `14 words` 判失败。
- schema 和最终 validator 使用同一组下限，确保短残片在结构化输出阶段或最终入库前被拦截。
- 可见字符口径：中文、英文、数字、标点都计数；空格、换行、tab 不计数。
- 控制字符和零宽字符直接判为低质量，防止隐藏字符/乱码洞察入库。
- `keyInsights` 下限暂不强行改为 prompt 目标 `55` 字符。最近两天真实数据扫描显示，若硬改会让不少可读短洞察失效，超出本次 `oneLiner=Google` incident 的修复范围。

修复后预期行为：

```
模型返回 oneLiner = "Google"
  -> too_short_oneLiner
  -> 触发 retry model
  -> retry 成功才写 articles.summary_zh
  -> retry 失败走 fallback，不写坏缓存
```

### Verification

本地验证：

- `parseCachedArticleSummary({ oneLiner: "Google", ... }, "zh")` 返回 `null`。
- 含零宽/隐藏字符的洞察返回 `null`。
- 正常中文摘要仍可通过。
- `pnpm --filter substack-digest-server build` 通过。
- `pnpm lint` 通过。

生产数据风险扫描：

- 最近两天 `2026-05-24` 和 `2026-05-25` 共 222 条 digest items 中，仅 1 条 `oneLiner < 35`，即该 Slashdot 异常样本。
- `keyInsights < 55` 的条目较多，因此本次未扩大 keyInsight 下限，避免误伤已有可读摘要和引发不必要重算。

### Follow-up Actions

| Action | Owner | Status | Notes |
|---|---|---|---|
| 部署后复查 2026-05-24 异常缓存是否被判 invalid 并重新生成 | AI agent | Pending | 可通过手动/定时重跑目标日期或定向清理该 article summary 后验证 |
| 观察 `too_short_oneLiner` 和 retry 成功率 | AI agent | Pending | 判断主模型短残片是否偶发还是频繁 |
| 评估网页总结模型候选 | AI agent + User | Optional | 用真实文章样本比较当前模型、retry 模型、Claude/Gemini/GPT 系列的质量、成本、速度 |
| 继续抽查 `keyInsights` 质量 | AI agent | Optional | 若短洞察或乱码仍出现，再单独定义 keyInsight 质量规则 |

### Next Review

- 下一轮日报后检查 scheduler 日志中的 validation metadata，确认短 `oneLiner` 会进入 retry。
- 抽样检查新生成摘要是否仍出现单词残片、隐藏字符或缓存污染。
- 若 retry 后仍频繁失败，再讨论模型稳定性、并发/频率和主模型切换，而不是继续扩大 validator 规则。

## 2026-05-27: Multilingual digest language routing and German support

### Summary

为支持中文、英文以外的日报语言，摘要链路改为按目标语言读取专用 profile。首个新增语言为德语，设置页新增 Deutsch 选项，后端按用户 `digest_language` 选择对应 prompt、schema、轻量校验、fallback 文案和缓存键。

### Behavior Contract

- 手动生成、定时生成和预摘要仍必须通过 `executeDailyDigestJob` 相关链路执行，保持 feed sync、pre-summary、digest assembly 顺序不变。
- 同一篇文章可以按不同目标语言生成不同摘要；抓取仍复用同一篇 `articles` 记录，摘要缓存按 `article_id + language` 隔离。
- 旧的 `articles.summary_zh` / `summary_en` 继续作为兼容回退，不改变既有中文/英文用户的缓存读取。
- 德语只做轻量 Latin script 校验，不用脆弱的德语词表或特殊字母硬规则；语言质量主要由德语专用 prompt、结构化 schema、长度/低质量校验和 retry 兜底。

### Changes

- 新增 `article_summaries` 表，使用 `(article_id, language)` 唯一索引保存多语言摘要 JSON、模型和 prompt version。
- 新增 summary language profile，把中文、英文、德语 prompt/schema/validation/fallback 文案集中管理。
- `presummarizeForUser()` 和 digest assembly 均优先读取 `article_summaries`，再回退 legacy `summary_zh/en`，生成后写入新缓存；中文/英文同步回写 legacy 字段。
- Settings API 和前端设置页允许 `zh` / `en` / `de`，历史非法值继续回退为 `zh`。

### Verification

- `server/node_modules/.bin/tsc -p server/tsconfig.build.json` 通过。
- `node_modules/.bin/eslint .` 通过。

### Follow-up: Model Switch Decision

同日根据 10 篇德语样本探针，决定把生产 `AI_MODEL` 从 `openai/gpt-oss-120b` 切到 `qwen/qwen3.5-flash-02-23`。理由不是成本，而是任务匹配度：当前核心任务是多语言日报摘要，qwen 在抽样德语摘要中 10/10 成功、0 英文混入、0 JSON/schema 失败，而主模型在同一批次德语日报中出现少量英文 `keyInsights` 混入。已更新 web 与 scheduler 服务的 `AI_MODEL` 配置；运行进程是否已加载新配置需要通过后续重启/重部署后的摘要日志确认。

### Follow-up: Background Pre-Summary Architecture

同日决定实现“不新增服务”的阶段二最小架构优化：提前批次处理消化大部分抓取和摘要工作，日报时间保留最终同步、兜底和组装。

设计边界：

- 不新增 Zeabur 服务；仍使用现有 `scheduler` 服务承载 runner。
- `executeDailyDigestJob()` 主链路不变，避免破坏手动生成、定时生成和新增订阅初始生成的一致性。
- 后台 feed sync 每 4 小时扫描 active subscriptions 关联的 feeds，并尊重 `last_fetched_at` freshness window，只抓 due feeds。
- feed sync 插入近期新文章后，按 active subscriber 的 `digest_language` 和 `digest_source_types` 创建 `article_summary_jobs(article_id, language)`，使用唯一键去重。
- summary runner 每 5 分钟领取一批 `article_summary_jobs`，调用当前 `AI_MODEL` 写入 `article_summaries`。
- 日报 job 仍运行 `presummarizeForUser()`，作为 cutoff/后台任务未完成时的兜底。

本次实现：

- 新增 `article_summary_jobs` 表、唯一索引和状态索引。
- 新增 `article-summary-jobs.ts`，包含 enqueue、stale reclaim、claim/run/update 状态逻辑。
- `syncFeed()` 对真实新插入且处于近期窗口的文章入队 summary jobs，并避免为用户已过滤的来源预摘要。
- `scheduler` 新增 `ARTICLE_SUMMARY_RUN_CRON` 与 `FEED_SYNC_CRON` runner。
- `.env.scheduler.example`、`docs/context.md`、`docs/operations.md` 已更新。

验证：

- `server/node_modules/.bin/tsc -p server/tsconfig.build.json` 通过。
- `node_modules/.bin/eslint .` 通过。
- `node_modules/.bin/tsc -p tsconfig.app.json --noEmit` 仍失败于既有前端类型问题：Clerk `afterSignOutUrl` prop 与 DailyDigest union `.id` narrowing。
- `node_modules/.bin/vite build` 受本机 Rollup optional native package code signing 问题阻塞，未到业务代码编译阶段。

### Follow-up Actions

| Action | Owner | Status | Notes |
|---|---|---|---|
| 部署后抽查德语日报输出 | AI agent + User | Pending | 重点看自然德语、专业术语、fallback 数量和 retry 日志 |
| 观察 `article_summaries` 命中率 | AI agent | Pending | 对比 `summaryCacheHits`、`summaryCacheMisses`、`aiRequests` 是否符合 `article + language` 口径 |
| 修复前端既有 TypeScript 问题 | AI agent + User | Optional | 当前不由本次多语言改造引入，但会影响完整 frontend typecheck |

### Follow-up: Phase 2 Safety Review Fixes

阶段二骨架 review 后补齐上线前安全项：

- `ENABLE_ARTICLE_SUMMARY_JOBS`、`ENABLE_BACKGROUND_FEED_SYNC`、`ENABLE_ARTICLE_SUMMARY_BACKFILL` 改为显式 `true` 才启用，避免部署代码即改变生产负载。
- `syncFeed()` 只有在 `ENABLE_ARTICLE_SUMMARY_JOBS=true` 时才写入 `article_summary_jobs`，避免主链路 feed sync 在灰度前产生新队列表数据。
- `article_summary_jobs` 入队去掉手写 article id `IN (...)` 拼接，改用查询构造器参数化条件。
- 已失败、跳过、取消或异常成功但缺少缓存的 summary job，再次入队时会重置为 `pending`，避免唯一键导致永久卡死。
- summary runner 失败后按指数退避重试；达到最大尝试次数后不再被普通 runner 反复扫描，需通过再次入队/backfill 或人工 reset 重新激活。
- 新增近期 backfill 入口，用于把已有近期文章按活跃订阅语言补入 `article_summary_jobs`，但默认关闭。

## 2026-05-28: German digest quality review and summary metadata observability

### Summary

复查 `target_date=2026-05-27` 的德语日报后，确认多语言链路正常生效：德语用户生成 47 条日报内容，`presummarizeForUser()` 使用 `language=de`，日报组装阶段 47 条全部命中 `article_summaries` 缓存。质量问题集中在模型服从性：少量 `keyInsights` 仍为英文，主模型返回结构合法结果后通过了当前轻量 Latin script 校验，因此没有触发 retry。

### Evidence

- Scheduler 日志显示德语预摘要：`articlesToProcess=47 aiRequests=49 retryRequests=2 succeeded=47 failed=0`。
- 2 次 retry 均由主模型 JSON parse error 触发，不是语言质量错误。
- 日报组装日志显示：`summaryCacheHits=47 summaryGenerated=0 aiRequests=0`，说明问题摘要已在预摘要阶段写入缓存。
- 抽样定位 4 篇文章共 7 条英文 `keyInsights`：`We Automated Everything With AI and Tripled Our Headcount`、`Time to freak out about the national debt`、`Your future job will be to keep AI on task`、`Choosing to Stay Human`。

### Decision

- 暂不把问题定义为 prompt 链路错误；德语 prompt 和 `language=de` 传递正常。
- 暂不直接把 retry 模型替换为主模型；生产中 retry 模型只覆盖 2 次样本，能证明可用但不足以证明更适合作为主模型。
- 先补可观察性：新生成的 `article_summaries` 持久化实际成功模型、prompt version 和成功 attempt，后续再用真实文章做主模型与候选模型的德语输出一致性探针。

### Changes

- `summarizeArticleWithMetadata()` 返回摘要和生成 metadata，保留 `summarizeArticle()` 兼容旧调用。
- `presummarizeForUser()` 和 digest assembly 缓存写入时记录 `model`、`prompt_version`、`generation_attempt`。
- `article_summaries` 增加 `generation_attempt` 列；既有 `model` / `prompt_version` 字段开始由生成链路写入。

### Verification

- `server/node_modules/.bin/tsc -p server/tsconfig.build.json` 通过。
- `node_modules/.bin/eslint .` 通过。

---

## 2026-05-31: 开放注册前的安全与成本加固评估（SSRF 优先落地，部分未完成）

### Summary

对各功能模块做了一次代码质量评估。结合产品即将「开放谷歌邮箱登录」的定位，把改进收敛为「安全开放注册所必需的最小集」，而非通用质量改造。本轮先落地 SSRF 出站防护**代码**；其余项（限流、僵尸用户过滤、数据约束、测试）已规划但**未实现**，且本轮 SSRF 改动**尚未编译验证、未提交**（用户在验证前暂停）。

> 状态说明：以上是 `2026-05-31` 暂停时的快照。相关实现已在 `2026-06-01` 收尾，当前状态见下方 Follow-up Actions 和 `2026-06-01` 记录。

### Behavior Contract / 产品定位

- 产品将从邀请制转向开放谷歌登录：任何 Google 账号可自助登录使用。`/api/auth/me` 已支持任意 Clerk 用户首访自动建号，新用户默认 `free`。
- 订阅上限按用户决定**保持 `free=100` 不变**，不调 `entitlements.ts` 的 `PLAN_LIMITS`。
- 防护重心据此定为：① 防 SSRF；② 防 AI 成本失控（贵端点限流 + 僵尸用户不烧钱），**不**通过压低正常用户额度来控成本。

### 评估结论（收敛后）

- 实读验证后纠正两处易误判，避免误改正常代码：
  - `digest-jobs.ts` 的 `runPendingDigestJobs` 任务认领是「条件 UPDATE + 检查 affected rows」乐观锁，并发安全、可支持多实例，**非缺陷**。
  - `presummarize.ts` 的 `while(true)` 去重循环**不会死循环**：in-flight promise 完成后即从 map 删除，下一轮走自生成分支。
- 真实风险按开放注册定位排序：SSRF（非盲，`/discover` 回显抓取结果）> 贵端点无限流（可刷爆 AI 账单）> 僵尸用户照常每天烧钱。
- **明确不做**（避免过度工程化，后续勿当 TODO 重提）：前端 react-query、前端 `strict` 全开、迁移 drizzle-kit、超大组件拆分、抽 `useFeedList` hook、监控告警系统。理由：与「安全开放注册」无关，只扩大改动面与回归风险。

### Changes（本轮仅落地安全项）

- 新增 `server/src/sources/url-guard.ts`：`assertPublicUrl(rawUrl)`，仅允许 http/https，DNS 解析后校验 IP，拒绝 loopback / 私网（10/172.16-31/192.168）/ 链路本地 `169.254.0.0/16`（含云 metadata）/ CGNAT / ULA / `localhost` / `*.local`。失败抛 `AppError`（400，双语，复用 `sources/app-error.ts`）。
- 接入点（收敛后最小集）：
  - `rss-discovery.ts`：入口 `targetUrl`、从 HTML 提取的 `feedUrl`、homepage 元数据抓取三处。
  - `substack.ts` `getSubstackInfo()`：`feedUrl`。
  - `rss.ts` `syncFeedInternal()`：所有 feed 抓取的**统一兜底拦截点**；命中私网则跳过该 feed、返回 0、记 warn。
- 判断 `youtube-discovery.ts` **无需改**：`normalizeInputUrl()` 已强制 host 必须是 YouTube 域名。

### 已知边界

- SSRF guard 在 fetch 前按 host 校验，并通过 `safeFetchText()` 禁止客户端自动重定向、逐跳校验重定向目标。仍不在连接时复检 DNS，因此不是对 DNS-rebinding 的硬防护。若引入统一 fetch proxy 再加强。

### Follow-up: Redirect SSRF hardening

- 新增 `server/src/sources/safe-fetch.ts`：使用 `redirect: "manual"` 逐跳处理最多 5 次 HTTP 重定向，每次请求前都执行 `assertPublicUrl()`。
- RSS 拉取统一改为安全抓取文本后调用 `rssParser.parseString()`，覆盖 RSS 发现、持久化 feed 同步、Substack、播客校验和 YouTube feed。
- HTML 发现与 homepage 元数据抓取也统一走安全封装。
- 安全抓取增加 15 秒默认超时和 5 MiB 默认响应体上限。
- 新增 `safe-fetch.test.ts`，覆盖公网地址重定向到 metadata IP、相对公网重定向、重定向次数上限和响应体大小上限。

### Verification

- `2026-05-31` 暂停时尚未验证。`2026-06-01` 已完成 build、lint、单元测试和 `git diff --check`；部署后仍需通过真实路由做一次公网 RSS 放行与内网 URL 拒绝验收。

### Follow-up Actions

| Action | Owner | Status | Notes |
|---|---|---|---|
| SSRF 改动编译验证 + 起服务实测 | AI agent | Partial | build、lint 和 SSRF 单测已完成；部署后补真实路由验收 |
| 贵端点限流（`express-rate-limit`，按 `req.userId`） | AI agent | Completed | discover/search 30/min，generate 5/min+30/day |
| 僵尸用户不烧钱（按 `users.lastLoginAt` 过滤） | AI agent | Completed | 已覆盖 `dispatchDigestJobs`、`syncAllFeeds`、summary enqueue/backfill，窗口默认 30 天 |
| `digests.userId` 补 `NOT NULL` + 外键 | AI agent | Completed | 已清理孤儿并补约束；外键初始化处理 web/scheduler 并发 |
| 关键纯函数补 vitest + test 脚本 | AI agent | Completed | 已覆盖 SSRF、redirect、配额、timezone、摘要缓存校验 |

### Next Review

- 部署后通过真实路由确认拒绝内网 URL、放行正常公网 RSS。
- 检查摘要日志出现 `maxOutputTokens=1200`，并按独立开关灰度开启阶段二。

---

## 2026-06-01: 开放注册加固收尾、日报 fallback 事故与输出 token 上限

### Production Review

- `target_date=2026-05-31` 日报调度正常，无 job 积压，但三份日报分别出现 `48/65`、`15/18`、`17/29` 条 fallback。
- 日志确认 retry 模型请求被 OpenRouter `402` 拒绝：请求未显式设置输出上限，供应商按最多 `65536 tokens` 评估余额。
- 未修改 `AI_MODEL` 或 `AI_RETRY_MODEL` 名称。新增 `AI_MAX_OUTPUT_TOKENS`，默认 `1200`，并在摘要启动日志输出实际值。

### Safety Completion

- 新增 `safeFetchText()`：逐跳校验重定向目标，阻断公网 URL 跳转到 metadata / loopback 地址。
- 补齐 IPv6 SSRF 判断：完整拦截 `fe80::/10`、`fc00::/7`、IPv6 multicast、十六进制 IPv4-mapped IPv6 和 IPv4 兼容写法。
- 修复 ICU 在本地午夜返回 `hour=24` 导致日报范围提前一天的问题，并补上海与纽约 DST 测试。
- `article_summary_jobs` enqueue 与 backfill 查询加入最近活跃用户过滤，避免共享 feed 为休眠用户语言继续消耗摘要预算。
- `users.last_login_at` 增加索引。
- `digests.user_id` 外键改为仅缺失时新增，并处理 web 与 scheduler 并发初始化时的 `duplicate_object`。
- 新增贵端点按用户限流、`digests.user_id` 数据约束和关键纯函数 vitest。

### Verification

- `pnpm install --lockfile-only --frozen-lockfile` 通过。
- `pnpm --filter substack-digest-server build` 通过。
- `pnpm --filter substack-digest-server test` 通过：`35/35`。
- `pnpm lint` 通过。
- `git diff --check` 通过。

### Rollout Notes

- 阶段二开关仍默认关闭：`ENABLE_ARTICLE_SUMMARY_JOBS=false`、`ENABLE_BACKGROUND_FEED_SYNC=false`、`ENABLE_ARTICLE_SUMMARY_BACKFILL=false`。
- 部署后先确认摘要日志出现 `maxOutputTokens=1200`，再重跑受影响的 `2026-05-31` 日报。
- OpenRouter credits 仍需恢复为正数；输出上限修复用于避免按不必要的 `65536 tokens` 最坏情况提前拒绝请求。

### Production Rollout: Stage 0 and Stage 1 Completed

同日完成生产灰度的阶段 0 和阶段 1。数据库复合索引优化暂缓，不属于本次发布。

阶段 0 验收：

- `web` 和 `scheduler` 均配置 `AI_MAX_OUTPUT_TOKENS=1200`。
- `scheduler` 配置 `DIGEST_ACTIVE_USER_WINDOW_DAYS=30`。
- 部署检查发现 `web` 仅有前端 `VITE_CLERK_PUBLISHABLE_KEY`，服务端 `clerkMiddleware()` 缺少同值的 `CLERK_PUBLISHABLE_KEY`。已补齐生产变量，并同步更新 `.env.web.example` 与 `docs/operations.md`。
- `web` 数据库初始化成功，公开站点返回 HTTP 200；Clerk 中间件可正常识别未登录请求。
- `scheduler` 数据库初始化成功，日报 dispatcher 正常扫描最近活跃用户。最近一轮日志为 `activeUsers=7`：5 个唯一用户进入日报扫描，2 个唯一 revoked 用户被跳过，无重复用户。

阶段 1 验收：

- 仅在 `scheduler` 开启 `ENABLE_ARTICLE_SUMMARY_JOBS=true`。
- 保持 `ENABLE_BACKGROUND_FEED_SYNC=false`、`ENABLE_ARTICLE_SUMMARY_BACKFILL=false`。
- 灰度参数为 `ARTICLE_SUMMARY_RUN_CRON=*/5 * * * *`、`ARTICLE_SUMMARY_JOB_RUN_LIMIT=10`、`ARTICLE_SUMMARY_JOB_CONCURRENCY=2`。
- 新 scheduler 单实例已替换旧实例，启动日志明确显示 `articleSummaryJobsEnabled=true`、`backgroundFeedSyncEnabled=false`、`articleSummaryBackfillEnabled=false`。
- summary runner 已完成 startup catch-up，并在 `12:00Z`、`12:05Z`、`12:10Z` 按计划执行 scheduled tick；当前均为 `claimed=0 succeeded=0 skipped=0 failed=0`。这表示 runner 已正常工作，但暂时没有新任务，因此尚无真实 AI 摘要质量样本。

下一步：

- `2026-06-02` 先检查阶段 1 过夜日志和新生成日报质量，不直接假设阶段 2 可以开启。
- 阶段 1 无异常后，再开启 `ENABLE_BACKGROUND_FEED_SYNC=true` 进入阶段 2；`ENABLE_ARTICLE_SUMMARY_BACKFILL` 继续保持 `false`。
- 阶段 2 开启后观察 feed sync 扫描量、due feed 数、新文章数、summary job 入队量、runner 成功/失败量、OpenRouter 402 和摘要缓存命中率。

---

## 2026-06-03: Stage 2 Background Feed Sync Gray Release

### Production Review

- `scheduler` 当前生产部署持续运行，`web` 首页返回 HTTP 200，Clerk 中间件可正常识别未登录访问。
- `scheduler` 日志在 `2026-06-03 05:10Z-08:15Z` 窗口内稳定 tick：
  - digest runner 与 summary runner 均为 `claimed=0 succeeded=0 skipped=0 failed=0`。
  - summary job scan 持续为 `candidates=0`，说明阶段 1 runner 存活但暂无待处理摘要任务。
  - dispatcher 每 15 分钟扫描，最新为 `activeUsers=6`、`scannedUsers=6 created=0 existing=12`。
  - 2 个 revoked 用户被跳过，没有看到重复创建任务、失败积压或 OpenRouter `402` 日志。

### Stage 2 Change

- 仅在 Zeabur `scheduler` 服务开启 `ENABLE_BACKGROUND_FEED_SYNC=true`。
- `ENABLE_ARTICLE_SUMMARY_JOBS=true` 保持开启。
- `ENABLE_ARTICLE_SUMMARY_BACKFILL=false` 保持关闭。
- 本阶段目标是验证“后台 feed sync -> 新文章入库 -> 小批量 article summary jobs 入队 -> summary runner 可控处理/失败”的链路，不补历史文章。

### Activation Verification

- 推送文档提交后触发新的 `scheduler` 部署 `6a1fe3bc43208a2c509fab82`。
- 新部署已进入 `RUNNING`，旧 scheduler 实例已移除。
- 启动日志确认：`articleSummaryJobsEnabled=true`、`backgroundFeedSyncEnabled=true`、`articleSummaryBackfillEnabled=false`。
- scheduler 启动时不会立即执行 feed sync；feed sync 只按 `FEED_SYNC_CRON` 运行，当前为 `0 */4 * * *`。

### Expected Signals

- 正常有新文章时：
  - `[rss] Starting sync job ... toSync=...`
  - `[summary-jobs] Enqueue complete ... created=... existing=... requeued=...`
  - `[summary-jobs] Runner candidate scan ... candidates=...`
  - `[scheduler] Summary runner ... claimed=... succeeded=... failed=...`
- 如果 OpenRouter credit 仍不足，预期失败应小批量、可解释：
  - `aiErrorCategory=quota_or_billing` 或 OpenRouter `402`
  - `failed` 可以出现，但不能持续失控增长
  - `ENABLE_ARTICLE_SUMMARY_BACKFILL=false` 应保证不会批量重跑历史摘要

### Next Review

- `2026-06-04` 检查阶段 2 过夜日志。
- 优先确认新部署启动日志中 `backgroundFeedSyncEnabled=true`。
- 检查 feed sync 扫描量、due feed 数、抓取耗时、新文章数、summary job 入队数。
- 检查 summary runner 的 `claimed/succeeded/failed`、OpenRouter `402`、重试量和摘要缓存命中率。
- 若余额不足导致失败，先确认失败是否受 `ARTICLE_SUMMARY_JOB_RUN_LIMIT=10` 与 `ARTICLE_SUMMARY_JOB_CONCURRENCY=2` 控制，再决定是否充值或暂停阶段 2。

---

## 2026-06-04: Apple Podcast Multi-Region Search

### Decision

- 先增强现有 Apple iTunes Search，不引入新 podcast provider。
- Apple `country` 参数一次请求只能指定单个地区；不传时默认偏 US，不是全球搜索。
- DigestDesk 将 `PODCAST_APPLE_COUNTRIES=auto` 作为后端通用搜索配置，展开为 `us,cn,tw,hk,sg,gb,ca,au`。
- Podcast Index 暂不接入本轮；后续作为 Apple 之外的目录补充源评估。

### Implementation Notes

- 播客搜索仍发生在 `web` 服务的 `/api/podcast-feeds/search`。
- 后端对多个 Apple country 并发搜索，合并后按 `feedUrl` 去重。
- 最多校验 18 个候选 RSS，避免一次搜索放大为过多 RSS 请求。
- 前端返回结构保持 `PodcastSearchResult[]`，不需要前端改动。
- 用户订阅后仍保存 RSS `feedUrl`；后续更新继续由 scheduler 的 RSS sync 处理，Apple 不参与日常同步。

### Follow-up

- 代码已推送到 `main`：`cebb4f0 Support multi-region Apple podcast search`。
- Zeabur `web` 部署 `6a20632dd1b851e4629864cf` 已进入 `RUNNING`，旧 web 实例已移除；线上搜索效果仍待用真实登录态验证。
- 公开首页健康检查返回 HTTP 200，响应 `last-modified=2026-06-03T17:26:08Z`，Clerk 未登录识别正常。
- `docs/operations.md` 已按代码实际读取的 env 补齐可选变量清单。生产 Zeabur 变量完整核对需读取服务变量列表；该操作会暴露密钥值，必须在获得明确授权后执行，且核对时只记录变量名/状态，不输出值。
- 后续 docs-only 提交 `2dc26ac Align operations docs with runtime envs` 已推送到 `main`，并触发 Zeabur `web` 部署 `6a2064ccd1b851e462986593`；该部署一度显示为失败/缺少 runtime log，随后进入 `RUNNING`，旧部署 `6a20632dd1b851e4629864cf` 已移除。构建日志显示 Vite/server build 均成功。复查公开首页仍为 HTTP 200，`last-modified=2026-06-03T17:26:08Z`。
- docs-only 提交仍会触发 web 自动部署；记录生产状态时必须以 Zeabur 最新 deployment list 和生产健康检查为准，避免把中间态写成最终态。
- 部署后用中英文播客关键词各测一次，观察 `rawCandidates`、`deduped`、`verified` 日志。
- 若搜索覆盖仍不足，再接入 Podcast Index 作为第二 provider。
