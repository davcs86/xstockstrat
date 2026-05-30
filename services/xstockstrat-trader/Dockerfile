FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# Configure npm to retry failed requests and use longer timeouts
RUN npm config set fetch-timeout 120000 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5

FROM base AS deps
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/proto/gen/ts/ ./packages/proto/gen/ts/
COPY services/xstockstrat-trader/package.json ./services/xstockstrat-trader/
RUN pnpm install --frozen-lockfile --filter xstockstrat-trader

FROM base AS builder
WORKDIR /workspace
COPY --from=deps /workspace ./
COPY services/xstockstrat-trader/ ./services/xstockstrat-trader/
RUN pnpm --filter xstockstrat-trader run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /workspace/services/xstockstrat-trader/.next/standalone ./
COPY --from=builder /workspace/services/xstockstrat-trader/.next/static ./services/xstockstrat-trader/.next/static
EXPOSE 3000
CMD ["node", "services/xstockstrat-trader/server.js"]
