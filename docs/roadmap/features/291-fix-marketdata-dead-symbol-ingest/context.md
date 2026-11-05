# Context Log: fix-marketdata-dead-symbol-ingest

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-04-marketdata-bar-ingest-dead-symbols-refetched-defect.md` (Issues disabled): marketdata re-ingests symbols that never return bars, every cycle, indefinitely
- Severity: SEV-3
- Routed to SDD path (Track C); environment recorded as dev (main-dev), Grafana label `staging`
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), status.md, context.md
- Affected services (from report): xstockstrat-marketdata
- Root cause hypothesis: Under investigation. The warm set has no eviction for symbols without data and the feature 282 OTC filter does not cover these. LXP and PSKY look like live listings, so the vendor/feed cause (IEX coverage, renamed tickers) must be established in recon. May also feed analysis live_loop 'had no 1d bars' WARNs.
- Recommended design depth: quick -> `/sdd-design fix-marketdata-dead-symbol-ingest quick` (rationale: SEV-3 single service, but root cause is under investigation (rubric: quick))
- Development branch: feature/fix-marketdata-dead-symbol-ingest
- Number 291 reserved via scripts/sdd-allocate-feature-number.sh (triage authorized by the operator, 2026-11-04)

---

## Session 2026-11-04 — sdd-design (Phase 0 + round 1)

- Status: `draft` (design not yet approved). `/sdd-review` skipped on the operator's instruction to work on 290/291 right away.
- Phase 0 recon written (`recon.md`): marketdata warm set is add-only (no eviction) and `GetBars` re-warms on every call, so back-off state must live in the ingester. Feature 282 (OTC filter) is `implementation-ready` and not implemented; it touches the same warm-set region.
- Round 1 (quick mode): the proposed per-symbol back-off was BLOCKED by the adversary — F-07 (hardcoded 1h/6h data-age windows; ledger fails.md:2931-2933 rules these must be config keys; "operator-approved F-07 exception" is not a valid framing under F-11), YAGNI (on the multi-symbol path dead and healthy symbols share ONE `GetBarsMulti` request at `marketdata_service.go:1293`, so back-off saves no vendor call there), false positives freezing thin IEX names on Mondays/post-holidays (fails.md:2718-2721), and an override of 282's rejected design (`282 design.md:42,48`).
- **Operator decision at the gate (P-04):** continue with the FULL back-off design (round 2), not report-once-only (the adversary's recommendation). Risk accepted knowingly: more mechanism than the logs-only harm strictly needs. Round 2 must: use a config key for the back-off max (<=0 = off), a wall-clock/session-aware threshold, a proportional peer rule, drop entries for symbols leaving the warm set, state honestly where calls are actually saved, and record 282 sign-off in both features' context.md.
- Open: round 2 in progress.

## Open Threads

- [ ] 282 coordination: narrowing 282's "warm-set readers never filtered" invariant needs recorded sign-off in 282's and 291's context.md; add a merge-order row (291 ↔ 282 independent, rebase-only).
- [ ] Name the GetBars miss-path refetch burst (BOSSY/CRTD/DNB/FORL) as a follow-up defect report/feature, not free text.
- [ ] Add FR-N definitions to product-spec so new @AC-* carry @FR tags (C-15).

---

## Session 2026-11-04 — sdd-design (round 2 + approval)

- Round 2: proposer (config key, wall-clock streak, strict-majority informative rule, reconcile) → adversary NEEDS WORK, no Floor breach. Gate (P-04): operator chose **"Approve full back-off on both paths"** (over the adversary's narrowed hold) and **"Seed via config migration"** (over a seeding waiver). design.md written; status `draft` → `design-approved` (/sdd-review skipped on operator instruction).
- Adopted from the adversary: strict `>` majority (exactly-half outage is non-informative); streak gap = `end.Sub(start)`; read `D` before taking `warmMu`; pointer-check and `markWarm` new-add delete dropped (YAGNI; warm set is add-only, reconcile bounds a stale entry to one cycle); positive-control RED tests; recording store (the no-op `fakeBarsStore` cannot prove "bars stored"); config service in scope: `SCALAR_BOUNDS_REGISTRY` entry `[0, 86400000]` + test, snapshot-built reader test (`@AC-11 @feature-278`), config migration (next number after `034`, grounded at /sdd-spec; DBA + service owner + config team approvals); honest-value and freshness (consumer, series) table written into design.md.
- **Accepted risk, operator informed:** on the production multi-symbol path (`GetBarsMulti` `:1293`) a held symbol saves zero vendor calls, and a false-positive hold lags that symbol's stored daily bar up to `D` (6 h default) for the live loop, screener, `BatchGetBars` consumers and offline marks. Report-once-only would give the same noise reduction without the lag.
- **282 sign-off recorded (also in 282's context.md):** 282's invariant "the gate applies at warm-add sites only; warm-set readers are never filtered" (`282 design.md:24,42`) is narrowed to: "No reader filters the warm set by servability. The bar ingester may leave a symbol out of a cycle's vendor request because of feature-291 no-bars hold state, and never removes it from the warm set. Quote/price readers are never filtered." `merge-order.md` row added (291 ↔ 282 independent, rebase-only).
- **Operator-approved fixed invariants** (documented in marketdata `CLAUDE.md` at teardown): strict-majority informative-cycle rule; streak-continuity gap = window width.
- Follow-up artifact created: `docs/reports/2026-11-04-marketdata-getbars-miss-path-refetch-every-call-defect.md` (+ `.status` open).
- Product-spec and acceptance.feature revised (FR-1..5, `@AC-1` kept with FR tags, `@AC-2..11` appended; config key + migration now in Fix Scope; services: marketdata + config).
- Status: draft → design-approved.

## Open Threads (supersedes the earlier list)

- [ ] Config migration number, seed-without-overwrite SQL and rollback — ground at /sdd-spec (C-07, F-01); approvals DBA + owner + config team.
- [ ] Register: `scripts/config-wiring.json`, `CLAUDE.md` row, config-governance log, snapshot-built reader test.
- [ ] CHANGELOG note: the existing no-bars WARN's `missing`/`total` are now over non-held symbols.
- [ ] Teardown: marketdata `CLAUDE.md` ingester bullet + invariants; `docs/context-constitution.md` MARKETDATA-5 note on the `<=0` resolver asymmetry.
- [ ] RED tests need inline fakes (`recordingBarsSource`, recording bars store) — list in the step Files.
- [ ] Re-check Loki for the dead symbols after 282 lands; AC-1's "not re-requested" is literally true but means zero saved calls on the multi path.

---

## Session 2026-11-04 — sdd-spec

- Generated implementation-spec.md with 8 steps (1 migration, 2 config service, 3 config test, 4 marketdata config seam, 5 its test, 6 ingester service, 7 ingester RED tests, 8 docs). Status design-approved → implementation-ready.
- Key codebase findings:
  - Last config migration is `034` on the working tree and `origin/main-dev`, so the seed is `035_marketdata_bar_ingest_backoff`; re-verify against `origin/main-dev` right before merge (fails.md 2026-10-14 sector-classification-strategy-params).
  - **Correction to design.md:** no `scripts/config-wiring.json` entry. The file is a shrink-only baseline of findings; seed (035) plus a reader on the identical full-dotted string produces no finding, and an entry would fail as `STALE`. Verified with `check-config-wiring.mjs --keys` / `--final` instead.
  - **Correction:** MARKETDATA-5 is in `services/xstockstrat-marketdata/docs/context-constitution.md:21`, not the root file. CHANGELOG.md is generated by `/promote`, so the "missing/total now over non-held symbols" note goes in the PR body and marketdata CLAUDE.md.
  - Snapshot-built reader test needs an exported seam: `config.Watcher.snapshot` is unexported in marketdata. Trading already has `config.NewSnapshotWatcher` (`services/xstockstrat-trading/internal/config/config.go:249`); Step 4 mirrors it.
  - `internal/service` is excluded from the CI coverage filter (`ci.yml:298`), so the ingester tests add no measured coverage; `internal/config` (Step 5) is measured.
  - Only three test call sites exist for `ingestRecentBarsForTimeframe` (`marketdata_service_test.go:1171,1191,1219`), none for `reportIngestCycle`, so the signature change touches no existing test.
  - Design tension to watch at execute time: in a non-informative cycle `applyBarCycle` deletes all non-held entries (including a streak entry of an errored symbol), while errored symbols never create/advance/reset an entry in an informative cycle. Spec follows design.md text literally.

## Open Threads (after sdd-spec)

- [ ] Config migration 035 needs DBA + service owner + config team approvals; renumber at merge if a sibling lands a higher number.
- [ ] Teardown after Step 8: `/context-forge:context-constitution refresh` scoped to the three touched docs (or manual reconciliation recorded in the PR body).
- [ ] Post-merge dev smoke of marketdata and config (operator).
- [ ] Re-check Loki for the dead symbols after 282 lands; AC-1's "not re-requested" saves zero vendor calls on the multi-symbol path.

---

## Session 2026-11-04 — sdd-review impl-spec (advisory)

- Result: 0 failures, 6 warnings, 0 Floor risks (advisory — did not block). Criteria pass: PASS WITH WARNINGS; overlap scan: no identical config key / proto field / migration number with any in-flight feature, no FAIL-level overlap.
- Verified by the orchestrator (the overlap agent had no shell): config migration `035` is absent on `origin/main-dev` (last is `034`) and on every `origin/feature/*` branch; feature 281's branch carries config migration `037`, so numbers 035/036 may be claimed by others' plans — a gap is not a collision, but re-check immediately before merge.
- Unresolved ⚠ carried into execution:
  - Step 1 / F-01: re-verify `035` against `origin/main-dev` (and open feature branches) immediately before merge; renumber if taken — [ ] unaddressed. Migration needs DBA + service-owner + config-team approval (root Approval Flow).
  - Step 1 verification: the line expects `check-config-wiring.mjs --declared-migration` to print "PENDING"; the flag exists but the wording was not confirmed — treat as "exit 0" — [ ] unaddressed.
  - Steps 2/3 and 6/7 (C-08/P-06/B3): paired tests numbered after their service step; red-before-green is carried by prose, not by order — run the test step first (write it to fail) or execute each pair together — [ ] unaddressed.
  - Step 6 verification: the `-run` regex targets `TestBarHold` / `TestResolveBarIngestBackoff`, which exist only after Step 7 — the step cannot go green alone; run Steps 6 and 7 together — [ ] unaddressed.
  - Step 6 (accepted trade-off): `s.repo.InsertBars` → `s.barsStore.InsertBars` with no nil guard — a future `&MarketDataService{}` literal that returns bars will panic by design (existing tests `:1156`/`:1204` return no bars, so stay green) — [ ] acknowledged.
  - Step 6 (C-18, minor): `applyBarCycle` takes 9 parameters and returns 5 values; consider a small result struct — [ ] unaddressed (waivable).
- Overlap findings (WARN, rebase-only): `marketdata_service.go:109` `barsStore` comment — 291 Step 6 instr. 7 and 290 Step 3 item 3 rewrite the same line (certain textual conflict; whichever merges second re-reads and states both consumers); `configServiceImpl.ts` `SCALAR_BOUNDS_REGISTRY` insertion after `last_close_lookback_days` (`:148`) and `setConfigScalarBounds.test.ts:287-288` `TIMEOUT_KEY_FORMS` — same anchor as 281 (Steps 13/14) and 282 (Step 2), different keys; `config-governance.md` log and marketdata `CLAUDE.md`/`context-constitution.md` edits in different sections; latent migration-number race with draft feature 293 (seed migration for `analysis.engine.max_strategies_per_cycle`, no number yet). Existing merge-order row (291 ↔ 282) stands.
- Proposed `merge-order.md` rows (NOT written — shared file, awaiting operator confirmation): (a) 290 ↔ 291 soft rebase-only for the `:109` comment; (b) 291 ↔ 293 migration-ordering: whichever merges second renumbers to max(origin/main-dev)+1 just before merge.

---

## Session 2026-11-04 — sdd-review product-spec (advisory; status NOT changed)

- Verdict: FAIL (2 blockers, no Floor) on a spec that was already design-approved and implementation-ready; status stays `implementation-ready` — this advisory run does not write status.md / feature.md history.
- Blockers fixed: **FR-4** reworded so exactly half or fewer returning bars is non-informative (it contradicted design.md and AC-3 at the boundary): "informative only if a strict majority of the non-held, non-probe, non-errored requested symbols returned bars"; **acceptance.feature** rewritten with concrete values (back-off 3600000 ms, 5-minute cycles from Wed 2026-11-04 15:00 UTC, `LIVE1..3` + `DEAD`, cycle numbers, counts); positive controls moved into Then clauses; "not re-requested from the vendor" reworded to "absent from the ingester's request symbol list" (zero calls are saved on the multi path); AC IDs unchanged.
- Warnings fixed: persona; FR-1 tied to the key and its 6 h default; migration detail (035 = last+1, up+down, `ON CONFLICT DO NOTHING`, approvals) in Fix Scope; affirmative `- [ ]` Fix Scope items converted to plain bullets; Consumer Surface(s) now states the false-positive lag consequence; the `scripts/config-wiring.json` contradiction resolved (NO entry — design.md step 3 corrected to match the implementation-spec).
- Overlap (warn-level): `ingestRecentBarsForTimeframe` / `barsStore` comment vs 290; `reportIngestCycle` heartbeat vs 294; migration 035 vs draft 293 and 281's `037`. Merge-order rows added (290, 294, 293).

---

## Session 2026-11-04 — product-spec re-review (advisory; status NOT changed)

- Second pass: PASS WITH WARNINGS, 0 blockers (both first-pass blockers resolved; the cycle arithmetic in AC-1/AC-9 was independently checked: back-off 3600000 ms = 12 cycles, hold at cycle 12, probe at 24, next at 36).
- Six warnings addressed: (W1) Background no longer fixes the symbol set — each scenario states its own warm symbols (AC-5 adds `AAA`); (W2) AC-1 now also asserts that the "symbols returned no bars" WARN stops naming `DEAD` after cycle 12 and that the heartbeat INFO is logged in all 40 cycles (FR-3); (W3) AC-4/AC-5/AC-6/AC-9 state "held at cycle 12" and AC-7 gives cycle numbers 13/14; (W4) **AC-12 appended** (probes-only request keeps the hold) with implementation-spec Scenario Coverage row, Step 7 Covers and a new Step 7 test 13; (W5) Step 7 test 7 and design RED test 7 corrected to **at least 150 cycles** (6 h default: hold at cycle 72, probe/recovery at 144); (W6) service-name wording.

---

## Session 2026-11-04/05 — loop round 1 (fixes)

- Correction to the impl-spec review note above: the `merge-order.md` rows (291 ↔ 290, 291 ↔ 294, 293 ↔ 291, 293 ↔ 281, 290 ↔ 294) WERE written (operator asked for all warnings to be addressed); the earlier "NOT written" line is superseded.
- Product-spec findings fixed: AC-12 Given reworded to the reachable state (symbol list contains only `DEAD`; the warm set is add-only today); AC-6 narrowed to the warm-set snapshot / `markWarm` (the `GetBars`/`BatchGetBars` contracts are guarded by the existing @feature-191 / @feature-240 suites); FR-4 now says a non-informative cycle discards the in-progress streak and "a lone symbol that returned no bars"; **AC-13** (streak reset: held at cycle 21, not 12) and **AC-14** (streak-continuity gap) appended with Step 7 tests 14/15, coverage rows and Covers.
- Impl-spec findings fixed: execution order 1→3→2→5→4→7→6→8 with per-pair "execute first" wording; Step 3 migration-shape test is a green-on-arrival guard; Step 6 verification no longer names tests that exist only after Step 7 (moved to Step 7 first); `barPlan`/`barOutcome`/`barCycleResult` structs replace the 9-parameter `applyBarCycle`; Step 1 PENDING output line verified against `check-config-wiring.mjs` (`PENDING: <file>:<ns>/<key>:seeded-unread`, exit 0); constant form pinned (plain string-literal `const`, no forwarder) so the wiring check resolves it; duplicate "13." removed; execution summary says three edit sites; `barsStore.InsertBars` grep expects 3 matches.

## Session 2026-11-05 — loop round 2 (impl-spec review)
- Step 6 instructions 3/4/7/8 aligned to the `barPlan`/`barOutcome`/`barCycleResult` structs; `reportIngestCycle` pinned to one signature taking `res barCycleResult`. AC-14 positive-control wording tightened.
