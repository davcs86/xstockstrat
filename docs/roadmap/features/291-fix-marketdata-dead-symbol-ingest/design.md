# Design: fix-marketdata-dead-symbol-ingest

**Created**: 2026-11-04
**Rounds**: 2 (quick mode extended to a second round by the operator; termination: approved)
**Approved by**: user @ 2026-11-04 (round-2 gate: "Approve full back-off on both paths"; key introduced "via config migration")
**Grounded in**: recon.md

---

## Chosen Approach

An ingester-only **hold state** per `(symbol, timeframe)` that leaves a warm symbol that keeps returning no bars out of the bar ingester's vendor request (except one probe per period), reports hold and recovery once per state change, and clears when bars return. The warm set is never filtered or shrunk; `GetBars`, `BatchGetBars`, the quote paths and the price paths are unchanged (`markWarm` `marketdata_service.go:1089-1096` is add-only and `GetBars` re-warms on every call `:263`, so eviction cannot work and `markWarm` must not consult the state — it would starve the quote path, `282 AC-16/17/26`). Internal/platform-only (C-14 n/a).

**State.** Field `barHold map[string]map[string]*barHoldEntry` (symbol → tf → `{emptySince, lastEmpty, nextProbe}`) beside `warmSymbols` (`:48-51`), guarded by the existing `warmMu`, created lazily so `&MarketDataService{}` literals stay safe; `delete` on a nil map is a no-op. The nested shape is kept because `bar_ingest_timeframe` is still a list (`:1220`) and a per-symbol delete is O(1); it intentionally differs from `lastStaleCheck`'s `sym|tf` key. Field comment: guarded by `warmMu`, never held across a vendor call. **No pointer-check and no `markWarm` new-add delete** (YAGNI): nothing removes symbols from `warmSymbols` today, and the plan-step reconcile drops entries for symbols absent from the cycle's `symbols` argument within one cycle (keeps `282 R1`'s ≤5 min bound); whichever of 282/291 lands second adds the delete inside `markWarmIfServable` if it is then needed.

**Plan step** (top of `ingestRecentBarsForTimeframe`, `:1289`): read `D = resolveBarIngestBackoff(s.budgetCfg)` **before** taking `warmMu` (avoids a `warmMu` → config-watcher lock edge). `D <= 0` → clear `barHold`, request every symbol exactly as today (MARKETDATA-5 kill switch). Under `warmMu`: reconcile (drop entries for symbols not in `symbols`); request list = non-held symbols plus held symbols whose `end >= nextProbe`. Release the lock, then fetch through the existing multi (`:1292-1312`) or per-symbol (`:1314-1328`) path using the request list only. The clock is the cycle's `end` (`ingestRecentBars` computes it from `time.Now()` at `:1277`; tests call `ingestRecentBarsForTimeframe` directly with a fixed `end`, as `:1171` does).

**Update step** (under `warmMu`, clock `end`):
- `active` = non-held requested symbols that did not error. A cycle is **informative** iff `hits*2 > len(active)` (strict majority of active symbols returned bars; strict `>` so an exactly-half partial vendor outage is not informative — a 2-symbol warm set `{live, dead}` therefore never holds the dead one; accepted). Non-informative cycles (weekend, holiday, partial outage, a lone dead symbol, a probes-only request) delete every non-held entry — the streak needs uninterrupted evidence.
- Informative cycle: symbol returned bars → delete its entry; symbol missing → no entry or `end - lastEmpty > end.Sub(start)` (the actual window width, exact when an operator widens `bar_ingest_lookback_ms`) starts a new streak at `end`, else `lastEmpty = end`; when `end - emptySince >= D` the symbol is **held** with `nextProbe = end + D` (reported in the "newly held" list).
- Probes, any cycle: bars returned → insert, delete the entry, add to "recovered"; empty → `nextProbe = end + D` (fixed period, no doubling); fetch error → no change (retried next cycle).
- Per-symbol fetch errors (`:1317-1320`) never create, advance or reset an entry and are excluded from `active`.

**Reporting** (`reportIngestCycle` `:1337`, gains `held int`): the INFO heartbeat is logged every cycle (also for an empty request list) with `symbols` still equal to the full argument count and a new `held` attribute. The existing WARN `bar ingest: symbols returned no bars` keeps its message, with `missing`/`total` redefined over `active`; held symbols never appear; empty probes are not re-reported (no dashboard or alert reads these attrs — grep of `packages/otel` and docs; CHANGELOG note). New once-per-transition aggregated lines (sample capped by `barIngestNoBarsSample` `:1333`): WARN `bar ingest: holding symbols that returned no bars` (with `probe_every_ms`) and INFO `bar ingest: held symbols returned bars` (never in an all-empty cycle).

**Inserts.** The two ingester inserts (`:1304`, `:1325`) go through `s.barsStore.InsertBars` (prod wires `barsStore = repo` `:235-239`; `barsBatchStore` already declares `InsertBars` `:127-130`). One-line field comment: the ingester requires it non-nil when bars are returned — no nil-guard, a nil store must panic, never silently drop bars. `fetchAndCacheBars`' `s.repo.InsertBars` (`:370`) is untouched.

**Config key — `marketdata.stream.bar_ingest_backoff_ms`** (int, default `21600000` = 6 h, `<=0` disables and clears state). `D` is both the in-session empty span required to hold a symbol and the probe period; it expresses one policy (how long a warm symbol's stored daily bar may lag), therefore a config key (F-07; ledger `fails.md:2931-2933`). Custom reader `resolveBarIngestBackoff(cfg intGetter)` — not `resolvePositiveInt` (`:986-994`), which maps `<=0` to the default and would defeat the kill switch; document the asymmetry in the CLAUDE.md row. Steps (all must land, **config service in scope**):
1. **Config migration** (next `services/xstockstrat-config/migrations/NNN_*` — last is `034`; number grounded at `/sdd-spec`, C-07) seeding the key at its code default in every environment without overwriting an existing runtime value (staging may later hold one via `create_key=true`); approvals: DBA + service owner + config team (root `CLAUDE.md` approval flow). This is the operator-chosen route instead of a seeding waiver; it also removes the `create_key=true` need on the unregistered key (feature 091).
2. `SCALAR_BOUNDS_REGISTRY` entry `'marketdata.stream.bar_ingest_backoff_ms': { minValue: 0, maxValue: 86400000 }` in `services/xstockstrat-config/src/grpc/configServiceImpl.ts:135-146` (0 keeps the kill switch; negatives rejected; an unbounded value could recreate the frozen-series scar) + a case in `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts`.
3. `scripts/config-wiring.json` entry (consumed-with-default reader) and a **snapshot-built reader test** (a real config snapshot holding the stored key, asserting `resolveBarIngestBackoff` returns it — `@AC-11 @feature-278`; `fakeCfg` alone does not satisfy it).
4. Row in `services/xstockstrat-marketdata/CLAUDE.md` § Config Keys Consumed; entry in the Per-Feature Registered Keys log in `docs/patterns/config-governance.md`.

**Operator-approved fixed invariants** (recorded in marketdata `CLAUDE.md`, not config values): the strict-majority informative-cycle rule (it classifies "did the market have a session in this window", not how stale data may get) and the streak-continuity gap `end.Sub(start)`. Because a non-informative cycle wipes all non-held entries, the gap only matters after an ingester pause shorter than the window — kept, stated.

### Honest value (what the operator is buying)

- **Production multi-symbol path** (`GetBarsMulti`, `:1293`): dead and healthy symbols travel in ONE request (and `GetBarsMulti` returns early on an empty list, `internal/alpaca/client.go:412-414`). Holding a symbol shortens the symbol list but **saves zero vendor calls**; it removes the per-cycle WARN (~288 mentions/day/symbol → 1 WARN + 1 INFO) and adds hold state plus up to `D` of lag for any symbol held on a false positive. Report-once-only would deliver the same noise reduction without the lag; the operator chose full back-off knowingly (recorded). `@AC-1`'s text ("not re-requested") is literally true (the symbol is absent from the request) but must not be read as a vendor-call saving.
- **Per-symbol fallback path** (`:1314-1328`, any non-multi source or a cycle where the multi call errors): one `GetBars` call saved per held symbol per cycle (~288 → ~4/day at the 6 h default).
- **Freshness table (fails.md:2718-2721)** — for a held symbol with stored history, probes are the *only* refresher of: the analysis live loop (`live_loop.py:702-708`, explicit-range `GetBars` → the staleness refetch `:315` applies only to implicit windows, rate-limited to once per 24 h per `(symbol,tf)` by `staleCheckDue`), the screener, `BatchGetBars` consumers (opportunities; no staleness refetch, cold path only when nothing is stored `:764-768`), and portfolio offline marks (stored 1d close, 168 h window). Worst-case lag for a false positive is therefore up to `D` + one interval. Accepted; bounded by the config key (0 = off, max 24 h).
- **"Emptiness across more than one session" is NOT guaranteed** (daily bars are stamped ~04:00 UTC, fixture `marketdata_service_test.go:4067`): Tue–Fri pre-open the 48 h window holds one stamp, and on Monday/post-holiday it can hold none for thin names. The real minimum evidence is `D` of informative-cycle emptiness, sometimes inside one session. A pre-282 warm set dominated by dead/OTC names (live names under half) never produces an informative cycle → nothing is held (fails safe, bug unfixed until 282 lands).

### RED tests (C-08, P-06, C-13; fakes inline)

Setup: fixed `end0 = 2026-11-04 15:00 UTC` (Wednesday session), cycles at `end0 + k*5m`, window `[end-48h, end]`, `budgetCfg: &fakeCfg{ints: {"marketdata.stream.bar_ingest_backoff_ms": 3600000}}`, a recording `barsBatchStore` (stored bars + ctx; `fakeBarsStore.InsertBars` is a no-op `:4074`), new inline `recordingBarsSource` embedding `*fakeBatchBarsSource` (`:1603`) with `requested [][]string`, `multiErr` (forces the per-symbol path), `errs map[string]error`. **Every "no hold" test carries a positive control** in the same test (the same setup with an informative cycle must hold DEAD), so an implementation that never holds cannot pass:
1. holds after the wall-clock span (DEAD in every request before 1 h, none after; probe at hold time + 1 h); 2. report once (exactly one "holding" WARN naming DEAD over 40 cycles); 3. recovery clears + bars **stored** (recording store) + one INFO + requested next cycle; 4. whole-empty Sunday cycles neutral (+ positive control) and a held DEAD probed in a whole-empty cycle stays held with `nextProbe == end + D`; 5. partial outage ≤ half returns bars → no hold (+ positive control), and the exactly-half case is non-informative; 6. fetch errors not counted (+ positive control), held probe that errors is retried; 7. zero-value service `&MarketDataService{}` run for more than `D/5m` cycles with a source that has a live peer (reaches hold and recovery); 8. held symbol still in `warmSnapshot()` (characterization guard, not RED); 9. entry dropped when the symbol leaves the `symbols` argument (RED) and re-add requested next cycle; 10. lone dead symbol never held; key `0` → every symbol requested every cycle, state cleared; 11. positive feedback: once DEAD is held it leaves `active`, lifting the ratio for the rest. Existing `:1156`/`:1204` stay green unchanged (heartbeat `symbols` = argument count; recovery INFO never in a single all-empty cycle; empty request list still logs the heartbeat).

### Follow-ups and 282 coordination (recorded, not deferred)

- GetBars miss-path refetch on every call for no-stored-bars symbols (`:313-332`; 952-line burst for BOSSY/CRTD/DNB/FORL — the larger dead-symbol vendor cost): `docs/reports/2026-11-04-marketdata-getbars-miss-path-refetch-every-call-defect.md` (+ `.status` `open`). Out of scope: changing it would alter `@AC-53 @feature-240` and edit lines 282 rewrites.
- **282 sign-off (recorded in BOTH `291/context.md` and `282/context.md`):** 282's invariant "the gate applies at warm-add sites only; warm-set readers are never filtered" (`282 design.md:24`, `:42`) is narrowed to: *"No reader filters the warm set by servability. The bar ingester may leave a symbol out of a cycle's vendor request because of feature-291 no-bars hold state, and never removes it from the warm set. Quote/price readers are never filtered."* 291 is the per-symbol negative cache that `282 design.md:48` put out of scope; it does not change 282's scope. 282 R6 (`design.md:59`) is annotated "addressed by 291". `merge-order.md` gets a row for the shared `markWarm` region (291 ↔ 282: independent, rebase-only; whichever lands second keeps any new-add delete inside `markWarmIfServable`).

## Rejected Alternatives

- Report-once only (no request filter) — the adversary's recommendation: same noise reduction, no lag, no config key, no 282 change. Rejected by the operator, who accepts the extra mechanism and the lag (recorded).
- Hold = WARN suppression on the multi path + call-skip on the per-symbol path only (round-2 adversary's fix) — rejected by the operator in favour of full back-off on both paths.
- Hardcoded 1 h/6 h windows as "operator-approved F-07 exceptions" — rejected: a Floor cannot be waived (F-11); data-age windows are config (fails.md:2931-2933).
- N-cycle (3 × 5 min) threshold and "at least one peer" rule — rejected: carry no information over a 48 h window; misfire on thin IEX names and partial outages.
- Warm-set eviction or `markWarm` consulting the state — rejected: `GetBars` re-warms every call; starves the quote path.
- Session-aware hold (trading calendar) — rejected: overbuilt for SEV-3.
- Pointer-check race guard and `markWarm` new-add delete — dropped (YAGNI): the warm set is add-only today and reconcile bounds a stale entry to one cycle.
- A private ingester mutex — rejected: removal on warm-set exit must be atomic with `warmSymbols` changes, which already hold `warmMu`.

## Open Risks

- [ ] False-positive hold freezes a thin IEX name's daily bar up to `D` (6 h default) for the live loop, screener, `BatchGetBars` consumers and offline marks — mitigated by the key (0 = off, max 24 h) and the strict-majority rule; accepted knowingly.
- [ ] Pre-282, a dead/OTC-dominated warm set never produces an informative cycle → bug not fixed until 282 lands.
- [ ] Config migration needs DBA + service-owner + config-team approval; number and rollback grounded at `/sdd-spec`.
- [ ] The cause of the empty responses (IEX coverage vs rename vs bad symbol) is unknown; the mechanism is cause-agnostic.
- [ ] 282 sign-off must be recorded in 282's `context.md` (done at this gate) and honored by whichever feature lands second.

## Constitution Rules Touched

- `F-07` — honored by: `D` is a config key; only non-freshness classifiers are fixed invariants, operator-approved and documented. `F-11` — honored by: no Floor waiver claimed.
- `C-05` / `C-07` — honored by: key named `marketdata.stream.bar_ingest_backoff_ms`; migration numbered `last+1` at spec time.
- `C-08` / `P-06` — honored by: positive-control RED tests; characterization guards labelled.
- `C-10(b)` — honored by: unchanged `GetBars`/`BatchGetBars` contracts; held symbols stay quoted/valued.
- `C-13` / `C-15` / `C-16` / `C-18` — honored by: inline single-consumer fakes; FRs and `@AC-*` tags (product-spec/acceptance revised); see Business Rules Touched; one key, one map, existing lock, no new mutex.
- `F-01` — honored by: new migration only. `F-04` — honored by: cited paths verified by the adversary. `P-03` — honored by: 282 narrowing surfaced and recorded in both features. `C-14` n/a.

## Business Rules Touched (C-16)

- PRESERVE `@AC-3 @FR-2 @feature-191` (`services/xstockstrat-marketdata/acceptance/opportunities-latency-fix.feature`), `@AC-53/54 @FR-5 @feature-240` (`…/offline-account-full-pnl.feature`), `@AC-3 @FR-3 @feature-178` (`…/quote-fanout-batching.feature`), `@AC-8 @FR-2 @feature-196`, `@AC-1 @feature-153` — GetBars/BatchGetBars contracts unchanged; no new ohlcv reads (state in memory).
- PRESERVE-with-bounded-lag `@AC-1/@AC-5/@AC-8/@AC-2 @FR-1/FR-5 @feature-185` (analysis `opportunity-compute-robustness.feature`) — recovery requires marketdata to re-serve once bars exist; delayed by up to `D` for a held symbol (probe); `@AC-13 @feature-215`, `@AC-2 @feature-181`, `@AC-2 @feature-275`, `@AC-4/@AC-7 @feature-272` unaffected.
- Pending 282 (not durable): `@AC-4`, `@AC-9`, `@AC-15`, `@AC-16/17/26` honored — the warm set is never changed and quote/price paths are untouched.
- No CHANGE; no new durable-rule sign-off needed beyond the 282 narrowing recorded above.

## Rounds

2 — round 1 BLOCKED (F-07 hardcoded windows, false positives, zero call savings, 282 override); operator chose full back-off with round 2; round 2 NEEDS WORK with no Floor breach (config bounds + migration, test positive controls, honest value statement, freshness table) — all adopted; approved by the operator with the migration route for the key.
