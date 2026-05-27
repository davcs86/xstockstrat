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
COPY services/xstockstrat-config-ui/package.json ./services/xstockstrat-config-ui/
RUN pnpm install --frozen-lockfile --filter xstockstrat-config-ui

FROM base AS builder
WORKDIR /workspace
COPY --from=deps /workspace ./
COPY services/xstockstrat-config-ui/ ./services/xstockstrat-config-ui/
RUN pnpm --filter xstockstrat-config-ui run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
COPY --from=builder /workspace/services/xstockstrat-config-ui/.next/standalone ./
COPY --from=builder /workspace/services/xstockstrat-config-ui/.next/static ./.next/static
EXPOSE 3002
CMD ["node", "server.js"]
