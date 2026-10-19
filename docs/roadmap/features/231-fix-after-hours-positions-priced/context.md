# Context Log: fix-after-hours-positions-priced

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-19 (/sdd-triage)

- Found during the feature 229 post-merge staging investigation, then recorded as defect report
  `docs/reports/2026-10-19-after-hours-one-sided-quote-half-price-defect.md`. Issues are disabled.
- Severity: SEV-2 (operator-confirmed). Routed to SDD path (Track C) by operator choice. Environment:
  staging; production runs the same code.
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios AC-1..4), context.md.
- Affected services: xstockstrat-portfolio, xstockstrat-marketdata.
- Root cause hypothesis: one-sided after-hours quote averaged as `(ask + bid) / 2` at 5 sites. This is not a
  regression from feature 229: the formula has been present since at least `6d06894`.
- Recommended design depth: full → `/sdd-design fix-after-hours-positions-priced` (rationale: 2 affected
  services; the fallback-price choice and a possible `Quote` proto field are design forks).
- NNN: 230 is claimed by two in-flight branches (`230-fix-etf-flag-fill`, `230-offline-account-full-pnl`),
  so this feature takes 231. That existing 230 collision is not this feature's to resolve.
- Branch: triage committed on harness-assigned `ccr-9f55a8ac-dtw4iv`, off `main-dev` (as feature 229 did).

## Session 2026-10-19 — sdd-review product-spec

- Product spec approved: PASS WITH WARNINGS, no blockers, no Floor breach. Status: draft → spec-ready.
- Warnings (carried into /sdd-design; resolve in design and acceptance.feature):
  - [ ] W1 C-15: every `Then` is a negative "is never <halved>". Rewrite to one positive expected value once the rule is chosen.
  - [ ] W2 P-03/C-18: "usable price" fork is unresolved. Reuse candidate: `trading.go:3160-3168`
        (both sides > 0 → mid; else the positive side; else FailedPrecondition).
  - [ ] W3: AC-2 is not observable from aggregate equity unless LYFT is the only position. Cover the
        snapshot-skipped outcome (`portfolio_service.go:847`).
  - [ ] W4: AC-3 asserts internal `posValues`. Restate as the emitted concentration alert or % (`:916-921`).
  - [ ] W5: AC-4 Given lacks `marketdata.fundamentals.snapshot_source=edgar` and the filed-date-close fallback (`marketdata_service.go:1726,1753-1756`).
  - [ ] W6 C-10(b): name `GetPnL` (`:652`) and `ListPortfolios` (`:1341`) as affected read paths; add parity.
  - [ ] W7: proto item unchecked. `GetLatestPrice`/`BatchGetLatestPrice` already carry `last_price` (`marketdata.proto:26,54,108`).
  - [ ] W8 C-14: no Consumer Surface(s) line; declare MCP `get_positions` / Book → Portfolio read-only.
- Overlap findings: none blocking.
  - `230-fix-etf-flag-fill` (feature/fix-etf-flag-fill, draft, docs-only).
  - `230-offline-account-full-pnl` (ccr-cd56ff4d-s5wkbb, draft, docs-only). Its scope (offline marks,
    "no live quote marks at 0") will touch the same portfolio valuation functions. Soft ordering note:
    whichever lands second reconciles.
- Test constraint: `portfolio_service_test.go:48` asserts CurrentPrice is the byte-identical `(Ask+Bid)/2`
  (PR #735 parity guard). Update it deliberately.
