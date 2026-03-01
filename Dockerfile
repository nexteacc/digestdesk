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
# 构建前端 + 编译后端 TypeScript
RUN pnpm build:all

# --- 运行阶段 (Runner) ---
FROM base AS runner
WORKDIR /app

# 设置生产环境
ENV NODE_ENV=production
ENV PORT=8080

# 复制前端构建产物
COPY --from=builder /app/dist ./dist
# 复制后端编译产物（JS，非 .ts 源码）
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/package.json ./server/package.json
# 复制运行时依赖
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/node_modules ./server/node_modules

# 创建 SQLite 数据目录
RUN mkdir -p server/data

# 暴露端口 (Zeabur 会自动识别并映射)
EXPOSE 8080

# 启动命令：直接用 node 执行预编译的 JS（无需 tsx 运行时转译）
CMD ["node", "server/dist/index.js"]
