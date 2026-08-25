# Context Log: fix-fundamentals-signal-producer

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-25 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-08-25-fundsignal-first-cycle-resets-on-redeploy-defect.md`
  (GitHub Issues disabled on this repo — filed as a report, no issue number to close).
- Severity: SEV-2. Config-only fix possible: no. Impact type: behavior-correctness.
  Environment: dev / staging (and production under promotion-driven redeploys).
- Routed to SDD path (Track C): SEV-2 with environment dev/staging → Track C.
- Created: status.md (`draft`), feature.md, product-spec.md, acceptance.feature (2 regression
  scenarios), context.md.
- Affected services (from report): xstockstrat-analysis (fundamentals signal producer, feature 062 / 154).
- Root cause hypothesis: `fundsignal_loop.py:98-100` sleeps before the first `run_once` and keeps no
  persisted schedule; `deploy-dev.yml` redeploys the whole app on every `main-dev` push, so each
  restart resets the sleep and the first cycle is deferred indefinitely.
- Recommended design depth: **quick** → `/sdd-design fix-fundamentals-signal-producer quick`
  (rationale: SEV-2, single service, no proto/migration/config-key change; too small to debate in
  full, too risky — a scheduling change to a live producer — to skip design entirely).
- Development branch: feature/fix-fundamentals-signal-producer.
- Feature number: 155 (max existing NNN = 154 + 1; note 153 is a duplicated prefix in the tree
  — `153-fix-ohlcv-chunk-lock-oom` and `153-ui-auth-improvements` — but max is still 154).

### Related operational state (carried from the discovery session, not part of the fix code)

- Stopgap already applied in **staging**: `analysis.fundsignal.run_interval_hours` set to `1`
  (config version `1787692710368`, 2026-08-25) so each fresh process fires within ~1h of startup
  despite deploy churn. This is a mitigation, not the fix. **Revert to `24` once the fix lands**
  (a config action, tracked here — out of scope for the code change).
