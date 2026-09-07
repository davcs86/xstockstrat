FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
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

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /deploy ./
COPY scripts/wait-for-deps.sh /usr/local/bin/wait-for-deps.sh
COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
# manage-users.py — Python CLI for user provisioning / password resets
# hadolint ignore=DL3018
RUN apk add --no-cache python3 py3-pip
COPY scripts/requirements-manage-users.txt /tmp/requirements-manage-users.txt
RUN pip3 install --break-system-packages --no-cache-dir -r /tmp/requirements-manage-users.txt \
 && rm /tmp/requirements-manage-users.txt
COPY scripts/manage-users.py /app/scripts/manage-users.py
RUN chmod +x /usr/local/bin/wait-for-deps.sh /docker-entrypoint.sh /app/scripts/manage-users.py
EXPOSE 50058
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
