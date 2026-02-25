# --- 基础阶段 (Base) ---
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# --- 依赖安装阶段 (Deps) ---
FROM base AS deps
WORKDIR /app
# 复制所有 package.json 和 lockfile 以利用缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/
RUN pnpm install --frozen-lockfile

# --- 构建阶段 (Builder) ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY . .
# 构建前端到 /app/dist
RUN pnpm build:all

# --- 运行阶段 (Runner) ---
FROM base AS runner
WORKDIR /app

# 设置生产环境
ENV NODE_ENV=production
ENV PORT=3001

# 复制构建产物和后端源码
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

# 暴露端口 (Zeabur 会自动识别并映射)
EXPOSE 3001

# 启动命令
# 1. 确保数据目录存在并有权限 (SQLite 使用)
# 2. 直接启动后端服务
CMD mkdir -p server/data && pnpm start
