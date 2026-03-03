FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY . .
RUN pnpm build:all

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/node_modules ./server/node_modules

RUN mkdir -p server/data && chmod 777 server/data

EXPOSE 8080

CMD ["node", "server/dist/index.js"]
