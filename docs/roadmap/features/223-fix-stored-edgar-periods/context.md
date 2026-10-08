# Context Log: fix-stored-edgar-periods

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-06 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-10-06-edgar-stored-de-predates-financial-debt-defect.md`: Stored EDGAR periods still carry total-liabilities D/E after feature 211's financial-debt D/E launched
- Severity: SEV-2
- Routed to SDD path (Track C) — environment dev (staging)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md
- Affected services (from report): xstockstrat-marketdata
- Root cause hypothesis: under investigation — leading candidate is pre-211 backfilled rows never re-derived (earliest-filing idempotency pin); confidence low, unverified against DB/deploy timeline
- Recommended design depth: quick → `/sdd-design fix-stored-edgar-periods quick` (rationale: SEV-2, root cause unverified; re-derivation strategy and drift guard are design choices)
- Coordinate with `222-fix-edgar-quarterly-roe`: one purge + re-backfill after both fixes, not two. The deferred `fundamentals_macd_blend` exit-rule backtests (see 222 context.md) wait on this re-backfill.
- Development branch: feature/fix-stored-edgar-periods

## Session 2026-10-06 — /sdd-design quick (operator decision) + /sdd-execute sequential

- Operator: derivation_version column + conditional upgrade. Root cause confirmed from code (DO NOTHING pin + 216 price-only recovery ⇒ statement columns never rewritten).
- Migration 008 (after 217's 007 — merge-order row added); stacked on 222. Status → code-completed.
- Next operational step: one fundamentals re-backfill after 222 + 223 deploy (runbook § Re-deriving stored periods).

## Session 2026-10-08 (CI: feature status automation)

- Promotion PR #1233 merged to main
- Feature promoted and committed: 595bd1d4effdc73153752d8dce5cee69d1a6f656
- Status updated: `code-completed` → `launched`
- Launched date: 2026-10-08
