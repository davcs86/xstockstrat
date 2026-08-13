# Product Spec: fundamentals-provider-alternative

**Created**: 2026-08-12

---

## Problem Statement

`xstockstrat-marketdata`'s fundamentals source (feature 059) integrates Financial Modeling Prep
(FMP) on its free **Basic** plan: a 250-request/day cap (`marketdata.fmp.daily_request_cap`) plus
the free plan's per-symbol `/stable/ratios-ttm` and `/stable/profile` endpoints being throttled to
a small symbol universe. Screening or backtesting ratio-based strategies across the platform's
full symbol set starves against these limits well before the 250/day ceiling is even reached,
because `ratios-ttm`/`profile` are not batchable (one call per symbol) unlike `/stable/quote`.

## User Story

As a platform operator, I want `xstockstrat-marketdata`'s fundamentals source to stop being
bottlenecked by FMP's free-tier limits, so that ratio-based screening/backtesting works across the
full symbol set instead of a handful of names.

## Functional Requirements

FR-1. Recon/design must verify, against each candidate's **current, live API documentation** (not
recollection or prior conversation summary), the real free-tier request limits and whether each of
the following fields is available on the free tier for arbitrary US-listed equities: price, market
cap, P/E, EPS, 52-week high/low, P/B, dividend yield, ROE, debt-to-equity, beta, currency. Only
Finnhub and Twelve Data are in scope for this comparison.

FR-2. Design must select exactly one candidate as the implementation target, justified by the FR-1
findings (materially better effective throughput than FMP's 250/day + per-symbol-throttled
ratios/profile, and full coverage of the required fields on the free tier). If neither candidate
clears FMP's current ceiling with full field coverage, design must say so explicitly rather than
force a pick — see `docs/roadmap/ledger/insights.md` 2026-08 "data-source ideas" entry (a
demotion at idea/design stage is a valid, cheap outcome).

FR-3. Implement a new `source.FundamentalsSource` for the selected provider, mirroring the shape of
`internal/fmp/fmp_client.go` (`GetFundamentals`/`GetFundamentalsMulti`), populating the same
`source.Fundamentals` fields FMP currently populates. No changes to the `source.Fundamentals`
struct, the `GetFundamentals`/`GetFundamentalsMulti` RPCs, or their proto messages — this is a
same-shape client swap behind the existing interface.

FR-4. Preserve the existing read-through DB cache behavior in `marketdata.fundamentals`
(`cache_ttl_hours` → no external call; miss/stale → quota-guarded fetch; at cap → serve stale
(`stale=true`) or `ResourceExhausted`; source disabled → `FailedPrecondition` with no external
call) — same semantics as today, pointed at the new provider's actual limit shape (daily cap,
per-minute rate limit, or whatever the provider's real docs specify; FR-1's findings determine the
exact guard shape).

FR-5. New provider config keys follow the existing `marketdata.<source>.*` convention (see
`marketdata.fmp.*` in `services/xstockstrat-marketdata/CLAUDE.md`): `enabled`, `base_url`, request
quota key(s) matching FR-1's findings, `metrics` if the provider has a similar
core/extended endpoint split. The API key is a secret env var (`<PROVIDER>_API_KEY`), never a
config key — same rationale as FMP's `FMP_API_KEY` (config values are plaintext and streamed to
every `WatchConfig` subscriber).

FR-6. Whether FMP is fully replaced or kept as a switchable alternative behind the same interface
is a design-time decision (see product-spec `Open Questions`); if kept switchable, add a
`marketdata.fundamentals.provider` selector config key defaulting to the new provider. If FMP is
replaced outright, remove `internal/fmp/` cleanly (no dead registration in `cmd/server/main.go`,
no orphaned `marketdata.fmp.*` config keys/migration).

FR-7. No change to which callers may reach fundamentals data — `xstockstrat-analysis` (screener,
fundamentals-signal producer) continues to read **only** via the cached
`GetFundamentals`/`GetFundamentalsMulti` RPCs, never the provider directly (unchanged chokepoint
invariant from feature 059).

## Out of Scope

- OHLCV/quote source changes (Alpaca remains the sole OHLCV source; a second OHLCV vendor is
  tracked separately in idea-stage feature `065-second-market-data-vendor`)
- Newsletter/signal source integrations (`docs/runbooks/add-data-source.md` Part 2)
- Any UI or MCP agent tool changes — this is a same-shape backend client swap with no
  consumer-facing surface change
- Historical backfill of fundamentals for previously-cached symbols (existing cache/TTL behavior
  handles staleness on next read)

## Affected Services

- `xstockstrat-marketdata` — owns the `source.FundamentalsSource` client, the fundamentals cache,
  and the `GetFundamentals`/`GetFundamentalsMulti` RPCs
- `xstockstrat-config` — new `marketdata.<source>.*` config keys (registration only, no service
  code changes expected)

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — none
- [ ] **Agent** — none
- [x] **None** — internal/platform-only. `GetFundamentals`/`GetFundamentalsMulti` are unchanged
  RPC contracts; existing callers (`xstockstrat-analysis` screener and fundamentals-signal
  producer, and any UI/agent surface that already reads through those RPCs) see no shape or
  behavior change beyond improved availability/coverage. No new UI page, control, or MCP tool is
  introduced by this feature.

## Proto Contract Changes

- [x] No proto changes required

`source.Fundamentals`, `GetFundamentalsRequest`/`Response`, and
`GetFundamentalsMultiRequest`/`Response` are unchanged — this is an internal client swap behind
the existing `source.FundamentalsSource` interface.

## Config Key Changes

- OR: new keys, exact names/types/defaults determined by FR-1's live-docs findings and finalized
  in design.md / implementation-spec.md, following the `marketdata.<source>.*` convention:
  - `marketdata.<source>.enabled` (bool, default `false`)
  - `marketdata.<source>.base_url` (string)
  - `marketdata.<source>.cache_ttl_hours` (int) — or reuse `marketdata.fmp.cache_ttl_hours`'s
    pattern under the new source name
  - a request-quota key matching whatever guard shape FR-1 finds (daily cap and/or per-minute
    rate limit)
  - possibly `marketdata.fundamentals.provider` (string selector) if FR-6 resolves to
    switchable-not-replaced
  - secret: `<PROVIDER>_API_KEY` env var (not a config key — matches `FMP_API_KEY` precedent)

## Database Changes

- [x] No schema changes expected

Reuses the existing `marketdata.fundamentals` cache table (migration `002_fundamentals.up.sql`) —
FR-3 requires the new client populate the same fields FMP does today. If design finds a required
field needs a schema addition, that must be called out explicitly in design.md, not assumed here.

## Feature Workflow Notes

Branch: this feature's SDD **Development Branch** is deliberately the harness-assigned
`claude/fmp-free-layer-ratios-dr0c4j` rather than a fresh `feature/<slug>` branch — the task that
opened this session pins all commits/pushes to that branch. This is a documented deviation from
the default `feature/<slug>`-from-`main-dev` convention (see `docs/runbooks/feature-workflow.md`),
made specifically to avoid the branch-divergence trap recorded in
`docs/roadmap/ledger/fails.md` (2026-07-30, `082-fix-fmp-config-boot-only`): letting a
harness-assigned branch and a separately-created SDD branch silently diverge. Keeping one branch
as the single source of truth for both the SDD artifacts and the implementation avoids that failure
mode entirely.

Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking config change; no proto change)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A unless design finds a schema gap

## Acceptance Criteria

1. Recon/design cites the live, current API documentation URL and quoted limit/field-coverage
   text for both Finnhub and Twelve Data — no claim about either provider's limits or coverage is
   accepted without a citable source read during this feature's design phase.
2. Exactly one provider is selected (or the feature is explicitly demoted with a written
   rationale if neither clears the bar) and recorded in design.md § Chosen Approach.
3. The new client returns all of: price, market cap, P/E, EPS, 52w high/low, P/B, dividend yield,
   ROE, debt-to-equity, beta, currency for a representative sample of symbols outside FMP's
   restricted-free-tier set, verified via a live smoke test against the provider's free tier.
4. `GetFundamentals`/`GetFundamentalsMulti` RPC contracts are unchanged; existing consumers
   (screener, fundamentals-signal producer) require no code changes.
5. Quota-guard behavior (stale-serve at cap, `FailedPrecondition` when disabled) is preserved and
   covered by tests mirroring the existing FMP quota-guard tests.
6. `services/xstockstrat-marketdata/CLAUDE.md` and `docs/patterns/config-governance.md` are
   updated to reflect the new source's config keys and (if FMP is removed) FMP's removal.

## Open Questions

- [ ] Which of Finnhub / Twelve Data becomes the implementation target? — resolved by
  `/sdd-design` recon (FR-1/FR-2), not assumed here.
- [ ] Does FMP get removed outright or kept as a switchable alternative (FR-6)? — resolved by
  `/sdd-design`; default lean is full replacement unless recon finds a reason (e.g. FMP-only
  field/coverage gap) to keep both.
- [ ] Known trap (`docs/roadmap/ledger/fails.md` 2026-08-06 `fundamentals-data-source`): don't
  assume an existing alert/quota-guard helper is parameterized for a new source's limit shape
  (severity, cap type) without reading its full signature — read `internal/service/marketdata_service.go`'s
  existing FMP quota-guard code in full during recon before assuming it generalizes.
