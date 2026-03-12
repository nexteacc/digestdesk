# RSS 通用源支持 — 实现总结

## 1. 功能概述
DigestDesk 现已完整支持通用 RSS 订阅源。通过本次升级，系统从单一的 Substack 订阅工具演进为支持多平台（Substack, RSS）的内容聚合与 AI 总结引擎。

## 2. 核心架构变更：分阶段巡检与交付
为了优化 AI 总结的频率限制并提升用户体验，采用了**解耦架构**：
- **阶段 1 & 2 (巡检与预处理)**：每 4 小时执行一次。系统自动发现新文章，并通过 Jina Reader 提取全文，随后调用 AI 进行深度总结（One-liner & Key Insights）。
- **阶段 3 (聚合与交付)**：每天早上 8:00 (Asia/Shanghai) 准时生成日报。由于内容已在预处理阶段就绪，日报生成可实现瞬时交付。

## 3. 技术实现细节

### 3.1 数据库与类型定义
- **Schema 扩展**：`feeds` 表新增 `source_type` 字段（enum: `substack`, `rss`, `youtube`），默认值为 `substack`。
- **共享类型**：在 `shared/types.ts` 中统领前后端数据契约，新增 `DiscoveredFeed` 类型用于探测预览。

### 3.2 后端服务
- **RSS 探测服务 (`rss-discovery.ts`)**：实现三层探测逻辑：
  1. 直接解析 URL（如果是 Feed 地址）。
  2. HTML `<link>` 标签自动发现（如果是网站首页）。
  3. 常用路径尝试（如 `/feed`, `/rss` 等）。
- **独立路由 (`rss-feeds.ts`)**：提供 `/api/rss-feeds/discover` 和 CRUD 接口，保持与 Substack 逻辑的解耦。
- **通用同步逻辑 (`rss.ts`)**：复用现有的数据管线，支持任何标准 RSS/Atom 协议。

### 3.3 前端页面
- **RSS 管理页面 (`RssFeeds.tsx`)**：
  - 支持粘贴 URL 自动探测源信息。
  - 提供订阅预览（标题、描述、Logo）。
  - 实现批量取消订阅模式。
- **偏好设置页面 (`Settings.tsx`)**：
  - 用户可自主选择每日日报的生成时间（通过精简的下拉框选择，如 07:00, 18:00）。
  - 支持配置所在时区，采用标准化的 `UTC±X (City)` 格式（如 `UTC+8 (Beijing)`），确保定时任务在全球任何服务器上都能准点触发。
- **导航集成**：侧边栏新增 RSS 专属入口和设置入口。

## 4. 文件变动清单
| 模块 | 文件 | 说明 |
| :--- | :--- | :--- |
| **数据库** | `server/src/db/schema.ts` | 添加 `sourceType` 字段及 `settings` 表 |
| **共享层** | `shared/types.ts` | 更新 Feed 类型，新增探测与设置类型 |
| **服务层** | `server/src/services/rss-discovery.ts` | **新建** RSS 自动探测逻辑 |
| **路由层** | `server/src/routes/rss-feeds.ts` | **新建** RSS 管理 API |
| **路由层** | `server/src/routes/settings.ts` | **新建** 偏好设置 API |
| **调度层** | `server/src/cron/scheduler.ts` | **重构** 定时任务为分阶段模式，支持动态调时 |
| **前端页面** | `src/pages/RssFeeds.tsx` | **新建** RSS 订阅管理页面 |
| **前端页面** | `src/pages/Settings.tsx` | **新建** 偏好设置管理页面 |
| **API 客户端** | `src/lib/api.ts` | 新增 RSS 与 Settings 相关请求函数 |

## 5. 验证方案
- **探测测试**：可尝试 `https://sspai.com` 或 `https://blog.google/rss`。
- **同步测试**：订阅后可在后台日志观察到 `Initial sync` 触发。
- **设置测试**：在“偏好设置”中修改时间，观察后端日志是否出现 `Rescheduling digest job`。
- **日报测试**：在设定的新时间点检查生成的日报。

---
*总结日期：2026-03-12*
