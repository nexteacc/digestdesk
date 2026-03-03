# --- 基础阶段 (Base) ---
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# --- 依赖安装阶段 (Deps) ---
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/
RUN pnpm install --frozen-lockfile

# --- 构建阶段 (Builder) ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY . .
# 根据 package.json 里的脚本，这会构建前端到 /dist，并将后端编译也输出到 /dist
RUN pnpm build:all

# --- 运行阶段 (Runner) ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# 复制构建产物
# 1. 复制前端构建产物到 dist/
COPY --from=builder /app/dist ./dist
# 2. 复制后端编译产物到 dist/ (实现扁平化结构，匹配启动命令)
COPY --from=builder /app/server/dist/* ./dist/

# 复制 package.json 和运行时依赖 (补齐双重 node_modules)
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/node_modules ./server/node_modules

# 创建数据目录 (server/data/)，配合 dist/index.js 中的 ../../data 路径
RUN mkdir -p server/data && chmod 777 server/data

# 暴露端口
EXPOSE 8080

# 启动后端服务 (直接从根目录的 dist 运行)
CMD ["node", "dist/index.js"]
