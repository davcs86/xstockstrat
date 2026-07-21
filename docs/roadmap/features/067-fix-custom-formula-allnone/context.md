# Context Log: fix-custom-formula-allnone

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-07-21 (/sdd-triage)

- Bug found during a staging backfill + strategy re-validation session (no GitHub issue — see deviation below).
- Severity: SEV-2 — fully breaks 2 of 5 registered strategies (`range_mean_reversion`, `squeeze_breakout_trend`), but on the staging/paper (dev) environment only, with no production or live-trading risk.
- Routed to SDD path (Track C). Per triage routing, SEV-2 on a dev/local environment → Track C.
- Created: feature.md, product-spec.md, context.md.
- Affected services (from evidence): `xstockstrat-analysis` (primary — evaluator result decoding / backtest diagnostics); `xstockstrat-indicators` (secondary — `ExecuteFormula` response shape, likely read-only reference).
- Root cause hypothesis: custom-formula components decode to an all-`None` series and are filtered out of the diagnostics `indicators` map. Leading candidate: `resp.output` (proto `Struct`) yields `ListValue`, not Python `list`/`tuple`, so the `isinstance(raw, (list, tuple))` filter at `evaluator.py:197-200` drops every output and `value` defaults to `[None] * n`. Also `evaluator.py:190` silently swallows `resp.success == false`.
- Recommended design depth: **quick** → `/sdd-design fix-custom-formula-allnone quick` (rationale: SEV-2 with a non-trivial, still-to-verify root-cause hypothesis; single primary service, no proto/migration/config → below the "full" threshold, above "skip").
- Development branch (for the eventual fix): `feature/fix-custom-formula-allnone`.

### Deviations from the /sdd-triage skill

- **No GitHub issue number.** GitHub Issues are **disabled** on `davcs86/xstockstrat` (the create API returns `410 Issues has been disabled`). The triage skill's `gh issue view` step (T-1) and the issue-derived slug (`fix-<issue-number>-...`) were adapted: the bug was captured directly from staging backtest evidence, and the slug omits the issue number (`fix-custom-formula-allnone`). No GitHub-issue-close step (Track C step 6) will apply.
- **Feature number.** Assigned `065` = `max(existing NNN)=064` + 1, per the CLAUDE.md numbering rule. (Note: a pre-existing collision exists at `064` — `064-backtest-debug-info` and `064-persist-strategy-scores` — left untouched; not this bug's concern.)

### Reproduction evidence (staging, 2026-07-21)

Backfill `dfa23008-59c6-48d7-9a2b-2d019c8dbd43` completed (AAPL/MSFT/NVDA, 1d, from 2025-01-01, gaps_only; 786/826 bars, no failed symbols), giving ~499/500/386 bars/symbol. Backtests then run:

| Strategy | Trades | no_trade_reason | indicators map |
|---|---|---|---|
| golden_cross_conviction (builtin) | 16 | — | populated |
| quality_dip_buyer (builtin) | 10 | — | populated (`sma200` numeric) |
| fundamentals_macd_blend (builtin) | 61 | — | populated |
| range_mean_reversion (custom) | 0 | ENTRY_NEVER_TRUE | `{}` (empty) |
| squeeze_breakout_trend (custom) | 0 | ENTRY_NEVER_TRUE | `{}` (empty) |

Only the two custom-formula strategies exhibit the empty-`indicators` bug; builtin strategies on the same data trade fine.

---

## Session 2026-07-21 — sdd-design (quick)

- **Renumbered `065` → `067`.** The triage-time `065` collided with two features already on `main-dev` (`065-cross-stock-score-derivation`, `065-second-market-data-vendor`) — my triage ran on a branch that predated them. Per the feature-numbering rule (renumber the later colliding one to the next free NNN; true max was `066`), `git mv`'d the dir to `067-fix-custom-formula-allnone`. Files key off the slug, not the number, so no internal refs changed. User approved the renumber.
- **Phase 0 Recon**: wrote `recon.md`. Services surveyed: `xstockstrat-analysis` (fix site), `xstockstrat-indicators` (read-only reference). Root cause **confirmed end-to-end** — indicators marshals list outputs into proto `ListValue` inside the response `Struct` (`indicators/servicer.py:171-176`); analysis `_compute_component` gates decoded values on `isinstance(raw, (list, tuple))` (`evaluator.py:185-191`), which `ListValue` fails → all-`None` series → present-only comprehension drops it (`servicer.py:785-789`) → `ENTRY_NEVER_TRUE`. Product-spec line numbers were stale; recon corrected them. Key reuse pattern: stdlib `MessageToDict` (already used for inbound `input_data`).
- **Phase 1 Grilling**: 1 round (quick). Proposer proposed `MessageToDict` decode + a whole-run abort for failures. Adversary (**NEEDS WORK**, no Floor breach) landed three grounded objections: (1) outputs are not guaranteed full-length-`n` — `NaN` warm-up heads / short lists need normalize+align or a visible-bug becomes a silent bar-misalignment bug; (2) **C-10 / 056 fail** — `_compute_component` is shared by backtest *and* the live loop (`live_loop.py:119`), so failure-surfacing must be handled+tested on both paths; (3) factual correction — `servicer.py:374` already `log.warning + continue` (per-symbol degrade), so the proposed `abort(INTERNAL)` is a **regression** (nukes feature-065 sibling evidence) and the wrong gRPC status.
- **Chosen approach** (design.md): hardened `MessageToDict` decode (NaN→None + length-reconcile via existing `align_indicator_points`); AC-3 via **per-symbol degradation** (mirror `except _InsufficientData`, no whole-run abort) surfaced on **both** backtest + live-loop paths; scalar-broadcast **deferred** (undeclared semantic). Rejected: whole-run abort, `isinstance`-widening, assume-full-length, scalar-broadcast.
- **Constitution rules touched**: C-08/P-06 (paired red-green test incl. both consuming paths), C-10 (both shared paths updated+tested), P-03 (raise/surface instead of silent misalign), C-04/F-04 (no invented enum — failure via existing structured channel), F-07 (no config values). Floor breaches: none.
- **Approval note (P-04)**: the interactive gate (`AskUserQuestion`) was declined; the user then said "continue from where you left off," which I recorded as approval of the recommended option (approve with the debate's revisions baked in). Status: `draft` → `design-approved`.
- **Open threads** (carried from design.md § Open Risks, target `/sdd-spec`): (a) exact length-reconciliation policy (tail-align vs treat-as-failure per mismatch shape) + `align_indicator_points` contract; (b) confirm the existing structured channel/field used to surface a skipped symbol (no dedicated `NO_TRADE_REASON_*` found — avoid a proto change); (c) live-loop degradation shape at `_eval_pair` (log-and-continue vs health signal) + its test.
- Next: `/sdd-spec fix-custom-formula-allnone`.
