FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY services/xstockstrat-trader/package.json ./services/xstockstrat-trader/
RUN pnpm install --frozen-lockfile --filter xstockstrat-trader

FROM base AS builder
WORKDIR /app
COPY --from=deps /workspace/node_modules ./node_modules
COPY services/xstockstrat-trader/ .
RUN pnpm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
