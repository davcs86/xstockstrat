FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# Configure npm to retry failed requests and use longer timeouts
RUN npm config set fetch-timeout 120000 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5

FROM base AS deps
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/proto/gen/ts/ ./packages/proto/gen/ts/
COPY services/xstockstrat-insights/package.json ./services/xstockstrat-insights/
RUN pnpm install --frozen-lockfile --filter xstockstrat-insights

FROM base AS builder
WORKDIR /workspace
COPY --from=deps /workspace ./
COPY services/xstockstrat-insights/ ./services/xstockstrat-insights/
RUN pnpm --filter xstockstrat-insights run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=builder /workspace/services/xstockstrat-insights/.next/standalone ./
COPY --from=builder /workspace/services/xstockstrat-insights/.next/static ./.next/static
EXPOSE 3001
CMD ["node", "server.js"]
