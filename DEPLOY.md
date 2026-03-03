# 部署指南

本项目是一个全栈应用（React 前端 + Node.js/Express 后端 + SQLite 数据库）。推荐使用支持 Node.js 的云平台进行部署。

## ⚠️ 核心注意点 (必读)

无论使用哪个平台，以下两点至关重要，否则会导致**数据丢失**或**服务不可用**：

1.  **数据持久化 (Volume)**：
    *   本项目使用 SQLite 文件数据库，数据存储在 `server/data` 目录。
    *   **必须**在部署平台配置 Volume (磁盘挂载)，将持久化存储挂载到 `server/data` 目录。
    *   如果不配置，每次重新部署或重启，所有订阅源、文章和摘要记录都会**丢失**。

2.  **环境变量**:
    *   `AI_API_KEY`: **必填**。AI API 密钥（支持 OpenAI、Kimi、DeepSeek、Zhipu 等 OpenAI 兼容协议的厂商）。
    *   `AI_BASE_URL`: 选填。AI 厂商接口地址（如果使用 OpenAI 官方则无需填写，使用其他厂商时填写对应地址）。
    *   `AI_MODEL`: 选填。指定 AI 模型 ID（默认 `gpt-4o-mini`）。
    *   `CF_SEARCH_PROXY_URL`: 选填（生产环境推荐）。Cloudflare Worker 代理地址，用于绕过 Substack 搜索限制。不设则直连 Substack API。
    *   `CF_SEARCH_PROXY_TOKEN`: 选填。Cloudflare Worker 访问令牌，配合 `CF_SEARCH_PROXY_URL` 使用。
    *   `PORT`: 选填。默认为 `8080`。
    *   `NODE_ENV`: 选填。默认为 `production`。

---

## Zeabur 部署指南

*   **创建项目**:
    1.  在 Zeabur 控制台选择 "Deploy from GitHub repo"。
    2.  授权并选择你的项目仓库。
    3.  Zeabur 会自动识别为 Node.js 项目。

*   **构建与启动**:
    *   Build Command: `pnpm build`（自动构建前端 + 编译后端）
    *   Start Command: `pnpm start`（启动 Express 服务）
    *   端口: `8080`

*   **添加 Volume (关键)**:
    1.  进入服务的 `Volumes` 选项卡。
    2.  点击 `Add Volume`。
    3.  **Mount Path** (挂载路径) 填写: `server/data`

*   **环境变量**:
    1.  进入服务的 `Variables` 选项卡。
    2.  添加 `AI_API_KEY`（必填）、`CF_SEARCH_PROXY_URL`、`CF_SEARCH_PROXY_TOKEN` 等环境变量。

*   **域名**:
    1.  进入服务的 `Networking` 选项卡。
    2.  点击 `Generate Domain` 或绑定你的自定义域名。

## 故障排查

*   **页面 404**: 检查是否访问了不存在的路由。后端已配置 SPA Fallback，所有未匹配的路由都会返回 `index.html`。
*   **数据丢失**: 检查 Volume 是否正确挂载到 `server/data`。
*   **AI 摘要失败**: 检查 `AI_API_KEY` 是否正确设置，且账户有余额。如使用非 OpenAI 厂商，检查 `AI_BASE_URL` 是否正确。
