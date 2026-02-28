# 部署指南

本项目是一个全栈应用（React 前端 + Node.js/Express 后端 + SQLite 数据库）。推荐使用支持 Docker 的平台进行部署。

## ⚠️ 核心注意点 (必读)

无论使用哪个平台，以下两点至关重要，否则会导致**数据丢失**或**服务不可用**：

1.  **数据持久化 (Volume)**：
    *   本项目使用 SQLite 文件数据库，数据存储在 `/app/server/data`。
    *   **必须**在部署平台配置 Volume (磁盘挂载)，将平台的持久化存储挂载到容器内的 `/app/server/data` 目录。
    *   如果不配置，每次重新部署或重启，所有订阅源、文章和摘要记录都会**丢失**。

2.  **环境变量**:
    *   `GOOGLE_GENERATIVE_AI_API_KEY`: 推荐。Google AI API 密钥（Gemini Flash），与 OPENAI_API_KEY 二选一，同时存在时优先使用 Google。
    *   `OPENAI_API_KEY`: 备选。OpenAI API 密钥。
    *   `CF_SEARCH_PROXY_URL`: 必填。Cloudflare Worker 代理地址，用于绕过 Substack 搜索限制。
    *   `CF_SEARCH_PROXY_TOKEN`: 必填。Cloudflare Worker 访问令牌。
    *   `PORT`: 选填。默认为 `8080`。
    *   `NODE_ENV`: 选填。默认为 `production`。
    *   `AI_MODEL`: 选填。指定 AI 模型 ID（默认 `gemini-2.5-flash-preview-05-20` 或 `gpt-5-nano`，取决于使用的 API 密钥）。

---

## 平台详细指南

### 1. Railway (推荐)

Railway 对全栈应用支持极佳，配置 Volume 非常直观。

*   **创建项目**: 选择 "Deploy from GitHub repo"。
*   **添加 Volume (关键)**:
    1.  项目创建后，点击服务卡片。
    2.  进入 `Volumes` 选项卡。
    3.  点击 `Add Volume`。
    4.  **Mount Path** (挂载路径) 填写: `/app/server/data`
*   **环境变量**:
    1.  进入 `Variables` 选项卡。
    2.  添加 `GOOGLE_GENERATIVE_AI_API_KEY`（或 `OPENAI_API_KEY`）、`CF_SEARCH_PROXY_URL`、`CF_SEARCH_PROXY_TOKEN` 等。
*   **域名**:
    1.  进入 `Networking` -> `Public`。
    2.  点击 `Generate Domain` 或绑定自定义域名。

### 3. Docker / VPS (自托管)

如果你有自己的服务器，可以直接使用 Docker 部署。

```bash
# 1. 构建镜像
docker build -t digestdesk .

# 2. 准备数据目录
mkdir -p $(pwd)/digestdesk-data

# 3. 运行容器 (务必挂载数据目录)
docker run -d \
  -p 8080:8080 \
  -v $(pwd)/digestdesk-data:/app/server/data \
  -e GOOGLE_GENERATIVE_AI_API_KEY="your-key" \
  --name digestdesk \
  digestdesk
```

## 故障排查

*   **页面 404**: 检查是否访问了不存在的路由。后端已配置 SPA Fallback，所有未匹配的路由都会返回 `index.html`。
*   **数据丢失**: 检查 Volume 是否正确挂载到 `/app/server/data`。
*   **AI 摘要失败**: 检查 `GOOGLE_GENERATIVE_AI_API_KEY` 或 `OPENAI_API_KEY` 是否正确设置，且账户有余额。
