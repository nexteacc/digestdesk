# 部署指南

本项目是一个全栈应用（React 前端 + Node.js/Express 后端 + SQLite 数据库）。推荐使用支持 Docker 的平台进行部署。

## 推荐平台

### 1. Railway (推荐)
适合全栈应用，支持持久化存储（Volume），配置简单。

**步骤：**
1. 在 [Railway](https://railway.app/) 创建新项目。
2. 连接你的 GitHub 仓库。
3. Railway 会自动检测到 `Dockerfile` 并开始构建。
4. **重要**：为了防止数据丢失，必须添加一个 Volume。
   - 在 Railway 项目设置中，添加 Volume。
   - 挂载路径设置为 `/app/server/data`。
5. 在 Variables 中设置环境变量（参考 `.env.example`）。

### 2. Zeabur
国内访问速度较快，对全栈应用支持极佳。

**步骤：**
1. 在 [Zeabur](https://zeabur.com/) 创建项目。
2. 部署 Git 仓库。
3. Zeabur 会自动识别并构建。
4. **重要**：添加 Volume 挂载到 `/app/server/data` 以持久化 SQLite 数据。

### 3. Docker / VPS
如果你有自己的服务器，可以直接使用 Docker 部署。

```bash
# 构建镜像
docker build -t digestdesk .

# 运行容器 (挂载数据目录)
docker run -d \
  -p 3001:3001 \
  -v $(pwd)/server/data:/app/server/data \
  --name digestdesk \
  digestdesk
```

## 注意事项

### 数据库持久化
本项目使用 SQLite 文件数据库，数据存储在 `server/data/digestdesk.db`。
**必须**挂载 Volume 到 `/app/server/data`，否则每次重新部署数据都会丢失。

### 环境变量
请确保在部署平台设置以下环境变量：
- `OPENAI_API_KEY`: 用于 AI 摘要生成
- `PORT`: 3001 (通常平台会自动注入，或者你可以手动设置)
