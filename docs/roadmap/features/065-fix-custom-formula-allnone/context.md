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
