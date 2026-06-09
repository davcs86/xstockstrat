# Spec ↔ Implementation Gap Analysis

**Date:** 2026-06-09 · **Audited against:** `main-dev` (`067c2aa`)

## Scope and method

Every feature in `docs/roadmap/features/` with lifecycle status `launched` or `code-completed` (32 features) was audited by re-reading its `product-spec.md`, `implementation-spec.md`, and `context.md`, then verifying each functional requirement, acceptance criterion, and implementation step directly against the code — ignoring self-reported step statuses. Platform-level intentions (root `CLAUDE.md`, `docs/patterns/*`, `docs/roadmap/implementation-roadmap.md`, phase deviation notes) were audited the same way. Features in `idea`/`draft`/`demoted/canceled` status were excluded: unbuilt by design, not gaps.

Classification used throughout:

- **MISSING** — spec requires it, code does not have it
- **PARTIAL** — implemented incompletely relative to the spec
- **DIVERGENT** — implemented differently; deviation documented in `context.md`
- **SPEC-STALE** — code is correct/intentional; spec or docs are out of date
- **SUPERSEDED** — removed/replaced by a later launched feature

---

## Genuine functional gaps (code does not satisfy the spec)

### GAP-1 — `alpaca-default` backward-compat account is never seeded (feature 001, FR-6) — MISSING, HIGH

- **Spec:** `001-add-ikbr-account-support/product-spec.md` FR-6 — existing single-Alpaca deployments must keep working with zero changes: a real `broker_accounts` row named `alpaca-default` is inserted (from `ALPACA_API_KEY`/`ALPACA_API_SECRET`, encrypted) "at migration time". `context.md:144` then re-planned this as a startup-time seed via an `EnsureAlpacaDefault` function.
- **Reality:** Neither happened. `services/xstockstrat-trading/migrations/002_broker_accounts.up.sql` creates the table but seeds nothing; `git log -S EnsureAlpacaDefault` is empty — the function never existed in committed history. `cmd/server/main.go:99` only calls `LoadBrokerPool`, which tolerates an empty table.
- **Impact:** An upgraded single-Alpaca deployment starts cleanly with **zero broker accounts**; the first `PlaceOrder` fails. Meanwhile `003_orders_account_id.up.sql` and portfolio `003_positions_account_id.up.sql` backfill existing rows with `account_id = 'alpaca-default'` — referencing an account row that does not exist.
- **Fix options:** (a) implement the startup seed described in `context.md:144` (insert `alpaca-default` from env vars when `broker_accounts` is empty), or (b) document the manual `RegisterBrokerAccount` upgrade step in a runbook and amend FR-6.

### GAP-2 — `agent.oauth.*` config keys documented but never seeded — MISSING, HIGH

- **Spec:** Root `CLAUDE.md` §Config Governance lists `agent.oauth.registration_enabled` (bool, default `true`) and `agent.oauth.allowed_redirect_uris` (string, default `""`) as registered keys (feature 049 Part B); 049's product-spec documents the same. Config governance requires keys to exist in the config service.
- **Reality:** No migration inserts them — `grep -r "agent.oauth" services/*/migrations/` returns nothing. `services/xstockstrat-config/migrations/004_agent_config.up.sql` seeds only `agent.signal.alert_threshold`. The agent reads them via one-shot `GetConfig` (`app/oauth_server.py:70,85`) and falls back to in-code defaults when absent.
- **Impact:** On a fresh deploy the keys don't exist in `config.config_values`, so they are invisible in the config UI, cannot be audited via `config.config_audit`, and operators cannot disable Dynamic Client Registration or pin redirect URIs without first creating the keys out-of-band. Code defaults are safe (registration on, https-only redirects), so this is a governance/operability gap, not an outage.
- **Fix:** Add a config migration (e.g. `006_agent_oauth_config.up.sql`) seeding both keys for dev + production.

### GAP-3 — `OTEL_SERVICE_NAME` not wired in DO app specs (feature 015, FR-4/AC-4) — PARTIAL, LOW

- **Spec:** `015-fix-grafana-otel-variables` FR-4/AC-4 — every service entry in `.do/app.yaml` and `.do/app.dev.yaml` must set `OTEL_SERVICE_NAME` to its canonical `xstockstrat-<name>`.
- **Reality:** `grep -c OTEL_SERVICE_NAME .do/app.yaml .do/app.dev.yaml` → 0 and 0.
- **Impact:** Low — each service's `SERVICE_NAME` env var *is* set in the app specs and telemetry init falls back to it, so `service.name` resolves correctly in practice. But the acceptance criterion as written is unmet, and any service whose fallback drifts would silently report a wrong name.
- **Fix:** Either add the `OTEL_SERVICE_NAME` entries or amend AC-4 to bless the `SERVICE_NAME` fallback.

---

## Divergences with documented rationale (no action required beyond spec sync)

### DIV-1 — Feature 038: GHCR instead of DOCR, separate reusable workflow instead of a `ci.yml` job

- Spec called for a `docker-build` job inside `.github/workflows/ci.yml` pushing to DigitalOcean Container Registry. Implementation is a standalone reusable workflow (`.github/workflows/docker-build.yml`, 15-service matrix, GHA layer caching) invoked from `deploy-dev.yml`/`deploy-prod.yml`, pushing to **GHCR**. The DOCR→GHCR migration is documented in `context.md` (DOCR 5-repo limit). Functional intent (pre-built images, tag-pinned deploys) is fully met. Only the spec text is behind.

### DIV-2 — Feature 009: agent calls platform services via gRPC, not HTTP webhooks

- `009-agent-mcp-server/product-spec.md` FR-2 still specifies `POST /webhooks/ingest-signal` / `emit-alert` / `run-backtest` over `*_HTTP_ENDPOINT` (80xx). The agent actually uses native gRPC stubs on 50xx (`services/xstockstrat-agent/app/client.py:77-176`), consistent with the platform-wide gRPC-only migration (root `CLAUDE.md` documents the migration; feature 009's own spec was never amended). Code is correct; classify SPEC-STALE on 009's spec. `docs/runbooks/mcp-tools.md` retains stale webhook/`x-mcp-secret` wording too.

---

## Stale specs/docs (code is correct; documentation must catch up)

| # | Document | Stale claim | Reality |
|---|---|---|---|
| S-1 | Root `CLAUDE.md` §Implementation Roadmap (lines 336, 338) | Phase 0 and Phase 2 "Pending" | Both complete: proto gen/bootstrap/DB/Compose all functional (Phase 0, commit `838da86`); feature `013-phase-2-data-layer` launched 2026-05-22 (Phase 2) |
| S-2 | Root `CLAUDE.md` §Inter-Service Dependencies | "All services → xstockstrat-ledger (event writes)" and "All services → xstockstrat-notify (alert emissions)" | Only **trading, portfolio, marketdata** hold ledger/notify clients; the agent and analysis live-loop emit alerts; indicators/ingest/identity/config write no ledger events |
| S-3 | Root `CLAUDE.md` §Config Governance | "all services subscribe at startup" (WatchConfig) | All 10 backend services do; **xstockstrat-agent intentionally uses one-shot `GetConfig` at request time** (stateless design, noted in agent `CLAUDE.md`) — root doc should carve out the agent |
| S-4 | `009-agent-mcp-server/product-spec.md` FR-2 + `docs/runbooks/mcp-tools.md` | HTTP webhook transport, `x-mcp-secret` enforcement | Agent↔services transport is gRPC (see DIV-2) |
| S-5 | `038-ci-docker-registry-deploy` product/impl spec | DOCR registry, `docker-build` job in `ci.yml` | GHCR + reusable `docker-build.yml` workflow (see DIV-1) |
| S-6 | Feature `033-phase7-observability` lifecycle (`code-completed`) vs root `CLAUDE.md` Phase 7 (`DONE`) | Inconsistent pair | All FR/ACs of 033 verified implemented (telemetry modules in all 12 services, collector config, 4 dashboards, alert rules, non-fatal init, docs); if deployed, 033 should be `launched` |

---

## Superseded (expected, not gaps)

- **005-frontend-reverse-proxy** and **006-do-nginx-integration** — nginx introduced by 005/006 was removed by **045-ui-consolidation-nextjs**. Repo state is consistent: no nginx artifacts; routing handled by Next.js basePaths + DO route rules; `docs/patterns/nginx-routing.md` already marked historical.

---

## Verified clean (no functional gaps)

002-broker-accounts-ui · 003-formula-management-ui · 004-make-repo-public-secure (deviations documented: `SECURITY.md` deferred with approval, `.env.local` substitution, `.env.production` skipped by design) · 007-signal-source-weighting · 008-signal-source-registry · 011-remove-n8n-references · 012-wire-fe-auth · 013-phase-2-data-layer · 014-trader-chart-panel · 016-config-ui-weight-validation · 019-unified-login-page · 033-phase7-observability (code-level) · 041-upgrade-nextjs15 · 044-client-api-pattern · 045-ui-consolidation-nextjs · 046-align-frontend-e2e-bff-mocks · 047-strategy-engine · 048-live-strategy-alert-engine · 049-unify-admin-auth-gates (both Part A and Part B OAuth, except key seeding → GAP-2) · 050-strategy-creation-flow · 051-auth2-authorized-apps-ui · 052-durable-observable-backfills · 052-formula-parameters · 053-backfill-backtest-coverage · 054-resumable-chunked-backfills

Platform conventions verified compliant: gRPC-only backends (no 80xx ports, no webhook handlers, no runtime `*_HTTP_ENDPOINT` reads) · header propagation on every service that makes user-scoped outbound calls (trading, portfolio, marketdata, ingest, analysis; ledger/identity/notify have none to propagate) · WatchConfig subscription in all 10 backend services · telemetry modules present and `OTEL_ENABLED`-gated in all services · migration chains complete for all 10 schema-owning services · service registry ports match `docker-compose.yml` and DO specs.

---

## Spec hygiene (process findings)

- **Duplicate feature numbers:** `020-notify-external-fanout` / `020-order-snapshots-pnl-patterns` and `052-durable-observable-backfills` / `052-formula-parameters` share sequence numbers, breaking the "auto-assigned in creation order" convention and making `NNN` references ambiguous.
- Root `CLAUDE.md` "Active Features" table lists only 001 and 004; 31 features are launched. Consider whether the table should track recent/in-flight features instead.

---

## Recommended actions (priority order)

1. **GAP-1 (HIGH):** Implement the `alpaca-default` startup seed in trading (or document the manual upgrade step and amend FR-6).
2. **GAP-2 (HIGH):** Seed `agent.oauth.registration_enabled` / `agent.oauth.allowed_redirect_uris` via a new config migration.
3. **S-1/S-2/S-3 (MEDIUM):** Update root `CLAUDE.md` — mark Phases 0 and 2 DONE; correct the ledger/notify dependency edges; note the agent's on-demand config pattern.
4. **GAP-3 (LOW):** Add `OTEL_SERVICE_NAME` to both DO app specs or amend 015's AC-4.
5. **S-4/S-5/S-6 (LOW):** Sync stale spec text (009 transport, 038 registry/workflow, 033 lifecycle status).
6. **Hygiene (LOW):** Renumber one of each duplicated feature pair or note the collision in `merge-order.md`.
