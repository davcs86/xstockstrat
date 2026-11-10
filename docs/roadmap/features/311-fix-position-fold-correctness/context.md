# Context Log: fix-position-fold-correctness

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - `docs/reports/2026-10-06-portfolio-fill-fold-not-exactly-once-defect.md` — portfolio re-applies full order.filled history on restart; position writes serialized in-process only (SEV-2, production)
  - `docs/reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md` — live position fold treats every trading sell fill as a buy (SEV-2)
  - `docs/reports/2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md` — bracket leg fills never reach the ledger, so realized P&L omits the exit (SEV-2)
- Cluster rationale: all three corrupt the same portfolio live fold of `order.filled` (which fills arrive, how often, and with what sign); fixing them separately would re-touch processOrderFill three times.
- Severity: SEV-2 (all three)
- Routed to SDD path (Track C); prod-impacting SEV-2 (report 1) routed to C by operator decision 2026-11-10
- Created: status.md, feature.md, product-spec.md, acceptance.feature (4 regression scenarios), context.md; report sidecars stamped `triaged`
- Affected services (from reports): xstockstrat-portfolio, xstockstrat-trading
- Root cause hypothesis: in-memory-cursor fold with no idempotency key or DB-level locking; fold ignores side (trading now emits `side` since 251, consumer unchanged); no poller for bracket leg fills
- Recommended design depth: full → `/sdd-design fix-position-fold-correctness` (rationale: DB migration for exactly-once, 2 services, production data repair question)
- Development branch: feature/fix-position-fold-correctness
