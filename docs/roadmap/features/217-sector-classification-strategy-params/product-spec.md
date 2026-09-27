# Product Spec: sector-classification-strategy-params

**Created**: 2026-09-27

---

## Problem Statement

A single strategy today applies one parameter set to every symbol, but mean-reversion and momentum
characteristics differ sharply by sector, so a strategy author cannot express (for example) an RSI
oversold threshold of 30 for Utilities and 25 for Technology within the same strategy. The platform
also has no sector data at all — Alpaca exposes none, and the currently-wired FMP/Finnhub clients
extract none (`packages/proto/portfolio/v1/portfolio.proto` explicitly notes "marketdata exposes no
sector"). This feature closes both gaps: a point-in-time sector store, and per-sector formula
parameter overrides that consume it without look-ahead bias.

## User Story

As a strategy author, I want to define per-sector formula parameter overrides within a single
strategy, so that the same strategy applies sector-appropriate thresholds and lookbacks instead of
one-size-fits-all parameters, and so that backtests score each symbol with the sector it belonged to
at the time of each bar.

## Functional Requirements

**Group A — Sector classification store (marketdata)**

FR-1. A centralized, rate-limited FMP gateway in `xstockstrat-marketdata` is the single path for all
outbound FMP calls; a token-bucket limiter guarantees the configured request rate is never exceeded
regardless of caller concurrency, and the ceiling is config-tunable to fit the paid starter tier.

FR-2. A Type-2 slowly-changing-dimension table stores each symbol's GICS sector with `valid_from`,
`valid_to` (NULL = current row), `taxonomy`, `source`, and `refreshed_at`. Exactly one open
(`valid_to IS NULL`) row exists per symbol at any time.

FR-3. A scheduled refresh job diffs the FMP-reported sector against the current open row per symbol
and, **only when the sector changed**, closes the prior row (`valid_to = now`) and inserts a new open
row. An unchanged sector performs no write. FMP is never called on the read path.

FR-4. An FMP outage degrades only refresh freshness — classification reads and all downstream scoring
continue to serve from the local store, never erroring on provider unavailability.

FR-5. `xstockstrat-marketdata` exposes gRPC to read a symbol's current sector and to read the sector
valid as-of a given timestamp (point-in-time lookup against the SCD history).

**Group B — Per-sector strategy parameters (analysis / indicators / strategy definition)**

FR-6. A strategy definition can carry, for a declared subset of its formula parameters, a map of
GICS-sector → override value, plus a mandatory default bucket used when no sector-specific override
applies.

FR-7. `xstockstrat-analysis` resolves, for each evaluated bar, the symbol's sector **as-of that bar's
timestamp** (FR-5 point-in-time lookup) and selects the matching per-sector parameter override; there
is no use of the current-day sector for a historical bar (no look-ahead).

FR-8. When a symbol has **no stored classification row at all** (never observed — crypto, a brand-new
listing, a persistent FMP miss), scoring falls back to the default parameter bucket and never fails. A
bar predating stored history for a symbol that **has** a seed row resolves to that seeded sector (FR-10),
not the default bucket.

FR-9. Sector is modeled as a closed proto enum with a `SECTOR_UNSPECIFIED = 0` sentinel (per proto
governance: closed, deployment-time-defined value set → enum).

FR-10. On a symbol's **first observation** (no open classification row), both the scheduled refresh
job and the fundamentals profile write-through seed a single open row with `valid_from` = the epoch
sentinel `1900-01-01T00:00:00Z`, applying the observed sector to all pre-go-live bars of that symbol.
This is a bounded, user-signed-off relaxation of strict PIT (context.md 2026-09-27 C-16 sign-off): a
genuine pre-go-live reclassification is invisible within the seeded span, and the relaxation is in the
parameter-selection axis only (never a component numeric value). Post-go-live, strict Type-2 PIT
resumes — the first observed change closes the epoch-seeded row (`valid_to = now`) and opens a new row
(`valid_from = now`).

## Out of Scope

- Industry / sub-industry granularity — **sector only** in v1 (≈11 GICS sectors).
- Providers other than FMP (EDGAR/Fama-French, Finnhub) as a classification source.
- Back-seeding real sector *history* from before go-live via an external point-in-time source stays
  out of scope. The **FR-10 hybrid epoch seed is the one bounded exception**: each symbol's
  first-observed sector is stamped at the epoch sentinel and applies to its pre-go-live bars, but
  genuine pre-go-live reclassifications are not reconstructed. Post-go-live reclassifications accrue
  forward as strict Type-2 PIT.
- Migrating existing scattered FMP fundamentals calls onto the new gateway beyond what FR-1 requires
  to centralize the credential + rate limiter (opportunistic consolidation only; a full FMP-call
  audit is noted as a known trap, not a v1 deliverable).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-marketdata` (Go) — centralized FMP gateway + rate limiter, `symbol_classification` SCD
  table + migration, scheduled refresh job, current + as-of classification RPCs.
- `xstockstrat-analysis` (Python) — per-sector parameter resolution + as-of-bar sector join in
  scoring and backtest; owns (confirm in recon) strategy definition storage.
- `xstockstrat-indicators` (Python) — formula-engine parameter injection so a resolved per-sector
  override reaches the formula at evaluation.
- `packages/proto` — `Sector` enum, classification messages + RPCs on marketdata, per-sector
  parameter map on the strategy message.
- `xstockstrat-agent` (Python) — `manage_strategy` tool gains the per-sector parameter map argument;
  descriptor-parity projection updated in the same PR.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **Agent** — `xstockstrat-agent` MCP tools: `manage_strategy` (author/read per-sector parameter
  overrides on a strategy) and `run_backtest` (results reflect the as-of-bar sector resolution). New
  argument on `manage_strategy`; changed response mapping guarded by the descriptor-parity test.
- [x] **UI** — `xstockstrat-ui`: strategy-editing controls for authoring per-sector overrides, and
  `/insights` for displaying sector-resolved backtest output. Both the authoring control and the
  results display are **in scope** (confirmed by user). Recon confirms which segment hosts the
  strategy editor today and whether the control is new or extends an existing editor.
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- New closed enum `Sector` (`SECTOR_UNSPECIFIED = 0` + the GICS sectors).
- New marketdata RPCs + messages: current-sector read and as-of-timestamp read.
- New per-sector parameter map field on the strategy message (additive, non-breaking).
- All additive; must pass `buf breaking` against `main-dev`. Regenerate stubs via
  `./scripts/buf-gen.sh` in the same PR.

## Config Key Changes

- [ ] No new config keys
- Candidate keys (finalize in spec; follow `<service>.<category>.<key>`):
  - `marketdata.fmp.rate_limit_rps` — FMP gateway token-bucket ceiling (reuse if it already exists;
    do not duplicate).
  - `marketdata.classification.refresh_cron` (or interval) — refresh cadence.
  - `marketdata.classification.enabled` — feature gate for the refresh job.

## Database Changes

- [ ] No schema changes
- New `marketdata` migration adding `symbol_classification` (SCD Type-2): `symbol`, `sector`,
  `taxonomy`, `source`, `valid_from`, `valid_to` (nullable), `refreshed_at`; index for as-of lookups
  (`symbol`, `valid_from`, `valid_to`) and a partial-unique constraint enforcing one open row per
  symbol (`valid_to IS NULL`).
- Per-sector parameter storage in the strategy-owning service's DB (confirm owner in recon; likely
  `xstockstrat-analysis`) — either a new column (structured JSON) on the strategy row or a child
  table. Decide in design.

## Feature Workflow Notes

Branch to create: `feature/sector-classification-strategy-params` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (additive proto + config change)
- [ ] 2 service owners + platform lead (breaking proto change) — not expected; additions only
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Scope split — RESOLVED (user).** Kept as **one long feature**. Group A (classification store)
  and Group B (per-sector params) ship together; internally Group B depends on Group A's FR-5 as-of
  RPC, so `/sdd-spec` still orders A-before-B within the single implementation spec.
- [x] **UI + Agent surfaces — RESOLVED (user).** Both consumer surfaces are in scope: agent
  `manage_strategy` (+ `run_backtest`) and the `xstockstrat-ui` strategy editor + `/insights` results.
  Recon still confirms which UI segment hosts the strategy editor.
- [x] **Strategy storage owner — DEFERRED TO RECON (user).** Which service owns strategy-definition
  persistence (for FR-6 storage) is determined in recon before the migration is specced (likely
  `xstockstrat-analysis`). If recon finds a **new** UI page/route is required for the editor, C-10(a)
  nav registration (`PLATFORM_SUBNAV` + reachability test) is added at that point.

## Design Guidance / Known Traps

Carried into `/sdd-design` and `/sdd-spec`; these are advisories, not open decisions.

- **Config reuse — one FMP throttle model (C-18).** `marketdata.fmp.rate_limit_rps` is new but
  `marketdata.fmp.daily_request_cap` (=250) already exists; the naming pattern
  `marketdata.<source>.rate_limit_rps` is already used by `marketdata.backfill.*` and
  `marketdata.edgar.*`. Design must reconcile the per-second limiter with the per-day cap so the
  gateway has one coherent throttle, not two independently-tuned ones.
- **Migration mechanics (C-07).** The `symbol_classification` migration is next-free **`007`** in
  `services/xstockstrat-marketdata/migrations/` (tip `006_dividend_actions`); ship the
  `007_*.up.sql` + `.down.sql` pair. Resolve the strategy per-sector param storage shape (new JSON
  column vs child table) at design; re-derive its migration NNN in the owning service's dir at
  `/sdd-spec`.
- **Look-ahead RED test (ledger `fails.md:1852-1868`).** A look-ahead test on ragged start/end
  calendars passes green while a real mid-series look-ahead ships. The FR-7 as-of-join RED test
  (AC-7) must inject a **mid-series sector reclassification** and assert pre-change bars use the
  pre-change sector — not merely test endpoints.
- **Producer/shared-consumer coupling (ledger `fails.md:81-82,309-310,1151`).** The `Sector` enum
  and the strategy per-sector map hard-couple to shared consumers in the **same PR**: the UI's
  exhaustive `Record<Enum,…>` maps and the agent's descriptor-parity projection test
  (`test_*_view.py` / `test_*_projection.py`). Enumerate these in the C-14 consumer scan at
  `/sdd-spec`, not just the UI page.
- **Scattered FMP wiring (ledger `fails.md:1038-1043,1097,1123`).** FMP provider name, config keys,
  and error text are scattered across `marketdata_service.go`/`main.go` and tests; `grep -rn` all
  FMP sites before centralizing, or the gateway becomes a parallel path rather than the single one
  FR-1 demands.
- **FMP credential (ledger `fails.md:1566-1568`; features 076/147).** The FMP key is an encrypted
  config secret resolved via the `GetSecret` RPC at startup — the centralized gateway must resolve
  it that way and never re-introduce `FMP_API_KEY` as an env var.
- **Proto `Bar.time` not `Bar.timestamp` (ledger `fails.md:726-728`).** The analysis as-of join keys
  on the bar timestamp; use the real field `bar.time` and real `Bar` proto fixtures (not
  `MagicMock`, which hides the wrong field name).
