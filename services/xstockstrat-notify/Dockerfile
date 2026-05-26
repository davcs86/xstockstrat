FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /workspace

# Copy workspace root manifests (dep layer caching)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/proto/gen/ts/package.json ./packages/proto/gen/ts/
COPY services/xstockstrat-notify/package.json ./services/xstockstrat-notify/
RUN pnpm install --frozen-lockfile

# Copy source and compile proto stubs first
COPY packages/proto/gen/ts/ ./packages/proto/gen/ts/
RUN pnpm --filter @xstockstrat/proto run build

# Build service
COPY services/xstockstrat-notify/ ./services/xstockstrat-notify/
RUN pnpm --filter xstockstrat-notify run build

# Create self-contained deployment bundle (resolves workspace symlinks)
RUN pnpm deploy --filter xstockstrat-notify --prod /deploy

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /deploy ./
EXPOSE 50059 8059
CMD ["node", "dist/index.js"]
