# Changelog

All production promotions from `main-dev` to `main` are recorded here.
Each entry corresponds to one `main-dev → main` PR merge.

## 2026-05-16

### Summary
5 commits, 0 feature merges since last promotion.

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
- make-repo-public-secure: Audit the xstockstrat-orchestration repository for all hardcoded secrets, credentials, API keys, and sensitive configuration values, remove or replace them with environment variable references or safe placeholders, and update documentation to reflect public-repo best practices before making the repository public on GitHub.

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
