# Context: config-keys-relative-consumers  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: Slice B of the 4-way split of feature 296.
- **Consumer rewrite.** Every consumer read in 11 services, plus the strat-lab skill, moved from namespace-prefixed to relative keys.
- **Baseline drained.** The `prefixed-read` baseline went 180 → 0 over 12 commits in one integration PR (#1479).
- **Gate locked.** The finish commit made `prefixed-read` non-baselinable: the detector still blocks, and a baselined entry now exits 2.
- **Trading watchers.** Trading now holds two single-namespace watchers, `trading` and a required `platform`, instead of one merged watcher.
- **Test doubles.** The canonical test doubles in each language now reject `<ns>.`-prefixed keys.

**Why (irrecoverable rationale)**:
- **A separate, required platform watcher.**
  - A relative `trading_state` / `maintenance_mode` read through a two-namespace watcher can be shadowed at runtime by a same-named `trading` row, because lookup is first-hit-wins. No static gate sees runtime rows.
  - A nil-safe accessor was refused. A zero Watcher never WARNs, so a missed wiring would silently serve the HALTED default: the feature-192 outage signature (operator steering at the round-1 gate).
- **Doubles reject `<ns>.` keys.** Every double returns the code default for an unknown key, so an old-spelling fixture passes silently whenever its value equals the default (the 295 trap). The guard makes that impossible for the canonical doubles.
- **One integration PR, not three family PRs or per-service PRs.** The operator accepted a large diff to get one gated landing. Mitigation: per-family commits plus sequential-mode checkpoints.
- **Each family commit pairs its test step with its service step, test first.** This follows the 295 halt.
- **Runtime display strings keep the FQN (C-05).** Durable WARN assertions (295 @AC-12, 272 @AC-5) therefore need a separate FQN constant (`brokerTimeoutFQN`, `_LIMIT_FQN`, `KEY_FQN`). Otherwise they would keep passing on a substring of the relative key.

**Rejected alternatives**:
- **One shared `trading`+`platform` watcher with a collision detector, or a gate-only guard:** a detector only reports, and the gate cannot see runtime rows (operator S1).
- **Nil-safe `platformCfgW` accessor:** a silent HALTED. A required argument fails at boot instead.
- **Namespace-scoped getter in trading `config.go`:** duplicates the core's typed decode and the `recordRead`/WARN logic (C-18). Its only rationale lived in design.md.
- **`attribute()` resolving list receivers from the stored set, with zero matches → first namespace:** contradicts "zero stays null" and could hide a typo under the wrong namespace.
- **Deleting list-receiver support:** rejected because 305 FR-3 and a merge-order row rely on `registry.receivers`.
- **A gate-prep commit with `DOC_SCAN_PENDING` / `alt` in `excluded()`:** temporary scaffolding that never gets removed. Widening the doc scan early is also red while the 11 banners still carry the banned "cutover in feature 296".
- **A second Go constructor next to `NewSnapshotWatcher`, or a `WithSnapshot` method:** leaves an unguarded path. The `Must…` rename turns every stale call site into a compile error instead. (Rationale only in design.md.)
- **`internal/testdata/` as the home of the Go double:** an import cycle with package `config`'s tests. (Rationale only in design.md.)
- **Normalising prefix-catalog rows in `excluded()` (original FR-4):** dropped with operator sign-off, because the only real prefix row was already relative.
- **Deleting `config_allow296.py` in 304:** kept 304 a pure consumer rewrite; feature 305 owned the deletion.
- **Routing the poller's `SetConfig` through `platformCfgW`** (the runner-up): the namespace travels in the request, so this only widens the diff. (Rationale only in design.md.)
- **Sharing one gRPC connection between the two trading watchers:** needs a shared-core edit. The per-namespace connection fault domain was accepted. (Rationale only in design.md.)
- **Bumping the strat-lab plugin version:** YAGNI.

**Scars & gotchas**:
- **Drain rule for file-less baseline entries.**
  - An id read by two families drains only in the commit of its LAST reader. Deleting it earlier is RED; keeping it later is STALE.
  - Family commit order is free; only the last-reader drain is load-bearing.
  - Mid-sequence, split ids print `REPORTED … readers-disagree`, which never fails the gate.
  - A finding's `file` is the smallest file among its prefixed readers, so a shared id stays attributed to the last reader's file.
- **`WaitForSnapshot` has its own 90 s timeout per call.** Two sequential waits would double boot time, so the two watchers share one `context.WithTimeout(ctx, 90s)`.
- **`cancel` shadow hazard in trading `cmd/server/main.go`.** `waitCtx, cancel := context.WithTimeout(...)` would reassign the root `cancel` that the shutdown goroutine calls. It compiles and lints clean but is silently wrong. Use `waitCtx, waitCancel`.
- **`defer recover()` hides a nil deref.** In `trading_offline_test.go` (the recovered call guarded by a preceding non-nil pin) it would have masked a missing `platformCfgW` behind a misleading message. Pin `platformCfgW != nil` before the recovered call.
- **jscpd.** Three `ns`-parameterised `MustSnapshotWatcher` bodies in non-ignored `config.go` files form an identical token run ≥ `minTokens: 100`. Each needs a service-specific panic-message prefix.
- **Gate blind spot.** The gate trusts `registry.dynamic`, not string concatenation (`"marketdata."+provider+".enabled"`). Dynamic reads need their own red-first test plus a concatenation grep.
- **Key-filtering verification greps can hide real reads.** An `emit` exclusion hid `fundsignal_loop.py` `min_conviction_to_emit`. A blanket `analysis.snapshot.` exclusion would hide the real `analysis.snapshot.indicator_timeout_ms`.
- **Vacuous tests caught only at review.**
  - The AC-10 fixture stored the prefixed key, so its "no finding" held either way.
  - `test_no_new_config_leaf_introduced` would go vacuous once `watcher.py` went relative.
- **Only guard the doubles that discriminate.** About 50 analysis `MagicMock(side_effect=lambda key, default: default)` stubs return the default for any key, so a prefix guard there asserts nothing. Only stored-value doubles were guarded.
- **Strings that look like keys but are not reads must not be search-and-replaced:** ledger event types, OTel instrument names, `ingest.mcp_credential.<uuid>` credential refs, and the `config.read_key` format itself. One self-caught slip respelled three portfolio ledger event-type rows in CLAUDE.md.
- **Tooling.**
  - The preinstalled golangci-lint 2.5.0 (built with go1.25) refuses go1.27 modules. Reinstall with `GOTOOLCHAIN=go1.27.0`.
  - Playwright's `[setup] pre-warm SSR routes` (10 s) cannot finish on a cold `next dev`. Run with `--no-deps --workers=1 --retries=2`.
- **`sandbox_keys_check.py` is a semantic inversion, not a respell.** `HEALED_BY` stays `system:config-migration-031`, because 044 sets only `key`. The pre-031 snapshot block keeps its historical constants.
- **Portfolio tests read `scripts/config-wiring-stored.json`, not the applied 037/039 migrations (F-01).** That is why the portfolio CI path filter lists it.
- **FQN key names in prose are display spelling (C-05), kept on purpose.** This covers CLAUDE.md prose (notify Web Push/fanout, portfolio `portfolio.marketdata.*`, trading `trading.risk.sizing_enabled`, mcp-tools.md) and the older acceptance suites. The 25 FQN-near-read-verb scenarios were all classified PRESERVE. Do not respell them.
- **Node leaves (ledger/identity/notify) have no canonical config double.** Their alias-off proofs use inline key-matching doubles (single consumer, C-13), so AC-17's guard deliberately does not cover Node.
- **AC-8 not promoted:** it duplicates 296 @AC-6.
- **Portfolio `s.cfg` is a concrete `*config.Watcher`.** The AC-2 row therefore needs a real `MustSnapshotWatcher("portfolio", …)`.
- **No Gherkin step runner exists.** `acceptance/*.feature` prose is display-only, except for the signed C-16 CHANGEs.

**Permanent deviations**:
- **Stale-doc fixes moved into the trading family steps.** The design had the finish commit fix `trading/internal/config/config.go` and the trading CLAUDE.md "merges them" paragraph. They shipped in trading steps 20/21 instead, because they describe the code those steps change.
- **Findings row left unedited.** The design listed `docs/context-constitution-findings.md:20` as a stale doc. After the 303 merge, that line is an unrelated propagation row.
- **`config-governance.md` (trading watcher paragraph) reworded, not deleted.** Trading now holds a second single-namespace `platform` watcher.
- **S2 guard narrowed in analysis.** It covers only the stored-value doubles. The default-returning MagicMock stubs stay unguarded.
- **Spec amendments signed after design.**
  - FR-4 lost both the stored-set/zero-null clause and the `excluded()` normalisation, so AC-10 is characterization-only.
  - AC-2's portfolio row changed from `12.5` to `0.2`, because the reader compares a fraction with default 0.1.
  - The design's "indicators commit before agent" ordering constraint was dropped.
- **Recon claims corrected.**
  - The 13 analysis call sites outside the TSV ARE visible to the extractor; a missed one fails the gate.
  - Round-1 V3 was refuted: config canonicalised the poller's prefixed write with a WARN only, so no hotfix track was needed. That shim was later removed by 306, and SetConfig now rejects prefixed keys.

**Cross-feature signal**:
- **304 merged to main-dev while 305 was mid-design.** It added a durable scenario (304 @AC-12) that 305's one-shot scenario-recon missed (recorded in fails.md, feature 305).
- **The 296 → 304 → 305/306 split worked.** A 180-site rewrite landing as one PR with per-family drain commits is the evidence.
- **The impl-spec review needed 11 passes.**
  - Warnings per pass: 13 (+1 FAIL), 9, 4, 5, 2, 1, 3, 4, 3, 3, 0.
  - Every finding was a defect in the spec text: greps that could not print nothing, vacuous guards, the `cancel` hazard, jscpd exposure. None was a design change.

**Deferred follow-ons**:
- **305 (done):** removed `config_allow296.py` and its test.
- **306 (done):** alias removal and the config-side poller shim.
- **Open defect `2026-11-06-trading-broker-paper-env-derived-default-unseedable`:** owns the `broker.paper` `read-unseeded` entry that 304 renamed.
- **Operator confirmation that 295's one-staging-release window closed:** never recorded (carried from 296).
- **Stale agent prompt.** `services/xstockstrat-agent/app/prompts/signal_extraction.md` names a non-existent key, `xstockstrat-agent.signal.alert_threshold`; it should be `agent` / `signal.alert_threshold`. Recon flagged it; 304 did not fix it.
- **Rebase-only overlaps with 297/298/299 on `config-wiring*.{json,mjs}`, `ci.yml`, root CLAUDE.md and agent files.** After each rebase, re-run:
  - `--final`;
  - `node --test scripts/config-wiring.test.mjs`;
  - `--doc-check`.

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-11-10 entries. The 2026-11-09 separate-watcher design entry already existed and was skipped. Its design.md evidence resolves via `git show 2d91b5671335fcce267679b50caa494440205f51:<path>`.

**Runtime-invariant recommendations (→ /context-constitution)**: Verify each against the trading/config modules first.
- **TRADING.**
  - Trading reads `platform.{trading_state,maintenance_mode}` only through a required `platformCfgW`; `NewTradingService` errors on nil, and both watchers use the same `cfg.ApplicationEnv`.
  - `trading_state` defaults to HALTED and dominates; `maintenance_mode` defaults to false.
  - The platform stream can drop independently, keeping a stale ACTIVE for up to ~60 s until the reconnect SNAPSHOT. The signal is the WARN `config watcher stream ended, reconnecting namespace=platform`.
  - The reconciliation poller writes `{Namespace:"platform", Key:"trading_state"}` through the `cfgW` setter.
  - The two watchers share one 90 s boot-wait context.
- **PLAT (config-wiring gate).**
  - `registry.dynamic` lists are trusted over string concatenation.
  - A finding's `file` is the smallest file among its prefixed readers.
  - `prefixed-read` is blocking and not baselinable.
- **PLAT (testing).** The canonical config doubles reject `<ns>.`-prefixed keys (AC-17, promoted to `platform.feature`):
  - Go: `MustSnapshotWatcher`, `fakeCfg`, `fakeConfig`;
  - Python: `snapshot_watcher(namespace=…)`, agent `install_watcher`;
  - the UI fixture.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

### Session 2026-11-08 — open questions resolved (operator decisions)
- Q1 (known trap) resolved as a standing constraint on recon/spec (grep every test and fixture root of all 11 services per rewritten literal).
- Q2 (C1–C6/N2 split): operator chose to **defer to `/sdd-spec`**. Evidence gathered now: the 15 pre-approved scenarios (C1 @243 AC-1/4/5, C2 @182 AC-1/2/4, C3 @184 AC-1/2, C4 @278 AC-1, C6 @182 AC-6, N2 @247 AC-1–5) contain no `Then` pinning a reader literal; stored-seed ones are 296's and already noted, N2 names no keys. 295 `@AC-15` is the one 304 CHANGE (FR-7). A regex scan of all durable suites found 25 scenarios outside 296's signed list that quote a prefixed key near a read verb; read by title they are FQN prose, OTel metric names (@294 AC-12/32/38) or fixtures, and need a per-scenario call at spec time (`@154` AC-6/9, `@158` AC-8, `@173` AC-1/2/4, `@186` AC-3, `@147` AC-6/7/11/13, `@258` AC-7, `@243` AC-3, `@295` AC-24, `@278` AC-2/3).
- Q3 (PR strategy): operator confirmed **one integration PR** (the design's choice) over three family PRs or per-service PRs. Gate sizing, from `check-config-wiring.mjs --final --json` on `main-dev` (180 records, all with a file): analysis 75, marketdata 44, trading 27, ingest 9, portfolio 9, notify 6, indicators 3, ledger 3, agent 2, identity 2. Risk accepted: a large diff and review; mitigation is per-family steps and the sequential-mode checkpoints.
- Files modified: `product-spec.md` (Open Questions), this `context.md`.

_From: Session 2026-11-09 — sdd-design (Phase 0 recon + round 1)_

- Carried objections: finish-commit caveat sweep must also cover `services/xstockstrat-config/docs/context-constitution.md:26`, `docs/context-constitution.md:52`, `.claude/agents/spec-reviewer.md:20`, `.claude/skills/sdd-spec/reference/spec-template.md:136`, `.claude/skills/sdd-review/reference/product-spec-criteria.md:25`; C-16 CHANGE list gains 295 @AC-20 (`platform.feature:1441`); no mechanism for AC-15, AC-2 portfolio, AC-3, AC-4; WARN assertions in 295 @AC-12 / 272 @AC-5 need a separate FQN literal; AC-10 fixture/Given mismatch and FR-4 "zero stays null" need an operator-signed spec amendment (or become moot with the separate platform watcher); `config_allow296.py` deferral must name 305/306.

_From: Session 2026-11-09 — sdd-design (round 2 gate)_

- **Operator sign-off (AskUserQuestion, 2026-11-09):** (1) APPROVED all six spec/acceptance amendments: FR-1 (separate platform watcher; display strings keep FQN); FR-2 + new AC-17 (canonical doubles reject '<ns>.'-prefixed keys); FR-4 (drop stored-set/zero-null clause, list receivers kept); AC-1 (reads platform via platform watcher + `trading` stores `trading_state=ACTIVE`); AC-9 (list receiver with a relative key stays unattributed and blocking); AC-10 (Given uses prefixed catalog entry `indicators.sandbox.`; fixture test, no gate code change). (2) C-16 CHANGE signed off: 295 @AC-15 (`services/xstockstrat-ledger/acceptance/fix-config-keys-drift.feature:11,13`), 295 @AC-20 (`docs/sdd/business-rules/platform.feature:1441`), 243 @AC-2 read-note (`services/xstockstrat-indicators/acceptance/fix-sandbox-seed-keys.feature:7`). (3) `config_allow296.py` (+ test) removal is owned by feature 305; a note goes in merge-order.md and 305's context.md when design.md is written.

_From: Session 2026-11-09 — sdd-spec_

  - No Gherkin step runner exists outside `.venv`, so `acceptance/*.feature` prose is display-only except the signed C-16 CHANGEs (resolves recon's "analysis not verified" item).

_From: Session 2026-11-09 — sdd-design (round 4 gate, recorded retroactively for provenance)_

- Operator answers via AskUserQuestion at the round-4 design gate (2026-11-09): (1) **C-16 CHANGE signed** for 296 `@AC-22` and `@AC-23` (`docs/sdd/business-rules/platform.feature:1580-1593`) and the 295 `@AC-19` read-note at `:1440`; (2) the finish commit **keeps the `prefixed-read` detector** as a blocking, non-baselinable finding (296 `@AC-6`/`@AC-24` stay PRESERVE); (3) **design approved**. `design.md` Business Rules Touched cites these answers; the earlier "round 4 gate" wording refers to this entry.

_From: Step 26 — docs: sweep the alias caveat and settle read-notes (C-16 CHANGEs) [done] (unit Cf)_

- Caveat removed from root `CLAUDE.md`, `config-rollout.md`, config `CLAUDE.md`, `constitution.md` C-05, `config-governance.md` (rule, transition paragraph, `prefixed-read` kind row, `form-mismatch` row, the "first cross-namespace subscription" note), config `context-constitution.md` CONFIG-9, `context-constitution.md` PLAT-14, `spec-reviewer.md`, `spec-template.md`, `product-spec-criteria.md`. C-16 read-notes (operator-signed 2026-11-09): `platform.feature` 295 @AC-19/@AC-20 and 296 @AC-22/@AC-23, indicators 243 @AC-2, trading 192 @AC-2 ("the platform watcher"); ledger 295 @AC-15 rewritten to `export.enabled`. No migration touched (F-01: `git diff` over `services/xstockstrat-config/migrations` empty).
