# Context Log: fix-config-ui-env

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-07 (/sdd-triage)

- Bug reported via docs/reports/2026-08-07-config-ui-cross-environment-toggle-defect.md (GitHub
  Issues disabled on this repo — no issue number)
- Severity: SEV-2
- Routed to SDD path (Track C) — defect is architecture-level and reproducible in dev, not a
  confirmed-in-production incident requiring a hotfix
- Created: feature.md, product-spec.md, context.md
- Affected services (from report): xstockstrat-ui (config-ui segment), xstockstrat-config
- Root cause hypothesis: the `environment`/`trading_mode` columns are a genuine config-scoping
  mechanism within one database, but the Config UI toggle was never gated to the deployment's own
  native scope — so it reads as a live environment switch when it can only ever reach the single
  database the running instance is bound to
- Recommended design depth: full → `/sdd-design fix-config-ui-env` (rationale: affected services ≥
  2 per the triage skill's C-0 rule — xstockstrat-ui and xstockstrat-config)
- Development branch: feature/fix-config-ui-env
- Related: companion SEV-1 defect (WatchConfig clients omitting environment/trading_mode) is being
  fixed separately on `hotfix/fix-watchconfig-clients-omit`. That fix makes this UI toggle's
  cross-scope writes reachable by real consumers again once it lands — raising, not lowering, the
  priority of gating the toggle here.
