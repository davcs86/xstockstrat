# Defect: Orphaned modules, scripts and dependencies across services

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: dead-code
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-config, xstockstrat-ledger, xstockstrat-notify, xstockstrat-marketdata, xstockstrat-analysis, xstockstrat-ingest, xstockstrat-agent, xstockstrat-ui, xstockstrat-portfolio
**Config-only fix possible**: no
**Source**: per-module `docs/context-constitution-findings.md` § Dead / orphaned code (config, ledger, notify, marketdata, analysis, ingest, agent, ui, portfolio)

## Observed

Each of the following has no runtime caller at HEAD. It is either imported only by its own test, or not referenced at all:

1. **config `src/services/configWatcher.ts`**: config never subscribes to itself. The only importer is `src/__tests__/configWatcher.test.ts`. It also carries a stale 10s `waitForSnapshot` default, while the live copies elsewhere use 90s.
2. **ledger `package.json` `migrate` script**: invokes `node-pg-migrate`, but the service migrates with golang-migrate (`scripts/db-migrate.sh`).
3. **notify `jsonwebtoken` / `bcrypt` dependencies (+ `@types`)**: no import anywhere in `src/`. They increase image size and audit surface.
4. **marketdata `alpaca.AlpacaAsset`**: a struct declared "for backward compatibility" with zero references.
5. **analysis + ingest `ConfigWatcher.sandbox_timeout_ms` / `sandbox_memory_bytes` / `sandbox_allowed_imports`**: copied from the indicators watcher. They read `indicators.sandbox.*` keys these services never subscribe to. Only tests use them.
6. **ingest `app/extractors/example_simple_email.py`, `noop.py`** and the non-MCP input dataclasses: imported by nothing in `app/`. `extractor_module` is stored and returned as a string, never dynamically imported.
7. **agent `app/config/` package**: `__init__.py` is 0 bytes and nothing imports it.
8. **agent `app/prompts/signal_extraction.md`**: no `.py` file references it. Only `list_correlation.md` is loaded.
9. **ui `PortfolioPanel` combined (no-account) branch**: effectively unreachable, because `AccountContext` auto-selects the first active account.
10. **portfolio repo `r.pool` stragglers**: five methods still use `r.pool`, while `NewPortfolioRepoWithDB` sets only `db`. These methods nil-panic under pgxmock. Production is unaffected, but they cannot be unit-tested.

## Expected

Delete items 1–8 along with their tests. For item 9, delete the branch or document when it is reachable. For item 10, migrate the five methods to `r.db`.

## Reproduction

1. For each item, grep for importers or references outside its own file and its test. The result is empty, as shown in Evidence.
2. For item 10, construct `NewPortfolioRepoWithDB(mock)` and call `GetSnapshot`. It panics with a nil pointer.

## Evidence

`services/xstockstrat-config/src/services/configWatcher.ts:96`
> async waitForSnapshot(timeoutMs = 10_000): Promise<void> {

`services/xstockstrat-ledger/package.json:11`
> "migrate": "node-pg-migrate up",

`services/xstockstrat-notify/package.json:35-36`
> "jsonwebtoken": "^9.0.2",
> "bcrypt": "^5.1.1"

`services/xstockstrat-marketdata/internal/alpaca/client.go:560-561`
> // AlpacaAsset is kept for backward compatibility.
> type AlpacaAsset struct {

`services/xstockstrat-analysis/app/config/watcher.py:150` / `services/xstockstrat-ingest/app/config/watcher.py:168`
> def sandbox_timeout_ms(self) -> int:

`services/xstockstrat-ingest/app/extractors/noop.py:2`
> extractor_module: app.extractors.noop

`services/xstockstrat-ui/src/components/trader/PortfolioPanel.tsx:21`
> if (selectedAccountId) {

`services/xstockstrat-ui/src/context/AccountContext.tsx:44-45`
> const firstActive = fetched.find((a) => a.isActive);
> return firstActive?.id ?? null;

`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:49` vs `:216`
> return &PortfolioRepo{db: db}
> row := r.pool.QueryRow(ctx, q, portfolioID, atTime)

## Root cause hypothesis

Service-template copy-paste (items 1, 3, 5, 7), features that were planned but never wired (6, 8), and incomplete refactors (4, 9, 10). None of these has a reachability check in CI.

## Confidence

high
