ARG UI_THEME=staging

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
# Configure npm to retry failed requests and use longer timeouts
RUN npm config set fetch-timeout 120000 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5

FROM base AS deps
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/proto/gen/ts/ ./packages/proto/gen/ts/
COPY services/xstockstrat-ui/package.json ./services/xstockstrat-ui/
RUN pnpm install --frozen-lockfile --filter xstockstrat-ui

FROM base AS builder
WORKDIR /workspace
COPY --from=deps /workspace ./
COPY services/xstockstrat-ui/ ./services/xstockstrat-ui/
ARG UI_THEME
RUN pnpm --filter xstockstrat-ui run build

FROM node:24-alpine AS runner
ARG UI_THEME
LABEL io.xstockstrat.ui-theme=$UI_THEME
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /workspace/services/xstockstrat-ui/.next/standalone ./
COPY --from=builder /workspace/services/xstockstrat-ui/.next/static ./services/xstockstrat-ui/.next/static
# Next.js `output: standalone` does NOT include public/ — copy it so the PWA icons and service
# worker (feature 165) are served at runtime; the manifest comes from src/app/manifest.webmanifest.
COPY --from=builder /workspace/services/xstockstrat-ui/public ./services/xstockstrat-ui/public
EXPOSE 3000
CMD ["node", "services/xstockstrat-ui/server.js"]
