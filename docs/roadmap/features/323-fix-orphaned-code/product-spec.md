# Product Spec: fix-orphaned-code

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-orphaned-code-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10

---

## Problem Statement

### Orphaned modules, scripts and dependencies across services

Report: [docs/reports/2026-10-19-orphaned-code-defect.md](../../../reports/2026-10-19-orphaned-code-defect.md)

- **Observed:** each item has no runtime caller (imported only by its own test, or not at all):
  1. config `src/services/configWatcher.ts` — config never subscribes to itself; stale 10s `waitForSnapshot` default.
  2. ledger `package.json` `migrate` script invokes `node-pg-migrate`; the service migrates with golang-migrate.
  3. notify `jsonwebtoken` / `bcrypt` (+ `@types`) — no import in `src/`.
  4. marketdata `alpaca.AlpacaAsset` — zero references.
  5. analysis + ingest `ConfigWatcher.sandbox_*` accessors reading `indicators.sandbox.*` keys never subscribed to.
  6. ingest `app/extractors/example_simple_email.py`, `noop.py` and the non-MCP input dataclasses.
  7. agent `app/config/` package (`__init__.py` 0 bytes, nothing imports it).
  8. agent `app/prompts/signal_extraction.md` — no `.py` reference.
  9. ui `PortfolioPanel` combined (no-account) branch — effectively unreachable (`AccountContext` auto-selects).
  10. portfolio repo `r.pool` stragglers — methods use `r.pool` while `NewPortfolioRepoWithDB` sets only `db`; nil-panic under pgxmock.
- **Expected:** delete items 1–8 with their tests; item 9 delete the branch or document when it is reachable;
  item 10 migrate the methods to `r.db`.

## Reproduction Steps

1. For each item, grep for importers/references outside its own file and test — empty (see report Evidence).
2. Item 10: construct `NewPortfolioRepoWithDB(mock)` and call `GetSnapshot` — nil-pointer panic.

## Root Cause Hypothesis

Service-template copy-paste (items 1, 3, 5, 7), planned-but-unwired features (6, 8), incomplete refactors
(4, 9, 10); no reachability check in CI.

Spot-check at 0fecb24d:
- Still present: `services/xstockstrat-config/src/services/configWatcher.ts:96`; `services/xstockstrat-ledger/package.json:11`;
  `services/xstockstrat-notify/package.json:35-36,51`; `services/xstockstrat-marketdata/internal/alpaca/client.go:654`;
  `services/xstockstrat-ingest/app/extractors/{example_simple_email,noop}.py`; `services/xstockstrat-agent/app/prompts/signal_extraction.md`;
  `services/xstockstrat-ui/src/components/trader/PortfolioPanel.tsx:85`; `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:217,241,341` (`r.pool`).
- **Changed:** item 5 — no `sandbox_timeout_ms` / `sandbox_memory_bytes` in `services/xstockstrat-{analysis,ingest}/app` (appears already removed).
  Item 7 — `services/xstockstrat-agent/app/config/` now holds `watch_core.py` and `watcher.py` besides `__init__.py`; re-verify orphan status before deleting.

## Affected Services

- xstockstrat-config, xstockstrat-ledger, xstockstrat-notify, xstockstrat-marketdata, xstockstrat-analysis,
  xstockstrat-ingest, xstockstrat-agent, xstockstrat-ui, xstockstrat-portfolio

## Fix Scope

- [x] Proto changes anticipated: **no** — deletions and an internal repo refactor only.
- [x] Database migrations anticipated: **no** — item 10 changes the Go handle used, not the schema.
- [x] Config key changes anticipated: **no** — item 5's watcher accessors read keys these services never subscribe to; no key is added or retired.

## Open Questions

1. Item 9 (`PortfolioPanel` no-account branch): delete it, or document when it is reachable? The report offers both.
2. Items 5 and 7 have shifted since the report (5 appears resolved; 7's package now has modules) — confirm current scope at recon.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev; Docker images for notify and ledger still build.

## Out of Scope

- Adding a CI reachability / dead-code check (named in the root cause, not requested by the report).
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
