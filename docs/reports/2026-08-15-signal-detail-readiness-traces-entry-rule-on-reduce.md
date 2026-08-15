# Signal Detail: "Why this fired" traces the ENTRY rule on a REDUCE (held/exit) opportunity — 2026-08-15

**Status: open — routed via `/sdd-triage`.**
GitHub Issues are disabled on this repo, so this report is the audit trail per
`docs/runbooks/bug-triage.md`. Found by inspection of the live `xstockstrat-staging` deployment
(Decide → Opportunities → Signal detail).

## Report

On the Signal-detail page (`/insights/market/[symbol]`) for a **held** opportunity tagged
**`Reduce`**, the page shows two mutually contradictory numbers:

- Header **`CONVICTION 100`**.
- "Why this fired" panel: **`0/2 conditions`**, with **both** entry leaves `Fail` (e.g.
  `z < -1.00` → 1.23, `-181.4%`; `er < 0.25` → 0.62, `-59.6%`).

Meanwhile the Opportunities **queue card** for the same `(symbol, strategy)` reads **`100 · 1/1`**
`Reduce` `live_strategy`. Reproduced on `UPRO` under both `range_mean_reversion` (Range Mean
Reversion v3) and `quality_dip_buyer` live strategies.

## Root cause

The header conviction and the "Why this fired" panel are sourced from **two different code paths
that trace different rule trees** for a held/REDUCE row:

1. **Header conviction (100)** = the queue `Opportunity.conviction`
   (`services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx:107` →
   `Math.round(opportunity.conviction * 100)`). For a **held + attributed** candidate,
   `_compute_opportunities` traces the **exit** rule
   (`services/xstockstrat-analysis/app/handlers/servicer.py:2510`, `rule = "exit"`). UPRO's exit rule
   is a single condition that passes → `1/1` → `_conviction_ordinal(1, 1)` returns `1.0`
   (`app/services/evaluator.py:622`) → conviction `100`, and `exit_fires == True` →
   action `REDUCE` (`servicer.py:2916`). This is why the queue card reads `100 · 1/1`.

2. **"Why this fired" panel (0/2)** = `EvaluateReadiness`
   (`services/xstockstrat-analysis/app/handlers/servicer.py:2102`), which calls
   `evaluate_conditions_traced(definition, bars, symbol)` **with no `rule=` argument** — so it
   defaults to `rule="entry"` (`app/services/evaluator.py:179`). UPRO's **entry** rule has 2
   conditions, both far outside their thresholds → `0/2`, conviction `0`.

So the page juxtaposes **exit-rule** conviction (`100`, "reduce/exit warranted") against the
**entry-rule** condition trace (`0/2`, "nowhere near a fresh entry"). Both numbers are individually
correct; the page presents them as if they describe the same rule.

This is a defect in **feature 097's** Decide surface (materialized `ListOpportunities` + the
`EvaluateReadiness` readiness panel, with the held/exit-trace machinery), surfaced now that
feature 131's live-strategy attribution puts held-position `REDUCE` rows in front of the user more
often. `evaluate_conditions_traced` already supports `rule="exit"` (the queue uses it); the
`EvaluateReadiness` RPC and the Signal-detail readiness panel simply never thread it through, so a
`REDUCE`/held opportunity always shows the wrong (entry) rule.

## Expected behavior

For a held opportunity whose row exists because its **exit** rule fired (`REDUCE`, and analogously
the held `ADD` case), the "Why this fired" panel should trace the **exit** rule — the condition that
actually fired — so it reads `1/1` and reconciles with the header conviction. Entry-candidate rows
(ENTER) keep tracing the entry rule as today.

## Severity

**SEV-3** — misleading/contradictory readiness display on the Decide surface. No trading-path,
order-execution, or financial-integrity impact (the panel is informational; the order ticket is
independent). Affects interpretation of REDUCE opportunities, not correctness of any write.

## Suggested fix scope

Thread a rule selector into the readiness path so held (REDUCE/ADD) opportunities trace the exit
rule:

- `EvaluateReadiness` gains a way to select the exit rule for a held symbol (either an explicit
  request field the Signal-detail page sets when the opportunity action is `REDUCE`/`ADD`, or a
  server-side held-position lookup mirroring `_compute_opportunities`' `is_held` → `rule="exit"`
  decision), passing `rule="exit"` into `evaluate_conditions_traced`.
- The Signal-detail page (`market/[symbol]/page.tsx`) requests exit-rule readiness when the matching
  queue `Opportunity.action` is held (`REDUCE`/`ADD`), and labels the panel accordingly ("Why this
  should reduce" vs "Why this fired").
