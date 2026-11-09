# Product Spec: config-keys-relative-consumers

**Created**: 2026-11-07
**Type**: feature (slice B of feature 296 `fix-config-keys-contract`)
**Depends on**: feature 296 merged to `main-dev` — **merge order only; 296 need not be `launched`**. Relative literals read their code default until 296's rename migration has run, and the gate's inverse-direction `form-mismatch` blocks them in a tree without it. See `docs/roadmap/features/merge-order.md`.
**Followed by**: feature 305/306 (see merge-order) — dead-row deletion (C) and alias removal (D, which waits for this feature to be `launched`).

---

## Problem Statement

After feature 296, every stored config key is namespace-relative (`marketdata` / `backfill.batch_size`) and the 295 alias keeps serving the prefixed spelling, but all 11 consuming services still read their keys with the prefixed literal (`marketdata.backfill.batch_size`). The repo therefore depends on the alias, the gate carries a generated `prefixed-read` baseline of about 184 entries owned by this feature, and the consumer `CLAUDE.md` banners and key tables still state the old rule. Operators and agents cannot remove the alias (feature D) until every reader is relative.

## User Story

As a platform engineer, I want every service to read its config with the namespace-relative key, so that the alias can be removed, the gate's baseline ends empty, and the docs tell the truth.

## Functional Requirements

FR-1. In all 11 consuming services (trading, portfolio, marketdata, indicators, ingest, analysis, ledger, identity, notify, agent, ui) every production config read, `GetSecret`/`SetConfig` key and key constant uses the key relative to the namespace the reading watcher subscribes to. This includes: trading's reads of `platform` (`trading_state`, `maintenance_mode`), which go through a separate single-namespace `platform` watcher that `NewTradingService` requires non-nil (startup fails on nil), while trading's own watcher subscribes to `trading` only; its poller `SetConfig` key (`trading_state` in namespace `platform`); marketdata's concatenated provider keys (`provider+".cache_ttl_hours"`, `provider+".enabled"`); analysis's second `marketdata` watcher (`fundamentals.provider`); the agent's `indicators.sandbox.timeout_ms`/`startup_grace_ms` reads; the ui trader positions read of `platform` `trading_state`; and key constants (`signalPruneIntervalKey`, `FactorMapKey`, `RESOLVE_TIMEOUT_KEY`, `barIngestBackoffKey`, `assetRefreshHoursKey`). Runtime log, WARN and error strings that name a key keep its FQN (display-only, C-05).
FR-2. Every test, fixture and mock that models those reads is respelled through the service's canonical fixture home (C-12/C-13), including `services/xstockstrat-ui/e2e/mock-backend.ts` (`platform.trading_state`) and `e2e/trader/positions-reconciliation.spec.ts`; migration-coupled tests (portfolio `signal_prune_test.go`) assert against the generated `scripts/config-wiring-stored.json`, never by editing an applied migration (F-01). `services/xstockstrat-indicators/app/maintenance/sandbox_keys_check.py` is inverted (relative is the expected spelling) together with its test `services/xstockstrat-indicators/tests/test_sandbox_keys_check.py` (`:38`, `:63` and the `EXPECTED`-derived rows assert the prefixed spelling). Each canonical config double rejects a key that begins with its own `<ns>.` (Go `MustSnapshotWatcher(ns, values)` in trading/portfolio/marketdata `internal/config/config.go`, marketdata `fakeCfg`/`fakeIntGetter`, portfolio `fakeConfig`; Python `snapshot_watcher(namespace=…)` in analysis/indicators/ingest `tests/conftest.py`; agent `install_watcher`; trading's also rejects the `platform.` prefix), covered by AC-17.
FR-3. The gate baseline drains: each rewrite step deletes the `prefixed-read` entries the ratchet then reports `STALE`; at the end `scripts/config-wiring.json` holds no `prefixed-read` entry, `prefixed-read` is removed from `BASELINE_KINDS` and `PREFIXED_READ_OWNER` is removed, so a leftover entry is a schema error (exit 2) and any new prefixed read is an un-baselinable blocking finding.
FR-4. Gate follow-ups: `excluded()` and `attribute()` (`scripts/check-config-wiring.mjs`) are unchanged. A list receiver still selects a namespace only by a `<ns>.` key prefix, so a relative key read through one is `unattributed` (blocking; AC-9, characterization). No consumer reads through a list receiver: trading's `s.cfgW` receiver becomes `"trading"` and a new `s.platformCfgW` receiver is `"platform"` (`scripts/config-wiring.json:1242-1245`). AC-10 is characterization. The registry `dynamic` lists (`:1171-1188`) and the `broker.paper` defect entry (`:38`) are respelled. The `prefixed-read` finding stays produced and blocking (`join`, `check-config-wiring.mjs:630-632`); only its baseline eligibility and `PREFIXED_READ_OWNER` are removed (FR-3).
FR-5. Documents: the 11 consumer `CLAUDE.md` banners and "Config Keys Consumed" tables state the relative rule and list relative keys (marketdata's secret rows too), with no 295 transition note; the caveat sentence ("readers may still use the prefixed spelling via the alias until …") is removed from `DOC_RULE_SENTENCES` and from every file that states it (root `CLAUDE.md:161`, `docs/runbooks/config-rollout.md:31`, `services/xstockstrat-config/CLAUDE.md:111`, `docs/sdd/constitution.md:36`, `docs/patterns/config-governance.md:66`, `services/xstockstrat-config/docs/context-constitution.md:26`, `docs/context-constitution.md:52`, `.claude/agents/spec-reviewer.md:20`, `.claude/skills/sdd-spec/reference/spec-template.md:136`, `.claude/skills/sdd-review/reference/product-spec-criteria.md:25`), `/via the alias until/i` is added to `DOC_BANNED`, and the banned-phrase scan is widened to root `CLAUDE.md`, `services/*/CLAUDE.md` and `docs/runbooks/config-rollout.md`; the stale "Unseeded (feature 227 seeding waiver)" notes in `services/xstockstrat-analysis/CLAUDE.md:606-607` and `services/xstockstrat-marketdata/CLAUDE.md:76` are corrected (the keys are stored); `plugins/strat-lab/skills/backtest/SKILL.md:81` is respelled.
FR-6. No behaviour change: with the alias switched off (marker row absent), each rewritten reader still returns the stored value rather than its code default. Order handling, broker selection and paper/live (derived from environment) are unaffected.
FR-7. 295 `@AC-15` (ledger `config.read_key` record) is CHANGED: after the rewrite the record is `ns=ledger key=export.enabled`; its "row stays when no evidence" clause is preserved.

## Out of Scope

- The rename and CHECK migrations, server rejection, ListKeys/FQN display (feature 296).
- Dead-row deletion (feature C) and alias removal (feature D).
- Any new config key, proto change or schema change.

## Affected Services

- `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata` (Go) — literals, tests, banners
- `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis` (Python) — literals, tests, banners
- `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify` (Node) — literals, tests, banners
- `xstockstrat-agent` — `client.py` reads, tests, banner, strat-lab skill
- `xstockstrat-ui` — trader positions read (`src/app/trader/positions/page.tsx:129-130`), `e2e/mock-backend.ts:1547`, `e2e/trader/positions-reconciliation.spec.ts`, banner (feature 296 already respells `e2e/fixtures/configKeys.ts` and the config-ui specs)
- Tooling: `scripts/check-config-wiring.mjs`, `scripts/config-wiring.json`, `scripts/config-wiring.test.mjs`

## Consumer Surface(s)

- [x] **UI** — `/trader` positions: the REDUCE_ONLY/HALTED banner reads `platform` `trading_state` (relative key); behaviour unchanged, reachable already (C-10 n/a, no new route).
- [x] **Agent** — the agent's sandbox-deadline reads (`formula_deadline_s`); `list_config_keys`/`get_config` display is feature 296's.
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys. Existing keys keep their stored value, type and description; only the spelling of each reader's literal changes to the namespace-relative key.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/config-keys-relative-consumers` (branch from `main-dev`)
Delivery: one feature, one integration PR, one service+test step pair per family (Go trio, Python trio, Node trio, agent, ui); each step's Verification runs `--final`, and its `STALE` lines are that step's to-do list.
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking config change) — each of the 11 owners

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution **C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Known trap** (`docs/roadmap/ledger/fails.md`, 295 test blast radius) — resolved as a standing constraint: `/sdd-design` recon and `/sdd-spec` must grep every test file and fixture root of all 11 services for each rewritten literal and list each hit in a step's **Files**; sizing by service name is how 295 halted at `blocker:3`. FR-2 already requires every modelling test, fixture and mock to be respelled.
- [x] **C1–C6 / N2 split** — resolved by deferral to `/sdd-spec` (operator, 2026-11-08), as 296's design §258 provides. Evidence for that spec: none of the 15 pre-approved scenarios (C1 @243, C2 @182, C3 @184, C4 @278, C6 @182, N2 @247) has a `Then` that pins a *reader's* literal — C1/C2/C3/C5 pin stored seed spellings, C4 the gate and C6 docs (all noted by 296), and N2's five scenarios name no keys. The one 304-owned CHANGE is 295 `@AC-15` (FR-7). A scan found 25 further durable scenarios that name a key by its FQN near a read verb (mostly prose or OTel metric names): classify each at `/sdd-spec` with `scenario-recon`, and return to the operator only for a `Then` that pins a reader literal (C-16).
- [x] **One integration PR** — confirmed as designed (operator, 2026-11-08): one integration PR with one service+test step pair per family. Sizing from the gate: 180 production `prefixed-read` sites in 10 services (analysis 75, marketdata 44, trading 27, ingest 9, portfolio 9, notify 6, indicators 3, ledger 3, agent 2, identity 2) plus the ui trader read; the ≈600 figure includes tests and fixtures. The sequential-mode consumer-surface checkpoints bound each session.
