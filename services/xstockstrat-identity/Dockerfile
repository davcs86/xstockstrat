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
COPY services/xstockstrat-identity/package.json ./services/xstockstrat-identity/
# Install all workspace deps
RUN pnpm install --frozen-lockfile

# Compile proto stubs
RUN pnpm --filter @xstockstrat/proto run build

# Build service
COPY services/xstockstrat-identity/ ./services/xstockstrat-identity/
RUN pnpm --filter xstockstrat-identity run build

# Create self-contained deployment bundle (resolves workspace symlinks)
RUN pnpm deploy --filter xstockstrat-identity --prod /deploy

FROM node:22-alpine AS runner
RUN apk add --no-cache postgresql-client
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /deploy ./
COPY scripts/wait-for-deps.sh /usr/local/bin/wait-for-deps.sh
COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
COPY scripts/manage-users.sh /app/scripts/manage-users.sh
RUN chmod +x /usr/local/bin/wait-for-deps.sh /docker-entrypoint.sh /app/scripts/manage-users.sh
EXPOSE 50058
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
