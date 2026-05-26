FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# Configure npm to retry failed requests and use longer timeouts
RUN npm config set fetch-timeout 120000 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5

FROM base AS builder
WORKDIR /workspace

# Copy workspace root manifests and proto stubs (dep layer caching)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/proto/gen/ts/ ./packages/proto/gen/ts/
COPY services/xstockstrat-config/package.json ./services/xstockstrat-config/
# Install all workspace deps
RUN pnpm install --frozen-lockfile

# Compile proto stubs
RUN pnpm --filter @xstockstrat/proto run build

# Build service
COPY services/xstockstrat-config/ ./services/xstockstrat-config/
RUN pnpm --filter xstockstrat-config run build

# Create self-contained deployment bundle (resolves workspace symlinks)
RUN pnpm deploy --filter xstockstrat-config --prod /deploy

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /deploy ./
EXPOSE 50060 8060
CMD ["node", "dist/index.js"]
