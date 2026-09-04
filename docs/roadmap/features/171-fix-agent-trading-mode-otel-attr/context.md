# Context Log: fix-agent-trading-mode-otel-attr

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-09-04 (/sdd-triage --from-report)

- Bug surfaced via `docs/reports/2026-09-04-comment-audit-triage.md` item 1 (comment-audit pass).
  No GitHub issue — Issues disabled on this repo (`POST /issues` → 410); the dated report is the
  routable artifact.
- Severity: SEV-3.
- Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md, status.md.
- Affected services: `xstockstrat-agent` (`app/telemetry.py:33,39`).
- Triage verification: **confirmed** the read at `telemetry.py:33` and the `trading_mode` attribute
  at `:39`. Also confirmed `TRADING_MODE` is **still a live env var** — a paper/live routing axis used
  by `xstockstrat-portfolio` (`commonv1.TradingMode` enum) and the indicators/ingest config watchers
  (`resolve_trading_mode`). So this is a naming/semantics mismatch vs the post-147 model, not a stale
  read of a dead variable. The report's "verify, not confirmed" framing is resolved: the axis lives,
  the attribute name is the question.
- Root cause hypothesis: the resource attribute predates feature 147's removal of the config/scope
  `trading_mode` axis and was never reconciled with `deployment.environment`.
- Recommended design depth: **quick** → `/sdd-design fix-agent-trading-mode-otel-attr quick`.
  Rationale: SEV-3, single service, no proto/migration/config would ordinarily be a `skip`, BUT there
  is a genuine open decision (drop the attribute vs rename it) with an observability blast radius
  (Grafana dashboards may query `trading_mode`). One adversarial round settles drop-vs-rename and the
  dashboard-dependency check before spec.
- Development branch: `feature/fix-agent-trading-mode-otel-attr`.
