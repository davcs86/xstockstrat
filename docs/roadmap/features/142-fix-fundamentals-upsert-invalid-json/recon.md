# Recon: fix-fundamentals-upsert-invalid-json

**Created**: 2026-08-16
**From**: product-spec.md
**Affected services**: xstockstrat-marketdata

---

## Objective

`UpsertFundamentals` fails with a Postgres invalid-JSON-input error for at least one symbol
(UPRO). Investigation ruled out the original "bad vendor data" hypothesis: `ExtraMetrics` is a
`map[string]float64` populated only with hardcoded-key finite floats (or left empty), so
`json.Marshal` on this path cannot itself emit malformed JSON, and a NaN/Inf would fail at
`json.Marshal` (a Go error) before ever reaching Postgres. The strongest evidence-backed lead
instead is a driver/SQL-text gap: the `extra_metrics` bind parameter has no `::jsonb` cast, and
`marketdata` runs under `pgx.QueryExecModeExec` (required for its PgBouncer connection), which
skips the server round-trip that would otherwise tell pgx the parameter's real column type —
plausibly causing pgx to bind the `[]byte` payload as `bytea` instead of `jsonb`, which Postgres
cannot implicitly coerce.

## Codebase Map

- **`xstockstrat-marketdata`** (Go)
  - `UpsertFundamentals` — `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:300-332`
    - `extraJSON, err := json.Marshal(f.ExtraMetrics)` (`:301`)
    - `INSERT ... VALUES ($1,...,$14,...)` — **`$14` (extra_metrics) has no `::jsonb` cast** (`:316`)
    - `extraJSON` ([]byte) bound as a plain parameter, not string-interpolated (`:330`) — rules out
      quote/escaping injection
  - `extra_metrics` column is `jsonb NOT NULL DEFAULT '{}'` —
    `services/xstockstrat-marketdata/migrations/002_fundamentals.up.sql:21` (note: the observed
    error text says "type json"; worth reconfirming the verbatim error DETAIL against a live
    reproduction, since Postgres's jsonb coercion-failure path can still summarize as "json")
  - `ExtraMetrics` field — `map[string]float64` — `services/xstockstrat-marketdata/internal/source/source.go:47`;
    values are always finite floats from `encoding/json`-unmarshaled HTTP response bodies; keys are
    hardcoded literals, never vendor-controlled strings
  - Finnhub path (the **default** provider) never populates `ExtraMetrics` at all —
    `services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go:106`:
    `ExtraMetrics: map[string]float64{}` — always empty, for every symbol
  - FMP path populates at most two numeric keys (`volume`, `change`) from decoded floats —
    `services/xstockstrat-marketdata/internal/fmp/fmp_client.go:202-209`
  - Active provider is config-driven (`marketdata.fundamentals.provider`, default `finnhub`, read
    once at boot) — `services/xstockstrat-marketdata/CLAUDE.md` Config Keys Consumed table
  - `marketdata` runs under `pgx.QueryExecModeExec` specifically because it's PgBouncer-pooled
    (named prepared statements are unsafe there) —
    `services/xstockstrat-marketdata/internal/repository/pool.go:30-38`; `DB_PGBOUNCER=true` is set
    in both staging and production per `docs/patterns/database.md:65-86`
  - pgx version: `github.com/jackc/pgx/v5 v5.9.2` — `services/xstockstrat-marketdata/go.mod:8`

## Patterns to REUSE

- Every sibling service's parameterized jsonb write **explicitly casts** the bind param —
  established repo convention `UpsertFundamentals` does not follow:
  - `services/xstockstrat-analysis/app/repositories/strategy_scores.py:47` — `$4::jsonb`
  - `services/xstockstrat-analysis/app/repositories/strategies.py:47,84,128` — `::jsonb`
  - `services/xstockstrat-indicators/app/services/formulas_repository.py:63,103,179` — `::jsonb`
  Fix: add `::jsonb` to the `$14` bind site in `UpsertFundamentals`'s INSERT text, matching this
  existing convention exactly (Go/pgx equivalent of the Python/asyncpg pattern above).

## Dependencies

- Proto/RPC: none
- Migration: none — no schema change, only the SQL text in `UpsertFundamentals`
- Config keys: none
- Inter-service edges: none
- New env vars / ports: none

## Risks / Not-found

- **UPRO-specificity is unexplained.** `ExtraMetrics` content doesn't meaningfully vary by
  symbol (Finnhub: always `{}`; FMP: at most two floats) — a driver/OID-inference bug of this
  shape would fire on every `UpsertFundamentals` call, any symbol, any provider, not selectively on
  UPRO. Two readings: (a) the bug is real and symbol-independent, and UPRO was simply the first/only
  symbol exercised through this path recently in the observed window; or (b) something not yet
  reachable by static code reading is UPRO-specific and the driver hypothesis is wrong. Design must
  address this explicitly — the fix should be verified against a repro, not assumed correct from
  code reading alone.
- Not confirmed: the verbatim Postgres error DETAIL/CONTEXT text (only the summary + SQLSTATE
  22P02 was available) — would confirm/rule out the bytea-coercion path vs. a genuinely malformed
  byte sequence.
- Not confirmed: whether the observed failure occurred with `DB_PGBOUNCER=true` actually in effect
  (staging config says yes, but not independently reproduced here).
- Not confirmed: which provider was active at the time of the observed failure (repo default is
  `finnhub`, whose `ExtraMetrics` is always empty `{}` — if `{}` alone can trigger the failure, that
  actually *strengthens* the driver-level hypothesis, since an empty-map payload has zero
  symbol-specific content).
- No existing test or fixture for UPRO/ETF symbols in this service to compare against.

## Recommended Scope

Primary candidate fix (subject to grilling): add `::jsonb` to the `extra_metrics` bind parameter
in `UpsertFundamentals`'s SQL text, matching the repo's established jsonb-cast convention. Pair
with a regression test that reproduces the failure mode against a `pgxmock`-simulated (or, if
available, live) Postgres connection under `QueryExecModeExec` — proving the cast fixes the OID
mismatch — rather than a test that would pass even without a live coercion check.
