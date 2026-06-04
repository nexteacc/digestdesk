# DigestDesk History

> 记录项目演进中的关键诊断、AI 协作结论、工程决策和后续验证项。核心原则：只保留会影响未来判断的结论，不保存聊天流水账。

本文档是 DigestDesk 的项目记忆层。架构稳定事实写入 `docs/context.md`，部署和运行事实写入 `docs/operations.md`；阶段性事故、根因、决策和仍需验证的结论写入本文。已经被代码、`docs/context.md` 或 `docs/operations.md` 固化的实现细节，不再长期保留完整排查过程。

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

## 2026-05: 收敛后的事故与决策索引

5 月原始记录曾包含大量 SQL、Zeabur 日志窗口、OpenRouter 对账和中间猜测。相关代码已在 5 月下旬和 6 月初完成多轮修复，本节只保留后续判断仍需要的事故事实、根因和工程决策。

### AI 成本与 OpenRouter 请求数异常

- 最初误判风险来自“单个用户日报文章数”：一次测试约 42 篇文章却看到约 520 次 OpenRouter 请求，明显超出“每篇未缓存文章一次摘要”的设计预期。
- `2026-05-14` 后续对账显示：OpenRouter 1 Day 为 249 requests、1.31M tokens、约 `$0.191`；生产库实际是 6 份成功日报、252 条 digest items、203 篇 unique articles。关键结论是：请求量必须按全系统、多用户、retry、digest assembly 补摘要一起解释，不能拿前端某个用户看到的 38 篇文章直接对账。
- 日报生成会跨用户处理共享文章，同一篇文章在不同语言下仍可能各自摘要；真实成本口径应看 unique articles、语言、cache miss、retry 和 fallback。
- `AI_MAX_INPUT_CHARS` 曾被误以为生产是 `12000`，但当时运行容器实际读到 `200000`；后续才把生产收敛到 `12000`，并通过 Markdown 结构化输入压缩、内容块筛选和缓存复用降低输入 token。
- 5 月中旬新增/强化了预摘要缓存、并发 in-flight 去重和请求数对账日志，避免同一 `article + language` 在并发用户日报中被重复总结。
- 后续不要重新用“某个用户页面显示 N 篇文章”推导 OpenRouter 请求数；必须按全系统日志和数据库聚合判断。

### 摘要质量、retry 与 structured output

- 中文摘要一度出现长度不稳定、残句、fallback 偏多等问题。处理方向是让 prompt、schema、后校验和 retry 约束保持一致，而不是只改某一层文案。
- 采用主模型失败后 retry 的策略；OpenRouter/Qwen structured-output 曾因请求消息不含明确 JSON 协议提示而返回 `messages must contain the word 'json'`。修复后 retry 不再因该协议问题失效。
- `target_date=2026-05-18` 曾出现 16 条摘要 fallback，根因集中在 retry 协议未兜住摘要校验失败。后续复盘 `target_date=2026-05-19` 时调度、retry 和落库恢复正常。
- 英文摘要曾出现 `too_long_oneLiner` 漂移，即 primary 与 retry 都返回结构合法但超出产品长度约束。结论是：多语言摘要不能只依赖结构化输出，仍需要语言/长度/可读性后校验。
- Slashdot 单篇中文摘要曾出现结构合法但语义损坏的缓存：文章 `Friday Google's AI-Powered Search Results Glitched on the Word 'Disregard'` 的 `oneLiner` 只有 `Google`，`keyInsights` 含隐藏字符/乱码。根因是摘要硬校验过松，后续需要把坏缓存视为 invalid 并允许重新生成。

### 调度、日报任务与生产运行口径

- scheduler 方向明确：定时工作属于 `scheduler` 服务和 `digest_jobs`，不要把 cron 风格调度放回 `web`。
- `runPendingDigestJobs` 的任务认领使用条件更新和 affected rows 判断，属于可接受的乐观锁模型，不是并发安全缺陷。
- `presummarizeForUser()` 的 in-flight 去重循环不会死循环；promise 完成后从 map 删除，下一轮进入正常生成分支。
- 5 月多次生产复盘确认：`digest_jobs` 的 succeeded/skipped/failed 分布需要和 `digests`、`digest_items`、OpenRouter Activity 一起看。empty digest 的 skipped 不等于失败。
- 后续扩容方向是拆 `dispatcher` / `runner` 或拆独立 summary runner，而不是推翻现有 `digest_jobs` 模型。

### Admin、Clerk 用户与生产数据清理

- 5 月下旬发现历史测试/生产环境混写造成重复 Clerk 用户：同一 email 存在不同 Clerk `user_id`，旧用户仍有 active subscriptions，导致 scheduler 继续为旧用户生成日报。清理目标是让 scheduler 扫描从 9 个用户收敛到 7 个真实用户。
- 根因不是 scheduler 重复扫描，而是用户身份数据历史遗留。处理方向是清理/终止旧用户订阅、保留当前登录用户，并用 Admin 页面和生产库对账确认 active users。
- `/admin` 访问权限由后端 `ADMIN_EMAILS` 控制；前端不保存管理员名单。后续排查 Admin 页面统计时，应区分真实活跃用户、revoked 用户和历史重复用户。

### 多语言日报与语言路由

- 5 月底加入多语言日报能力，摘要缓存以文章和语言维度区分。德语日报链路验证通过：`target_date=2026-05-27` 德语用户生成 47 条日报内容，`presummarizeForUser()` 使用 `language=de`，digest assembly 47 条全部命中对应语言的 `article_summaries`。
- 德语质量问题主要来自模型服从性：结构合法不代表语言完全正确，少量 `keyInsights` 可能仍混入英文。后续语言质量改进应优先强化语言校验和 retry，而不是改前端展示。
- 用户来源过滤和语言过滤会影响后台预摘要入队；新增数据源或语言时必须同时检查 settings schema、summary cache、digest assembly 和 UI 展示。

### 开放注册前安全与成本加固

- 产品从邀请制转向开放 Google 登录后，防护重点从“内部可用”转为“公开入口不刷钱、不 SSRF、不为僵尸用户持续花钱”。
- 订阅上限保持 `free=100` 不变；不通过降低正常用户额度解决成本问题。
- 真实风险优先级：SSRF > 贵端点无限流 > 休眠用户继续触发日报/摘要成本。
- 5 月底先落地 SSRF 出站防护评估，6 月初完成收尾：URL guard、安全重定向抓取、IPv6/metadata/loopback 防护、贵端点按用户限流、最近活跃用户过滤、`digests.user_id` 约束和关键单元测试。
- 明确不作为开放注册前必要项：前端 react-query、前端 strict 全开、迁移 drizzle-kit、超大组件拆分、抽 `useFeedList` hook、完整监控告警系统。这些不是当前安全上线的阻塞项。

### 5 月遗留到 6 月的关键结论

- `AI_MAX_OUTPUT_TOKENS` 必须有明确默认值和生产值，当前建议 `1200`。没有输出上限时，OpenRouter/供应商可能按极高最大输出预算评估余额，导致请求被提前拒绝。
- 后台 summary jobs、feed sync 和 backfill 必须分开灰度：`ENABLE_ARTICLE_SUMMARY_JOBS`、`ENABLE_BACKGROUND_FEED_SYNC`、`ENABLE_ARTICLE_SUMMARY_BACKFILL` 不能混为一个开关。
- `ENABLE_ARTICLE_SUMMARY_BACKFILL` 应默认关闭，避免部署代码时批量重跑历史文章并放大 AI 请求峰值。
- 生产变量核对只能记录 key 和状态，不能输出 secret value。Zeabur service variables 接口会返回值，使用时要特别小心。

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
