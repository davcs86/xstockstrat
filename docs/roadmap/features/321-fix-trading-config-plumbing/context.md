# Context Log: fix-trading-config-plumbing

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bugs reported via defect reports (Issues disabled):
  - docs/reports/2026-10-19-trading-ibkr-timeout-hardcoded-defect.md — IBKR broker client ignores trading.broker.timeout_ms (SEV-3)
  - docs/reports/2026-10-19-trading-config-accessor-type-mismatch-defect.md — trading reads int-documented config keys with GetFloat (SEV-3)
  - docs/reports/2026-10-19-trading-requires-approval-always-false-defect.md — trading.orders.requires_approval is always persisted false (SEV-3)
  - docs/reports/2026-11-06-trading-broker-paper-env-derived-default-unseedable-defect.md — trading.broker.paper has an environment-derived default a catalog seed cannot express (SEV-2)
- Cluster rationale: all four are xstockstrat-trading config-read / persistence plumbing in the same service files (broker instantiation, config watcher getters, order persistence), so one feature touches them once.
- Severity: SEV-2 (highest; R4)
- Routed to SDD path (Track C); prod-impacting SEV-2 routed to C by operator decision 2026-11-10
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios @AC-1..4), context.md
- Affected services (from reports): xstockstrat-trading, xstockstrat-config
- Root cause hypotheses: see product-spec.md § Root Cause Hypothesis (spot-check: broker.timeout_ms now has a single GetFloat reader at HEAD)
- Recommended design depth: full → `/sdd-design fix-trading-config-plumbing` (rationale: SEV-2 + ≥2 affected services (trading, config) + config-key changes and a getter-coercion design fork)
- Development branch: feature/fix-trading-config-plumbing

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); config-key contract (value_type/default/reader/seed/live) for broker.timeout_ms, order.max_retries, order.retry_delay_ms, broker.paper deferred; migration NNN unpinned; AC-1 'about 2 seconds' imprecise; C-2/C-3 notes (Alpaca unaffected, paper-safety) missing
- Overlap findings: WARN: trading.go shared with 311/312/315; trading.broker.paper coordination with 322; config migration NNN with 322/330
- Recommended design depth: full (trading + config; config seeds; 322 TRADING_MODE coupling)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)
