# Config Governance Audit — Unused, Missing, and Stale Config Keys — 2026-08-07

Full audit of every `<service>.<category>.<key>` config key in the platform, as of `main-dev`
(branched for this audit as `claude/config-audit-ko8qpw`). Scope: all 11 services'
`CLAUDE.md` → "Config Keys Consumed" tables, `docs/patterns/config-governance.md`'s Global Config
Keys table and Per-Feature Registered Keys log, every `xstockstrat-config` DB seed migration
(`000`–`014`), and every actual config-watcher read call site in the Go/Python/Node source. One
read-only investigator audited each service independently; findings below are cross-checked
against each service's own `docs/context-constitution-findings.md` where one exists. GitHub
Issues are disabled on this repo, so this report is the audit trail per
`docs/runbooks/bug-triage.md` Track C for anything routed onward.

## Executive summary

- **Missing docs: none.** Every config key actually read anywhere in the codebase (Go, Python, or
  Node) is documented in its owning service's `CLAUDE.md`. Zero "read in code but undeclared"
  instances across all 11 services — doc coverage of *real* usage is complete.
- **Unused/stale: real, and larger than any one service's own findings log shows.** 8 keys are
  seeded in the config-service DB and documented, but never read by any service (dead seeds). A
  further 9 keys are documented as config but have no DB seed *and* no code reader at all —
  pure aspirational documentation for features that never shipped. Most of these were already
  self-flagged as "not yet enforced/implemented" in the owning service's own `CLAUDE.md`, so this
  audit mainly reconfirms known, tracked debt — see the full inventory below for what's newly
  surfaced versus already logged.
- **Root doc drift, not service drift.** The single largest cluster of stale documentation was in
  `docs/patterns/config-governance.md` itself: 5 of its 8 "Global Config Keys" never existed in
  the config-service DB or in any service's code — they described an OTel/endpoint layer that was
  actually built as env vars instead. **Fixed in this pass** (see below).
- **~15 keys are read in code with a working fallback default but were never seeded in the config
  DB** — meaning an operator cannot actually change them at runtime without first hand-inserting a
  row. Some of this is an intentional, already-documented pattern (features 101/102 explicitly
  chose "no seed migration, code-default only"); the rest is simply unflagged. Not a functional bug
  today, but a governance gap against rule 7 ("Default values must be declared... seed data").

## Root causes

| RC | Root cause | Instances |
|---|---|---|
| **RC-1** | A feature's design doc registers a config key (and sometimes seeds it) before the enforcement code lands, and the code never catches up. Most instances are already self-flagged `"documented, not yet enforced/implemented"` in the owning service's `CLAUDE.md`. | `trading.risk.daily_loss_limit`, `marketdata.retention.quotes_days`/`ohlcv_years`, `indicators.sandbox.max_concurrent`, `ingest.backfill.default_timeframe`, `ledger.retention.years`/`compression.after_days`, `notify.stream.max_subscribers`/`alert.retention_days`/`alert.max_body_bytes` |
| **RC-2** | Copy-paste service scaffolding (Python `app/config/watcher.py` cloned from `xstockstrat-indicators`) left the wrong `client_id` prefix and orphaned `indicators.sandbox.*` getters in two other services. | `xstockstrat-ingest` (already logged), `xstockstrat-analysis` (not yet logged) |
| **RC-3** | The root `docs/patterns/config-governance.md` "Global Config Keys" table described a `platform.otel.*`/`platform.*_endpoint` layer that was designed but never built that way — real OTel toggling and inter-service addressing both ended up as env vars per `docs/patterns/observability.md` and the `<SERVICE>_ENDPOINT` convention, and the table was never corrected. | `platform.ledger_endpoint`, `platform.config_endpoint`, `platform.otel.enabled`, `platform.otel.endpoint`, `platform.otel.sample_rate` |
| **RC-4** | A key is read in code with a graceful fallback default, but was never added to the config service's seed data (governance rule 7), so it's invisible to `list_config_keys`/the config UI and can't be changed without a manual DB insert. Sometimes intentional and documented as such (features 101/102); mostly just unflagged. | `portfolio.risk.max_drawdown_pct`/`concentration_limit_pct`/`exposure.factor_map`, `agent.oauth.registration_enabled`/`allowed_redirect_uris`, `identity.jwt.access_ttl_seconds`/`refresh_ttl_seconds`, 5 of `ingest`'s 8 documented keys, all of `trading.reconciliation.*`/`order_intent.*`, most of `analysis`'s feature-097/069/068/065/064/060 keys |
| **RC-5** | A config value is read every cycle but its result is discarded before use — reads as wired, has zero effect. | `portfolio.risk.max_drawdown_pct` (`_ = maxDrawdownPct // drawdown requires historical P&L tracking`) |
| **RC-6** | A config-shaped, env-tunable value bypasses config governance entirely — no config key, no env var, no documented exception (contrast with `xstockstrat-indicators`' `MAX_PARAMETERS`/`MAX_OUTPUTS`, which *are* documented as intentional hardcodes). | `xstockstrat-identity`'s OAuth authorization-code TTL (hardcoded SQL `interval '60 seconds'`) |

## Findings

### F-1 (SEV-3) — 5 of 8 "Global Config Keys" in the root governance doc never existed — fixed in this pass
`docs/patterns/config-governance.md`'s "Global Config Keys" table listed `platform.ledger_endpoint`,
`platform.config_endpoint`, `platform.otel.enabled`, `platform.otel.endpoint`, and
`platform.otel.sample_rate` alongside the 3 real platform keys. None of the five has a DB seed row
in any `xstockstrat-config` migration (`000`–`014`, checked exhaustively), and a repo-wide grep for
config-watcher reads of any of them returned zero hits in any service. `platform.config_endpoint`
is also structurally impossible as designed — a service cannot fetch its own config-service address
*from* the config service before it has connected to one. The real mechanisms are the
`<SERVICE>_ENDPOINT` env var convention (root CLAUDE.md) for addresses and `OTEL_ENABLED`/
`OTEL_EXPORTER_OTLP_ENDPOINT` env vars (`docs/patterns/observability.md`) for OTel.
**Fixed:** removed the 5 rows from the table with an explanatory note pointing to the real env-var
mechanisms.

### F-2 (SEV-3) — `xstockstrat-portfolio` wrongly claimed `platform.ledger_endpoint` as consumed — fixed in this pass
`services/xstockstrat-portfolio/CLAUDE.md:52` listed `platform.ledger_endpoint` in its Config Keys
Consumed table; no Go code in the service reads it via the config watcher — the ledger address is
the `LEDGER_ENDPOINT` env var, same as every other service. `xstockstrat-trading`'s own
`docs/context-constitution-findings.md:14` had already flagged this exact stale pattern for
itself; portfolio's copy went uncorrected.
**Fixed:** removed the row, added a note pointing at the real env var and trading's precedent.

### F-3 (SEV-3) — `xstockstrat-trading`'s own findings log had a stale claim — fixed in this pass
`docs/context-constitution-findings.md:11` (trading) claimed `trading.order.max_retries` /
`retry_delay_ms` are "read by nobody" (checked via zero `GetInt` call sites). They *are* read —
via `GetFloat`, not `GetInt` — at `internal/service/trading.go:2155-2156`, but only inside
`flattenAndHalt`'s retry loop (feature 030's protection-window flatten-and-halt), not in
`submitOrder`/`PlaceOrder`'s general order-submission path, which is still called exactly once
with no retry. `CLAUDE.md:17`'s "a retried submission... is de-duplicated" blurb overstates the
actual scope.
**Fixed:** corrected the findings-log row to reflect current behavior and flag the CLAUDE.md
blurb's overstated scope as the residual open item (not touched in this pass — it's a
one-sentence rewording call for the service owner, not a factual error worth a unilateral edit).

### F-4 (SEV-3) — `analysis.backtest.max_duration_seconds` is a dead seed, not previously logged
Seeded twice (`services/xstockstrat-config/migrations/001_config_tables.up.sql:69` dev default
`300`, `002_config_environment.up.sql:71` prod override `120`) and documented in
`services/xstockstrat-analysis/CLAUDE.md:156`, but a full-service grep found **zero** reads
anywhere in `app/`. Distinct from the similarly-named `analysis.screener.max_duration_seconds`,
which *is* read (`app/handlers/servicer.py:1890`) — easy to conflate the two when skimming.
**Recommendation:** either wire it as the intended backtest wall-clock deadline, or delete the key
+ seed rows. Not fixed in this pass — deciding "wire vs. delete" is a product call, not a doc
correction; route via `/sdd-triage --from-report`.

### F-5 (SEV-3) — `marketdata.alpaca.paper` is a dead seed, not previously logged
Seeded with a dev default and a prod paper/live split (`001_config_tables.up.sql:67`,
`002_config_environment.up.sql:75-76`) and documented, but no code in
`services/xstockstrat-marketdata` reads it via the config watcher — paper vs. live selection is
actually driven by the `TRADING_MODE` env var (`internal/config/config.go:52,105-107`). Same
failure shape as F-2/F-3 above (a config key superseded by an env var and never removed), but for
marketdata, which has no `context-constitution-findings.md` entry for it yet.
**Recommendation:** delete the key + seed rows (env var is the working mechanism and a second,
dead knob for the same decision invites confusion); or, if a config-driven override is wanted
independent of `TRADING_MODE`, wire it explicitly as an override. Not fixed in this pass — routing
call, not a doc typo.

### F-6 (SEV-3) — `ledger.stream.notify_enabled` is a dead seed, not previously logged
Seeded `true` (`001_config_tables.up.sql:65`) and documented as the intended pg-NOTIFY toggle, but
`xstockstrat-ledger`'s `ConfigWatcher` is used *only* as a startup readiness gate
(`waitForSnapshot`) — none of its `getString`/`getInt`/`getBool` getters are ever called anywhere
in `src/`. The NOTIFY trigger fires unconditionally on every insert regardless of this key's value.
Unlike its siblings, `xstockstrat-ledger` has no `docs/context-constitution-findings.md` at all, so
this was previously untracked anywhere.
**Recommendation:** gate the NOTIFY emission on this key (cheap, since the value is already seeded
and just needs a read + branch), or delete the key if unconditional NOTIFY is intentional. Not
fixed in this pass.

### F-7 (SEV-4) — `xstockstrat-identity`'s OAuth auth-code TTL bypasses config governance entirely
`identityServiceImpl.ts:346` hardcodes the OAuth authorization-code expiry as a literal SQL
`interval '60 seconds'` — not a config key, not an env var, and not documented as an intentional
exception (contrast `xstockstrat-indicators`' `MAX_PARAMETERS`/`MAX_OUTPUTS`, which *are*
documented hardcodes in that service's `CLAUDE.md`). Small blast radius — a short-lived
authorization code, not a security-critical tunable — but it's the one clean, previously-unlogged
violation of governance rule 1 ("no hardcoded config values") this audit found.
**Recommendation:** either add an `identity.oauth.auth_code_ttl_seconds` config key (matching the
existing `identity.jwt.*` pattern in the same file) or document it in CLAUDE.md as an intentional
fixed value, the way indicators does for its two hardcoded caps. Not fixed in this pass.

### F-8 (SEV-4) — `portfolio.risk.max_drawdown_pct` is read and then discarded
`portfolio_service.go:732,760`: `maxDrawdownPct := s.cfg.GetFloat("portfolio.risk.max_drawdown_pct", 0.10)`
followed by `_ = maxDrawdownPct // drawdown requires historical P&L tracking`. Functionally
identical to being unread, but the code makes it look wired at a glance — a different failure
shape than a flat-out dead seed. Already partially self-documented in
`services/xstockstrat-portfolio/CLAUDE.md:47` ("Read but not yet enforced"), so this confirms
rather than newly discovers the gap; flagged here because the discard pattern is worth naming so
it doesn't get mistaken for a live enforcement path during a future audit.

### F-9 (SEV-4) — Copy-paste config-watcher scaffolding in `xstockstrat-analysis`, mirroring an already-logged `xstockstrat-ingest` bug
Both `services/xstockstrat-ingest/app/config/watcher.py` and
`services/xstockstrat-analysis/app/config/watcher.py` carry a module docstring, a
`client_id=f"indicators-{id(self)}"` registration string, and three unused
`sandbox_timeout_ms`/`sandbox_memory_bytes`/`sandbox_allowed_imports` properties — all copied from
`xstockstrat-indicators`' original watcher and never renamed/pruned. ingest's instance is already
logged (`services/xstockstrat-ingest/docs/context-constitution-findings.md:26`); analysis's
appears to be the same defect, not yet logged anywhere.
**Recommendation:** rename `client_id` to the owning service (`"ingest-"`/`"analysis-"`) and
delete the three orphaned properties in both files — same fix, two services, no design decision
required. Not fixed in this pass (it's a source-code change, out of scope for a docs-only pass);
route as a small Track B/C fix.

## Full key inventory

Status legend: **live** = seeded (or intentionally unseeded per the per-feature log) and read;
**dead seed** = seeded + documented but never read; **doc-only** = documented, no seed, no code
reader; **unseeded** = documented + read + working fallback, but no DB seed row; **discarded** =
read but result unused.

| Service | Key | Status | Note |
|---|---|---|---|
| *(root)* | `platform.maintenance_mode`, `platform.log_level`, `platform.trading_state` | live | — |
| *(root)* | `platform.ledger_endpoint`, `platform.config_endpoint`, `platform.otel.enabled`, `platform.otel.endpoint`, `platform.otel.sample_rate` | doc-only → **removed** | F-1 |
| trading | 24 keys incl. `approval.*`, `risk.*` (7), `order.*`, `fill_poller.*`, `reconciliation.*` (3, unseeded/live), `order_intent.*` (2, unseeded/live), `broker.*`, `position_sync.*`, `credential_health.*` | live | all documented, all read |
| trading | `trading.risk.daily_loss_limit` | dead seed | self-flagged in CLAUDE.md |
| portfolio | `snapshot.interval_minutes`, `watchlist.max_per_user`, `watchlist.max_symbols_per_list` | live | — |
| portfolio | `risk.concentration_limit_pct`, `exposure.factor_map` | unseeded, live | RC-4 |
| portfolio | `risk.max_drawdown_pct` | unseeded, **discarded** | F-8 |
| marketdata | `backfill.batch_size`, `fmp.*` (5), `alpaca.adjustment`, `backfill.max_delete_days` | live | — |
| marketdata | `alpaca.paper` | dead seed | F-5, not previously logged |
| marketdata | `retention.quotes_days`, `retention.ohlcv_years` | doc-only | self-flagged |
| indicators | `sandbox.timeout_ms`, `sandbox.memory_bytes`, `sandbox.allowed_imports` | live | — |
| indicators | `sandbox.max_concurrent` | doc-only | self-flagged |
| ingest | `backfill.max_concurrent_jobs`, `retry_on_failure`, `max_retry_attempts`, `chunk_*` (3), `signals.dedup_window_hours` | unseeded except the 3 chunk keys; all live | RC-4 |
| ingest | `backfill.default_timeframe` | doc-only | self-flagged; code hardcodes `"1d"` directly instead |
| analysis | 34 of 36 documented keys (`backtest.*`, `scoring.*`, `strategy.*`, `signals.*`, `engine.*`, `screener.*`, `fundsignal.*` ×12, `opportunity.*` ×5) | live (mostly unseeded per RC-4 except `backtest.max_duration_seconds`, `signals.source_weights`, `fundsignal.*`) | — |
| analysis | `backtest.max_duration_seconds` | dead seed | F-4, not previously logged |
| ledger | `stream.notify_enabled` | dead seed | F-6, not previously logged |
| ledger | `retention.years`, `compression.after_days` | doc-only | self-flagged |
| identity | `jwt.access_ttl_seconds`, `jwt.refresh_ttl_seconds` | unseeded, live | RC-4 |
| identity | *(OAuth auth-code TTL — not a config key at all)* | hardcoded | F-7 |
| notify | `stream.max_subscribers`, `alert.retention_days`, `alert.max_body_bytes` | doc-only | self-flagged (all 3) |
| agent | `signal.alert_threshold` | live | — |
| agent | `oauth.registration_enabled`, `oauth.allowed_redirect_uris` | unseeded, live | RC-4, best-effort read w/ fallback |
| config, ui | — | — | `xstockstrat-config` is the registry itself; `xstockstrat-ui` consumes no `platform.*`/service keys, only env vars + the config-ui BFF |

## Fixed in this pass (docs-only — no behavior change)

- **F-1** — `docs/patterns/config-governance.md`: removed the 5 non-existent Global Config Keys,
  added an explanatory note.
- **F-2** — `services/xstockstrat-portfolio/CLAUDE.md`: removed the stale `platform.ledger_endpoint`
  row.
- **F-3** — `services/xstockstrat-trading/docs/context-constitution-findings.md`: corrected the
  `trading.order.max_retries`/`retry_delay_ms` row from "read by nobody" to the actual
  `flattenAndHalt`-only scope.

## Suggested routing

- **Track B / small fixes (no design gate needed — mechanical, single-service):** F-9 (rename
  `client_id`, delete orphaned properties in ingest + analysis watchers).
- **Track C or a config-rollout decision per finding (wire vs. delete — a product call):** F-4
  (`analysis.backtest.max_duration_seconds`), F-5 (`marketdata.alpaca.paper`), F-6
  (`ledger.stream.notify_enabled`), F-7 (identity OAuth TTL), and the pre-existing self-flagged
  doc-only keys (`trading.risk.daily_loss_limit`, `marketdata.retention.*`,
  `indicators.sandbox.max_concurrent`, `ingest.backfill.default_timeframe`,
  `ledger.retention.*`/`compression.*`, `notify.*` ×3) — each needs an owner decision to implement
  the enforcement or delete the key + docs, per `docs/runbooks/config-rollout.md`.
- **Optional cleanup, no urgency:** seed the RC-4 unseeded-but-read keys into the config DB so
  they're visible in the config UI / `list_config_keys` — not a defect, but closes the governance
  gap against rule 7 for keys that aren't already documented as intentionally seed-free (101, 102).
