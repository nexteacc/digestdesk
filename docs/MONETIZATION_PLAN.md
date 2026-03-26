# DigestDesk 商业化方案

> 更新日期：2026-03-26
> 当前策略：低复杂度上线，先验证是否有人愿意使用和付费，不为 SEO 或大规模增长预埋过多系统复杂度。

## 一、结论摘要

DigestDesk 当前最适合的商业化路线是：

- 保持单项目架构
- 保持现有 `Vite + React SPA + Express + Scheduler`
- 不新增独立官网项目
- 不为了 SEO 引入 Next.js / Astro
- 先做 `Free + Pro` 双套餐
- 先把收费闭环、套餐权限和最小公开展示页做出来

当前阶段的目标不是“标准 SEO 增长型网站”，而是：

- 能展示产品
- 能注册使用
- 能完成升级付费
- 能通过手动分发和社媒渠道验证市场

---

## 二、当前阶段产品目标

DigestDesk 是一个阅读工作流工具，聚合 Substack、RSS、YouTube 更新，并生成用户专属 AI Digest。

当前阶段优先级：

1. 产品能稳定使用
2. 套餐边界清晰
3. 用户能完成升级付费
4. 页面能承接手动推广流量
5. 保持部署和维护简单

当前阶段不追求：

- 内容 SEO 增长
- 博客矩阵
- 多站点架构
- Team / Organization
- 复杂按量计费

---

## 三、套餐设计

采用 `Free + Pro` 双套餐模式，仅通过 3 个维度区分。

| | **Free** | **Pro** |
|---|---|---|
| **内容源类型** | 仅 Substack | Substack + RSS + YouTube |
| **订阅源数量** | 10 个 | 无限 |
| **历史 Digest 保留** | 7 天 | 90 天 |

### 全部开放的能力

- 每日自动 Digest
- AI 摘要语言
- 用户设置（Digest 时间、时区等）
- 批量导入能力

### 成本保护

虽然不做复杂 usage billing，但仍建议保留最小成本保护：

- 免费版保留自动 Digest
- 手动重新生成 Digest 预留冷却或软限制能力

这属于风控，不属于对外主卖点。

### 设计原则

- 免费用户可以体验完整核心价值
- 升级理由要简单直接
- 套餐规则尽量少
- 不做额外复杂度换“看起来更专业”的设计

### 定价建议

- Pro 月付：`$8` 左右
- 年付：可后续再加

当前阶段不建议一开始就出更多套餐。

---

## 四、架构策略

### 总体原则

保持单项目，不拆站。

也就是说：

- 当前前端继续承载产品应用
- 同一个项目内增加最小公开页面
- 同一个后端继续承载认证、业务 API、billing API

### 当前推荐结构

```text
同一个项目内包含：

1. 未登录公开页面
   - Landing
   - Pricing
   - FAQ / 简短说明

2. 已登录应用页面
   - Daily Digest
   - Subscriptions
   - RSS
   - YouTube
   - Settings

3. 后端 API
   - Auth
   - Feeds / Digests / Settings
   - Billing

4. Scheduler
   - Digest 定时任务
```

### 为什么不拆独立官网

原因很明确：

- 你当前不是 SEO 驱动增长
- 主要靠手动宣传和外部分发
- 独立官网会带来额外部署和维护成本
- 对当前阶段的商业验证帮助有限

因此，现阶段不值得为了“更标准的网站架构”增加一整层复杂度。

---

## 五、前端页面策略

### 公开页面

建议在现有项目中补最小公开页面：

- `/` Landing page
- `/pricing`
- `/faq`

Landing page 负责：

- 一句话说明产品价值
- 展示支持的来源类型
- 展示核心流程
- 提供 CTA：`Get Started`

Pricing page 负责：

- Free / Pro 对比
- 解释升级价值
- 提供升级 CTA

FAQ page 负责：

- 解释产品是什么
- 解释支持哪些来源
- 解释是否需要登录
- 解释套餐差异

### 应用页面

现有应用页保持不变，主要增加套餐感知：

- Subscriptions 页：显示当前已用订阅数和上限
- RSS / YouTube 页：未开通时提示升级
- Settings 页：显示当前套餐、限制、升级入口、管理订阅入口

### 路由策略

如果要做基础公开页，建议逐步从 hash 路由迁移到普通路径路由。

原因：

- 普通路径更适合公开页面
- 用户分享链接更自然
- 即使不做强 SEO，也更像正式产品

但这不是第一优先级。如果迁移成本高，可以先保留现状，后续再处理。

---

## 六、基础 SEO 策略

当前阶段只做“够用版”，不做重 SEO 架构。

### 需要做的

- 基础 `title`
- 基础 `meta description`
- Open Graph
- `robots.txt`
- `sitemap.xml`

### 不需要做的

- 独立 SEO 站点
- 内容营销体系
- 程序化 SEO
- 博客矩阵
- 大量 feature pages

### 目标

这些基础配置的目的不是靠搜索获取增长，而是：

- 链接被分享时更像正式产品
- 搜索品牌名时有基本展示能力
- 提升可信度

---

## 七、用户旅程

### 7.1 新用户

```text
用户通过 Twitter / 社区 / 朋友链接进入
  -> 打开 Landing Page
  -> 理解产品价值
  -> 点击 Get Started
  -> 登录 / 注册
  -> 进入应用
  -> 默认成为 Free 用户
```

### 7.2 升级路径

```text
用户在应用中使用 Free 套餐
  -> 尝试使用 RSS / YouTube
  -> 或达到订阅数上限
  -> 看到升级提示
  -> 打开支付流程
  -> 支付成功
  -> 套餐升级为 Pro
```

### 7.3 应用内套餐感知

| 页面 | Free 用户 | Pro 用户 |
|---|---|---|
| Daily Digest | 正常使用 | 正常使用 |
| Subscriptions | 正常使用，接近/超过上限时提示升级 | 无限制 |
| RSS | 页面可见，但添加时拦截并提示升级 | 正常使用 |
| YouTube | 页面可见，但添加时拦截并提示升级 | 正常使用 |
| Settings | 显示 Free 状态和升级入口 | 显示 Pro 状态和管理入口 |

不建议一开始做“重付费墙”。

更适合的方式是：

- 用户能理解功能是什么
- 真正操作时再触发升级提示

---

## 八、计费与权限模型

虽然当前阶段强调低复杂度，但计费状态仍然不能设计得过于草率。

不建议只保留一张简单的 `user_plans` 表承载所有状态。

推荐采用最小分层模型：

### 1. `billing_customers`

记录用户和支付平台客户对象的映射。

### 2. `billing_subscriptions`

记录外部支付订阅事实。

### 3. `user_entitlements`

记录当前生效套餐权限。

### 4. `billing_webhook_events`

记录 webhook 事件，确保幂等和审计。

### 设计原则

- 支付平台状态属于“账单事实”
- 应用内放行规则属于“当前权限”
- 前端展示和后端校验都以 entitlement 为准

这样可以避免：

- 取消订阅状态混乱
- 重复 webhook 导致状态脏写
- 支付状态和权限状态耦合过深

---

## 九、套餐限制与统一判定

### 套餐配置

```typescript
const PLAN_LIMITS = {
  free: {
    sources: ["substack"],
    maxFeeds: 10,
    historyDays: 7,
    manualDigestCooldownMinutes: 60,
  },
  pro: {
    sources: ["substack", "rss", "youtube"],
    maxFeeds: Infinity,
    historyDays: 90,
    manualDigestCooldownMinutes: 0,
  },
};
```

### 判定原则

所有套餐限制必须由后端统一执行。

至少覆盖：

- 添加单个订阅源
- 批量导入订阅源
- 恢复历史订阅
- 手动生成或重生成 Digest
- 查询历史 Digest

### 推荐实现

建议新增 `plan-service.ts`，统一提供：

- `getUserEntitlement(userId)`
- `getUserPlanLimits(userId)`
- `assertCanUseSourceType(userId, sourceType)`
- `assertCanAddFeeds(userId, countDelta, sourceType)`
- `assertCanGenerateDigest(userId)`
- `getHistoryRetentionDays(userId)`

这样可以避免把规则散落在多个路由里。

---

## 十、历史保留策略

当前阶段建议先做“显示层限制”，不要急着做物理删除。

### 第一阶段

- Free 用户只展示最近 7 天 Digest
- Pro 用户展示最近 90 天 Digest

### 第二阶段

如果后续确认有必要，再增加后台清理任务：

- 周期性删除超出保留期的数据
- 删除 `digests` 时依赖 `digest_items` 级联删除

### 为什么先不删

- 规则更稳
- 更方便排查问题
- 降低误删风险
- 更适合当前验证阶段

---

## 十一、支付方案

### 原则

采用 Merchant of Record (MoR) 平台。

原因：

- 降低税务复杂度
- 降低合规压力
- 更适合个人或小团队早期产品

### 候选平台

- Paddle
- LemonSqueezy

### 接入原则

不要让前端直接决定套餐状态。

推荐流程：

```text
前端请求后端创建 checkout session
  -> 前端打开支付页面或 overlay
  -> 支付成功后平台发送 webhook
  -> 后端验签、落库、更新 billing_subscriptions
  -> 后端刷新 user_entitlements
  -> 前端刷新当前套餐状态
```

### 客户门户

如果支付平台支持，建议提供：

- 管理订阅
- 取消续费
- 更新支付方式

优先使用平台自带 customer portal，不自建。

---

## 十二、API 设计

建议新增以下 API。

### 面向前端

- `GET /api/billing/entitlement`
  - 返回当前计划、状态、已用量、上限、续费信息

- `POST /api/billing/checkout-session`
  - 为当前用户创建支付会话

- `POST /api/billing/customer-portal`
  - 返回客户门户入口

### 面向支付平台

- `POST /api/billing/webhook`
  - 接收 webhook
  - 验签
  - 幂等处理
  - 更新账单事实
  - 刷新 entitlement

---

## 十三、代码改造清单

### 后端

- `server/src/db/schema.ts`
  - 新增 billing 相关表

- `server/src/services/plan-service.ts`
  - 套餐判定与权限检查

- `server/src/services/billing-service.ts`
  - checkout、webhook、entitlement 刷新

- `server/src/routes/billing.ts`
  - entitlement API
  - checkout API
  - portal API
  - webhook

### 前端

- `src/hooks/usePlan.ts`
  - 获取当前套餐与用量

- `src/components/UpgradeGuard.tsx`
  - 升级提示组件

- `src/pages/Settings.tsx`
  - 套餐状态卡片

- `src/pages/Login.tsx` 或公开页面相关组件
  - 升级为 landing page

- 新增公开页面
  - `Pricing`
  - `FAQ`

### 静态资产

- `public/robots.txt`
- `public/sitemap.xml`

### 暂不引入

- 独立官网项目
- Next.js / Astro 改造
- Team 套餐
- Seat 管理
- 复杂 usage metering
- Redis 计费缓存
- 自建支付表单

---

## 十四、实施顺序

### Phase 1 — 套餐与权限基线

1. 新增 billing / entitlement 基础表
2. 实现 `plan-service`
3. 落地 `/api/billing/entitlement`
4. 接入订阅创建和导入时的统一套餐校验
5. 预留最小成本保护

### Phase 2 — 前端套餐感知

1. `usePlan` Hook
2. Settings 套餐状态卡片
3. RSS / YouTube 升级提示
4. Subscriptions 页容量提示

### Phase 3 — 支付接入

1. 确定 MoR 平台
2. 创建产品和价格
3. 实现 checkout session
4. 实现 webhook 验签与状态同步
5. 联调升级链路

### Phase 4 — 最小公开展示页

1. 优化 Landing Page
2. 新增 Pricing 页面
3. 新增 FAQ 页面
4. 补基础 metadata、OG、robots、sitemap

---

## 十五、上线前检查清单

- 用户是否能顺利注册和进入 Free 套餐
- 免费用户是否无法创建 RSS / YouTube 订阅
- 免费用户是否在达到订阅数上限时被正确拦截
- 支付成功后 entitlement 是否正确刷新
- 取消续费或支付失败后权限是否正确收敛
- Settings 页面信息是否和实际权限一致
- Landing / Pricing / FAQ 是否足够解释产品
- 分享链接时是否有基本的标题和预览图

---

## 十六、最终判断

DigestDesk 当前阶段不需要追求“大而全”的上市网站架构。

更合适的方案是：

- 保持单项目
- 保持低复杂度
- 把收费闭环和权限边界做好
- 用最小公开页面承接外部分发流量

这是当前阶段最务实、最适合真实上线验证的方案。
