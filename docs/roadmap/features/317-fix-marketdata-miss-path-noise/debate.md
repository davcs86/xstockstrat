# Debate Register: fix-marketdata-miss-path-noise

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 3 | 2 | 0 | 9 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 2 | 0 | 7 | 7 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | D-1: Marketdata cancel-quiet uses a single warnUnlessDone helper (Debug plus ctx_done when ctx is done, otherwise WARN) at the listed GetBars, GetLatestQuote and bar-ingest sites. ingestRecentBarsForTimeframe returns early on ctx.Err(), which skips applyBarCycle and reportIngestCycle. | Adversary r1 'checked and not objected': the only caller is the process-ctx poller (:1313, :1387) and hold state is in memory. | settled |
| D-2 | 1 | D-2: Portfolio cancel-quiet. processAccountDeregistered uses the feature-290 stop closure and returns ctx.Err(). Bracket and balance downgrade to Debug, keep the void signature and stay ackAlways. Order fill is unchanged. | portfolio_service.go:1573, :185-190, :231-241, :373; adversary r1 concurrence | settled |
| D-3 | 1 | D-3: If a GetBars negative cache ships, it records an entry only after a successful empty fetch and never on an error or cancel. fetched is false whenever ctx.Err()!=nil. | marketdata_service.go:409-416 returns (nil,'') for both error and empty; adversary r1 P-06 objection | settled |
| D-4 | 2 | D-4: If (B) ships, window<=0 skips noteMissResult entirely, so every call fetches and logs the WARN as before the fix (a full rollback lever). The disabled-control test asserts both. | Adversary r2: <=0 otherwise keeps the WARN deduped; the proposer's own feature-291 precedent bar_hold.go:34-44 treats <=0 as off. | settled |
| D-5 | 2 | D-5: The bars.miss_backoff_ms seed is a namespace-relative row (namespace 'marketdata', key 'bars.miss_backoff_ms', value_type 'int', staging and production, user_id NULL, a unique updated_by sentinel, ON CONFLICT DO NOTHING). It is never modelled on 042's FQN key or on 047. | 042_marketdata_bar_ingest_backoff.up.sql:11 holds the FQN key; 047_config_alias_removal_rows.up.sql is a latched DELETE; 044/045 reject prefixed keys; fails.md:2333, :3841 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | R-1: Using timeframe.Interval(canonicalTf) as the GetBars miss window. | A window that decides staleness must be a config key (F-07; insight 2026-11-04 fix-marketdata-dead-symbol-ingest); both sides agree. | locked |
| R-2 | 1 | R-2: Returning ctx.Err() from processBracketUpdate or processBalanceSync. | It moves feature 294's consumer outcome series from acked to error. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | O-1: There is no evidence the GetBars negative cache is still needed after feature 282. Run the Loki miss-path query grouped by symbol against servability before committing (B); drop (B) if no servable symbol floods. | yes | open |
| O-2 | 1 | O-2: The negative cache must be scoped to startImplicit reads, so an empty explicit-range or backtest read cannot suppress other reads. | yes | closed @ round 2 (The proposal scopes (B) to startImplicit && pageToken=="" on the miss branch after liveFetchAllowed; explicit-range and backtest reads keep fetching; the adversary accepted it.) |
| O-3 | 1 | O-3: The negative-cache key must equal the fetched symbol string (raw req.Symbol), or normalisation must be uniform across the read, the fetch and the key. | yes | closed @ round 2 (The key is the raw req.Symbol+'/'+canonicalTf, identical to the QueryRecentBars/QueryBars/fetchAndCacheBars arguments (:327, :329, :350); the adversary accepted it.) |
| O-4 | 1 | O-4: Reusing stream.bar_ingest_backoff_ms couples it with feature 291's rollback lever. Use a dedicated seeded and bounded key, or record operator sign-off in context.md. | no | closed @ round 2 (A dedicated key, bars.miss_backoff_ms, with its own bounds; no coupling to feature 291's stream.bar_ingest_backoff_ms. The seed-shape follow-up is tracked as O-10.) |
| O-5 | 1 | O-5: State the unloaded-asset-set behaviour in design.md (@AC-9 @feature-282): the first call still fetches, read as PRESERVE. | no | closed @ round 2 (design.md records @AC-9 @feature-282 as PRESERVE: the first call fetches while the asset set is unloaded, and only a confirmed empty suppresses later calls.) |
| O-6 | 1 | O-6: fetched=false on ctx.Err() even when the source returns (nil,nil); needs a red test with barsCancelSource. | no | closed @ round 2 (confirmedEmpty requires err==nil, len==0 and ctx.Err()==nil, with a red test that combines barsCancelSource{cancel} and empty bars.) |
| O-7 | 1 | O-7: Test seams: add a call counter to barsCancelSource (snapshotted at entry, C-13 relocation if it gets a second consumer); initialise lastEmptyFetch lazily for cacheBarsSvc; retarget the :1279 structural test. | no | closed @ round 2 (A call counter at entry, lazy map init in the writer, and the structural test TestGetBarsWarnsWhenMissAndLiveFetchEmpty retargeted onto liveRefetch, pinned by name, with the C-13 relocation rule.) |
| O-8 | 1 | O-8: Each new helper lands in the same step as its production caller (golangci-lint unused). | no | closed @ round 2 (The build order lands each helper in the same step as its production caller.) |
| O-9 | 1 | O-9: Confirm the product spec's order-fill ackAlways site is stale (processOrderFill :373 is not ackAlways-wrapped) and correct the spec. | no | open |
| O-10 | 2 | O-10: The seed row shape and test must be namespace-relative with an updated_by sentinel. The bounds FQN must be verified against the reader key with no double prefix. The seed ships with its reader under check-config-wiring --final. | yes | open |
| O-11 | 2 | O-11: Retiring or rewriting AC-2 on the gate's DROP path needs operator sign-off in context.md and a product-spec revision (C-15). | yes | open |
| O-12 | 2 | O-12: State in design.md the accepted concurrent cold-call herd under check-without-reserving, and keep AC-2 sequential. A reservation with rollback is the fallback. | no | open |
| O-13 | 2 | O-13: window<=0 must restore every-call fetch AND every-call WARN; the disabled-control test asserts both. | no | open |
| O-14 | 2 | O-14: design.md must carry the honest-value statement: vendor calls saved, warming and ingester polling not saved, WARN once per change into the empty state. | no | open |
| O-15 | 2 | O-15: The resolveOptionalMs refactor is allowed only if resolveBarIngestBackoff's signature and every feature-291 test and caller stay unmodified; otherwise drop it. | no | open |
| O-16 | 2 | O-16: fetchAndCacheBars should return a named outcome, not a third positional bool. Re-grep peer branches at spec time. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
