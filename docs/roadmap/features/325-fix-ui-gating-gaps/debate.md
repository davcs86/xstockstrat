# Debate Register: fix-ui-gating-gaps

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 2 | 3 | 0 | 4 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 3 | 2 | 3 | 3 | 1 | yes |
| 3 | 2026-11-13 | /sdd-batch | 2 | 0 | 3 | 5 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Namespace-editor gate is three-state via EditState: loading → disabled trigger; settled userId && !isAdmin → trigger hidden + single CardNotice 'Admin only: read-only view'; isAdmin OR settled null userId (/me failed) → editable (fail-open; BFF requireAdminScope authoritative). | src/hooks/useLiveStrategies.ts:48-52,61-69 (non-ok /me → {} → isAdmin false for 5 min); src/lib/configUiBff.ts:39; fails.md 2026-08-21 config-secrets-and-scoping; NamespaceEditor.tsx:38-60,193-195,293-316 | settled |
| D-2 | 1 | Watchlist in-queue membership comes from one bounded drain of the queue under the dedicated key ['opportunities','membership']. It uses the queue's default request params, follows nextPageToken until it is empty, computing/computeFailed is set, or the UI page cap is hit, polls every 15 s and keeps the previous data on a partial or failed drain. It is consumed in WatchlistReadiness. WatchlistDetail's unfiltered useOpportunities()/inQueue prop is removed. | servicer.py:4762-4764 (kick_full on no-rows) and ~:4717 (next token only while rows remain); analysis CLAUDE.md max_universe_size bound; WatchlistReadiness.tsx:157-160,295-299,344; WatchlistDetail.tsx:74,93-95,369; useOpportunities.ts:33,65-71 | settled |
| D-3 | 2 | The membership drain sends ListOpportunities with pageSize 1000 (MEMBERSHIP_PAGE_SIZE, mirroring the max_universe_size bound). It follows nextPageToken up to MAX_MEMBERSHIP_PAGES = 3, because held/watchlist/muted rows can exceed the bound. It stores a sorted, unique, upper-cased string[]. It throws on computing/computeFailed with retry: false, so the previous data is kept. It is enabled only when the watchlist has at least one bound row. | servicer.py:4659 (no page_size clamp), :4715-4717 (full read then slice); useOpportunities.ts:46 (stop rule); queryClient.ts:5-11 (normy keyed on strategyId), :22 (default retry) | settled |
| D-4 | 2 | The drain's request params come from one exported QUEUE_DEFAULT_FILTERS const (as const), hoisted from the useOpportunities parameter defaults. The Opportunities page's UI-token initial state is deliberately not coupled to it, so the badge means 'appears in your default, unfiltered queue'. | useOpportunities.ts:26-29; opportunities/page.tsx:97-100 (string tokens 'any'/'conviction', not enums); WatchlistDetail.tsx:74 | settled |
| D-5 | 2 | The AC-2 RED test uses a per-test page.route that honours pageSize and an integer-offset pageToken like the server, with the target symbol at index 60, plus a second case beyond 1000 rows to cover following the token and the cap. Recompute-dependent assertions drive an in-place refetch, not reload(). | servicer.py:4659-4662,4716-4717; e2e/mock-backend.ts:1008-1015 (shared mock never paginates); fails.md 2026-08-25 | settled |
| D-6 | 3 | The spec states the RPC delta as follows: the watchlist page goes from 1 to 2 ListOpportunities per poll only when the user has toggled the Copilot rail on. Otherwise it stays at 1, because membership replaces WatchlistDetail's page-1 read. | CopilotRail.tsx:101 (returns null unless showCopilot); PlatformHeader.tsx:184 (global mount); WatchlistDetail.tsx:74 | settled |
| D-7 | 3 | The O-5 cost accounting treats warm-set growth as independent of cadence. It counts held symbols as already warm (GetLatestQuotes → markWarm) and strategy-attributed candidates as already warm (recompute BatchGetBars). The newly warmed subset is unattributed speculative rows, muted non-held placeholders, and curated unattributed non-held rows, bounded as a union across users. | asset_servability.go:81-90; marketdata_service.go:53,637-642,815; servicer.py:5614-5619,5658-5660,5679-5691 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Per-symbol ListOpportunities{symbol} fan-out (useQueries over the visible page) for watchlist in-queue derivation | Empty per-symbol reads reach kick_full (servicer.py:4762-4764), so every poll starts a full per-user recompute for dismissed or snoozed symbols. It also reintroduces the client fan-out that feature 181 removed. | locked |
| R-2 | 1 | Admin gate canEdit = isAdmin && !adminLoading (fail-closed on /me failure) | A transient /me non-ok maps to isAdmin=false for 5 min and blocks real admins (regresses @AC-10/11/12 @feature-219; fails.md 2026-08-21). | locked |
| R-3 | 1 | Proto/analysis-side fixes for in-queue (in_queue on WatchlistReadinessRow, multi-symbol filter, suppress kick on symbol reads) | They escalate scope and design depth, or change Signal-detail behaviour (@AC-15 @feature-215), when a UI-only bounded drain fixes the defect. | locked |
| R-4 | 2 | Draining membership in pages of 50 with a page cap of about 20 | Each call re-reads every row server-side (servicer.py:4715-4717), so it costs N full DB reads per poll and widens the window for a multi-page race. | locked |
| R-5 | 2 | Storing Opportunity objects as the membership query data | The normy normalizer rewrites objects that carry a strategyId (queryClient.ts:5-11). A string[] avoids that and keeps a stable reference. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Drain must reuse the queue page's default ListOpportunities params (minConviction/sources/sort) rather than re-declaring literals; spec cites the source. | no | closed @ round 2 (Hoisted QUEUE_DEFAULT_FILTERS from useOpportunities.ts:26-29, used by both useOpportunities and the drain. The page's UI-token state (page.tsx:97-100) is documented as deliberately uncoupled.) |
| O-2 | 1 | Spec must verify no setQueriesData/getQueriesData over the ['opportunities'] prefix assumes the infinite-query shape, since that would corrupt the membership Set. | no | closed @ round 2 (Grep finds no setQueriesData, getQueriesData or setQueryData on the ['opportunities'] prefix; the only hits are useWatchlists.ts:140,180 on WATCHLISTS_KEY. Data is stored as a string[], which the normy normalizer (queryClient.ts:5-11) cannot rewrite. The spec re-greps at the step SHA.) |
| O-3 | 1 | Spec must enumerate the membership query's refetch triggers (15 s interval, refocus, ['opportunities'] invalidation after Take/Dismiss/Snooze) and state they are intended. | no | closed @ round 2 (Triggers enumerated and stated as intended: the 15 s interval (paused in hidden tabs), refocus or mount once stale (staleTime 5 s), and ['opportunities'] invalidation after Take/Dismiss/Snooze (useOpportunities.ts:68). Retry is pinned to false, and multiple mounts dedupe onto the one key.) |
| O-4 | 1 | Spec must quantify the worst-case live-enrichment (BatchGetLatestPrice) volume of a full drain per poll and justify the poll interval. | no | closed @ round 3 (Per-poll volume quantified per open watchlist: one analysis full-queue read, the same as today's page-1 read (servicer.py:4723-4725), plus one bounded, degradable BatchGetLatestPrice over at most the bounded queue (servicer.py:4827-4878), with no singleflight merge (marketdata_service.go:934-937). The 15 s interval is justified by D-2. Payload bytes are carried as a new, non-blocking objection.) |
| O-5 | 2 | The drain's full-window enrichment permanently grows marketdata's global warm set (marketdata_service.go:932; asset_servability.go:81-90), and the warm-quote poller and bar ingester then re-fetch those symbols. Before approval, the spec must state this as an accepted cost with its bound, or the operator rules on the D-2 cadence reopen. | yes | open |
| O-6 | 2 | Correct the O-4 claim that the RPC rate is unchanged: while CopilotRail is open the watchlist page goes from one RPC per poll to two. | no | closed @ round 3 (Corrected: 1 to 2 RPCs per poll only when the Copilot rail is toggled on (CopilotRail.tsx:101 returns null otherwise), otherwise unchanged at 1. The 'RPC rate unchanged' wording is dropped.) |
| O-7 | 2 | The AC-2 RED test must exercise the reported rank-below-50 case within a single page, not only page-2 pagination. | no | closed @ round 3 (AC-2 primary RED is D-5 Case A: an offset-honouring route serving a 70-row queue with X at index 60 in a single page. Buggy pageSize 50 misses X and fixed pageSize 1000 finds it. Case B (beyond 1000) covers the pager and cap.) |
| O-8 | 3 | The O-5 cost list is incomplete. It must add: (1) the classification refresh, which spends one FMP FetchSector call per new warm symbol per cycle against the shared marketdata.fmp.daily_request_cap of 250/day when marketdata.classification.enabled=true (classification_service.go:80-95,195-203), with the worst case /new warm/ / cap; (2) the per-symbol InsertQuote upserts every 30 s on marketdata's 2-connection pool (marketdata_service.go:1236-1242; marketdata_repo.go:279-290), about 780 rows per symbol per day, kept 90 days. | yes | open |
| O-9 | 3 | The spec must record a residual: GetLatestQuotesMulti and GetLatestTradesMulti send one unchunked GET (alpaca/client.go:465-466,570-571), and on failure warmQuotesOnce falls back to one vendor call per warm symbol every 30 s (marketdata_service.go:1246-1255). A larger warm set raises the cost of that existing failure mode. | no | open |
| O-10 | 3 | The bound must be restated precisely. The queue is at most max(max_universe_size, /curated/+/muted_only/) (servicer.py:5614-5619). The newly warmed subset is unattributed speculative rows, muted non-held placeholders, and curated unattributed non-held rows. Because the warm set is global (marketdata_service.go:53), the bound is a union across users. | no | open |
| O-11 | 3 | O-4 payload: the spec must state bytes per 15 s poll at the bounded queue size. The whole queue is serialized as proto, then BFF JSON, then sent to the browser, versus 50 or fewer rows today. It is an accepted cost under R-3. | no | open |
| O-12 | 3 | The 'exactly one membership request' assertion in AC-2 Case A is flaky as worded. It must count only requests whose JSON body has page.pageSize == 1000 (transport.ts:57, JSON by default), within a window that ends before the first 15 s refetch. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 2 | D-2 | Adversary r2: BatchGetLatestPrice → markWarmIfServable (marketdata_service.go:932; asset_servability.go:81-90) permanently warms every queued symbol into a global, unpruned set that the 30 s quote poller and the bar ingester re-fetch. Membership changes only on recompute or Take/Dismiss/Snooze, and those already invalidate ['opportunities']. The petition asks to lower D-2's 15 s membership refetchInterval to 60 s or to none (refocus plus invalidation). | pending user |
