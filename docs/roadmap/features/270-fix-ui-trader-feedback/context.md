# Context Log: fix-ui-trader-feedback

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-ui-trader-feedback-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-11, D-17,
  D-45, D-64 (plus needs-confirmation NC-D recorded as an open question).
- Severity: SEV-2 (group severity; D-64 alone was rated one tier lower by the surveyor). Impact type:
  misleading-trading-ui. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..7), context.md.
- Affected services: xstockstrat-ui (fix site); xstockstrat-analysis (D-45 semantics, NC-D); xstockstrat-trading
  read-only (D-17 server-side mode derivation).
- Root cause hypothesis: fire-and-forget stream hook with no freshness rule (D-11); display default leaking into
  requests (D-17); half-copied request shape (D-45); per-call `onError` omitted with no global fallback (D-64).
- Re-verification on main-dev @ a053b0e: all four reproduce in code. Line drift: D-11 unchanged
  (`useOrderUpdates.ts:25-27`, `OrdersTable.tsx:66`, `AlertStream.tsx:44`); D-17 page lines unchanged,
  `AccountContext.tsx:60` → `:61-62`, plus `OrderForm.tsx:139` (where PAPER enters the request); D-45 unchanged
  (`positions/[symbol]/page.tsx:1144`, `:1149-1158`; `insights/strategies/[id]/page.tsx:101-103`; analysis
  `servicer.py:865-870`); D-64 unchanged (`opportunities/page.tsx:155-156`, `signal-sources/page.tsx:254-262`,
  `trader/portfolio/page.tsx:108-113`).
- D-17 server contract checked: trading `resolveTradingMode` (`services/xstockstrat-trading/internal/service/trading.go:3570-3581`)
  maps `TRADING_MODE_UNSPECIFIED` to the environment's mode (`trading.broker.paper` / `TRADING_MODE`), so sending
  UNSPECIFIED needs no trading change.
- **Open question (NC-D):** does `strategy_id=''` create or overwrite a phantom `''` row in
  `analysis.strategy_scores_v2`? Partial evidence: `_recompute_headline` (`servicer.py:2811-2826`) resolves
  `get_by_owner_and_id(user_id, '')` first and returns `None` on a miss, so the headline path likely no-ops; but the
  run-history / per-symbol cell rows (`servicer.py:1280-1310`) are persisted keyed `''`. Settle in design: if
  phantom score rows exist, the fix needs an analysis guard (reject or ignore empty `strategy_id` with
  `strategy_id_ref`) and possibly a cleanup of existing `''` rows (which would add a migration and DBA review).
- **Overlaps:** 245-fix-screener-symbol-isolation (`implementation-ready`) edits `positions/[symbol]/page.tsx`
  (EmptyState host, `:66`); 246-fix-fundsignal-neutral-score (`implementation-ready`) edits
  `insights/opportunities/page.tsx`; launched 240-offline-account-full-pnl last touched `positions/[symbol]` and
  `trader/portfolio/page.tsx`. Expect textual conflicts; check `merge-order.md`. Related: feature-gap I-15 (unpriced
  guard) is out of scope. Sibling batch feature 272-fix-analysis-backtest-bounds (created concurrently, D-28/D-29)
  touches analysis `RunBacktest` — coordinate if NC-D adds an analysis guard there.
- Recommended design depth: full → `/sdd-design fix-ui-trader-feedback` (rationale: affected services ≥ 2 — ui +
  analysis for D-45/NC-D). The fix site is likely UI-only, so the operator may downgrade to
  `/sdd-design fix-ui-trader-feedback quick`; escalation stays warranted if NC-D confirms phantom rows. Design forks:
  D-17 send UNSPECIFIED vs block order entry; D-64 global mutation `onError` toast vs per-site handlers; D-11
  freshness by `updatedAt` vs dropping stream records on each poll.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Development branch: feature/fix-ui-trader-feedback
