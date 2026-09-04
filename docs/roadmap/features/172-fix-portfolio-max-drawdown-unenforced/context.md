# Context Log: fix-portfolio-max-drawdown-unenforced

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-09-04 (/sdd-triage --from-report)

- Bug surfaced via `docs/reports/2026-09-04-comment-audit-triage.md` item 2 (comment-audit pass).
  No GitHub issue — Issues disabled on this repo; the dated report is the routable artifact.
- Severity: SEV-3.
- Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md, status.md.
- Affected services: `xstockstrat-portfolio` (`internal/service/portfolio_service.go`).
- Triage verification: **confirmed** at `portfolio_service.go:722` (`GetFloat(
  "portfolio.risk.max_drawdown_pct", 0.10)`) and `:750` (`_ = maxDrawdownPct // drawdown requires
  historical P&L tracking — handled by snapshots over time`). Re-confirms the existing
  `services/xstockstrat-portfolio/docs/context-constitution-findings.md` (Dead/orphaned code) entry
  and the "Read but not yet enforced" note in the portfolio `CLAUDE.md` Config Keys table.
- Root cause hypothesis: drawdown tracking was never built; the read + `_ =` suppressor were left as a
  placeholder. Same class as `trading.risk.daily_loss_limit`.
- Recommended design depth: **quick** → `/sdd-design fix-portfolio-max-drawdown-unenforced quick`.
  Rationale: SEV-3, single service, would be a `skip` — EXCEPT there is a real scope fork with very
  different blast radius (Path A "implement drawdown halt" needs historical P&L state + possibly a DB
  migration + notify wiring, i.e. a real feature; Path B "document honestly" is doc-only). One
  adversarial round decides implement-vs-document before spec, avoiding rework. If Path A is chosen and
  a migration/second service enters scope, re-run design at `full` depth.
- Development branch: `feature/fix-portfolio-max-drawdown-unenforced`.
