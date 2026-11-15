# Context Log: fix-indicator-pane-warmup

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-15 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-15-indicator-panel-sma200-single-point-defect.md`: Long-lookback indicator pane renders a single point
- Source: operator report from staging (homelab) on 2026-11-15, with screenshots; root causes from read-only recon the same day
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): `xstockstrat-ui`, `xstockstrat-analysis` (candidate — series builder)
- Root cause hypothesis: see product-spec.md § Root Cause Hypothesis
- Recommended design depth: full → `/sdd-design fix-indicator-pane-warmup` (rationale: two candidate services (xstockstrat-ui consumer surface + xstockstrat-analysis series builder) and root cause under investigation — the ≥2-services escalate signal)
- Development branch: feature/fix-indicator-pane-warmup

## Session 2026-11-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Result: PASS WITH WARNINGS (0 fails, 4 warnings, 0 floor breaches).
- Warnings:
  - Definition of P (FR-1): "bars needed to produce the first value" is 1 for indicators that emit
    from their first bar (EMA, MACD, VWAP; `services/xstockstrat-analysis/docs/warmup.md`), while the
    platform treats their convergence as 3× period, and custom formulas declare a separate
    `warmup_period`. Design must state which P applies. Recorded in product-spec.md under
    Functional Requirements; all four scenarios use SMA, where P is unambiguous.
  - Root cause is not traced (report confidence low). Accepted for a bug spec by operator decision.
    Recon must record its finding (UI request vs analysis series builder) here before any fix is
    designed.
  - Coverage depth: scenarios use daily SMA only. No scenario covers a multi-output or
    custom-formula indicator, or a non-daily timeframe. Recorded in product-spec.md as a
    design-time item.
  - "Not enough history" is the only user-facing copy. The spec says it is shown per pane; whether
    that means per indicator inside a combined pane is to be firmed up at design.
- Overlap findings: CLEAN (no config-key, proto field-number or migration collision). Low-risk
  shared context, to re-check at impl-spec overlap time:
  - Peer 342-chart-series-palette (`draft`) touches the same indicator chart and legend on the
    symbol page. If both edit `src/lib/indicatorChart.ts` or
    `src/components/trader/IndicatorPanels.tsx`, expect a textual merge conflict; add a soft
    rebase-order row to `merge-order.md` at that point. No entry is required now.
  - If FR-1 lands in the analysis `GetIndicatorSeries` builder, `app/handlers/servicer.py` is shared
    with 308-fix-analysis-per-symbol-isolation and 330-fix-live-enrich-ttl-seed (disjoint line
    ranges; rebase only).
  - Peers 339, 340, 343, 344: same route family at most; no indicator-pane, proto, migration or
    config overlap.
- Recommended design depth: full (two affected services; root cause not traced).

### OPERATOR DECISIONS (binding, recorded 2026-11-15)

- Root cause is not traced; recon must determine whether the missing warm-up prefix is in the UI request or the analysis series builder before any fix is designed.
