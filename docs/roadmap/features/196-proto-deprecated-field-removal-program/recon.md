# Recon: proto-deprecated-field-removal-program

**Created**: 2026-09-19
**From**: product-spec.md
**Affected services**: analysis, common (shared proto), config, indicators, ingest, marketdata, portfolio, trading (+ consumers: xstockstrat-ui, xstockstrat-agent)

---

## Objective

Remove the genuinely-dead `[deprecated = true]` proto fields across 8 protos, `reserving` their
field numbers / enum values, without breaking clients, while keeping load-bearing fields. Recon's
job here was to (a) verify which of the 33 candidates are actually dead, and (b) establish the
breaking-change mechanics available in this repo. **Both came back adverse to the stated approach**
(see Risks) — the design phase must reconcile that before any removal is planned.

## Codebase Map

- **`xstockstrat-trading`** (Go) — identity from header: `internal/middleware/propagation.go:36`
  (`UserID: first(md.Get("x-user-id"))`); ownership gates ignore body `user_id`:
  `internal/service/trading.go:390,444,857,1125,1264`; `is_paper` ignored (env-derived):
  `internal/service/trading.go:2248,2258`.
- **`xstockstrat-portfolio`** (Go) — header helper: `internal/handler/portfolio_handler.go:22-23`;
  no body-`user_id` reader (`internal/service/portfolio_service.go:478`); live `Watchlist.symbols`
  mirror: `internal/repository/watchlist_repo.go:102,153`, `internal/service/portfolio_service.go:1691`.
- **`xstockstrat-marketdata`** (Go) — live string-`timeframe` sites: `internal/service/marketdata_service.go:137,1012`,
  `internal/handler/marketdata_handler.go:40,309`, `internal/repository/marketdata_repo.go:71`;
  enum↔string resolver: `internal/timeframe/timeframe.go` (switches name `TIMEFRAME_15MIN/1HOUR/1DAY` at :17,19,21,50,52,54);
  live `TIMEFRAME_1MIN` **writer**: `internal/alpaca/stream.go:255` (feature 080 FR-6).
- **`xstockstrat-analysis`** (Python) — header-only identity: `app/handlers/servicer.py:533`;
  `ListStrategies` uses header (`:2277`, `:2611` "never read ... from the wire").
- **`xstockstrat-indicators`** (Python) — body `user_id` is a LIVE fallback:
  `app/handlers/servicer.py:56` (`return x_user_id or request.user_id`), call sites `:321,:418`.
- **`xstockstrat-ingest`** (Python) — live string `timeframe` (`app/handlers/servicer.py:127,149`)
  and live deprecated `operation` string fallback (`:75-77`, `:1077`); non-deprecated
  `operation_enum = 5` at `packages/proto/ingest/v1/ingest.proto:199`.
- **`xstockstrat-config`** (Node) — sets deprecated `trading_mode` on the outbound request:
  `src/services/configWatcher.ts:45`; `ENVIRONMENT_DEV` handled by numeric wire value (1), not name:
  `src/grpc/configServiceImpl.ts:28-29`; only emits `VALUE_TYPE_FLOAT_SCALAR` (`:545`); `trading_mode`
  DB column already dropped by feature 147 (`migrations/017_...up.sql:96-97`).
- **`xstockstrat-ui`** (TS) — names `Timeframe.TIMEFRAME_1HOUR/15MIN` (`src/app/insights/backfills/page.tsx:37-38`)
  and `Environment.DEV` (`src/lib/deploymentEnv.ts:24`); config `trading_mode` NOT referenced beyond the BFF.
- **`xstockstrat-agent`** (Python) — no reference to the deprecated enum members; a test subtracts
  `trading_mode` from the `SetConfigRequest` field set (`tests/test_config_tools.py:304`).

## Patterns to REUSE

- **Deprecation itself is the repo's canonical pattern** → `[deprecated = true]` in place, per
  **PROTO-2** (`packages/proto/docs/context-constitution.md:20`). No `.proto` uses `reserved`
  (the only "reserved" hit is a comment at `analysis.proto:193`). Reuse deprecate-don't-delete rather
  than introducing `reserved`.
- **Header-authoritative identity** (why the body `user_id` fields are dead) → `x-user-id` interceptor
  per service (`trading/internal/middleware/propagation.go:36`; `portfolio/internal/handler/portfolio_handler.go:22`;
  `analysis/app/handlers/servicer.py:533`). Any removal leans on this pattern holding.
- **Breaking-change workflow** → the documented path is `docs/runbooks/proto-versioning.md:26-56`
  (create v2, migrate consumers, delete v1) — the only sanctioned removal procedure.
- **Codegen freshness gate** → `scripts/buf-gen.sh` + empty `git diff packages/proto/gen/`
  (`ci.yml:177-183`; ledger insights 52-58). Any `.proto` edit regenerates `gen/` in the same PR.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-10` "Config messages carry environment, no trading_mode" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — removing config `trading_mode` fields strengthens this; never re-add the axis.
- **PRESERVE** `@AC-12` "trading_mode rows collapse onto environment" (same suite) — paper/live derives from environment; keep it.
- **PRESERVE** `@AC-2` "keys seeded with getter-matching value_type" (`.../readiness-materializer-config-keys.feature` and `.../opportunity-config-operability.feature`) — bool/int/float scalar value-types untouched by removing `VALUE_TYPE_FLOAT_MAP`.
- **PRESERVE** `@AC-2/@AC-3` "BatchGetBars returns/omits daily bars" (`services/xstockstrat-marketdata/acceptance/opportunities-latency-fix.feature`) — verify BatchGetBars binds `timeframe_enum`, not the removed string.
- **PRESERVE** `@AC-1` "400-day GetBars succeeds" (`services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature`) — GetBars must still resolve daily bars after string `timeframe` removal.
- **PRESERVE** `@AC-1..@AC-6` "manage_signal_source REGISTER" (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`) — removing deprecated string `operation` must keep REGISTER routing via `operation_enum`.
- **PRESERVE** `@AC-1/4/5/6/7` "manage_account + non-owner PERMISSION_DENIED via x-user-id" (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`) — the header-authoritative invariant that makes every `user_id`-body removal behavior-neutral.
- **CHANGE (structural, above scenario layer)** — `packages/proto/CLAUDE.md` / `packages/proto/docs/context-constitution.md:20` PROTO-2 "deprecate-don't-delete / no `reserved`". Feature 196 reverses it. This is a `PLAT-*`/module invariant, not an `@AC-*`; **requires explicit user sign-off recorded in `context.md`** and reconciliation of the proto module constitution/findings.

## Dependencies

- Proto/RPC: 8 protos; module `buf.build/xstockstrat/contracts` (`packages/proto/buf.yaml:2`).
  `buf.yaml` has no `breaking:` block → default `FIELD_NO_DELETE`/`RESERVED_ENUM_NO_DELETE` apply.
  CI `proto-lint` runs `buf breaking` vs PR base (`ci.yml:106-123`); `proto-freshness` diff-gates `gen/`.
- **BSR publishing**: `buf push` on every deploy (`deploy-prod.yml:28-31` published; `deploy-dev.yml:28-32` draft);
  `BUF_TOKEN` required; runbook: published for open-source consumers on merge to main
  (`proto-versioning.md:95-100`). → **external consumers exist.**
- Migration: none (proto-only). Config keys: none. New env vars/ports: none.
- Storage: no numeric-enum columns — timeframe stored as `'15m'/'1h'/'1d'` TEXT
  (`marketdata/migrations/001_...up.sql:11`), environment as `'staging'/'production'` TEXT; config
  `trading_mode` column dropped (147); `VALUE_TYPE_FLOAT_MAP`'s only key removed (config migration 020).

## Verified-dead vs live (the reader audit)

**Verified DEAD (~12 of 33)** — removable *were it not for* the governance blockers below:
- trading `user_id` ×4 + `is_paper` (header/env-derived); portfolio `user_id` ×5 (header);
  analysis `ListStrategiesRequest.user_id` (header); config `VALUE_TYPE_FLOAT_MAP` (no consumer).

**LIVE / wire-load-bearing (must NOT remove)** — the majority:
- indicators `user_id` ×2 (live header-absent fallback, `servicer.py:56`);
- ingest `timeframe` ×2 + `operation` string (live fallbacks); marketdata `timeframe` ×4 (live
  deprecation-window reads/writes); common `TIMEFRAME_1MIN` (actively written, stream.go:255),
  `TIMEFRAME_15MIN`/`_1HOUR` (Go switches + UI dropdown + historical rows), `ENVIRONMENT_DEV`
  (wire value 1, deploymentEnv.ts); config `trading_mode` ×6 (set by configWatcher.ts); portfolio
  `symbols` (old-client watchlist mirror).

> The report's "12 already-ignored `user_id` fields, safe first cohort" is **partly wrong**: indicators
> `user_id` ×2 is live, so the dead `user_id` set is 10 (trading 4 + portfolio 5 + analysis 1), not 12.

## Risks / Not-found

- **BLOCKER-CLASS — PROTO-2 conflict + no procedure.** In-place removal and `reserved` directly
  contradict the proto module's own invariant (deprecate-don't-delete, no `reserved`). The only
  documented removal path is a full v1→v2 package migration (`proto-versioning.md`). There is **no**
  reserve-and-remove-in-place procedure. (`packages/proto/docs/context-constitution.md:20`.)
- **External BSR consumers exist** (published module) — the product-spec's open question resolves to
  "yes"; removal is not a repo-internal change and the deprecation window is externally visible.
- **Only ~12/33 are dead** — the program's premise (a 33-field cleanup) is mostly infeasible on the
  merits, independent of governance.
- **C-16 blind spots**: the deprecated `user_id` bodies and portfolio `symbols` are largely
  unguarded by promoted `@AC-*` scenarios — behavior-neutrality rests on the header pattern +
  proto comments, so per-service verification is required, not scenario coverage.
- **fails.md 067 / insights 166-175, 192-201 (mirror)**: removing an enum value referenced by an
  exhaustive TS `Record`/switch or a Go switch is a compile break; making one unreachable is
  compile-clean but silently dead. Confirmed live at `marketdata/internal/timeframe/timeframe.go`,
  `backfills/page.tsx:37-38`, `deploymentEnv.ts:24`.

## Recommended Scope

Given recon, the design debate should weigh three approaches (not a foregone conclusion):
1. **Keep deprecate-don't-delete as the terminal state** (close/park 196; optionally a tiny
   doc-hygiene pass affirming PROTO-2). YAGNI-aligned; honors PROTO-2 + BSR consumers.
2. **Minimal in-place removal of only the ~12 verified-dead fields** — requires an explicit PROTO-2
   override (user sign-off), `reserved` numbering, `buf.yaml` breaking-ignore, and accepting external
   BSR-consumer impact. High governance cost for cosmetic gain.
3. **Full v1→v2 migration** for the dead subset — the only *documented* path, but grossly
   disproportionate for dead cosmetic fields.

No implementation is in scope this session regardless (breaking proto → 2 owners + platform lead).
