FROM node:20-slim

# 启用 pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# 复制项目文件
COPY . .

# 安装依赖
RUN pnpm install --frozen-lockfile

# 构建前端应用到 dist 目录
RUN pnpm build:all

# 暴露端口
EXPOSE 3001

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3001

# 启动服务 (通过 package.json 中的 start 脚本启动后端，后端会自动托管前端静态文件)
CMD ["pnpm", "start"]
