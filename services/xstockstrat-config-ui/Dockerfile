FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY services/xstockstrat-config-ui/package.json ./services/xstockstrat-config-ui/
RUN pnpm install --frozen-lockfile --filter xstockstrat-config-ui

FROM base AS builder
WORKDIR /app
COPY --from=deps /workspace/node_modules ./node_modules
COPY services/xstockstrat-config-ui/ .
RUN pnpm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3002
CMD ["node", "server.js"]
