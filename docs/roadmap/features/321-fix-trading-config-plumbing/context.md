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

## Session 2026-11-13 — sdd-review A1b (demoted-duplicate, interactive)

- sdd-batch preflight flagged a demoted-duplicate match against 277 `fix-ingest-seeded-config-keys` (demoted/canceled, archived 2026-11-04). Routed through /sdd-review A1b interactively.
- Operator decision (2026-11-13): **321 is a re-attempt of 277.** Recorded as "Reactivated as duplicate of demoted feature `fix-ingest-seeded-config-keys`". Status stays `spec-ready` (the full review already passed 2026-11-10; A1b's skip-review path is moot).
- Design must read 277's `## Archive Synthesis` (`docs/roadmap/features/277-fix-ingest-seeded-config-keys/context.md`) as prior art, in particular its demotion reason (scope grew from 5 keys to an 18-key cross-service re-key over four rounds of new blockers) and its config-migration scars: key-only UPDATEs write no audit row; a blind namespace re-key aborts on `config_values_scope_uniq` when twins exist; a PRE_DEPLOY `RAISE` leaves golang-migrate dirty and blocks every deploy; `migration-rerun.sh` runs `up` to head before assertions (needs a dedicated `goto` pass).
- Development branch created: `feature/fix-trading-config-plumbing` (from origin/main-dev).

## Session 2026-11-20 — sdd-design (in progress)

- Phase 0 Recon: wrote recon.md (services: trading, config; consumer surfaces checked: ui, agent — no change). Two product-spec premises are stale at HEAD: the getters no longer return 0 on the other numeric branch (feature 295), and migration 041 already seeds `broker.timeout_ms`, `order.max_retries`, `order.retry_delay_ms` as int. Only `broker.paper` is unseeded.
- Phase 1 Grilling: rounds 1-2 run (full mode); register in debate.md (D-1..D-15, R-1..R-8). No Floor breach.
- **Operator rulings at the round-2 gate (2026-11-20):**
  - **O-1 / D-13 — IBKR request bound: accepted, with a pre-deploy operator action.** Each signed IBKR request is bounded by the live `trading.broker.timeout_ms` instead of the hardcoded 10 s. Before 321 deploys, the operator sets `trading.broker.timeout_ms` to 10000 in both environments. Accepted consequences: slow IBKR calls become uncertain outcomes at the configured bound; an emergency flatten that times out halts the account with the position possibly open until reconciliation; at 10000 every Alpaca call's timeout also becomes 10 s and the Alpaca 429 retry budget is a single attempt.
  - **O-8 / O-11 / D-14 — paper/live source: signed off.** `APPLICATION_ENV` alone decides trading's paper/live; `broker.paper` is seeded per environment (staging true, production false) and becomes a one-edit config-ui row. **C-16 CHANGE approved: 304 @AC-14 is superseded by 321 @AC-4** — `trading.broker.paper` is seeded per environment by the config migration, the `scripts/config-wiring.json` read-unseeded entry is removed, and `check-config-wiring.mjs --final` must report no read-unseeded or STALE line for it.
  - **O-21 / D-15 — proto comment:** fix the stale `TRADING_MODE env` comment at `packages/proto/trading/v1/trading.proto:264` in 321 (comment-only proto step).
  - **Gate decision: run another round** (round 3). The P-06 natural-RED waiver for AC-2 is NOT yet given — it is part of design approval.
