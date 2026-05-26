FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY services/xstockstrat-insights/package.json ./services/xstockstrat-insights/
RUN pnpm install --frozen-lockfile --filter xstockstrat-insights

FROM base AS builder
WORKDIR /app
COPY --from=deps /workspace/node_modules ./node_modules
COPY services/xstockstrat-insights/ .
RUN pnpm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3001
CMD ["node", "server.js"]
