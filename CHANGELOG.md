# Changelog

All production promotions from `main-dev` to `main` are recorded here.
Each entry corresponds to one `main-dev → main` PR merge.

## 2026-05-21

### Features
- fix-grafana-otel-variables: Fixes OTel env var configuration across docker-compose.yml and DigitalOcean app specs — runtime derivation of resource attributes in all 13 service telemetry modules, unified env var naming (OTEL_EXPORTER_OTLP_*), and SERVICE_NAME normalization. (`code-completed`)

### Summary
1 commit, 1 feature merge since last promotion.

---

## 2026-06-01

### Features
- upgrade-nextjs15: Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.

### Summary
-5 commits, 0 feature merges since last promotion.

---

## 2026-06-01

### Features
- upgrade-nextjs15: Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.

### Summary
6 commits, 0 feature merges since last promotion.

---

## 2026-05-30

### Summary
-14 commits, 0 feature merges since last promotion.

---

## 2026-05-30

### Summary
16 commits, 0 feature merges since last promotion.

---

## 2026-05-29

### Summary
-18 commits, 0 feature merges since last promotion.

---

## 2026-05-29

### Summary
20 commits, 0 feature merges since last promotion.

---

## 2026-05-28

### Summary
29 commits, 0 feature merges since last promotion.

---

## 2026-05-27

### Features
- ci-docker-registry-deploy: Move Docker image builds from DigitalOcean's infrastructure into GitHub Actions CI, push images to a container registry, and configure DO App Platform to deploy pre-built images. This surfaces build failures at PR time rather than during deployment and eliminates cold `pnpm install + pnpm build` runs on DO for every deploy.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-27

### Features
- ci-docker-registry-deploy: Move Docker image builds from DigitalOcean's infrastructure into GitHub Actions CI, push images to a container registry, and configure DO App Platform to deploy pre-built images. This surfaces build failures at PR time rather than during deployment and eliminates cold `pnpm install + pnpm build` runs on DO for every deploy.

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-26

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-26

### Summary
0 commits, 0 feature merges since last promotion.

---

## 2026-05-26

### Summary
4 commits, 0 feature merges since last promotion.

---

## 2026-05-25

### Summary
0 commits, 0 feature merges since last promotion.

---

## 2026-05-25

### Features
- agent-mcp-server: Phase 1 of the AI agent service: a new Python MCP server (`xstockstrat-agent`) that exposes platform capabilities as MCP tools, enabling an operator to manually trigger AI-assisted signal extraction workflows from Claude.ai with no scheduler or automation infrastructure. Prerequisite: signal-source-registry (008).

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-24

### Features
- trader-chart-panel: Add an OHLCV candlestick chart panel to the `xstockstrat-trader` UI. The chart polls `GetBars` on a configurable interval (no streaming required given 5m minimum timeframe) and supports a symbol selector and timeframe switcher (1m, 5m, 15m, 1h, 1d). Backend RPCs, service logic, and DB layer are fully implemented — only the frontend component is missing.

### Summary
5 commits, 0 feature merges since last promotion.

---

## 2026-05-24

### Features
- trader-chart-panel: Add an OHLCV candlestick chart panel to the `xstockstrat-trader` UI. The chart polls `GetBars` on a configurable interval (no streaming required given 5m minimum timeframe) and supports a symbol selector and timeframe switcher (1m, 5m, 15m, 1h, 1d). Backend RPCs, service logic, and DB layer are fully implemented — only the frontend component is missing.

### Summary
2 commits, -1 feature merges since last promotion.

---

## 2026-05-24

### Summary
2 commits, 2 feature merges since last promotion.

---

## 2026-05-24

### Features
- signal-source-weighting: Add per-source reliability weights to the signal aggregation in the analysis service so that higher-trust sources (e.g. Goldman) have proportionally more influence on the combined conviction score than low-quality newsletters. Weights are configurable via the config service without code changes.

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-23

### Summary
-1 commits, -1 feature merges since last promotion.

---

## 2026-05-23

### Summary
2 commits, 1 feature merges since last promotion.

---

## 2026-05-22

### Features
- signal-source-registry: Add a DB-backed signal source registry to the ingest service that defines all valid sources, their types (simple_email, email_attachment, linked_email, simple_website, authenticated_website), and per-source Python extractor modules. The registry enforces canonical source slugs across ingest and analysis, and is a prerequisite for the AI agent feature and signal-source-weighting (007).

### Proto Changes
- ingest/v1/ingest.proto

### Summary
12 commits, 3 feature merges since last promotion.

---

## 2026-05-22

### Features
- phase-2-data-layer: `GetPnL` in `xstockstrat-portfolio` always returns `realized_pnl = 0` because the service never queries the ledger for closed-position fills. The root cause is in `xstockstrat-trading`: neither broker engine (`AlpacaClient` nor `IBKRClient`) populates `FilledAvgPrice` in `BrokerOrder`, so `order.filled` ledger events are always emitted with `fill_price = 0.0`. This feature fixes both bugs: the trading service broker/pollFills root cause, and the portfolio service GetPnL ledger-query gap.

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-16

### Summary
5 commits, 0 feature merges since last promotion.

---

## 2026-05-21

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-21

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-21

### Features
- wire-fe-auth: Wire the fully-built `xstockstrat-identity` service into all three Next.js frontends (trader, insights, config-ui) — adding login pages, route-protection middleware, JWT session management, and Bearer token injection on all Connect-RPC calls. Establish a standard `user_id` propagation convention for service-to-service gRPC calls.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-20

### Features
- wire-fe-auth: Wire the fully-built `xstockstrat-identity` service into all three Next.js frontends (trader, insights, config-ui) — adding login pages, route-protection middleware, JWT session management, and Bearer token injection on all Connect-RPC calls. Establish a standard `user_id` propagation convention for service-to-service gRPC calls.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-20

### Features
- wire-fe-auth: Wire the fully-built `xstockstrat-identity` service into all three Next.js frontends (trader, insights, config-ui) — adding login pages, route-protection middleware, JWT session management, and Bearer token injection on all Connect-RPC calls. Establish a standard `user_id` propagation convention for service-to-service gRPC calls.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-19

### Features
- wire-fe-auth: Wire the fully-built `xstockstrat-identity` service into all three Next.js frontends (trader, insights, config-ui) — adding login pages, route-protection middleware, JWT session management, and Bearer token injection on all Connect-RPC calls. Establish a standard `user_id` propagation convention for service-to-service gRPC calls.

### Summary
5 commits, 0 feature merges since last promotion.

---

## 2026-05-18

### Summary
0 commits, 0 feature merges since last promotion.

---

## 2026-05-18

### Features
- do-nginx-integration: Wire the nginx reverse proxy (established locally by feature 005-frontend-reverse-proxy) into the DigitalOcean App Platform deployment by updating `.do/app.yaml` and `.do/app.dev.yaml` so that the unified `/trader`, `/insights`, `/config-ui` routing is live in both dev and production environments.
- remove-n8n-references: Remove all n8n references from the codebase and documentation. Webhook endpoints used only by n8n (config, ledger, identity, trading, indicators) are deleted entirely — callers use Connect-RPC directly. Endpoints that serve the agent MCP server's ingestion goal (ingest, notify, analysis) are kept with the `/n8n/` path segment removed. The `packages/n8n/` directory is deleted and all docs updated.

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-18

### Features
- do-nginx-integration: Wire the nginx reverse proxy (established locally by feature 005-frontend-reverse-proxy) into the DigitalOcean App Platform deployment by updating `.do/app.yaml` and `.do/app.dev.yaml` so that the unified `/trader`, `/insights`, `/config-ui` routing is live in both dev and production environments.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-16

### Summary
-4 commits, 0 feature merges since last promotion.

---

## 2026-05-12

### Features
- broker-accounts-ui: Surfaces registered broker accounts and per-account portfolio data in the `xstockstrat-trader` UI, completing the UI half of the `add-ikbr-account-support` feature which added backend RPCs but explicitly deferred all frontend changes.
- frontend-reverse-proxy: Implement a production-ready nginx reverse proxy that routes all frontend requests from a unified public URL (`/trader`, `/insights`, `/config-ui`) and centralizes authentication, CORS, rate limiting, and security middleware across all three Next.js frontends.

### Summary
10 commits, 4 feature merges since last promotion.
---

## 2026-05-15

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-12

### Summary
-3 commits, -3 feature merges since last promotion.

---

## 2026-05-12

### Summary
2 commits, 1 feature merges since last promotion.

---

## 2026-05-12

### Features
- broker-accounts-ui: Surfaces registered broker accounts and per-account portfolio data in the `xstockstrat-trader` UI, completing the UI half of the `add-ikbr-account-support` feature which added backend RPCs but explicitly deferred all frontend changes.
- make-repo-public-secure: Audit the xstockstrat repository for all hardcoded secrets, credentials, API keys, and sensitive configuration values, remove or replace them with environment variable references or safe placeholders, and update documentation to reflect public-repo best practices before making the repository public on GitHub.

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-11

### Features
- broker-accounts-ui: Surfaces registered broker accounts and per-account portfolio data in the `xstockstrat-trader` UI, completing the UI half of the `add-ikbr-account-support` feature which added backend RPCs but explicitly deferred all frontend changes.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-10

### Features
- broker-accounts-ui: Surfaces registered broker accounts and per-account portfolio data in the `xstockstrat-trader` UI, completing the UI half of the `add-ikbr-account-support` feature which added backend RPCs but explicitly deferred all frontend changes.

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-07

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-06

### Summary
7 commits, 0 feature merges since last promotion.

---

## 2026-05-04

### Summary
1 commit, 0 feature merges since last promotion.
