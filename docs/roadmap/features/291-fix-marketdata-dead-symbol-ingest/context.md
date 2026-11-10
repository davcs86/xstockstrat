# Context: fix-marketdata-dead-symbol-ingest  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: Shipped an in-memory "hold" in `bar_hold.go`, scoped to the bar ingester. A warm symbol that keeps returning no bars across informative cycles for `marketdata.stream.bar_ingest_backoff_ms` is left out of the ingester's request, except for one probe per period. The key is seeded by config migration `042`.

The warm set, the quote/price paths and `GetBars`/`BatchGetBars` are unchanged.

What the fix actually buys is log volume, not vendor load. On the production `GetBarsMulti` path a hold saves ZERO vendor calls. The operator bought more mechanism than the logs-only harm needed, and knew it. Launched 2026-11-07 via PR #1472.

**Why (irrecoverable rationale)**:
- **Full back-off was the operator's choice over the adversary's report-once-only, at the P-04 gate in both rounds.**
  - Report-once gives the same noise reduction with no lag, no config key and no change to 282.
  - The operator accepted the extra mechanism, and up to `D` (6 h) of stored-daily-bar lag on a false-positive hold. That lag reaches the live loop, the screener, `BatchGetBars` consumers and portfolio offline marks.
  - The lag is real because probes are the ONLY refresher of a held symbol's stored bars. The live loop's explicit-range `GetBars` skips the staleness refetch, and `BatchGetBars` has none.
  - Size of the effect: on the per-symbol fallback path, about 288 → about 4 `GetBars` per day per held symbol. Log noise drops from about 288 WARN mentions per day to 1 WARN + 1 INFO.
- **`D` is a config key; the majority rule and the streak gap are fixed.**
  - `D` decides how stale a stored series may get. That is a data-age policy, so it must be config (F-07; a Floor cannot be waived, F-11).
  - The strict-majority rule only classifies "did the market have a session in this window".
  - The streak gap is structural.
  - Both fixed values are operator-approved non-config invariants. CLAUDE.md says only "operator-approved"; the reason is here.
- **`>` not `>=` in the majority rule.** An exactly-half partial vendor outage must not count as informative. Accepted side effect: a 2-symbol warm set `{live, dead}` never holds the dead one.
- **`D` is read before `warmMu` is taken.** This avoids a `warmMu` → config-watcher lock-order edge.
- **The hold state lives in the ingester, not in `markWarm` or eviction.**
  - `GetBars` re-warms on every call, so eviction is undone at once.
  - A `markWarm` that consulted the hold would starve the quote path and break 282 AC-16/17/26.
- **The state is guarded by the existing `warmMu`.** Removal on warm-set exit must be atomic with `warmSymbols` changes.
- **`barHold` is nested `symbol→tf→entry`, deliberately unlike `lastStaleCheck`'s `sym|tf` key.** `bar_ingest_timeframe` is a list, and reconcile and recovery delete per symbol in O(1). Do not "harmonise" the two.
- **Redefining the no-bars WARN's `missing`/`total` over non-held symbols was cleared by a grep.** No `packages/otel` dashboard, alert or doc reads those attributes. Re-check if one is added.
- **The hold's shape (negative cache + report-once) was modelled on** the feature 227/215 ETF-flag filler (`StartEtfFlagFiller`).
- **The state maps are created lazily.** Test literals construct `&MarketDataService{}` with nil maps.
- **`barsStore.InsertBars` has no nil guard, on purpose.** A nil store must panic and never silently drop bars (accepted at impl-spec review). A future `&MarketDataService{}` literal that returns bars will panic by design.
- **Minimum evidence is weak, and the fix depends on 282.**
  - Daily bars are stamped around 04:00 UTC, so "empty across more than one session" is NOT guaranteed. On Mondays and after holidays, the 48 h window can contain no stamp at all for a thin IEX name. The real minimum evidence is `D` of informative-cycle emptiness, sometimes inside a single session.
  - Before 282 landed, a warm set dominated by dead/OTC names (live names under half) never produces an informative cycle. Nothing is held: the fix fails safe, but the bug stays unfixed until 282 is in.
- **The cause is still unknown.** Nobody established why AXIA/EVTV/LRHC/LXP/PSKY/RAMP return nothing on `feed=iex`. It could be IEX coverage, a rename or a bad symbol, and `GetBarsMulti` cannot tell them apart. The mechanism was made cause-agnostic on purpose. Weak hints:
  - PSKY "bars stale since 2026-10-05" (feature 240 context).
  - PSKY has an SEC CIK, so it is likely a rename.
  - Feature 282's context records AXIA/EVTV/LRHC/PSKY as "no Webull row, FMP major exchange".

**Rejected alternatives**:
- **A seeding waiver (leave the key unseeded and write it via `create_key=true`):** rejected at the round-2 gate. The operator chose a config migration, which also removes the feature-091 `create_key` need.
- **Report-once only** (round-1 adversary): same noise reduction, no lag, no key, no 282 change. Rejected by the operator, who accepted the extra mechanism and the lag.
- **The round-2 adversary's narrowed hold** (WARN suppression on the multi path, call-skipping on the per-symbol path only): rejected in favour of full back-off on both paths.
- **Hard-coded 1 h/6 h windows framed as "operator-approved F-07 exceptions":** BLOCKED. A Floor cannot be waived (F-11), and data-age windows are config.
- **An N-cycle threshold (3 × 5 min) and an "at least one peer" rule:** a cycle count carries no information over a 48 h lookback window. Both misfire on thin IEX names and partial outages.
- **Warm-set eviction, or `markWarm` consulting the hold:** `GetBars` re-warms on every call, and this would starve the quote path.
- **A session-aware hold using a trading calendar:** overbuilt for a SEV-3.
- **A pointer-check race guard and a `markWarm` new-add delete:** YAGNI. The warm set is add-only, and reconcile bounds a stale entry to one cycle, which keeps 282 R1's ≤5 min bound. Whichever of 282/291 lands second adds the delete inside `markWarmIfServable` if needed.
- **A private ingester mutex:** removal must be atomic with `warmSymbols` changes.
- **Rate-limiting the `GetBars` miss-path refetch with the same state:** would alter `@AC-53 @feature-240` and edit lines that 282 rewrites. Split out into its own defect report.

**Scars & gotchas**:
- **Migration `035` was unusable although it was absent from `origin/main-dev`.** `035_smoke_rpc_user_id` and `036_smoke_writes_enabled` already exist in repo history (`git log --all -- 'services/xstockstrat-config/migrations/03[56]*'`). Main-dev had also moved to `037`, and golang-migrate silently skips a lower version that lands after a higher one. The final number, 042, was set under the merge order 282 (038/039) → 295 (040/041) → 291.
- **Key-constant shape is load-bearing.** The key must be a plain string-literal `const` passed straight to `GetInt`, with no forwarder. `check-config-wiring.mjs` `goConsts` resolves only that form; anything else becomes a keyless `dynamic-read` finding that gates CI.
- **A copied migration-test helper truncated a correct migration.** The helper from `retiredPortfolioSnapshotInterval.test.ts` splits SQL on every `;`. The `042` description contains a `;`, so the first GREEN failed. `barIngestBackoffSeedMigration.test.ts` now drops `--` lines and splits quote-aware. The precedent file still has the naive split.
- **One live peer never holds.** Under the strict majority, one live symbol plus `DEAD` is exactly half, which is non-informative. Hold tests need at least 2 live peers (with the 6 h default: hold at cycle 72, recovery at 144).
- **Paired test steps ran after their service steps.** The spec's declared test-first order (1→3→2→5→4→7→6→8) was ignored: the batch workflow ran Steps 2, 4 and 6 before their paired tests.
  - Each RED was captured from scratch working-tree tests, then reverted (F-08).
  - Step 7 was proven afterwards with mutants. A never-holds mutant (`resolveBarIngestBackoff`→0) failed all 15 tests, including every positive control. A `hits*2 >= active` mutant was caught by the exactly-half case.
- **The pre-commit hook was inert in the batch-execute worktree.** `core.hooksPath` pointed at a missing `/home/user/xstockstrat/.husky/_`. Only `gofmt -l` was run by hand.
- **A spec-time tension was followed literally.** A non-informative cycle deletes every non-held entry, including an errored symbol's streak entry. Inside an informative cycle, an errored symbol never creates, advances or resets an entry.
- **The context-constitution teardown was done by hand.** Stale MARKETDATA-5 `~L` hints were re-stamped.

**Permanent deviations**:
- **Key registration.**
  - Design: register the key with a `scripts/config-wiring.json` entry (recon said "as `read-unseeded`").
  - Shipped: no entry.
  - Because: that file is a shrink-only baseline of FINDINGS. A key seeded and read under an identical string produces no finding, so an entry would fail as `STALE`. Verified with `--keys`/`--final` instead.
- **Migration number.**
  - Design: "next after `034`" (then `035`).
  - Shipped: `042`.
  - Because: 035/036 are taken in history, 037 landed, and 282/295 claimed 038–041.
- **RED test 7.**
  - Design: uses "a live peer".
  - Shipped: two live peers.
  - Because: one peer is exactly half, which is non-informative.
- **CHANGELOG note.**
  - Design: a CHANGELOG note.
  - Shipped: a PR-body note plus marketdata CLAUDE.md.
  - Because: CHANGELOG is generated by `/promote`.
- **MARKETDATA-5 location.**
  - Design: put it in the root constitution.
  - Shipped: it is in `services/xstockstrat-marketdata/docs/context-constitution.md`.
- **Recording source in tests.**
  - Design: `recordingBarsSource.requested [][]string`.
  - Shipped: `map[int][]string` keyed by cycle.
  - Because: test 15 resumes at a non-contiguous cycle.

**Cross-feature signal**:
- **Superseded key form (296/304).** The reader now uses the namespace-relative `stream.bar_ingest_backoff_ms`. 042's full-dotted seed and its shape test are historical, and the stored rows were reconciled by the later key-heal migrations, so the mismatch is not a bug.
- **282's warm-set invariant was narrowed.** It now reads: "No reader filters the warm set by servability; the bar ingester may leave a symbol out of a cycle's vendor request because of feature-291 hold state, and never removes it from the warm set; quote/price readers are never filtered." Recorded in both features' context.
  - 291 is the per-symbol negative cache that 282's design scoped out.
- **Shared code with 290 and 294.**
  - 290 rewrites the same `barsStore` field comment.
  - 294 relies on the `bar ingest: cycle complete` literal. 291 kept it, extended only with `held`.
- **Config migration numbering across 281/282/291/293/295** is fixed at merge as max(`origin/main-dev`)+1 EXACTLY, renumbering down as well as up.

**Deferred follow-ons**:
- **GetBars miss-path refetch.** Every call refetches symbols that have no stored bars. This is the larger dead-symbol vendor cost (the 952-line BOSSY/CRTD/DNB/FORL burst), tracked in `docs/reports/2026-11-04-marketdata-getbars-miss-path-refetch-every-call-defect.md`.
- **Re-check Loki** for the dead symbols now that 282 has landed.
- **Post-merge dev smoke by the operator:** the no-bars WARN should stop naming the dead symbols within 6 h. Not recorded as done.
- **Root cause of the empty IEX responses** is still unknown. It needs live Alpaca `/v2/assets` and iex-vs-sip calls.
- **Unverified hypothesis from the defect report:** the dead symbols also cause analysis `live_loop` "had no 1d bars" WARNs.
- **Re-check 294 AC-7** against the `cycle complete` heartbeat, which now carries `held`.

**Ledger entries written**: insights.md (1), fails.md (4) — see the 2026-11-10 entries. The 2026-11-04 design entry and the inert-hook entry already existed and were skipped.

**Runtime-invariant recommendations (→ /context-constitution)**: none new. These are already recorded:
- the narrowed 282/291 warm-set invariant, in MARKETDATA-16;
- "read the key before `warmMu`", in marketdata CLAUDE.md and MARKETDATA-5;
- "nil `barsStore` panics by design", as a field comment in `marketdata_service.go`. Since feature 290 it also covers `fetchAndCacheBars`.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51. Defect report `docs/reports/2026-11-04-marketdata-bar-ingest-dead-symbols-refetched-defect.md` (+ `.status`) was pruned in the same run.
