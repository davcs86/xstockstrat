# Defect: Fabricated 0.5 fundamentals signals already stored in ingest are never retracted

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: fabricated-signal
**Environment**: dev (main-dev) and production; every environment where the fundamentals producer ran before feature 246 ships
**Affected service(s)**: xstockstrat-ingest, xstockstrat-analysis
**Config-only fix possible**: no
**Source**: feature 246-fix-fundsignal-neutral-score design (C-14 owner of stored signals), `docs/roadmap/features/246-fix-fundsignal-neutral-score/design.md`

## Observed

Feature 246 stops the producer from emitting a fabricated 0.5 score for a data-less symbol
(`docs/reports/2026-10-19-analysis-fundsignal-neutral-score-fabricated-defect.md`). It does not touch the
signals already stored. Each one was written to `ingest.newsletter_signals` with conviction 0.5,
`user_id='system'`, and `valid_until` set to emit time + `analysis.fundsignal.valid_days` (default 90).
Until that date it stays active and keeps feeding three readers:

- the live fundamentals blend universe, which reads active signals for the source slug;
- `ListOpportunities`, rendered at `/insights/opportunities` and MCP `list_opportunities`;
- any screener or backtest that weights by the fundamentals source.

## Expected

After feature 246 deploys, every stored fundamentals-source signal that was emitted for a data-less
symbol is expired, so no reader sees it as active.

## Reproduction

1. On an environment where the producer ran over an ETF-heavy universe before 246, query
   `ingest.newsletter_signals` for `user_id='system'`, `source='fundamentals'`, `conviction=0.5`.
2. Rows exist for data-less symbols (e.g. SPY, VOO, QQQ) with `valid_until` in the future.
3. Deploy 246. The rows are still there and still active.

## Evidence

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:232`
> valid_days = self._cfg.get_int("analysis.fundsignal.valid_days", default=90)

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:524-525`
> valid_until = Timestamp()
> valid_until.FromDatetime(now + timedelta(days=valid_days))

`services/xstockstrat-ingest/app/handlers/servicer.py:1020-1022` (insert target and columns)
> INSERT INTO ingest.newsletter_signals
> (source, symbol, direction, conviction,
> valid_from, valid_until, headline, raw_url, tags, user_id)

`services/xstockstrat-ingest/app/handlers/servicer.py:1208` (`QuerySignals` active-window filter)
> conditions.append(f"(valid_until IS NULL OR valid_until >= ${idx})")

`services/xstockstrat-analysis/app/engine/live_loop.py:166-176` (blend universe reads active signals)
> ingest_pb2.QuerySignalsRequest(source=slug, active_window=window, ...)

`services/xstockstrat-analysis/app/repositories/opportunities.py:89,141,226` (opportunity rows carry their own
`valid_until`; reads filter `o.valid_until > now()`)

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:210-216` (`force` deletes the day's
`analysis.fundsignal_emitted` rows, so a forced re-run re-emits with a new `signal_id`)

## Remediation (proposed, operator SQL)

Expire, do not delete: set `valid_until = now()` on `ingest.newsletter_signals` rows matching
`(user_id='system', source=<analysis.fundsignal.source_slug>, symbol, valid_from::date)` for each
confirmed candidate, regardless of `signal_id`. Matching by `signal_id` misses force-rerun orphans
(`fundsignal_loop.py:210-216,260-268`). Run once per environment after 246 deploys. Approvals: DBA +
ingest owner. Precheck: a config audit confirming `analysis.fundsignal.scoring_formula_id` was never set
in that environment (otherwise formula-path rows are also candidates, scored from wire zeros).

Amendments (from the 246 design debate):

- (a) `score=0.5` / `conviction=0.5` is a candidate filter only. Each candidate is confirmed data-less via
  the marketdata fundamentals cache (all five built-in scorer metrics NULL) or by operator review before
  it is expired; a real computed 0.5 is not retracted.
- (b) Reader lag. The blend universe sees the expiry at once (`live_loop.py:166-176`).
  `/insights/opportunities` and MCP `list_opportunities` see it only after the next opportunity recompute,
  because `analysis.opportunities` stores its own `valid_until` (`opportunities.py:87-105,141,203-226`).
  The fix names the recompute trigger or accepts the lag.
- (c) Named residual: partial-row wrong-score signals (e.g. a row with pe 20 and roe 0.0 emitted at 0.6
  instead of 0.30, because `if f.roe:` dropped the zero at `fundsignal_loop.py:425`) are outside this
  predicate and stay live up to `valid_days`.
- (d) If the 246 post-deploy dev smoke (`run_fundamentals_scan symbols=[SPY,VOO,QQQ,IWM,DIA]`) fails, the
  signals the smoke itself emits on dev fall inside this predicate and this report's dev run.

## Root cause hypothesis

Feature 246 is producer-side only by design (Fix Scope: no ingest code change). Signals already stored
have no retraction path; ingest exposes no RPC to expire a system-owned signal, and adding one would
overbuild a one-off cleanup.

## Confidence

high
