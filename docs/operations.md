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
     - `CLERK_SECRET_KEY`
     - `DATABASE_URL` 或 `POSTGRES_CONNECTION_STRING` / `POSTGRES_URI`
     - `AI_API_KEY`
     - `AI_MODEL`
     - `AI_RETRY_MODEL`（可选；摘要校验失败时的第二次尝试模型）
     - `AI_BASE_URL`
     - `CF_SEARCH_PROXY_URL`
     - `CF_SEARCH_PROXY_TOKEN`
     - `JINA_RPM`
     - `JINA_MAX_CONCURRENCY`
     - `APP_URL`
     - `ADMIN_EMAILS`
     - `VITE_ENABLE_GOOGLE_YOUTUBE_IMPORT`
     - `ENABLE_GOOGLE_YOUTUBE_IMPORT`
   - `scheduler`:
     - `DATABASE_URL` 或 `POSTGRES_CONNECTION_STRING` / `POSTGRES_URI`
     - `AI_API_KEY`
     - `AI_MODEL`
     - `AI_RETRY_MODEL`（可选；摘要校验失败时的第二次尝试模型）
     - `AI_BASE_URL`
     - `JINA_RPM`
     - `JINA_MAX_CONCURRENCY`
     - `DIGEST_DISPATCH_CRON`
     - `DIGEST_RUN_CRON`
     - `DIGEST_JOB_RUN_LIMIT`
6. 仅给 `web` 绑定公开域名。
7. `scheduler` 不需要域名，不对外暴露 HTTP。
8. `scheduler` 初始保持单实例。
9. 部署完成后查看日志，确认调度服务正常启动。

当前建议：

- 主站先上线时，将 `VITE_ENABLE_GOOGLE_YOUTUBE_IMPORT=false`
- 同时将 `ENABLE_GOOGLE_YOUTUBE_IMPORT=false`
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

这组值更贴合日报产品的节奏：

- 降低全量用户扫描频次
- 降低 runner 空跑频次
- 降低单轮抓取、总结、写库的资源峰值
- 仍能在用户设定时间附近完成投递

## 7. 当前适用范围

阶段一目标：

- 正确上线
- 恢复并稳定自动日报
- 支撑几千量级用户验证

说明：

- 该阶段适合真实生产验证
- 但不应直接承诺为“1 万用户晨峰稳态版本”

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
