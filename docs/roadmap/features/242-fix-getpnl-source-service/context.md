# Context Log: fix-getpnl-source-service

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md`
  (Issues disabled). Found while confirming `2026-10-19-portfolio-default-identity-fallback-defect` (PR #1257).
- Severity: SEV-2. Impact type: wrong-pnl-reported. Environment: dev (main-dev) @ 1302e6d. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..2), context.md.
- Affected services (from report): xstockstrat-portfolio, xstockstrat-trading, xstockstrat-ledger.
- Root cause hypothesis: bare literal mismatch — portfolio queries `"trading"`, trading writes
  `"xstockstrat-trading"`, ledger filters by exact match; the `GetPnL` fake ledger ignores the request.
- Confirmation evidence (report, confidence high): scratch test `zz_getpnl_source_test.go` with an exact-match fake
  ledger and fills buy 10 @ 100 / sell 10 @ 150 → stored as `"xstockstrat-trading"`: `GetPnL queried [trading trading]
  -> realized=0`; control stored as `"trading"`: `realized=500`.
- Line drift: report cites `portfolio_service.go:670-672`/`:715-717`; at triage time the `SourceService: "trading"`
  lines are `:683` and `:728`. Trading emits at `trading.go:1861`, `:2106`, `:2674`.
- Recommended design depth: full → `/sdd-design fix-getpnl-source-service` (rationale: SEV-2 with 3 affected services
  per the report, which is the C-0 full trigger). The fix site is likely portfolio-only (trading and ledger are
  read-only evidence), so the operator may downgrade to `/sdd-design fix-getpnl-source-service quick`; escalation
  stays warranted if design adopts a shared source-service constant spanning trading and portfolio (DRY guard rail).
  Design fork: literal `"xstockstrat-trading"` vs shared constant vs dropping the `SourceService` filter.
- **Overlap:** open PR #1255 (`230-offline-account-full-pnl`) also touches portfolio P&L (`GetPnL` / valuation paths
  in `portfolio_service.go`). Sequence or rebase against it; check merge-order before the integration PR.
- Development branch: feature/fix-getpnl-source-service
