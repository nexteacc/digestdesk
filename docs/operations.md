# DigestDesk Zeabur Deployment

本文档给出当前在 Zeabur 上的正式部署方式，以及后续面向更大规模用户的演进方向。

## 1. 当前正式部署形态

阶段一先采用三服务形态：

- `web`
- `scheduler`
- `postgres`

职责：

- `web`：提供 SPA 与 API
- `scheduler`：常驻运行，周期性调用 `dispatchDigestJobs` 与 `runPendingDigestJobs`
- `postgres`：存储共享内容资产、用户数据、digest 结果和 `digest_jobs`

当前不再依赖 `platform cron`。

## 2. 服务命名要求

仓库内提供了按服务名覆盖的 Zeabur 配置文件：

- `zbpack.web.json`
- `zbpack.scheduler.json`

因此在 Zeabur 中建议服务名直接使用：

- `web`
- `scheduler`

如果服务名不同，则需要在 Zeabur 控制台中手动填写等价的 build/start command。

## 3. 当前 build / start 命令

### 3.1 Web

- Build: `pnpm build`
- Start: `pnpm start`

对应文件：

- [`zbpack.web.json`](../zbpack.web.json)

### 3.2 Scheduler

- Root Directory: `/`
- App Directory: `server`
- Build: `pnpm build`
- Start: `pnpm start:scheduler`

对应文件：

- [`zbpack.scheduler.json`](../zbpack.scheduler.json)

## 4. 部署步骤

1. 在 Zeabur 中创建或进入现有 Project。
2. 部署 PostgreSQL 服务。
3. 从同一 GitHub 仓库部署第一个 Node 服务，命名为 `web`。
4. 再从同一 GitHub 仓库部署第二个 Node 服务，作为 `scheduler`。
5. 给 `web` 和 `scheduler` 都配置相同的后端环境变量：
   - `web`:
     - `VITE_CLERK_PUBLISHABLE_KEY`
     - `CLERK_PUBLISHABLE_KEY`
     - `CLERK_SECRET_KEY`
     - `DATABASE_URL` 或 `POSTGRES_CONNECTION_STRING` / `POSTGRES_URI`
     - `CORS_ALLOWED_ORIGINS`（可选；除 `APP_URL` 外额外允许的前端 origin，逗号分隔）
     - `AI_API_KEY`
     - `AI_MODEL`
     - `AI_RETRY_MODEL`（可选；摘要校验失败时的第二次尝试模型）
     - `AI_BASE_URL`
     - `AI_SUMMARY_CONCURRENCY`（可选；摘要并发，默认 `3`）
     - `AI_MAX_INPUT_CHARS`
     - `AI_MAX_OUTPUT_TOKENS`（摘要最大输出 token；默认 `1200`）
     - `CF_SEARCH_PROXY_URL`
     - `CF_SEARCH_PROXY_TOKEN`
     - `JINA_RPM`
     - `JINA_MAX_CONCURRENCY`
     - `YOUTUBE_API_KEY`（可选；YouTube RSS 不可用时用于读取公开视频和频道更新）
     - `PODCAST_APPLE_COUNTRIES`（可选；Apple 播客搜索地区，默认 `auto`）
     - `APP_URL`
     - `ADMIN_EMAILS`
     - `ADMIN_OPERATIONS_TIMEZONE`（可选；Admin 运行状态日期口径，默认 `Asia/Shanghai`）
     - `VITE_ENABLE_GOOGLE_YOUTUBE_IMPORT`
     - `ENABLE_GOOGLE_YOUTUBE_IMPORT`
     - `INITIAL_DIGEST_DEBOUNCE_MS`（可选；新增订阅后初始日报防抖，默认 `30000`）
     - `RATE_LIMIT_DISCOVER_PER_MIN`（可选；发现/搜索接口限流，默认 `30`）
     - `RATE_LIMIT_GENERATE_PER_MIN`（可选；日报生成分钟限流，默认 `5`）
     - `RATE_LIMIT_GENERATE_PER_DAY`（可选；日报生成日限流，默认 `30`）
   - `scheduler`:
     - `DATABASE_URL` 或 `POSTGRES_CONNECTION_STRING` / `POSTGRES_URI`
     - `AI_API_KEY`
     - `AI_MODEL`
     - `AI_RETRY_MODEL`（可选；摘要校验失败时的第二次尝试模型）
     - `AI_BASE_URL`
     - `AI_SUMMARY_CONCURRENCY`（可选；摘要并发，默认 `3`）
     - `AI_MAX_INPUT_CHARS`
     - `AI_MAX_OUTPUT_TOKENS`（摘要最大输出 token；默认 `1200`）
     - `JINA_RPM`
     - `JINA_MAX_CONCURRENCY`
     - `YOUTUBE_API_KEY`（可选；YouTube RSS 不可用时用于读取公开视频和频道更新）
     - `DIGEST_DISPATCH_CRON`
     - `DIGEST_RUN_CRON`
     - `DIGEST_JOB_RUN_LIMIT`
     - `DIGEST_ACTIVE_USER_WINDOW_DAYS`（仅为最近活跃用户生成日报和后台摘要；默认 `30`）
     - `ENABLE_SCHEDULER_SERVICE`（可选；设为 `false` 时禁用 scheduler，默认启用）
     - `ENABLE_ARTICLE_SUMMARY_JOBS`（阶段二开关；默认 `false`）
     - `ENABLE_BACKGROUND_FEED_SYNC`（阶段二开关；默认 `false`）
     - `FEED_SYNC_CRON`（后台 feed sync cron，默认 `0 */4 * * *`）
     - `FEED_SYNC_FRESHNESS_WINDOW_MS`（feed sync 新鲜度窗口，默认 `14400000`）
     - `ENABLE_ARTICLE_SUMMARY_BACKFILL`（一次性/灰度 backfill 开关；默认 `false`）
     - `ARTICLE_SUMMARY_RUN_CRON`
     - `ARTICLE_SUMMARY_JOB_RUN_LIMIT`
     - `ARTICLE_SUMMARY_JOB_CONCURRENCY`
     - `ARTICLE_SUMMARY_RETRY_BASE_DELAY_MS`
     - `ARTICLE_SUMMARY_BACKFILL_LIMIT`
6. 仅给 `web` 绑定公开域名。
7. `scheduler` 不需要域名，不对外暴露 HTTP。
8. `scheduler` 初始保持单实例。
9. 部署完成后查看日志，确认调度服务正常启动。

当前建议：

- 主站先上线时，将 `VITE_ENABLE_GOOGLE_YOUTUBE_IMPORT=false`
- 同时将 `ENABLE_GOOGLE_YOUTUBE_IMPORT=false`
- 播客搜索默认使用 `PODCAST_APPLE_COUNTRIES=auto`，后端会展开为 `us,cn,tw,hk,sg,gb,ca,au` 多地区搜索；订阅后的更新仍然只依赖播客 RSS。
- `ADMIN_EMAILS` 只配置在 `web` 服务，例如 `founder@example.com,ops@example.com`
- `/admin` 页面复用 Clerk 登录；后端只允许 `ADMIN_EMAILS` 中的邮箱访问 `/api/admin`
- 这样可以先发布 Digest / RSS / Substack / 手动添加 YouTube 频道能力
- 等 Google 完成 YouTube 敏感 scope 审核后，再把这两个变量切到 `true`

如果 Zeabur 里没有自动识别 `zbpack.scheduler.json`，则手动配置：

- Root Directory: `/`
- `ZBPACK_APP_DIR=server`
- `ZBPACK_BUILD_COMMAND=pnpm build`
- `ZBPACK_START_COMMAND=pnpm start:scheduler`

## 5. 启动后应看到的日志

`scheduler` 服务启动后，预期应看到类似日志：

```text
[scheduler] Starting initialization...
[scheduler] Database initialized.
[scheduler] Initialized: dispatchCron="*/15 * * * *", runCron="*/5 * * * *", runLimit=10, ...
[scheduler] Service started.
```

随后会持续出现：

```text
[scheduler] Dispatch Scheduled tick: ...
[scheduler] Runner Scheduled tick: ...
```

## 6. 当前调度频率

当前代码默认值：

- `dispatch`: 每 5 分钟一次
- `run`: 每 1 分钟一次
- `runLimit`: 20

当前生产推荐值：

- `DIGEST_DISPATCH_CRON=*/15 * * * *`
- `DIGEST_RUN_CRON=*/5 * * * *`
- `DIGEST_JOB_RUN_LIMIT=10`
- `DIGEST_ACTIVE_USER_WINDOW_DAYS=30`
- `AI_MAX_OUTPUT_TOKENS=1200`
- `ENABLE_ARTICLE_SUMMARY_JOBS=false` by default; set to `true` only when rolling out phase 2 summary jobs.
- `ENABLE_BACKGROUND_FEED_SYNC=false` by default; set to `true` only after confirming feed sync capacity.
- `ENABLE_ARTICLE_SUMMARY_BACKFILL=false` by default; temporarily set to `true` to seed recent existing articles.
- `FEED_SYNC_CRON=0 */4 * * *`
- `FEED_SYNC_FRESHNESS_WINDOW_MS=14400000`
- `ARTICLE_SUMMARY_RUN_CRON=*/5 * * * *`
- `ARTICLE_SUMMARY_JOB_RUN_LIMIT=10`
- `ARTICLE_SUMMARY_JOB_CONCURRENCY=2`
- `ARTICLE_SUMMARY_RETRY_BASE_DELAY_MS=300000`
- `ARTICLE_SUMMARY_BACKFILL_LIMIT=50`

这组值更贴合日报产品的节奏：

- 降低全量用户扫描频次
- 降低 runner 空跑频次
- 降低单轮抓取、总结、写库的资源峰值
- 仍能在用户设定时间附近完成投递
- 后台 feed sync 默认关闭；开启后每 4 小时只抓 due feeds，抓到近期新文章后按用户来源设置入队 `article_summary_jobs`
- 后台 summary runner 默认关闭；开启后在现有 `scheduler` 服务内提前消化摘要任务，日报 job 仍保留同步和预摘要兜底
- recent backfill 独立开关，避免部署代码时立刻扫描既有文章并放大 AI 请求峰值

### 6.1 当前生产灰度状态（2026-06-03）

当前已完成阶段 0、阶段 1，并已在 `scheduler` 服务开启阶段 2：

- `AI_MAX_OUTPUT_TOKENS=1200`
- `DIGEST_ACTIVE_USER_WINDOW_DAYS=30`
- `ENABLE_ARTICLE_SUMMARY_JOBS=true`
- `ENABLE_BACKGROUND_FEED_SYNC=true`
- `ENABLE_ARTICLE_SUMMARY_BACKFILL=false`
- `ARTICLE_SUMMARY_RUN_CRON=*/5 * * * *`
- `ARTICLE_SUMMARY_JOB_RUN_LIMIT=10`
- `ARTICLE_SUMMARY_JOB_CONCURRENCY=2`

阶段 2 只开启后台 feed sync，不开启历史 backfill。目标是验证后台 feed sync 是否能为最近活跃用户的订阅源发现新文章，并小批量入队 `article_summary_jobs`。

阶段 2 仍必须保持：

- `ENABLE_ARTICLE_SUMMARY_BACKFILL=false`

阶段 2 开启后观察：

- 新部署启动日志是否显示 `backgroundFeedSyncEnabled=true`
- feed sync 扫描量、due feed 数和抓取耗时
- 新文章数量、summary job 入队量
- summary runner 的 `claimed`、`succeeded`、`failed`
- OpenRouter `402`、重试量和摘要缓存命中率

如果 OpenRouter credit 不足，预期是小批量 article summary jobs 失败并记录 `quota_or_billing` / `402`，而不是静默失败或批量重跑历史文章。

## 7. 当前适用范围

阶段一目标：

- 正确上线
- 恢复并稳定自动日报
- 支撑几千量级用户验证

说明：

- 该阶段适合真实生产验证
- 但不应直接承诺为“1 万用户晨峰稳态版本”

阶段二最小优化：

- 不新增 Zeabur 服务
- 在现有 `scheduler` 中增加 feed sync runner 与 article summary runner
- `executeDailyDigestJob` 主链路不变，仍负责最终同步、预摘要兜底和日报组装
- 长期若 summary runner 影响 digest runner，再基于真实日志拆成独立服务

## 8. 面向 1 万用户的下一阶段

当要认真面向 1 万用户时，建议升级为：

- `web`
- `dispatcher`
- `runner`
- `postgres`

对应调整：

- `dispatcher` 只负责创建 `digest_jobs`
- `runner` 只负责抢占并执行任务
- `runner` 才做水平扩容

必须补齐的能力：

1. 基于真实日志确认 scheduler 已出现任务积压或晨峰瓶颈
2. 强化 job claim 的数据库级并发安全
3. 优化 dispatch 的全量用户扫描
4. 根据 `summaryCacheMisses` 和 AI 调用峰值决定是否把摘要进一步前移
5. 基于真实数据做压测后再谈容量承诺

已完成的阶段一优化：

- `generateDaily` 已改为用户级队列，同一用户串行，不同用户可并行
- `runPendingDigestJobs` 已支持批量并发执行
- 用户 feed 同步已支持有限并发和近期同步跳过
- 新增订阅、手动生成和定时任务已统一进入 `executeDailyDigestJob`

## 9. 为什么当前方案没有方向性隐形债务

当前阶段虽然还存在容量型债务，但没有方向性错误，原因是：

- 没有把调度重新塞回 `web`
- 没有放弃 `digest_jobs`
- 没有破坏共享资产复用和用户结果隔离
- 没有继续依赖 Zeabur 上并不存在的 `platform cron`

后续扩容是顺着当前模型继续拆分，而不是推翻重写。
