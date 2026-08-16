# Context Log: fix-signal-detail-readiness-rule

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-15 (/sdd-triage)

- Bug found by inspection of the live `xstockstrat-staging` Decide surface; recorded as
  `docs/reports/2026-08-15-signal-detail-readiness-traces-entry-rule-on-reduce.md` (Issues disabled).
- Severity: SEV-3 (misleading/contradictory readiness display; no trading-path or financial-integrity
  impact — the order ticket is independent).
- Routed to SDD path (Track C). Created: feature.md, product-spec.md, context.md.
- Affected services: `xstockstrat-analysis` (`EvaluateReadiness`), `xstockstrat-ui` (Signal-detail
  page + `SignalReadiness.tsx`), potentially `packages/proto` (`EvaluateReadinessRequest` rule
  selector).
- Root cause (confirmed, not hypothesis): the queue traces `rule="exit"` for held+attributed rows
  (`servicer.py:2510`) → conviction/`passing`/`total` reflect the exit rule; `EvaluateReadiness`
  (`servicer.py:2102`) traces `rule="entry"` by default (`evaluator.py:179`). The two rule trees are
  presented as one on the Signal-detail page.
- Design-shaping finding: the queue `Opportunity` proto carries only scalar
  conviction/passing/total (no `ConditionEval` leaves), so the exit-rule *leaves* are not exposed to
  the UI today — a UI-only reuse of the queue trace can relabel/hide but cannot show exit leaves
  without an `EvaluateReadiness` change. `EvaluateReadiness` also backs Watchlist readiness, which
  must keep entry-rule tracing for held symbols → any exit tracing must be an explicit caller opt-in,
  not a blanket server-side flip.
- Recommended design depth: **quick** → `/sdd-design fix-signal-detail-readiness-rule quick`
  (rationale: SEV-3 and small, but one genuine fork exists — explicit `EvaluateReadiness` rule
  selector [additive proto + UI opt-in, shows exit leaves] vs a lighter UI-only relabel [no proto,
  no exit leaves]; touches a proto contract, so worth one adversarial round).
- Development branch: feature/fix-signal-detail-readiness-rule
- Slug note: derived as `fix-signal-detail-readiness-rule` (clarity-adjusted from the strict
  first-3-words rule, which would give the unclear `fix-signal-detail-why`).

---

## Session 2026-08-15 (direct Track C fix)

User chose the **full exit-rule-trace** approach (AskUserQuestion) over the lighter UI-only relabel,
and asked to fix it directly. Implemented as a Track C bug fix (design + impl-spec are optional for
bugs per bug-triage runbook), branch `feature/fix-signal-detail-readiness-rule` off `main-dev`.

### Changes
- **proto** (`packages/proto/analysis/v1/analysis.proto`): additive `ReadinessRule` enum
  (`UNSPECIFIED=0`→ENTRY / `ENTRY=1` / `EXIT=2`) + `EvaluateReadinessRequest.rule = 3`. `buf lint` +
  `buf breaking` (against `main-dev`) clean; stubs regenerated via `./scripts/buf-gen.sh`.
- **analysis** (`app/handlers/servicer.py` `EvaluateReadiness`): `rule = "exit" if
  request.rule == READINESS_RULE_EXIT else "entry"`, passed to `evaluate_conditions_traced`.
  UNSPECIFIED/ENTRY keep the entry default (watchlist readiness unchanged).
- **UI**: `useReadiness(strategyId, symbols, rule?)` threads the rule (in the query key so
  entry/exit cache separately); `SignalReadiness` computes `isHeld` from the matching queue
  `Opportunity.provenance.includes("position")` — the exact `is_held` marker `_compute_opportunities`
  used to pick `rule="exit"`, so the panel and the header's conviction always agree — and requests
  `ReadinessRule.EXIT` when held. Copy made rule-agnostic; an "exit rule" cue
  (`data-testid=readiness-exit-rule`) renders on held rows.

### Design decisions
- **Held signal = `provenance` contains `"position"`**, not the action enum. This mirrors the queue's
  own `is_held -> rule="exit"` decision exactly, so the readiness panel and the header conviction are
  guaranteed consistent. A picked strategy with no matching queue row -> no `position` -> entry rule.
- **Explicit caller opt-in, not server-side held inference.** `EvaluateReadiness` also backs
  Watchlist readiness, which must keep entry-rule tracing for held symbols.
- Enum over bool for the closed {entry, exit} rule set (proto governance C-04).

### Verification
- `buf lint`/`buf breaking` clean; analysis `ruff` clean; `pytest` -> **514 passed** (incl. 2 new
  EvaluateReadiness rule-routing tests: default->entry, EXIT->exit leaf).
- UI `tsc --noEmit` + `next lint` clean. e2e: mock `evaluateReadiness` made rule-aware (+`exitReadiness`
  fixture); new `signal-detail.spec.ts` case asserts a held (MSFT/strat-001) opportunity traces the
  exit rule and NOT the entry leaves. Local Playwright can't run (pinned browser absent) — CI's
  sharded e2e is the gate.

### Deviation
- Skipped `/sdd-design` and `/sdd-spec` (permitted for Track C bugs); implemented directly after the
  user picked the approach. No `implementation-spec.md` generated.
