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

## Session 2026-11-20 — sdd-design

- Phase 0 Recon: wrote recon.md (services: trading, config; key reuse patterns: Alpaca's live `Timeout func()` closure; the 054 INSERT-if-absent seed migration).
- Phase 1 Grilling: 3 rounds (full). Chosen approach: IBKR signed requests read `broker.timeout_ms` live with the 10 s stale floor kept; no getter change, an int-row flatten guard test; `requires_approval` bound from the insert-time status; `broker.paper` from `APPLICATION_ENV`, seeded per environment by config migration 056 (provisional); a comment-only proto fix. Rejected: `GetInt` switch, getter coercion, dropping the floor, keeping `broker.paper` unseeded, keeping the `TRADING_MODE` fallback (R-1..R-9 in debate.md).
- **Operator rulings at the round-3 gate (2026-11-20):**
  - **Design approved.**
  - **P-06 waiver for AC-2 granted:** "AC-2 red N/A — no behavior change: since feature 295 `GetFloat` widens an int row, so an int `order.max_retries` row is already honoured at HEAD; characterization test `TestFlattenAndHalt_IntRetryRowsSetAttempts_F321_AC2` added. Discrimination is shown by mutation instead of a natural RED (hardwiring `maxRetries := 3` → 4 submissions vs want 2/6 FAIL; hardwiring `retryDelay` to 500 ms → elapsed FAIL; reverted → PASS)."
  - **D-20 — the pre-deploy action is two edits per environment:** `trading.broker.timeout_ms` = 10000 AND `trading.order_intent.stale_multiplier` = 4.0 (keeps Alpaca 429 retry and pacing at T = 10 s; S = 40 s). Pass condition (stored state, checkable any time): timeout_ms is an int >= 10000 and stale_multiplier >= 4.0 in staging and production, each with a `config.config_audit` row; audit timestamps recorded here; the integration PR stays draft until then.
- Constitution rules touched: C-01, C-05, C-07, C-08, C-09, C-10, C-13, C-14, C-15, C-16, C-18, F-01, F-04, F-07, P-03, P-04, P-06. Floor breaches: none.
- Status: spec-ready → design-approved.

## Open Threads

- [ ] Pre-deploy operator action (timeout_ms 10000 + stale_multiplier 4.0, both environments), recorded with audit timestamps; integration PR draft until then — operator step / integration PR.
- [ ] Migration 056 is provisional (feature 317's spec also claims 056); regenerate `scripts/config-wiring-stored.json` after each main-dev merge — U4+U5 and integration PR.
- [ ] IBKR call chain (40 s) equals S = 40 s with no margin; conid-lookup timeout leaves the order PENDING — known gap, not widened.
- [ ] Credential poller hardcoded 5 s (`trading.go:2837`); stale stored descriptions (`stale_multiplier`, `broker.timeout_ms`); no DO env-pairing assertion — record as findings in the docs unit.
- [ ] `&config.Config{}` harnesses move LIVE → PAPER under the new fallback — full-suite run in U4+U5.
- [ ] 277 halt condition: stop for an operator re-scope if anything pushes toward rewriting stored descriptions or touching `watchcore.go`.
- [ ] C-16 promotion: 321 `@AC-4` to platform.feature with a "Superseded by @feature-321" comment above 304 `@AC-14` — integration PR.
- [ ] /sdd-spec must amend product-spec.md and acceptance.feature per design.md § Spec amendments.

## Session 2026-11-20 — pre-deploy operator action (D-13 / D-16 / D-20), staging

- Applied on the operator's instruction through the agent MCP `set_config` (global scope, attributed to the operator's user; audited in `config.config_audit`):
  - **DO staging** (`xstockstrat_staging`, environment `staging`): `trading`/`broker.timeout_ms` 5000 → **10000** (int) at 2026-11-20T13:59:10Z; `trading`/`order_intent.stale_multiplier` 3.0 → **4.0** (float) at 2026-11-20T13:59:12Z. Read back via `get_config`: 10000 / 4.0.
  - **Homelab staging** (`xstockstrat_homelab_staging`, environment `staging`, a separate config store): the same two edits at 2026-11-20T13:59:38Z and 13:59:39Z.
- **Production: NOT done** — no production agent MCP is connected to this session. D-16's pass condition is therefore met for staging only; the integration PR stays draft until production reads `broker.timeout_ms` >= 10000 and `order_intent.stale_multiplier` >= 4.0 with audit timestamps recorded here.
- Live effect from the edit (321 is not deployed yet): on both staging deployments every Alpaca call's timeout and the T-bounded reconciliation / position-sync polls (all brokers) are now 10 s; S = 40 s; Alpaca 429 budget B = 20 s. IBKR signed requests are unaffected until 321 deploys.
