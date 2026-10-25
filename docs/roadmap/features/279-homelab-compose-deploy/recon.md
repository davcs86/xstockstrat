# Recon: homelab-compose-deploy

**Created**: 2026-10-24
**From**: product-spec.md
**Affected services**: xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata (code); config, ledger,
identity, notify, indicators, ingest, analysis, ui, agent (deployed unchanged)

---

## Objective

Deploy the 12 services and a one-shot migrator to the homelab VMs through homelab-edge's tailnet and forced-command
gate, beside the DO deploys, from a digest-pinned compose file whose values all come from a generated `.env`. Give the
Go services a `grpc.health.v1` service and a self-probe so the gate's `up --wait` rollback sees every service.

Recon ran against the session's WIP commit `98c78d3`, which already contains a first implementation; the digests
below describe that tree.

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - Entry point: `services/xstockstrat-trading/cmd/server/main.go:34` (`healthcheck` argv short-circuit, before any init)
  - Init order: config `NewWatcher` `:69` → `WaitForSnapshot` (90 s cap) `:75` → `NewTradingRepo` `:81` →
    `LoadBrokerPool` (fatal) `:104` → 6 pollers `:116-126` → `net.Listen` `:129` → `mtls.ServerConfig` `:135` →
    `RegisterHealthServer(health.NewServer())` `:151` → `Serve` `:165`
  - Probe: `internal/mtls/mtls.go:75-93` (`Probe`); `healthcheck()` `main.go:171-179`, 3 s timeout
  - `config.LoadFromEnv` `internal/config/config.go:37-52`: pure, no exit; healthcheck mode needs only `GRPC_PORT` + `MTLS_*`
  - Broker paper default: `internal/service/trading.go:2597` `GetBool("trading.broker.paper", s.cfg.TradingMode == "paper")`;
    `TRADING_MODE` default `"paper"` `config.go:49`
  - Last migration: `011_offline_fees_snapshot_headers.up.sql`
- **`xstockstrat-portfolio`** (Go)
  - Init: `WaitForSnapshot` `cmd/server/main.go:60` → `NewPortfolioService` (DB ping) `:65` → 6 goroutines `:71-76` →
    `net.Listen` `:80` → `RegisterHealthServer` `:102` → `Serve` `:116`; client dials lazy (`grpc.NewClient`)
  - `MARKETDATA_ENDPOINT` default `xstockstrat-marketdata:50053` `internal/config/config.go:37` (not set in homelab compose; default matches)
  - Last migration: `017_offline_realized_lifetime_fees.up.sql`
- **`xstockstrat-marketdata`** (Go)
  - Init: `WaitForSnapshot` `cmd/server/main.go:67` → `GetSecret` x4, WARN on miss `:74-89` → `NewMarketDataRepo` (ping) `:121`
    → 5 pollers `:163-171` → `net.Listen` `:173` → `RegisterHealthServer` `:195` → `Serve` `:209`
  - Alpaca paper flag: `main.go:107` `Paper: cfg.TradingMode == "paper"`; `GetSecret` allow-list keyed by caller/namespace/key
    only (`services/xstockstrat-config/src/grpc/authz.ts:114-119,156-163`)
  - Last migration: `009_symbol_classification.up.sql` (no `007`, pre-existing gap)
- **Node** (config, ledger, identity, notify): fail-closed `mtls.ts:12-16`; `sslmode` stripped, `ssl: {rejectUnauthorized: !!caCert}`
  (`xstockstrat-config/src/index.ts:25-43`, same in the others); `APPLICATION_ENV` → scope (`configWatcher.ts:43`);
  `CONFIG_SECRETS_ENCRYPTION_KEY` 64-hex required (`xstockstrat-config/src/crypto.ts:14,24`); identity blocks the seed
  admin under `production` (`identityServiceImpl.ts:38-40,150`).
- **`xstockstrat-ui`** (Next.js standalone): `Dockerfile:24-31` sets only `NODE_ENV=production` (no `HOSTNAME`/`PORT`);
  `AGENT_PUBLIC_URL` read in 5+ routes; `NODE_ENV=production` → `secure` session cookie (`src/lib/auth.ts:48-49`).
- **Python** (indicators, ingest, analysis, agent): fail-closed `app/mtls.py:18-24`; `statement_cache_size=0` on
  `DB_PGBOUNCER` (`xstockstrat-indicators/app/main.py:57`, ingest `:62`, analysis `:60`); ingest builds an explicit
  no-verify SSL context (`xstockstrat-ingest/app/main.py:50-59`); indicators/analysis rely on the DSN `sslmode`;
  agent OAuth `aud == AGENT_PUBLIC_URL` (`xstockstrat-agent/app/auth.py:42,74`).

## Patterns to REUSE

- Leaf minting → reuse `scripts/gen-dev-certs.sh` (CERTS_DIR override) and the DO pipeline's CA-decode one-liner from
  `.github/workflows/deploy.yml` "Mint inter-service mTLS leaves"; do not write a second minter.
- Self-probe client creds → reuse `mtls.ClientConfig` (`internal/mtls/mtls.go`), the same SAN-pinned client every
  outbound call uses; no insecure path.
- Health server → upstream `google.golang.org/grpc/health` (already a dep via `mtls_test.go:110`), not a hand-rolled RPC.
- Probe tests → reuse `mtls_test.go` `newCA`/`leaf`/`setEnv` helpers (`probeServer` `:244-257`).
- Migrator → reuse `scripts/Dockerfile.migrate` + `scripts/db-migrate.sh` (dirty-contract guard, feature 225) unchanged;
  publish it from the existing `docker-build.yml` matrix.
- Image build → reuse `docker-build.yml`'s `:<short sha>` tags; resolve to digests, never rebuild.
- Transport, secret sourcing, tailnet join, gate calls → homelab-edge `templates/app-deploy/deploy.yml`, copied with
  its pins (tailscale, `op`), not re-derived.
- Readiness probes for Node/Python → the existing `nc -z` / bash `/dev/tcp` probes from `docker-compose.yml`.

## Existing Business Rules (preserve / extend)

All PRESERVE; no CHANGE.
- **PRESERVE** `@AC-1 @feature-210` "A plaintext gRPC caller is refused in production configuration" (`docs/sdd/business-rules/platform.feature`) — health shares the one mTLS listener; no plaintext/health-only port.
- **PRESERVE** `@AC-2 @feature-210` "A mutually-authenticated peer with a valid platform-issued identity is accepted" — per-deploy leaves from the per-environment CA verify at every hop, the probe included.
- **PRESERVE** `@AC-4 @feature-210` "mTLS is enforced identically in every environment; verification cannot be disabled" — no skip-verify in `healthcheck`; `.env` delivery stays fail-closed (`${VAR:?}`).
- **PRESERVE** `@AC-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS" — health registration does not touch the interceptor chain.
- **PRESERVE** `@AC-6 @feature-210` "A long-lived streaming RPC survives a certificate rotation" — every deploy is a leaf rotation.
- **PRESERVE** `@AC-6 @feature-224` "The fundamentals loop still runs the system scoring formula" — leaf SAN must be exactly `DNS:xstockstrat-<svc>`.
- **PRESERVE** `@AC-9 @feature-196` "request-only dead fields stay server-ignored" — paper/live stays derived from environment; no new mode knob.
- **PRESERVE** `@AC-1`/`@AC-2 @feature-171` (no `trading_mode` telemetry attribute; telemetry never blocks startup).
- **PRESERVE** `@AC-1 @feature-175` "The dead getEnvBool is gone from the Go config packages".
- **PRESERVE** `@AC-18`, `@AC-6`, `@AC-12`, `@AC-5 @feature-225` — migrator keeps the dirty-contract guard, never runs a down, replays safely; contract gate unchanged.
- **PRESERVE** `@AC-1..3 @feature-192` (`services/xstockstrat-trading/acceptance/fix-trading-config-key-mismatch.feature`) — snapshot before traffic; no new default path.
- **PRESERVE** `@AC-7 @feature-147` "A missing Alpaca credential warns but marketdata still starts" (`services/xstockstrat-marketdata/acceptance/config-secrets-and-scoping.feature`) — a fresh homelab has no vendor secrets; marketdata must still reach SERVING, or the first deploy can never pass `--wait`.
- **PRESERVE** `@AC-6 @feature-147` (credentials via `GetSecret`, no `ALPACA_API_*` env) and `@AC-8 @feature-147` (no `MCP_AGENT_SECRET`; the rule's file list predates the homelab files).
- No existing suite covers health endpoints, readiness order, pooling/sslmode routing, env rendering or CA minting.

## Dependencies

- Proto/RPC: none (`grpc.health.v1` is upstream grpc-go).
- Migration: none.
- Config keys: none new. Existing `trading.broker.paper` (trading) overrides the `TRADING_MODE` default; `agent.oauth.allowed_redirect_uris` must be set per homelab environment (operator).
- Inter-service edges: unchanged; the probe is a self-call on `127.0.0.1`.
- Env vars: `IMAGE_*`, `DB_HOST/DB_NAME/DB_USER/DB_PASSWORD`, `<SVC>_MTLS_CERT/KEY` exist only in `deploy/homelab/compose.yml`; none added to `docker-compose.yml` / `.do/app*.yaml`.

## Risks / Not-found

- **Defect D1 — `TRADING_MODE` absent from the homelab compose.** Code still reads it: trading broker paper default
  (`trading.go:2597`), marketdata Alpaca `Paper` (`main.go:107`), indicators watcher (`watcher.py:49`). DO prod sets
  `TRADING_MODE=live` globally (`.do/app.yaml` envs). Homelab production would default to **paper**.
- **Defect D2 — UI bind address.** Next standalone binds to `process.env.HOSTNAME`; Docker sets `HOSTNAME` to the
  container id, so the server listens on eth0 and the `nc -z localhost 3000` healthcheck never passes → every deploy
  rolls back. (Agent's inference from Next behaviour; generated `server.js` not inspectable without a build.)
- Health is never set NOT_SERVING on shutdown (`SetServingStatus` absent); `GracefulStop` closes the listener instead.
- `mtls.ServerConfig` runs after `net.Listen` (all three) — bound-but-never-served only when `MTLS_*` is broken, which exits.
- Readiness timing: `WaitForSnapshot` caps at 90 s; compose `start_period: 30s` + 6×10 s ≈ 90 s. Borderline on a cold DB.
- Dead env in compose mirrored from DO: `NOTIFY_ENDPOINT` (ledger, identity, indicators), `LEDGER_ENDPOINT` (notify), `IDENTITY_ENDPOINT` (ingest).
- UI `JWT_SECRET` / agent `JWT_SECRET` lack their own `:?` (identity's guard fails the render anyway).
- `sslmode=require` with no CA = encrypted, unverified (operator's choice); asyncpg DSN `sslmode` parsing not verified in repo.
- Homelab Postgres/PgBouncer connection budget unstated (spec review warning, F-06 context).
- Seeded `admin@localhost` cannot log in under `APPLICATION_ENV=production` until rotated (`scripts/manage-users.py`).
- UI `secure` cookie: only the HTTPS edge path works, not `http://<vm>:3000` (expected).
- Resolved by the orchestrator: homelab-edge's Caddy `(agent)` snippet does `uri strip_prefix /agent`
  (`roles/stack/templates/Caddyfile.j2:76-77`), matching DO; `scripts/wait-for-deps.sh:20-21` waits up to 150 s per
  endpoint (15 s interval), so `WAIT_FOR` alone can exceed the gate's 300 s budget only if several deps are each slow.
- Ledger trap: Docker-unavailable family — all runtime evidence here is "not a live-boot proof".

## Recommended Scope

1. Fix D1 and D2 in `deploy/homelab/compose.yml` + workflow (`TRADING_MODE` derived from target env; `HOSTNAME: 0.0.0.0` on ui).
2. Keep the Go health change as is (registration after init is already true by construction); decide on NOT_SERVING-on-shutdown.
3. Tests already present for `Probe`; add a compose-render check for D1/D2.
4. homelab-edge PR unchanged unless the debate finds a gate issue.
