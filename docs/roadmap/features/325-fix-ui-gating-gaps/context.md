# Context Log: fix-ui-gating-gaps

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bugs reported via defect reports (Issues disabled):
  - docs/reports/2026-10-19-ui-namespace-editor-non-admin-edit-defect.md — Config-UI namespace editor shows Edit/Save to non-admins (SEV-3)
  - docs/reports/2026-10-19-ui-watchlist-inqueue-first-page-only-defect.md — Watchlist "in queue" flag only sees the first loaded opportunity page (SEV-3)
- Cluster rationale: both are xstockstrat-ui client-side display gaps where the UI does not reflect server truth (admin scope, queue membership); one UI PR with Playwright coverage closes both.
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios @AC-1..2), context.md
- Affected services (from reports): xstockstrat-ui
- Root cause hypothesis: missing UI admin gate (074/119/120); feature-215 filter fix not applied to the watchlist consumer
- Recommended design depth: skip → `/sdd-spec fix-ui-gating-gaps` (rationale: SEV-3, single service, no proto/migration/config, clear root cause; escalate to full if the watchlist fix picks a multi-symbol proto filter)
- Development branch: feature/fix-ui-gating-gaps

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); AC-1 Then disjunctive pending OQ1 (hide vs notice); AC-2 lacks a concrete symbol; OQ2 multi-symbol filter would need proto (escalate to full)
- Overlap findings: none
- Recommended design depth: quick (single service (ui), no proto/migration, clean overlap)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

`/sdd-design fix-ui-gating-gaps` (full mode) stopped at its approval gate after round 2. The gate policy is halt, so design.md is not written and status.md is unchanged (spec-ready). The register is in `debate.md`: D-1..D-5, R-1..R-5, O-1..O-7 and P-1.

## Open Threads

- **Approach (round-2 synthesis).** One PR in xstockstrat-ui only, with no proto, migration or config change. It honours D-1, D-2 and R-1..R-3 and has two independent units.
  - **Unit 1, namespace-editor gate (D-1).** NamespaceEditor derives `editGate` (`'loading' | 'edit' | 'readonly'`) from the shared `['auth-me']` query (`useIsAdmin`/`useCurrentUserId`, `useLiveStrategies.ts:42-70`). It threads the gate through EditState/EditContext the same way `isNativeEnv` is threaded.
    - `loading`: the trigger is disabled.
    - `readonly`: the user is settled and not an admin. The `actions-<key>` trigger is hidden and one CardNotice reads "Admin only: read-only view".
    - `edit`: the user is an admin, or the userId settled as null (/me failed). This fails open, and the BFF's `requireAdminScope` (`configUiBff.ts:39`) stays authoritative.
    - The Edit item at `:164` is the only SetConfig entry point.
  - **Unit 2, membership drain (D-2 made concrete by D-3/D-4).** Add `useQueueMembership()` in `useOpportunities.ts`, a plain `useQuery` on `['opportunities','membership']`.
    - It reads its parameters from a hoisted, exported `QUEUE_DEFAULT_FILTERS` (`:26-29`). The Opportunities page's UI-token state (`page.tsx:97-100`) is deliberately not coupled to it.
    - It sends `pageSize` = `MEMBERSHIP_PAGE_SIZE` = 1000 and follows `nextPageToken` up to `MAX_MEMBERSHIP_PAGES` = 3.
    - It throws on `computing`/`computeFailed` with `retry: false`, which keeps the previous data.
    - It returns a sorted, unique, upper-cased `string[]`, which the normy normalizer cannot rewrite.
    - It uses `refetchInterval` 15 s and is `enabled` only when the watchlist has bound rows.
    - WatchlistReadiness consumes it (`:299`). WatchlistDetail's `useOpportunities()`, Set and `inQueue` prop are removed.
  - **Build order.**
    1. Unit 1, plus RED e2e tests for a non-admin and for an admin whose /me returns 5xx.
    2. Hoist `QUEUE_DEFAULT_FILTERS` and add the hook.
    3. Swap the consumer, plus the AC-2 RED test (D-5). It uses an offset-honouring `page.route` with X at index 60, and a second case past 1000 rows.
    4. Re-run `e2e/insights/watchlists.spec.ts` and record any fixtures in INVENTORY.md (C-13).
- **Strongest open objection: O-5, blocking.** Each drain poll enriches the whole window through `BatchGetLatestPrice` → `markWarmIfServable` (`marketdata_service.go:932`; `asset_servability.go:81-90`). That permanently adds every queued symbol to marketdata's global, unpruned warm set, which the 30 s quote poller and the bar ingester then re-fetch.
  - Before approval, the spec must state this as an accepted cost bounded by `max_universe_size` (default 100) plus held/muted rows. The alternative is for the operator to rule on **P-1**, a pending petition to reopen D-2 and lower the 15 s cadence to 60 s or remove it.
  - Two non-blocking objections are also open. **O-6**: the claim that the RPC rate is unchanged is wrong, because with CopilotRail open each poll makes 2 RPCs. **O-7**: the AC-2 RED test must cover rank-below-50 inside a single page.
  - O-1, O-2 and O-3 closed in round 2. O-4 is still open, and O-5 carries it forward.
- **Floor status.** Neither side raised a Floor breach.
- **@AC changes not covered by an operator decision.** CHANGE: @AC-1 and @AC-2 of feature 325. PRESERVE: @AC-10/11/12 @feature-219, @AC-2/3 @feature-181, @AC-2/3/5/7 @feature-187, @AC-1 @feature-213 and @AC-15 @feature-215. The operator has not ruled on any of these yet.
- **Next action.** The operator rules on P-1 (D-2 cadence) and O-5, then re-runs `/sdd-batch` to resume from the state block below.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "One UI-only PR in services/xstockstrat-ui. It has two independent units and no proto, migration or config change. It honours D-1, D-2, R-1, R-2 and R-3.\n\nUNIT 1: namespace-editor gate (D-1, unchanged)\n- NamespaceEditor (src/app/config-ui/[namespace]/NamespaceEditor.tsx) reads useIsAdmin() and useCurrentUserId(). Both come from the one shared ['auth-me'] query (src/hooks/useLiveStrategies.ts:42-70).\n- It derives editGate: 'loading' | 'edit' | 'readonly' and threads it through EditState/EditContext the same way isNativeEnv is threaded (:38-60, 293-316). COLUMNS stays at module scope (:193-195).\n- 'loading' renders the actions-<key> trigger disabled.\n- 'readonly' means a settled userId that is not admin. The trigger is not rendered, and one CardNotice reading \"Admin only: read-only view\" is shown.\n- 'edit' means isAdmin, or a settled null userId (/me returned non-ok, giving {} at useLiveStrategies.ts:48-49). This fails open; requireAdminScope (src/lib/configUiBff.ts:39) stays authoritative.\n- The Edit item at :164 is the only SetConfig entry point, so this gate covers every write path.\n\nUNIT 2: membership drain (D-2), made concrete\n- Add useQueueMembership() to src/hooks/useOpportunities.ts. It is a plain useQuery keyed ['opportunities','membership']. The infinite-query keys put a number at index 1 (:33), so the keys cannot collide. The [['opportunities']] prefix invalidation after Take/Dismiss/Snooze (:65-71) still reaches it.\n- Request (O-1). Hoist the four parameter defaults of useOpportunities (:26-29: 0, [], OpportunityActionTag.UNSPECIFIED, OpportunitySort.CONVICTION) into one exported `QUEUE_DEFAULT_FILTERS ... as const`. Both useOpportunities' defaults and the drain read from it.\n  - The Opportunities page's initial useState (src/app/insights/opportunities/page.tsx:97-100) uses UI tokens ('any', 'conviction'), not the proto enums. It is deliberately not coupled to the const, and the spec states this.\n  - So the badge means \"appears in your default, unfiltered queue\". That matches what WatchlistDetail sends today (WatchlistDetail.tsx:74).\n- Paging. Each request asks for pageSize: MEMBERSHIP_PAGE_SIZE = 1000. That mirrors the [1,1000] bound of analysis.opportunity.max_universe_size.\n  - The server does not clamp page_size (servicer.py:4659) and reads every row before slicing (:4715-4717). One call therefore costs the database the same as today's page-1 read.\n  - The drain follows page.nextPageToken up to MAX_MEMBERSHIP_PAGES = 3. The cap is needed because held, watchlist and muted rows are exempt from the universe cut, so the row count can exceed 1000. The comment next to the constant names that overflow.\n- Stop rule. If any page has computing or computeFailed set, the queryFn throws, which keeps the previous data in place. This mirrors getNextPageParam (:46). Set retry: false on this query.\n- Return value. A clean drain returns a sorted, unique, upper-cased string[]. That shape cannot be rewritten by normy, which keys on strategyId (src/lib/queryClient.ts:5-11).\n- refetchInterval stays at 15_000, as D-2 settles. The adversary's cadence cut contradicts D-2 and is carried only as a REOPEN petition for the operator.\n- Gate the query with `enabled` so it runs only when the watchlist readiness page has at least one bound row. An empty watchlist then makes no full-queue read and no enrichment call.\n- Consumer. WatchlistReadiness memoizes a Set from the hook and replaces inQueue?.has at :299. The inQueue prop (:165,175) is removed.\n- WatchlistDetail drops useOpportunities() (:74), the Set (:93-95), the prop (:369) and the import (:32). The shared page-1 key used by CopilotRail and the queue is untouched.\n\nBUILD ORDER\n1. Unit 1, plus RED e2e tests for two cases:\n   - Non-admin: no actions-<key> trigger, and the notice is visible.\n   - Admin whose /me returns 5xx: the trigger is present.\n2. Hoist QUEUE_DEFAULT_FILTERS and add useQueueMembership.\n3. Swap the consumer, plus an AC-2 RED test. A per-test page.route honours page.pageSize and an integer-offset pageToken, as the server does (servicer.py:4659-4662, 4716-4717). Put symbol X at index 60.\n   - The buggy code (pageSize 50) misses X. The fixed code (pageSize 1000) finds it in one page.\n   - A second case puts X beyond 1000 rows, to exercise following the token and the cap.\n   - Any \"badge appears after recompute\" assertion triggers an in-place refetch or invalidation, not reload() (fails.md 2026-08-25).\n4. Re-run e2e/insights/watchlists.spec.ts:84,448-465. Register any new fixtures in INVENTORY.md (C-13).",
    "open_objections": [
      {
        "text": "O-4 (still open): the proposal's 'net delta is batch size only' claim omits the warm-set side effect. Every drain poll's enrichment calls BatchGetLatestPrice over the whole window (servicer.py:4716-4721,4855-4856), and that call marks every queued symbol warm (marketdata_service.go:932, asset_servability.go:81-90). The warm set is global and is not pruned at runtime, and the 30 s quote poller and the bar ingester re-fetch every warm symbol. Before approval, the spec must state that this growth is an accepted cost and give its bound: max_universe_size, default 100, plus held/muted rows. Alternatively, the operator rules on the D-2 cadence REOPEN petition.",
        "blocking": true
      },
      {
        "text": "The statement 'the RPC rate does not change' is false while CopilotRail is open. Today WatchlistDetail's useOpportunities() and CopilotRail's useOpportunities(0) share one key; after the change the page makes two RPCs per poll (page-1 plus membership). The O-4 text in the spec must be corrected.",
        "blocking": false
      },
      {
        "text": "The AC-2 RED test must exercise the actual defect: a symbol ranked below 50 inside a single page. It needs a route that honours pageSize and an offset pageToken, with X at index 60, which fails on the buggy code. A two-page route only tests the pager.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 (feature 325, non-admin cannot see/use namespace edit action)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 (feature 325, watchlist in-queue badge reflects full queue, not page 1)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-10 @feature-219",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-11 @feature-219",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-12 @feature-219",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-181",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-181",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-213",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-15 @feature-215",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Paging the drain at 50 with a cap of about 20 pages. The server re-reads every row on each call (servicer.py:4715-4717), so this costs N full DB reads per poll and widens the window for a multi-page race.",
      "Storing Opportunity objects under the membership key. The normy normalizer rewrites any object that carries a strategyId (queryClient.ts:5-11). A string[] cannot be touched by it and gets stable structural sharing.",
      "Reducing membership polling to 60 s, or to none (refocus plus invalidation only). This contradicts settled D-2 (15 s), so it is not adopted. It goes forward as a REOPEN petition with new warm-set evidence.",
      "A server-side flag to skip live enrichment on membership reads. It would remove the warm-set and payload costs, but it is a proto/analysis change covered by locked R-3.",
      "Wiring the Opportunities page's initial useState to QUEUE_DEFAULT_FILTERS. The page uses UI tokens ('any', 'conviction', page.tsx:97-100), not the proto enums, so coupling would need a mapping layer that the fix does not need. It is documented as deliberately uncoupled instead."
    ],
    "open_risks": [
      "Global warm-set growth in marketdata. Every queued symbol of every user with an open watchlist is warmed on each 15 s poll and then re-fetched by the 30 s quote poller and the bar ingester. That adds vendor load and pressure on marketdata's 2-connection pool. It is bounded by max_universe_size plus held/muted rows.",
      "Response payload size. One pageSize-1000 response of full rows every 15 s per open watchlist could reach hundreds of KB near the bound.",
      "A 1000-symbol BatchGetLatestPrice singleflight key never merges with the queue page's 50-symbol call. GetPreviousDailyCloseBatch over the whole queue competes with interactive reads.",
      "Assumed but not verified: BatchGetLatestPrice has no small cap on symbol count. Only empty-list guards were seen (marketdata_service.go:929).",
      "Cap overflow. If the queue exceeds 3000 rows, the partial Set silently drops badges past the cap. The badge is a cue, not an authority.",
      "Fail-open for unknown identity shows an enabled Edit trigger to a non-admin when /me fails. The BFF rejects the write, so the error surface must be legible.",
      "Peer feature fix-live-enrich-ttl-seed may change the live-quote memo seed. This design treats the memo as cold on every poll, so it is unaffected."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-11",
      "C-12",
      "C-13",
      "C-15",
      "C-16",
      "C-17",
      "C-18",
      "P-02",
      "P-03",
      "F-06",
      "F-07"
    ],
    "rationale": "I checked the proposal's load-bearing claims against the code:\n- `servicer.py:4659` does not clamp page_size.\n- `useOpportunities.ts:26-29` holds the defaults and `:46` the computing stop rule.\n- `markWarmIfServable` is called at `marketdata_service.go:932`.\n- `opportunities/page.tsx:97-100` uses UI tokens rather than enum values, so it cannot import the hoisted const directly.\n\nHow the open objections stand:\n- **O-1 closed.** The hoisted `QUEUE_DEFAULT_FILTERS` answers it, and the page is deliberately left uncoupled.\n- **O-2 closed.** Grep finds no `setQueriesData` on the `['opportunities']` prefix, and storing a `string[]` sidesteps the normy normalizer.\n- **O-3 closed.** The refetch triggers are listed and stated as intended, and `retry: false` is now pinned rather than optional.\n- **O-4 stays open.** The adversary's evidence is new and correct: the full-window enrichment permanently grows marketdata's global warm set, which the \"batch size only\" claim leaves out.\n\nThe adversary's fix, cutting the 15 s cadence, conflicts with settled D-2. Following the register guardrail, I kept 15 s in the approach and filed the cut as a REOPEN petition with new evidence for the operator to rule on. Within D-2 I adopted the mitigations that do not conflict with it: `enabled` gating on bound rows, `retry: false`, and a comment on the cap that names the overflow. I also adopted the AC-2 RED redesign (offset-honouring route, symbol X at index 60) so the test actually covers the rank-below-50 defect. Neither side found a Floor breach.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The membership drain sends ListOpportunities with pageSize 1000 (MEMBERSHIP_PAGE_SIZE, mirroring the max_universe_size bound). It follows nextPageToken up to MAX_MEMBERSHIP_PAGES = 3, because held/watchlist/muted rows can exceed the bound. It stores a sorted, unique, upper-cased string[]. It throws on computing/computeFailed with retry: false, so the previous data is kept. It is enabled only when the watchlist has at least one bound row.",
          "evidence": "servicer.py:4659 (no page_size clamp), :4715-4717 (full read then slice); useOpportunities.ts:46 (stop rule); queryClient.ts:5-11 (normy keyed on strategyId), :22 (default retry)"
        },
        {
          "text": "The drain's request params come from one exported QUEUE_DEFAULT_FILTERS const (as const), hoisted from the useOpportunities parameter defaults. The Opportunities page's UI-token initial state is deliberately not coupled to it, so the badge means 'appears in your default, unfiltered queue'.",
          "evidence": "useOpportunities.ts:26-29; opportunities/page.tsx:97-100 (string tokens 'any'/'conviction', not enums); WatchlistDetail.tsx:74"
        },
        {
          "text": "The AC-2 RED test uses a per-test page.route that honours pageSize and an integer-offset pageToken like the server, with the target symbol at index 60, plus a second case beyond 1000 rows to cover following the token and the cap. Recompute-dependent assertions drive an in-place refetch, not reload().",
          "evidence": "servicer.py:4659-4662,4716-4717; e2e/mock-backend.ts:1008-1015 (shared mock never paginates); fails.md 2026-08-25"
        }
      ],
      "new_rejected": [
        {
          "text": "Draining membership in pages of 50 with a page cap of about 20",
          "why": "Each call re-reads every row server-side (servicer.py:4715-4717), so it costs N full DB reads per poll and widens the window for a multi-page race."
        },
        {
          "text": "Storing Opportunity objects as the membership query data",
          "why": "The normy normalizer rewrites objects that carry a strategyId (queryClient.ts:5-11). A string[] avoids that and keeps a stable reference."
        }
      ],
      "new_objections": [
        {
          "text": "The drain's full-window enrichment permanently grows marketdata's global warm set (marketdata_service.go:932; asset_servability.go:81-90), and the warm-quote poller and bar ingester then re-fetch those symbols. Before approval, the spec must state this as an accepted cost with its bound, or the operator rules on the D-2 cadence reopen.",
          "blocking": true
        },
        {
          "text": "Correct the O-4 claim that the RPC rate is unchanged: while CopilotRail is open the watchlist page goes from one RPC per poll to two.",
          "blocking": false
        },
        {
          "text": "The AC-2 RED test must exercise the reported rank-below-50 case within a single page, not only page-2 pagination.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "Hoisted QUEUE_DEFAULT_FILTERS from useOpportunities.ts:26-29, used by both useOpportunities and the drain. The page's UI-token state (page.tsx:97-100) is documented as deliberately uncoupled."
        },
        {
          "id": "O-2",
          "how": "Grep finds no setQueriesData, getQueriesData or setQueryData on the ['opportunities'] prefix; the only hits are useWatchlists.ts:140,180 on WATCHLISTS_KEY. Data is stored as a string[], which the normy normalizer (queryClient.ts:5-11) cannot rewrite. The spec re-greps at the step SHA."
        },
        {
          "id": "O-3",
          "how": "Triggers enumerated and stated as intended: the 15 s interval (paused in hidden tabs), refocus or mount once stale (staleTime 5 s), and ['opportunities'] invalidation after Take/Dismiss/Snooze (useOpportunities.ts:68). Retry is pinned to false, and multiple mounts dedupe onto the one key."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-2",
          "evidence": "Adversary r2: BatchGetLatestPrice → markWarmIfServable (marketdata_service.go:932; asset_servability.go:81-90) permanently warms every queued symbol into a global, unpruned set that the 30 s quote poller and the bar ingester re-fetch. Membership changes only on recompute or Take/Dismiss/Snooze, and those already invalidate ['opportunities']. The petition asks to lower D-2's 15 s membership refetchInterval to 60 s or to none (refocus plus invalidation).",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-batch design gate (round 3)

`/sdd-design fix-ui-gating-gaps` (full mode) stopped at its approval gate after round 3. The gate policy is halt, so design.md is not written and status.md is unchanged (spec-ready). The register is in `debate.md`: D-1..D-7, R-1..R-5, O-1..O-12 and P-1.

## Open Threads

- **Approach (round-3 synthesis).** The mechanics are unchanged from round 2: one PR in xstockstrat-ui only, with no proto, migration or config change. It rests on D-1..D-5 and respects R-1..R-5.
  - **Unit 1, namespace-editor gate (D-1).** NamespaceEditor derives `editGate` (`'loading' | 'edit' | 'readonly'`) from the shared `['auth-me']` query. It threads the gate through EditState/EditContext the way `isNativeEnv` is threaded. `readonly` hides the trigger and shows one CardNotice. `edit` fails open on a settled null userId, and `requireAdminScope` (`configUiBff.ts:39`) stays authoritative.
  - **Unit 2, membership drain (D-2/D-3/D-4).** Add `useQueueMembership()` on `['opportunities','membership']`.
    - Params come from the hoisted `QUEUE_DEFAULT_FILTERS`.
    - It sends `pageSize` 1000 and follows the token up to `MAX_MEMBERSHIP_PAGES` = 3.
    - It returns a sorted, unique, upper-cased `string[]`.
    - It throws on `computing`/`computeFailed` with `retry: false`.
    - It is `enabled` only when the watchlist has bound rows, and `refetchInterval` is 15 s (D-2; P-1 is still pending).
    - WatchlistReadiness consumes it. WatchlistDetail's `useOpportunities()`, Set and `inQueue` prop are removed.
  - **What round 3 adds: the cost accounting the spec must carry.**
    - (a) Cadence does not set the warm-set bound, because `markWarmIfServable` is an idempotent set insert (`asset_servability.go:81-90`). Cadence changes only the BatchGetLatestPrice rate and the payload rate (D-7).
    - (b) The warm set is global (`marketdata_service.go:53`), so the bound is a union across users. Held symbols (`marketdata_service.go:637-642`) and strategy-attributed candidates (recompute BatchGetBars, `servicer.py:5679-5691`) are already warm. The newly warmed rows are unattributed speculative rows, muted non-held placeholders, and curated unattributed non-held rows. The queue is at most max(max_universe_size, |curated|+|muted_only|) (`servicer.py:5614-5619`).
    - (c) Each new warm symbol costs:
      - the 30 s warm-quote poller: one unchunked multi-quote call, then one InsertQuote upsert per symbol, about 780 rows per symbol per market day, kept 90 days, on marketdata's 2-connection pool;
      - the bar ingester;
      - when `marketdata.classification.enabled=true`, one FMP FetchSector per cycle against the shared 250/day `marketdata.fmp.daily_request_cap` (worst case |new warm| / cap).
      - Residual: the per-symbol fallback that runs when the multi-quote call fails gets more expensive.
    - (d) Each open watchlist, per 15 s poll, costs:
      - one full-queue ListOpportunities, the same DB read as today's page 1;
      - one bounded, degradable BatchGetLatestPrice with no singleflight merge;
      - a whole-queue payload, accepted under R-3.
    - (e) RPC delta (D-6): ListOpportunities goes from 1 to 2 per poll only while the Copilot rail is toggled on (`CopilotRail.tsx:101`). Otherwise it stays at 1.
  - **AC-2 tests (D-5).**
    - Case A, the primary RED: an offset-honouring `page.route` with a 70-row queue and X at index 60. The request count includes only bodies with `page.pageSize == 1000`, in a window that ends before the first 15 s refetch.
    - Case B: X beyond row 1000, which covers the pager and the cap.
    - Recompute-dependent assertions use an in-place refetch.
- **Strongest open objection: O-5 plus O-8, both blocking.** The warm-set growth must be stated as an accepted cost with its bound. Round 3's cost list was incomplete: it left out the classification/FMP budget draw and the per-symbol quote upserts (O-8: `classification_service.go:80-95,195-203`; `marketdata_service.go:1236-1242`; `marketdata_repo.go:279-290`). Both close when the operator accepts the cost stated in (a)–(d), or rules on **P-1**.
  - Open and non-blocking:
    - **O-9**: the residual from the unchunked multi-quote GET and the per-symbol fallback.
    - **O-10**: restate the bound precisely as a union across users.
    - **O-11**: payload bytes per poll at the bounded queue size.
    - **O-12**: filter the Case A request count on `pageSize == 1000`.
  - Closed this round:
    - **O-4**: per-poll volume quantified.
    - **O-6**: RPC delta corrected.
    - **O-7**: Case A is the primary RED.
  - Unverified risk for the spec to check at the step SHA: no small symbol-count cap was seen on BatchGetLatestPrice, only the empty-list guard (`marketdata_service.go:929`).
- **Floor status.** Neither side raised a Floor breach.
- **@AC changes not covered by an operator decision.**
  - CHANGE: @AC-1 and @AC-2 of feature 325.
  - PRESERVE: @AC-10/11/12 @feature-219, @AC-2/3 @feature-181, @AC-2/3/5/7 @feature-187, @AC-1 @feature-213 and @AC-15 @feature-215.
  - The operator has not ruled on any of these yet.
- **Next action.** The operator accepts the O-5/O-8 cost or rules on P-1 (D-2 cadence), then re-runs `/sdd-batch` to resume from the state block below.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "This is one UI-only PR in services/xstockstrat-ui. It has two independent units and no proto, migration or config change. It rests on D-1 to D-5 and respects R-1 to R-5. Mechanically nothing changes from round 2; this round only tightens the cost accounting the spec must carry.\n\nUNIT 1: namespace-editor gate (D-1)\n- NamespaceEditor (src/app/config-ui/[namespace]/NamespaceEditor.tsx) reads useIsAdmin() and useCurrentUserId(). Both come from the shared ['auth-me'] query (src/hooks/useLiveStrategies.ts:42-70).\n- It derives editGate: 'loading' | 'edit' | 'readonly' and threads it through EditState/EditContext the same way isNativeEnv is threaded (:38-60, 293-316). COLUMNS stays at module scope (:193-195).\n- The three states:\n  - 'loading' renders the trigger disabled.\n  - 'readonly' (a settled non-admin userId) hides the trigger and shows one CardNotice reading \"Admin only: read-only view\".\n  - 'edit' (isAdmin, or a settled null userId after /me failed) fails open. requireAdminScope (src/lib/configUiBff.ts:39) stays authoritative.\n\nUNIT 2: membership drain (D-2/D-3/D-4)\n- Add useQueueMembership() to src/hooks/useOpportunities.ts, keyed ['opportunities','membership'].\n- Params come from the hoisted QUEUE_DEFAULT_FILTERS (from :26-29).\n- Request pageSize 1000 (MEMBERSHIP_PAGE_SIZE) and follow the token with MAX_MEMBERSHIP_PAGES = 3.\n- Return a sorted, unique, upper-cased string[].\n- Throw on computing/computeFailed (stop rule mirrors :46), with retry: false.\n- Enable the query only when the watchlist has at least one bound row. refetchInterval is 15_000 per D-2; P-1 is still pending with the operator.\n- WatchlistReadiness consumes the hook and memoizes a Set, replacing inQueue?.has at :299. The inQueue prop (:165, :175) is removed.\n- WatchlistDetail drops useOpportunities() (:74), the Set (:93-95), the prop (:369) and the import.\n\nSPEC TEXT REQUIRED (cost accounting for O-4/O-5, as corrected this round)\n(a) Cadence does not set the warm-set bound. markWarmIfServable is an idempotent set insert (marketdata asset_servability.go:81-90), so new warm entries grow once per distinct symbol and stay until restart. Cadence changes only the BatchGetLatestPrice call rate and the payload rate.\n\n(b) Which symbols are newly warmed. The warm set is global (marketdata_service.go:53), so the bound is a union across users, not a per-user sum. Some rows are already warm:\n- held symbols, via portfolio GetLatestQuotes → markWarm (verified at marketdata_service.go:637-642);\n- strategy-attributed candidates, via the recompute's BatchGetBars (servicer.py:5679-5691 → marketdata_service.go:815).\n\nThe newly warmed subset is:\n- unattributed speculative rows;\n- muted non-held placeholders, which are excluded from eligible at servicer.py:5658-5660;\n- curated (watchlist) symbols with no strategy binding that are not held.\n\nThe queue size is curated + muted_only + speculative[:max(0, max_universe − curated − muted)] (servicer.py:5614-5619). So the queue is at most max(max_universe_size, |curated|+|muted_only|).\n\n(c) Downstream consumers of each new warm symbol, each stated as an accepted cost:\n- The 30 s warm-quote poller. It makes one batched GetLatestQuotesMulti, which is unchunked (alpaca/client.go:465-466,570-571). It then makes one sequential InsertQuote upsert per symbol (marketdata_service.go:1236-1242 → cacheQuote :1156-1161 → marketdata_repo.go:279-290). That is about 780 rows per symbol per market day, retained for retention.quotes_days (90), and the writes go through marketdata's 2-connection PgBouncer client pool.\n- The bar ingester, which batches through GetBarsMulti.\n- When marketdata.classification.enabled=true (default false), RefreshClassifications. It calls FMP FetchSector once per symbol per cycle against the shared marketdata.fmp.daily_request_cap (default 250/day), and a cap hit ends the cycle (classification_service.go:80-95,195-203). The spec states the worst case as |new warm| / daily_request_cap.\n\nResidual: if the multi-quote call fails, warmQuotesOnce falls back to one vendor call per warm symbol every 30 s (marketdata_service.go:1246-1255). A larger warm set makes that existing failure mode more expensive.\n\n(d) Per open watchlist page, per 15 s poll:\n- one analysis ListOpportunities call, the same full-queue DB read that page 1 already costs (servicer.py:4723-4725);\n- one BatchGetLatestPrice over at most the bounded queue, capped by live_enrich_timeout_ms and degrading to unenriched rows (servicer.py:4827-4878). It never shares a singleflight with the page-1 call (marketdata_service.go:934-937);\n- a payload of the whole bounded queue, serialized as proto, then BFF JSON, then sent to the browser. The spec quantifies the bytes at the bounded queue size, and the cost is accepted because R-3 locks out a symbols-only read.\n\n(e) RPC delta (O-6). The page goes from 1 to 2 ListOpportunities per poll only when the user has toggled the Copilot rail on (CopilotRail.tsx:101 returns null unless showCopilot; it is mounted in PlatformHeader.tsx:184). Otherwise it stays at 1.\n\nAC-2 TESTS (D-5)\n- Case A, the primary RED: a per-test page.route that honours pageSize and an integer-offset token, serving a 70-row queue with X at index 60.\n  - Buggy code (pageSize 50) misses X.\n  - Fixed code (pageSize 1000) finds X in one response.\n  - The request-count assertion counts only requests whose JSON body has page.pageSize == 1000 (connect-web uses JSON, src/lib/browserClients/transport.ts:57), within a window that ends before the first 15 s interval.\n- Case B: X beyond row 1000, which exercises following the token and the cap.\n- Recompute-dependent assertions use an in-place refetch, not reload().\n\nApproval remains gated on blocking O-5 and on the new blocking accounting objection below. Both are satisfied by the operator accepting the cost stated in (a)–(d), or by the operator ruling on P-1.",
    "open_objections": [
      {
        "text": "O-5 (still open): the warm-set growth must be stated as an accepted cost with its bound, or the operator rules on P-1. Round 3 gave a cadence-independence argument and a partial bound. Closing this needs the full corrected accounting (see the next objection) and operator acceptance of the cost.",
        "blocking": true
      },
      {
        "text": "The O-5 cost list is incomplete. It must add: (1) the classification refresh, which spends one FMP FetchSector call per new warm symbol per cycle against the shared marketdata.fmp.daily_request_cap of 250/day when marketdata.classification.enabled=true (classification_service.go:80-95,195-203), with the worst case |new warm| / cap; (2) the per-symbol InsertQuote upserts every 30 s on marketdata's 2-connection pool (marketdata_service.go:1236-1242; marketdata_repo.go:279-290), about 780 rows per symbol per day, kept 90 days.",
        "blocking": true
      },
      {
        "text": "The spec must record a residual: GetLatestQuotesMulti and GetLatestTradesMulti send one unchunked GET (alpaca/client.go:465-466,570-571), and on failure warmQuotesOnce falls back to one vendor call per warm symbol every 30 s (marketdata_service.go:1246-1255). A larger warm set raises the cost of that existing failure mode.",
        "blocking": false
      },
      {
        "text": "The bound must be restated precisely. The queue is at most max(max_universe_size, |curated|+|muted_only|) (servicer.py:5614-5619). The newly warmed subset is unattributed speculative rows, muted non-held placeholders, and curated unattributed non-held rows. Because the warm set is global (marketdata_service.go:53), the bound is a union across users, not a per-user figure.",
        "blocking": false
      },
      {
        "text": "O-4 payload: the spec must state bytes per 15 s poll at the bounded queue size. The whole queue is serialized as proto, then BFF JSON, then sent to the browser, versus 50 or fewer rows today. It is an accepted cost under R-3.",
        "blocking": false
      },
      {
        "text": "The 'exactly one membership request' assertion in AC-2 Case A is flaky as worded. It must count only requests whose JSON body has page.pageSize == 1000, within a window that ends before the first 15 s refetch.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 (feature 325, non-admin cannot see/use namespace edit action)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 (feature 325, watchlist in-queue badge reflects full queue, not page 1)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-10 @feature-219",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-11 @feature-219",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-12 @feature-219",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-181",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-181",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-213",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-15 @feature-215",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Lowering the membership cadence to 60 s or to none (P-1). It is not adopted because it contradicts settled D-2, and it is still pending the operator. Its effect is limited: it lowers only the BatchGetLatestPrice rate and the payload rate. It does not shrink the warm-set bound, the classification/FMP cost or the quote-write cost, because warming is an idempotent set insert (asset_servability.go:81-90).",
      "Suppressing read-time enrichment for membership reads. This is the one structural fix that would remove the new warm entries, but it needs a proto/analysis request flag, which locked R-3 rules out. It is listed only so the operator knows what accepting the cost gives up.",
      "Asserting 'exactly one ListOpportunities request' unfiltered in AC-2 Case A. That would be flaky, because the refetch interval, refocus and Copilot page-1 calls hit the same route."
    ],
    "open_risks": [
      "When classification.enabled is on, warm-set growth from unattributed, muted and curated non-held rows across all users can take a meaningful share of the shared 250/day FMP budget. Random map order then changes which symbols miss refresh each cycle, and the budget is shared with feature-217 sector, fundamentals snapshots and the ETF-flag filler (which stops at 80%).",
      "Each newly warm symbol adds per-symbol quote upserts every 30 s, kept 90 days, on marketdata's 2-connection client pool.",
      "The unchunked multi-quote GET and the per-symbol fallback get more expensive as the warm set grows.",
      "The full-queue payload is sent every 15 s per open watchlist, and only the symbols are used.",
      "The membership BatchGetLatestPrice never shares a singleflight with the page-1 call, so a whole-queue GetPreviousDailyCloseBatch competes with interactive reads.",
      "Unverified: BatchGetLatestPrice has no small symbol-count cap. Only the empty-list guard was seen (marketdata_service.go:929). The spec must check this at the step SHA.",
      "If the queue exceeds 3000 rows, badges past the cap are silently dropped. The badge is a cue, not an authority.",
      "Fail-open on an unknown identity shows an enabled Edit trigger to a non-admin when /me fails. The BFF rejects the write, so its error must be legible.",
      "Peer fix-live-enrich-ttl-seed may change the memo TTL. That affects only the enrichment call rate, not the warm-set bound."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-11",
      "C-12",
      "C-13",
      "C-15",
      "C-16",
      "C-17",
      "C-18",
      "P-02",
      "P-03",
      "F-06",
      "F-07"
    ],
    "rationale": "I spot-checked the adversary's new evidence at HEAD.\n\n**What the code shows:**\n- `classificationUniverse()` is the union of `warmSnapshot()` and demand (classification_service.go:80-95).\n- `RefreshClassifications` calls `FetchSector` once per symbol and ends the cycle on `ErrFMPDailyCapExceeded` (:192-205).\n- Marketdata's CLAUDE.md confirms that `classification.enabled` defaults to false and that `fmp.daily_request_cap` (default 250) is the single shared FMP budget.\n- `GetLatestQuotes` marks every symbol warm (marketdata_service.go:637-642). This confirms the proposal's assumption that held symbols are already warm.\n- `warmQuotesOnce` tries the multi call first, then falls back to one call per symbol (:1234-1258).\n- CopilotRail returns null unless `showCopilot` is on (CopilotRail.tsx:101).\n\n**Where the sides agree:** neither side found a Floor breach or a register violation, and both agree the cadence does not move the warm-set bound.\n\n**Objections:**\n- **O-5 stays open and blocking.** Round 3 did not account for the classification/FMP cost or the per-symbol quote writes. I recorded that gap as a new blocking objection, and closing it needs operator acceptance or a ruling on P-1.\n- **O-4 is closed for call counts.** The proposal quantified per-poll volume and justified 15 s under D-2. Payload bytes are carried as a new, non-blocking objection.\n- **O-6 is closed.** The proposal corrected the RPC delta, and I tightened the wording to \"only when the Copilot rail is toggled on\", based on the verified null return.\n- **O-7 is closed.** Case A (X at index 60 within a single page) is now the primary RED. The flaky unfiltered request-count assertion is a new non-blocking objection; my approach adopts the pageSize==1000 body filter.\n\n**Reopens:** none. P-1 stays pending with the operator. The new marketdata evidence does not depend on cadence, so it informs the P-1 ruling rather than strengthening it.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The spec states the RPC delta as follows: the watchlist page goes from 1 to 2 ListOpportunities per poll only when the user has toggled the Copilot rail on. Otherwise it stays at 1, because membership replaces WatchlistDetail's page-1 read.",
          "evidence": "CopilotRail.tsx:101 (returns null unless showCopilot); PlatformHeader.tsx:184 (global mount); WatchlistDetail.tsx:74"
        },
        {
          "text": "The O-5 cost accounting treats warm-set growth as independent of cadence. It counts held symbols as already warm (GetLatestQuotes → markWarm) and strategy-attributed candidates as already warm (recompute BatchGetBars). The newly warmed subset is unattributed speculative rows, muted non-held placeholders, and curated unattributed non-held rows, bounded as a union across users.",
          "evidence": "asset_servability.go:81-90; marketdata_service.go:53,637-642,815; servicer.py:5614-5619,5658-5660,5679-5691"
        }
      ],
      "new_rejected": [],
      "new_objections": [
        {
          "text": "The O-5 cost list is incomplete. It must add: (1) the classification refresh, which spends one FMP FetchSector call per new warm symbol per cycle against the shared marketdata.fmp.daily_request_cap of 250/day when marketdata.classification.enabled=true (classification_service.go:80-95,195-203), with the worst case |new warm| / cap; (2) the per-symbol InsertQuote upserts every 30 s on marketdata's 2-connection pool (marketdata_service.go:1236-1242; marketdata_repo.go:279-290), about 780 rows per symbol per day, kept 90 days.",
          "blocking": true
        },
        {
          "text": "The spec must record a residual: GetLatestQuotesMulti and GetLatestTradesMulti send one unchunked GET (alpaca/client.go:465-466,570-571), and on failure warmQuotesOnce falls back to one vendor call per warm symbol every 30 s (marketdata_service.go:1246-1255). A larger warm set raises the cost of that existing failure mode.",
          "blocking": false
        },
        {
          "text": "The bound must be restated precisely. The queue is at most max(max_universe_size, |curated|+|muted_only|) (servicer.py:5614-5619). The newly warmed subset is unattributed speculative rows, muted non-held placeholders, and curated unattributed non-held rows. Because the warm set is global (marketdata_service.go:53), the bound is a union across users.",
          "blocking": false
        },
        {
          "text": "O-4 payload: the spec must state bytes per 15 s poll at the bounded queue size. The whole queue is serialized as proto, then BFF JSON, then sent to the browser, versus 50 or fewer rows today. It is an accepted cost under R-3.",
          "blocking": false
        },
        {
          "text": "The 'exactly one membership request' assertion in AC-2 Case A is flaky as worded. It must count only requests whose JSON body has page.pageSize == 1000 (transport.ts:57, JSON by default), within a window that ends before the first 15 s refetch.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-4",
          "how": "Per-poll volume quantified per open watchlist: one analysis full-queue read, the same as today's page-1 read (servicer.py:4723-4725), plus one bounded, degradable BatchGetLatestPrice over at most the bounded queue (servicer.py:4827-4878), with no singleflight merge (marketdata_service.go:934-937). The 15 s interval is justified by D-2. Payload bytes are carried as a new, non-blocking objection."
        },
        {
          "id": "O-6",
          "how": "Corrected: 1 to 2 RPCs per poll only when the Copilot rail is toggled on (CopilotRail.tsx:101 returns null otherwise), otherwise unchanged at 1. The 'RPC rate unchanged' wording is dropped."
        },
        {
          "id": "O-7",
          "how": "AC-2 primary RED is D-5 Case A: an offset-honouring route serving a 70-row queue with X at index 60 in a single page. Buggy pageSize 50 misses X and fixed pageSize 1000 finds it. Case B (beyond 1000) covers the pager and cap."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — sdd-batch design gate (round 4)

`/sdd-design fix-ui-gating-gaps` (full mode) stopped at its approval gate after round 4. The gate policy is halt, so design.md is not written and status.md is unchanged (spec-ready). The register is in `debate.md`: D-1..D-8, R-1..R-5, O-1..O-17 and P-1.

## Open Threads

- **Approach (round-4 synthesis).** The mechanism is unchanged from round 3 and rests on D-1..D-7: one UI-only PR in xstockstrat-ui, with no proto, migration or config change. Round 4 changes only the cost text the spec must carry for O-5, and that text is not yet ready for the operator to accept.
  - **Unit 1, namespace-editor gate (D-1).** NamespaceEditor derives `editGate` (`'loading' | 'edit' | 'readonly'`) from `useIsAdmin()` and the `['auth-me']` userId, threaded through EditState like `isNativeEnv`. `readonly` hides the trigger and shows one CardNotice. `edit` fails open when `/me` fails, and `requireAdminScope` (`configUiBff.ts:39`) stays authoritative.
  - **Unit 2, membership drain (D-2..D-6).** `useQueueMembership()` on `['opportunities','membership']` uses `QUEUE_DEFAULT_FILTERS`, `pageSize` 1000 and `MAX_MEMBERSHIP_PAGES` = 3, returns a sorted, upper-cased `string[]`, throws on `computing`/`computeFailed` with `retry: false`, is enabled only with bound rows, and polls every 15 s (P-1 is still pending). WatchlistReadiness consumes it; WatchlistDetail's `useOpportunities()`, Set and `inQueue` prop are removed.
  - **Cost text the spec must carry (O-5), as corrected in round 4.**
    - (a) Baseline (D-8): live enrichment covers only the returned page window and WatchlistDetail already reads page 1, so the drain adds warm entries only for queue rows ranked 51 and lower. This is a row count; new distinct symbols are at most that many. The `servicer.py:4744-4749` cite is the proposer's and is not yet verified.
    - (b) Per-recompute snapshot: max(0, Q_u − 50) per viewer, with Q_u ≤ max(`opportunity.max_universe_size`, |curated_u| + |muted_only_u|). The cut is at `servicer.py:5627-5639`; the earlier `:5614-5619` cite is stale (O-16). The warm set is global, so the total is a union across viewers.
    - (c) Bound over time, the one the operator is asked to accept: `markWarm` only adds (`marketdata_service.go:1171-1177`), the only removal is the delisting prune (`asset_servability.go:153`) or a restart, and the speculative tail is re-selected by `signal_axis` on every recompute. So between marketdata restarts the new warm set is the union of every tail any viewer has drained since boot, with no structural bound below the servable signal-symbol universe. V means distinct viewers since boot. The proposal's |W_new| ≤ 50 × V is only a snapshot (O-14).
    - (d) Cost per new warm symbol, three line items:
      - FMP classification: 0 while `marketdata.classification.enabled=false` (the default); when true, one FetchSector per symbol per 24 h cycle against the shared 250/day cap, so 20% of the budget per 50 symbols;
      - quote upserts: one per 30 s cycle, about 780 rows per symbol per market day and about 48k retained over 90 days, on marketdata's 2-connection pool;
      - bar ingester, missing from the proposal (O-13): one more symbol in GetBarsMulti and one InsertBars upsert into `marketdata.ohlcv` per 5-min cycle, up to 288 per symbol per day, on the same pool. Feature 291's dead-symbol hold limits symbols that return nothing.
    - (e) Residual (O-9, closed): when the multi-quote call fails, the fallback makes one vendor call per warm symbol every 30 s.
    - (f) Tripwires, each requiring a re-check of the bound before the key changes: `marketdata.classification.enabled = true`, and `opportunity.max_universe_size` > 100 (O-15; at 1000 the per-viewer term is about 950).
    - (g) Watch signals: `marketdata.db.pool.{acquired,empty_acquire_wait}` and `marketdata.ohlcv.out_of_memory_errors{op=insert_bars}`.
    - (h) Records (O-17): log the residual in `services/xstockstrat-marketdata/docs/context-constitution-findings.md` and reference a follow-up feature for a marketdata warm-set TTL prune, which is the structural fix and out of scope here.
    - (i) Cadence: per D-7, P-1 changes none of (a) to (e). It lowers only the BatchGetLatestPrice rate and the payload rate.
- **Strongest open objection: O-5 (blocking), with O-13 and O-14 (both blocking).** The operator asked for one explicit bound to accept. The bound offered is a single-recompute snapshot and is wrong over time, and the bar-ingester cost line is missing. Approval needs the next proposal to carry (c) and the third item of (d), and then the operator either accepts "unbounded below the signal-symbol universe until restart" or rules on P-1.
- **Other open objections (non-blocking).** O-10 (bound restatement needs the time-union form and the corrected cite), O-11 (payload bytes per 15 s poll), O-12 (AC-2 Case A request count filtered on `page.pageSize == 1000` inside the first 15 s), O-15, O-16 and O-17. O-8 and O-9 closed this round.
- **Floor status.** No Floor breaches and no register violations.
- **@AC changes.** This feature's @AC-1 and @AC-2 are CHANGE and are now covered by the operator's 2026-11-20 C-16 sign-off, so no @AC change is uncovered. The eleven prior-feature scenarios (@AC-10/11/12 @feature-219, @AC-2/3 @feature-181, @AC-2/3/5/7 @feature-187, @AC-1 @feature-213, @AC-15 @feature-215) are PRESERVE.
- **Reopen petitions.** None new. P-1 (lower D-2's 15 s cadence) is still pending the operator.
- **Open risks.** The pool impact of the extra quote and bar upserts is not measured, so the spec must check the pool gauges and `out_of_memory_errors` on dev after deploy. Badges past 3000 queue rows are silently dropped. Fail-open shows an enabled Edit trigger to a non-admin when `/me` fails, so the BFF's rejection must be legible.

```sdd-batch-design-state
{
  "round": 4,
  "synth": {
    "approach": "The mechanism is unchanged from round 3 and rests on D-1 to D-7. It is one UI-only PR in services/xstockstrat-ui with no proto, migration or config change. This round changes only the cost text the spec must carry, and that text is still not ready for the operator to accept.\n\nUNIT 1: namespace-editor gate (D-1)\n- src/app/config-ui/[namespace]/NamespaceEditor.tsx derives editGate ('loading' | 'edit' | 'readonly') from useIsAdmin() and the ['auth-me'] userId (src/hooks/useLiveStrategies.ts:42-70).\n- The gate is threaded through EditState the same way isNativeEnv is (:38-60, 293-316). COLUMNS stays at module scope.\n- 'readonly' hides the trigger and shows one CardNotice reading \"Admin only: read-only view\". 'edit' fails open when /me fails, and requireAdminScope (src/lib/configUiBff.ts:39) stays authoritative.\n\nUNIT 2: membership drain (D-2 to D-6)\n- useQueueMembership() goes in src/hooks/useOpportunities.ts under the key ['opportunities','membership'].\n- It uses QUEUE_DEFAULT_FILTERS, pageSize 1000 and MAX_MEMBERSHIP_PAGES = 3, and returns a sorted, upper-cased string[].\n- It throws on computing/computeFailed with retry: false, is enabled only when the watchlist has at least one bound row, and polls every 15 s (D-2; P-1 is still pending with the operator).\n- WatchlistReadiness consumes it. WatchlistDetail drops useOpportunities() (:74), the Set (:93-95) and the inQueue prop (:369).\n- AC-2 tests follow D-5. The Case A request count is filtered on page.pageSize == 1000 inside the first 15 s.\n\nCOST TEXT THE SPEC MUST CARRY (O-5), as corrected by this synthesis\n\n(a) Baseline. Live enrichment covers only the returned page window, and WatchlistDetail.tsx:74 already reads page 1 today. The drain therefore adds warm entries only for queue rows ranked 51 and lower. This is a row count: rows are (symbol, strategy) candidates, so new distinct symbols are at most that many rows, minus symbols already warm under D-7. The proposer cites servicer.py:4744-4749 for the page-window slice; I did not check that line.\n\n(b) Per-recompute snapshot. For each viewer u the term is max(0, Q_u − 50), where Q_u ≤ max(opportunity.max_universe_size, |curated_u| + |muted_only_u|). The cut is at services/xstockstrat-analysis/app/handlers/servicer.py:5627-5639, not :5614-5619 as earlier rounds cited. The warm set is global, so the total is a union across viewers.\n\n(c) The bound over time, which is the one the operator is asked to accept. The proposal's |W_new| ≤ 50 × V is only a snapshot.\n- markWarm only adds (services/xstockstrat-marketdata/internal/service/marketdata_service.go:1171-1177). The only removal is the delisting prune (asset_servability.go:153) or a restart.\n- The speculative tail is re-selected by signal_axis on every recompute (servicer.py:5637-5639), so ranks 51 and lower bring in new symbols as signals change.\n- So between marketdata restarts, |W_new| is the union of every tail any viewer has drained since boot. Its ceiling is the set of servable symbols that carried an active signal for, or were curated or muted by, any watchlist viewer since boot. V means distinct viewers since boot, not concurrent viewers.\n- There is no structural bound below that universe. The spec must say so in those words. The operator either accepts \"unbounded below the signal-symbol universe until restart\" or does not.\n\n(d) Cost per new warm symbol, three line items:\n1. FMP classification. The cost is 0 while marketdata.classification.enabled=false, which is the default. When it is true, the refresh makes one FetchSector per symbol per 24 h cycle against the shared marketdata.fmp.daily_request_cap of 250 (classification_service.go:82, 199-200). That is |W_new|/250 of the daily budget, or 20% per 50 symbols. A cap hit ends the cycle, and random map order decides which symbols go stale.\n2. Quote upserts. One sequential cacheQuote per 30 s cycle (marketdata_service.go:1236-1252), about 780 rows per symbol per market day. Rows are kept 90 days, so about 48k rows are retained per symbol. At 50 symbols that is about 1.7 upserts/s, 39k rows/day and 2.4M rows retained. The writes use marketdata's 2-connection PgBouncer client pool.\n3. Bar ingester. This item is missing from the proposal. ingestRecentBars takes the whole warmSnapshot() (marketdata_service.go:1382-1383). Each 5-min cycle adds one symbol to GetBarsMulti and one InsertBars upsert into marketdata.ohlcv (:1425-1432), up to 288 per symbol per day, on the same 2-connection pool. Feature 291's dead-symbol hold limits the cost of symbols that return nothing.\n\n(e) Residual (O-9). If the multi-quote call fails, the fallback makes one vendor call per warm symbol every 30 s. That cost is linear in |W_new|.\n\n(f) Tripwires. Each one requires re-checking the bound before the key is changed:\n- marketdata.classification.enabled = true;\n- opportunity.max_universe_size > 100. The key is SetConfig-bounded to [1,1000], and at 1000 the per-viewer term is about 950.\n\n(g) Watch signals: marketdata.db.pool.{acquired,empty_acquire_wait} and marketdata.ohlcv.out_of_memory_errors{op=insert_bars} (docs/runbooks/ohlcv-lock-budget-tuning.md).\n\n(h) Records and follow-up.\n- Log the cross-module residual in services/xstockstrat-marketdata/docs/context-constitution-findings.md, so whoever turns classification on sees it.\n- Reference a follow-up feature for a marketdata warm-set TTL prune. That is the structural fix and is out of scope here.\n\n(i) Cadence. P-1 does not change any figure in (a) to (e), per D-7. It lowers only the BatchGetLatestPrice rate and the payload rate. The operator's ruling on it is still pending.\n\nApproval is gated on the next proposal carrying (c) and (d.3), and on the operator accepting the bound in (c) or ruling on P-1.",
    "open_objections": [
      {
        "text": "O-5 (still open): the operator steer asked for one explicit bound to accept. The proposal's bound, |W_new| ≤ 50 × V, is a single-recompute snapshot and is wrong over time, so there is nothing correct for the operator to accept yet. Closing needs the time-union bound and the bar-ingester line item below, then operator acceptance or a ruling on P-1.",
        "blocking": true
      },
      {
        "text": "The bar-ingester cost is missing, although O-5 names it. ingestRecentBars takes the whole warmSnapshot() (marketdata_service.go:1382-1383). Each new warm symbol adds one symbol to GetBarsMulti and one InsertBars upsert into marketdata.ohlcv per 5-min cycle (:1425-1432), up to 288 per day, on the same 2-connection pool. The spec must add this as a third line item and name marketdata.ohlcv.out_of_memory_errors{op=insert_bars} as a watch signal, with feature 291's dead-symbol hold as the mitigation.",
        "blocking": true
      },
      {
        "text": "The bound must be a union over time since the last marketdata restart. The warm set is only added to (marketdata_service.go:1171-1177; the only removal is the delisting prune at asset_servability.go:153). The speculative tail is re-selected by signal_axis on every recompute (servicer.py:5637-5639). The spec must state the per-recompute snapshot as (Q_u − 50) per viewer, define V as distinct viewers since boot, and either give the boot-to-boot ceiling (the servable signal-symbol universe) or state that growth is unbounded between restarts. This stays within D-7, because recompute churn drives it, not cadence.",
        "blocking": true
      },
      {
        "text": "O-10 (still open): the bound restatement is incomplete until it carries the time-union form above and cites the cut at servicer.py:5627-5639.",
        "blocking": false
      },
      {
        "text": "The bound is pinned to opportunity.max_universe_size = 100 with no tripwire. The key is SetConfig-bounded to [1,1000]. The spec must write the per-viewer term as max_universe_size − 50 and add max_universe_size > 100 as a second tripwire next to classification.enabled = true.",
        "blocking": false
      },
      {
        "text": "The cited lines are stale. servicer.py:5614-5619 (used in the proposal, D-7 and O-10) is no longer the curated/muted/speculative cut, which is now at servicer.py:5627-5639. The spec must re-cite at the step SHA.",
        "blocking": false
      },
      {
        "text": "The page-1 baseline must be worded as a row count. Queue rows are (symbol, strategy) candidates, so new distinct symbols are at most the rows ranked 51 and lower. The spec should also note that the drain replaces the page-1 read and re-covers ranks 1 to 50.",
        "blocking": false
      },
      {
        "text": "The classification-flag risk (one SetConfig flip lets a few viewers spend the shared 250/day FMP budget) is recorded only as spec prose. It must also be logged in services/xstockstrat-marketdata/docs/context-constitution-findings.md.",
        "blocking": false
      },
      {
        "text": "O-11 (still open): the spec must state payload bytes per 15 s poll at the bounded queue size. The proposal only defers this to the spec.",
        "blocking": false
      },
      {
        "text": "O-12 (still open): the AC-2 Case A request count must be filtered on page.pageSize == 1000 inside the first 15 s. The proposal restates this, and it closes once the spec carries it.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 (feature 325, non-admin cannot see/use namespace edit action)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2 (feature 325, watchlist in-queue badge reflects full queue, not page 1)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-10 @feature-219",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-11 @feature-219",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-12 @feature-219",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-181",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-181",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-213",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-15 @feature-215",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "P-1 (membership cadence 60 s, or refocus plus invalidation only) as the answer to O-5. It is not adopted this round because it would contradict settled D-2 without an operator reopen, and by D-7 it moves none of the warm-set, FMP, quote-upsert or bar-ingest figures. It lowers only the enrichment and payload rate. It is still pending the operator and is not declined.",
      "A marketdata-side TTL prune of warm symbols not queried in N hours, inside this PR. It is the real structural fix and R-3 does not lock it, but it puts a cross-service change into a SEV-3 UI-only fix. The spec references it as a follow-up feature instead.",
      "Stating the bound as |W_new| ≤ 50 × V. That is a single-recompute snapshot. The warm set only grows between restarts and the speculative tail changes with signals, so the figure understates growth over uptime.",
      "Suppressing read-time enrichment for membership reads. It would remove the new warm entries but needs a proto/analysis request flag, which locked R-3 rules out."
    ],
    "open_risks": [
      "Between marketdata restarts the warm set has no structural bound below the servable signal-symbol universe. Every warm symbol carries three recurring costs: quote upserts every 30 s, bar upserts every 5 min, and FMP calls when classification is on.",
      "The acceptance depends on two live-tunable keys. Turning marketdata.classification.enabled on lets about 250 new warm symbols spend the whole shared FMP day budget. Raising opportunity.max_universe_size toward 1000 lifts the per-viewer term to about 950. The UI has no guard for either.",
      "The extra per-symbol InsertBars upserts land on marketdata.ohlcv, which has a recorded lock-table exhaustion risk, and share the 2-connection pool with the quote upserts. The pool impact is not measured, so the spec must check the pool gauges and out_of_memory_errors on dev after deploy.",
      "The unchunked multi-quote GET and the per-symbol fallback (one vendor call per warm symbol every 30 s on failure) get more expensive as the warm set grows.",
      "The full-queue payload is sent every 15 s per open watchlist and only the symbols are used. The byte count is not yet stated.",
      "I did not check the proposer's cite for page-window-only enrichment (servicer.py:4744-4749). The baseline of ranks 51 and lower depends on it, so the spec must confirm it at the step SHA.",
      "If the queue exceeds 3000 rows, badges past the cap are silently dropped. The badge is a cue, not an authority.",
      "Fail-open on an unknown identity shows an enabled Edit trigger to a non-admin when /me fails. The BFF rejects the write, so its error must be legible."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-11",
      "C-12",
      "C-13",
      "C-15",
      "C-16",
      "C-17",
      "C-18",
      "P-02",
      "P-03",
      "F-06",
      "F-07"
    ],
    "rationale": "The design is still not approvable: O-5 stays open and blocking, because the proposal's bound is wrong over time and one cost line is missing. There are no Floor breaches and no register violations, and the mechanism (D-1 to D-7) is undisputed.\n\n**What I checked at HEAD:**\n- `ingestRecentBars` takes `warmSnapshot()` (marketdata_service.go:1382-1383), then runs `GetBarsMulti` and a per-symbol `InsertBars` (:1425-1432). The adversary's missing line item is real.\n- The curated/muted/speculative cut is at servicer.py:5627-5639, and the speculative tail is sorted by `signal_axis` (:5637). The earlier :5614-5619 cite is stale.\n- `markWarm` is at :1171, and the only warm-set removal is asset_servability.go:153.\n- `classificationUniverse` reads `warmSnapshot()` (classification_service.go:82), and `FetchSector` stops on the cap (:199-200).\n- The `marketdata.ohlcv.out_of_memory_errors` counter and the lock-budget runbook both exist.\n\n**Objections:**\n- **O-8 is closed.** Its text asks for two items, the FMP accounting and the quote-upsert accounting, and the proposal supplies both with numbers. The adversary's reason for holding it open is the bar ingester, which is not in O-8's text. I recorded that as a new blocking objection instead.\n- **O-9 is closed.** The proposal records the linear fallback residual, and the adversary agrees.\n- **O-5 stays open and blocking.** The steer asked for one explicit bound. The bound offered is a snapshot, and the adversary's time-union correction is supported by the code. My approach states the corrected bound, so the next proposer and the operator have one to rule on.\n- **O-10, O-11 and O-12 stay open.** O-10 needs the time-union form and the corrected cites. O-11 and O-12 are only deferred to the spec.\n\n**Operator decisions:** the 2026-11-20 C-16 sign-off covers this feature's @AC-1 and @AC-2, so both are now marked covered.\n\n**Reopens:** none. P-1 stays pending with the operator. The proposer's \"not proposed\" is a recommendation, not a verdict.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The O-5 new-warm baseline is queue rows ranked 51 and lower, counted as rows with distinct symbols at most that many, because live enrichment covers only the returned page window and WatchlistDetail's page-1 read already enriches the top 50 rows today. The per-viewer snapshot term is max(0, Q_u − 50).",
          "evidence": "services/xstockstrat-analysis/app/handlers/servicer.py:4744-4749 (proposer cite, accepted by the adversary, to be re-verified at the step SHA); services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx:74"
        }
      ],
      "new_rejected": [],
      "new_objections": [
        {
          "text": "The O-5 cost list omits the bar ingester. ingestRecentBars takes the whole warmSnapshot() (marketdata_service.go:1382-1383). Each new warm symbol adds one symbol to GetBarsMulti and one InsertBars upsert into marketdata.ohlcv per 5-min cycle (:1425-1432), up to 288 per day, on the 2-connection pool. The spec must add it as a third line item, name marketdata.ohlcv.out_of_memory_errors{op=insert_bars} as a watch signal, and cite feature 291's dead-symbol hold as the mitigation.",
          "blocking": true
        },
        {
          "text": "The bound |W_new| ≤ 50 × V is a single-recompute snapshot. The warm set is only added to between restarts (marketdata_service.go:1171-1177; the only removal is the delisting prune at asset_servability.go:153), and the speculative tail is re-selected by signal_axis on every recompute (servicer.py:5637-5639). The spec must restate the bound as a union over time since the last restart, define V as distinct viewers since boot, and either give the servable signal-symbol universe as the ceiling or state that growth is unbounded between restarts.",
          "blocking": true
        },
        {
          "text": "The bound is pinned to opportunity.max_universe_size = 100, which is SetConfig-bounded to [1,1000]. The spec must write the per-viewer term as max_universe_size − 50 and add max_universe_size > 100 as a second tripwire next to marketdata.classification.enabled = true.",
          "blocking": false
        },
        {
          "text": "The servicer.py:5614-5619 cite (in D-7, O-10 and the round-4 proposal) is stale. The curated/muted/speculative cut is at servicer.py:5627-5639. The spec must re-cite at the step SHA.",
          "blocking": false
        },
        {
          "text": "The classification-flag and warm-set-growth residual must also be logged in services/xstockstrat-marketdata/docs/context-constitution-findings.md, and the spec must reference a follow-up feature for a marketdata warm-set TTL prune.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-8",
          "how": "Both requested items were added. (1) FMP: one FetchSector per new warm symbol per 24 h cycle, so |W_new|/250 of the shared daily cap (20% per 50 symbols), and 0 while marketdata.classification.enabled=false (classification_service.go:82,199-200). (2) Quote upserts: one sequential cacheQuote per symbol per 30 s (marketdata_service.go:1236-1252), about 780 rows per symbol per market day and about 48k retained per symbol over 90 days, on the 2-connection pool. The missing bar-ingester item is carried as a new blocking objection."
        },
        {
          "id": "O-9",
          "how": "The spec text records the residual: if the multi-quote call fails, the fallback makes one vendor call per warm symbol every 30 s, a cost linear in |W_new|. The adversary agreed it can close."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — sdd-batch design gate (round 5)

`/sdd-design fix-ui-gating-gaps` (full mode) stopped at its approval gate after round 5. The gate policy is halt, so design.md is not written and status.md is unchanged (spec-ready). The register is in `debate.md`: D-1..D-10, R-1..R-5, O-1..O-20 and P-1. The operator's ruling this run was "I accept the bound", which closes O-5.

## Open Threads

- **Approach (round-5 synthesis).** The mechanism is unchanged and rests on D-1..D-8: one UI-only PR in xstockstrat-ui, with no proto, migration or config change. With the O-5 bound accepted (D-9), no blocking objection remains.
  - **Unit 1, namespace-editor gate (D-1).** NamespaceEditor derives `editGate` (`'loading' | 'edit' | 'readonly'`) from `useIsAdmin()` and the `['auth-me']` userId, threaded through EditState like `isNativeEnv`. `loading` disables the trigger, `readonly` hides it and shows one CardNotice, and `edit` fails open when `/me` fails. `requireAdminScope` (`configUiBff.ts:39`) stays authoritative.
  - **Unit 2, membership drain (D-2..D-6).** `useQueueMembership()` on `['opportunities','membership']` uses `QUEUE_DEFAULT_FILTERS`, `pageSize` 1000 and `MAX_MEMBERSHIP_PAGES` = 3, returns a sorted, unique, upper-cased `string[]`, throws on `computing`/`computeFailed` with `retry: false`, is enabled only with bound rows, and polls every 15 s. WatchlistReadiness consumes it; WatchlistDetail's `useOpportunities()`, Set and `inQueue` prop are removed. The AC-2 Case A request count includes only requests with `page.pageSize == 1000`, inside the first 15 s.
  - **O-5 cost text the spec carries (operator-accepted; it replaces the "780 per market day" text everywhere).**
    - (a) Baseline (D-8): the drain replaces the page-1 read that already warms ranks 1 to 50, so new warm entries are at most the rows ranked 51 and lower.
    - (b) Per-recompute snapshot: max(0, Q_u − 50) per viewer, with Q_u ≤ max(`max_universe_size`, |curated_u| + |muted_only_u|); 50 at the default. The cut is at `servicer.py:5627-5639`.
    - (c) Bound over time, as accepted: |W_new| is a union since the last marketdata restart over every tail any viewer has drained. `markWarm` only adds; removals are the first-load unservable prune, the feature-352 delisting removal, or a restart. There is no structural bound below the servable signal-symbol universe until restart.
    - (d) Cost per newly warm symbol per calendar day, with both pollers running 24/7: the accepted total is |W_new| × (2,880 + 288) on marketdata's 2-connection pool.
      - Quote upserts: 2,880 statements per day. Retained rows are the distinct vendor quote timestamps, at most 2,880 × 90 (D-10, O-18).
      - Bar cycles: 288 per day. These are transactions of about 2 to 3 INSERTs each, so about 576 to 864 row upserts into `marketdata.ohlcv` (D-10, O-19). Feature 291's dead-symbol hold drops symbols that keep returning nothing.
      - FMP classification: 0 while `marketdata.classification.enabled=false`; when true, |W_new|/250 of the shared daily budget.
    - (e) Caveats: GetBarsMulti paginates past about 330 total warm symbols, the FMP 250/day cap is a tripwire, servability fails open before the first asset load, and the O-9 fallback makes one vendor call per warm symbol every 30 s when the multi-quote call fails.
    - (f) Tripwires, each requiring a re-check of the bound before the key changes: `marketdata.classification.enabled = true`, and `opportunity.max_universe_size` (namespace `analysis`) > 100. The spec uses that one key name everywhere (O-20).
    - (g) Watch signals on dev after deploy: `marketdata.db.pool.{acquired,empty_acquire_wait}` and `marketdata.ohlcv.out_of_memory_errors{op=insert_bars}`.
    - (h) Records: a row in `services/xstockstrat-marketdata/docs/context-constitution-findings.md`, and a referenced follow-up feature for a marketdata warm-set TTL prune, numbered at spec time and out of scope here.
    - (i) Cadence: D-2 stays at 15 s.
- **Strongest open objection: O-11 (non-blocking).** The spec must state payload bytes per 15 s poll. The proposal gives only rows × B_row, so B_row must be measured from a dev BFF JSON ListOpportunities body at spec time, and `/sdd-review impl-spec` checks for the figure.
- **Other open objections (non-blocking, all spec-text fixes).** O-18 (quote retention is a ceiling of 2,880 × 90 rows, not "about 259k"), O-19 (label the 288 as bar transactions with the 2 to 3 rows multiplier) and O-20 (one name for the tripwire key). None changes the accepted bound. O-5, O-10 and O-12 to O-17 closed this round.
- **Floor status.** No Floor breaches and no register violations.
- **@AC changes.** This feature's @AC-1 and @AC-2 are CHANGE and are covered by the recorded 2026-11-20 C-16 sign-off, so no @AC change is uncovered. The eleven prior-feature scenarios (@AC-10/11/12 @feature-219, @AC-2/3 @feature-181, @AC-2/3/5/7 @feature-187, @AC-1 @feature-213, @AC-15 @feature-215) are PRESERVE.
- **Reopen petitions.** None new. The synthesis treats P-1 (lower D-2's 15 s cadence) as declined, because the operator accepted the bound instead of reopening D-2. The P-1 row in `debate.md` still reads "pending user"; this run's register update did not include a verdict change for it.
- **Open risks.**
  - The accepted bound has no ceiling below the signal-symbol universe until marketdata restarts, and the bar upserts land on `marketdata.ohlcv`, which has a recorded lock-table exhaustion risk. The watch signals detect saturation after the fact; the two-key tripwire is the only in-scope lever.
  - Real statement volume is about 3,456 to 3,744 per symbol per day, 9 to 18% above the 3,168 headline, because the 288 are transactions. This is treated as a relabel and not a changed bound, and the operator should see it in the spec.
  - The about-330 pagination threshold and the O-9 fallback lines were not re-derived this round; the spec re-cites both at the step SHA.
  - The operator's words in this run cover only the O-5 bound. The C-16 sign-off for @AC-1 and @AC-2 rests on the earlier recorded decision.
  - B_row is unmeasured. Badges past 3,000 queue rows are silently dropped. Fail-open shows an enabled Edit trigger to a non-admin when `/me` fails, so the BFF's rejection must be legible.

```sdd-batch-design-state
{
  "round": 5,
  "synth": {
    "approach": "The mechanism is unchanged and rests on D-1 to D-8: one UI-only PR in services/xstockstrat-ui, with no proto, migration or config change. With the operator's acceptance of the O-5 bound, no blocking objection remains.\n\nUNIT 1: namespace-editor gate (D-1)\n- services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx derives editGate ('loading' | 'edit' | 'readonly') from useIsAdmin() and the ['auth-me'] userId (src/hooks/useLiveStrategies.ts:42-70).\n- The gate is threaded through EditState the same way isNativeEnv is (:38-60, 293-316; uses at :48, :144, :174, :303). COLUMNS stays at module scope (:193-195).\n- 'loading' disables the trigger. 'readonly' hides it and shows one CardNotice reading \"Admin only: read-only view\". 'edit' fails open when /me fails; requireAdminScope (src/lib/configUiBff.ts:39) stays authoritative.\n\nUNIT 2: membership drain (D-2 to D-6; cadence stays 15 s)\n- useQueueMembership() goes in src/hooks/useOpportunities.ts under the key ['opportunities','membership'].\n- It uses QUEUE_DEFAULT_FILTERS (hoisted from :26-29), pageSize 1000 and MAX_MEMBERSHIP_PAGES = 3, and returns a sorted, unique, upper-cased string[].\n- It throws on computing/computeFailed with retry: false, and is enabled only when the watchlist has at least one bound row.\n- WatchlistReadiness consumes it. src/components/insights/WatchlistDetail.tsx drops useOpportunities() (:74), the Set (:93-95) and the inQueue prop (:369).\n- AC-2 tests follow D-5. The Case A request count includes only requests whose JSON body has page.pageSize == 1000 (src/lib/browserClients/transport.ts:57), in a window that ends before the first 15 s refetch.\n\nO-5 COST TEXT THE SPEC CARRIES (operator-accepted; replaces the \"780 per market day\" text everywhere)\n\n(a) Baseline (D-8). Enrichment covers only the returned window (services/xstockstrat-analysis/app/handlers/servicer.py:4744-4749). The page-1 read at WatchlistDetail.tsx:74 already warms ranks 1 to 50, and the drain replaces that read. New warm entries are therefore at most the rows ranked 51 and lower. This is a row count; new distinct symbols are at most that many, minus symbols already warm under D-7.\n\n(b) Per-recompute snapshot. Per viewer u the term is max(0, Q_u − 50), where Q_u ≤ max(max_universe_size, |curated_u| + |muted_only_u|). The cut is at servicer.py:5627-5639 and the speculative tail is sorted by signal_axis at :5637. At the default the term is max_universe_size − 50 = 50.\n\n(c) Bound over time, as accepted. |W_new| is a union since the last marketdata restart over every tail any viewer has drained, with V meaning distinct viewers since boot.\n- markWarm only adds (services/xstockstrat-marketdata/internal/service/marketdata_service.go:1171-1177).\n- Removals are the first-load unservable prune, the feature-352 flagged-delisting removal, or a restart.\n- The ceiling is the servable symbols that, since boot, carried an active signal for, or were curated or muted by, any watchlist viewer. There is no structural bound below that universe until restart.\n\n(d) Cost per newly warm symbol per calendar day. Both pollers run 24/7 (marketdata_service.go:1194-1231, 1306-1332). The accepted total is |W_new| × (2,880 + 288), on marketdata's 2-connection PgBouncer client pool.\n1. Quote upserts: 2,880 statements per day, one sequential cacheQuote per 30 s cycle (:1246-1252). InsertQuote is ON CONFLICT (symbol, time) DO UPDATE (internal/repository/marketdata_repo.go:299-304), so retained rows are the distinct vendor quote timestamps, at most 2,880 × 90. The proposal's \"about 259k rows per symbol\" is a ceiling, not an estimate.\n2. Bar cycles: 288 per day. Each 5-min cycle adds one symbol to GetBarsMulti and, when bars come back, one InsertBars call (:1382-1383, 1425-1432). InsertBars is one transaction with one INSERT per bar (marketdata_repo.go:77-111), about 2 to 3 daily bars per cycle. So 288 counts transactions, about 576 to 864 row upserts into marketdata.ohlcv. Feature 291's dead-symbol hold (internal/service/bar_hold.go:47-77) drops symbols that keep returning nothing.\n3. FMP classification: 0 while marketdata.classification.enabled=false. When true, one FetchSector per symbol per 24 h against the shared 250/day cap (classification_service.go:82, 199-200), which is |W_new|/250 of the budget.\nThe figures scale linearly with stream.warm_interval_ms and stream.bar_ingest_interval_ms, and each extra bar-ingest timeframe adds another 288.\n\n(e) Caveats, as listed in the ruling.\n- GetBarsMulti paginates once the warm set passes about 330 symbols in total (limit 1000 bars at about 3 per symbol; internal/alpaca/client.go:672-674, 708-711).\n- The FMP 250/day cap is a tripwire.\n- GetSymbolServability fails open before the first asset load, so unservable symbols can warm in that window.\n- O-9 residual: if the multi-quote call fails, the fallback makes one vendor call per warm symbol every 30 s. Re-cite at the step SHA.\n\n(f) Tripwires. Re-check the bound before changing either key:\n- marketdata.classification.enabled = true;\n- opportunity.max_universe_size (namespace analysis) > 100. It is SetConfig-bounded to [1,1000], and at 1000 the per-viewer term is about 950. Use this one key name everywhere in the spec.\n\n(g) Watch signals, checked on dev after deploy: marketdata.db.pool.{acquired,empty_acquire_wait} and marketdata.ohlcv.out_of_memory_errors{op=insert_bars} (docs/runbooks/ohlcv-lock-budget-tuning.md).\n\n(h) Records and follow-up.\n- Add a row to services/xstockstrat-marketdata/docs/context-constitution-findings.md covering warm-set growth and the classification-flag exposure.\n- Reference a follow-up feature for a marketdata warm-set TTL prune, numbered by scripts/sdd-allocate-feature-number.py at spec time. It is out of scope here.\n\n(i) Cadence. D-2 stays at 15 s; P-1 is declined.\n\nPAYLOAD (O-11, still open)\n- Bytes per poll are rows × B_row, with rows ≤ max(max_universe_size, |curated| + |muted_only|) against 50 or fewer today.\n- B_row must be measured at spec time from a dev BFF JSON ListOpportunities body. /sdd-review impl-spec checks that the spec carries the measured figure.",
    "open_objections": [
      {
        "text": "O-11 (still open): the spec must state payload bytes per 15 s poll. The proposal gives only the formula rows × B_row and defers the number. It closes when the spec carries B_row measured from a dev BFF JSON body, checked at /sdd-review impl-spec.",
        "blocking": false
      },
      {
        "text": "The quote-retention figure in (d)1 is wrong as an estimate. InsertQuote upserts on (symbol, time) (marketdata_repo.go:299-304), so repeated polls of an unchanged quote update one row. The spec must keep \"2,880 upsert statements per day\" and replace \"about 259k rows per symbol\" with \"at most 2,880 × 90 rows; in practice the distinct vendor quote timestamps\".",
        "blocking": false
      },
      {
        "text": "The \"288\" in the accepted total counts bar transactions, not statements. InsertBars runs one INSERT per bar inside one transaction (marketdata_repo.go:77-111), about 2 to 3 daily bars per cycle, so about 576 to 864 row upserts per symbol per day. The spec must keep the accepted 2,880 + 288 figures and label the 288 as transactions with that multiplier, so the ohlcv lock-budget reading is not understated.",
        "blocking": false
      },
      {
        "text": "The tripwire key is named two ways: opportunity.max_universe_size in (f) and analysis.opportunity.max_universe_size in Touchpoints. The spec must use the namespace-relative opportunity.max_universe_size (namespace analysis) in both places.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 (feature 325, non-admin cannot see/use namespace edit action)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2 (feature 325, watchlist in-queue badge reflects full queue, not page 1)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-10 @feature-219",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-11 @feature-219",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-12 @feature-219",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-181",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-181",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @feature-187",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-213",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-15 @feature-215",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "P-1: lowering the membership cadence to 60 s, or to refocus plus invalidation only. The operator accepted the O-5 bound instead, and by D-7 cadence moves none of the warm-set, quote, bar or FMP figures. D-2 stays at 15 s.",
      "A marketdata-side warm-set TTL prune inside this PR. It is the structural fix, but it puts a cross-service change into a SEV-3 UI-only fix. The spec references it as a follow-up feature.",
      "Restating the accepted bar cost in rows instead of cycles. It is the more useful number for lock budgeting, but it would change the figures the operator accepted. The spec keeps 288 and adds the 2 to 3 rows-per-transaction multiplier.",
      "Suppressing read-time enrichment for membership reads. It would remove the new warm entries but needs a proto/analysis request flag, which locked R-3 rules out."
    ],
    "open_risks": [
      "The accepted bound has no ceiling below the servable signal-symbol universe until marketdata restarts. Each extra warm symbol adds 2,880 quote upserts and 288 bar transactions per day on a 2-connection pool.",
      "The accepted total was worded as \"write statements\", but the 288 bar cycles are transactions of about 2 to 3 INSERTs each. Real statement volume is about 3,456 to 3,744 per symbol per day, 9 to 18% above the 3,168 headline. The ruling's own wording (\"288 bar cycles\") is accurate, so I treated this as a label fix and not a changed bound; the operator should see the relabel in the spec.",
      "The bar upserts land on marketdata.ohlcv, which has a recorded lock-table exhaustion risk. The pool gauges and out_of_memory_errors{op=insert_bars} detect saturation after the fact; they do not prevent it. The only in-scope lever is the two-key tripwire.",
      "Two live-tunable keys can break the bound: marketdata.classification.enabled = true spends the shared FMP 250/day budget, and opportunity.max_universe_size toward 1000 lifts the per-viewer term to about 950. The UI has no guard for either.",
      "The about-330 GetBarsMulti pagination threshold and the O-9 fallback lines were not re-derived this round. The spec must re-cite both at the step SHA.",
      "The C-16 sign-off for @AC-1 and @AC-2 is taken from the recorded-decisions block and context.md; the user's relayed words in this run cover only the O-5 bound.",
      "B_row for the payload figure is unmeasured, so the per-poll byte cost is still unknown.",
      "If the queue exceeds 3,000 rows, badges past the cap are silently dropped. The badge is a cue, not an authority.",
      "Fail-open on an unknown identity shows an enabled Edit trigger to a non-admin when /me fails. The BFF rejects the write, so its error must be legible."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-11",
      "C-12",
      "C-13",
      "C-15",
      "C-16",
      "C-17",
      "C-18",
      "P-02",
      "P-03",
      "F-06",
      "F-07"
    ],
    "rationale": "The design is approvable: there are no Floor breaches, no register violations, and no blocking objection remains after the operator accepted the O-5 bound. Four non-blocking spec-text items stay open.\n\n**What I checked at HEAD:**\n- `InsertBars` opens one transaction and runs one `INSERT … ON CONFLICT` per bar (`marketdata_repo.go:77-111`). The adversary's point that 288 counts transactions is correct.\n- `InsertQuote` is `ON CONFLICT (symbol, time) DO UPDATE` (`marketdata_repo.go:299-304`). The \"about 259k rows\" figure is a ceiling, not an estimate.\n- `minIngestLookback` exists (`marketdata_service.go:1372`), which supports the 2 to 3 bars-per-cycle multiplier.\n- I did not re-check the 24/7 tickers, the `servicer.py:5627-5639` cut or `bar_hold.go`; the adversary reports verifying all three.\n\n**Objections closed this round:**\n- **O-5** closes on the operator's acceptance (\"I accept the bound\") of |W_new| × (2,880 + 288) per calendar day, as a union since restart, with the listed caveats.\n- **O-13** closes: the bar-ingester line, the watch signal and the feature-291 hold are in the text.\n- **O-14** closes: the bound is a time union, V is distinct viewers since boot, and the ceiling is stated as unbounded below the signal-symbol universe until restart.\n- **O-10, O-15, O-16, O-17** close: the restatement, the `max_universe_size − 50` term with its tripwire, the corrected cite, and the findings row plus follow-up are all carried.\n- **O-12** closes: the request count is filtered on `page.pageSize == 1000` inside the first 15 s.\n\n**Still open, non-blocking:**\n- **O-11** stays open. The proposal defers the measured `B_row` to spec time, so it closes at impl-spec review.\n- Three new text fixes from the adversary: the quote-retention wording, the bar-transaction label, and one name for the tripwire key. None changes the accepted bound.\n\n**Petitions:** P-1 is declined. The operator accepted the bound instead of reopening D-2, so the cadence stays at 15 s. No new petitions were filed and nothing is reopened.\n\n**@AC coverage:** this feature's @AC-1 and @AC-2 are marked covered on the recorded 2026-11-20 C-16 sign-off (context.md:507). The eleven prior-feature scenarios are PRESERVE.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The O-5 warm-set cost is accepted by the operator at |W_new| × (2,880 + 288) per calendar day: 2,880 quote upsert statements and 288 bar cycles per newly warm symbol, with both pollers running 24/7. |W_new| is a union since the last marketdata restart, with no structural bound below the servable signal-symbol universe. Caveats: GetBarsMulti paginates past about 330 total warm symbols, the FMP 250/day tripwire, fail-open before the first asset load, and the O-9 residual re-cited at the step SHA. The spec carries these figures, not the earlier 780-per-market-day text, and D-2's 15 s cadence stands.",
          "evidence": "Operator ruling 2026-11-20 ('I accept the bound'); services/xstockstrat-marketdata/internal/service/marketdata_service.go:1194-1231,1306-1332 (no market-hours gate), :1246-1252, :1382-1383, :1425-1432; services/xstockstrat-analysis/app/handlers/servicer.py:5627-5639"
        },
        {
          "text": "The spec labels the accepted 288 as bar transactions, each about 2 to 3 row upserts into marketdata.ohlcv, and states quote retention as at most 2,880 × 90 rows, in practice the distinct vendor quote timestamps. Neither label changes the accepted figures.",
          "evidence": "services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:77-111 (one tx, one INSERT per bar), :299-304 (ON CONFLICT (symbol, time) DO UPDATE); marketdata_service.go:1372 (minIngestLookback)"
        }
      ],
      "new_rejected": [],
      "new_objections": [
        {
          "text": "The quote-retention figure in the O-5 cost text is wrong as an estimate. InsertQuote upserts on (symbol, time) (marketdata_repo.go:299-304). The spec must keep \"2,880 upsert statements per day\" and replace \"about 259k rows per symbol\" with \"at most 2,880 × 90 rows; in practice the distinct vendor quote timestamps\".",
          "blocking": false
        },
        {
          "text": "The \"288\" in the accepted total counts bar transactions, not statements. InsertBars runs one INSERT per bar in one transaction (marketdata_repo.go:77-111), about 2 to 3 bars per cycle, so about 576 to 864 row upserts per symbol per day. The spec must keep the accepted figures and label the 288 as transactions with that multiplier.",
          "blocking": false
        },
        {
          "text": "The tripwire key is named two ways in the proposal. The spec must use the namespace-relative opportunity.max_universe_size (namespace analysis) everywhere.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-5",
          "how": "Operator accepted the bound on 2026-11-20 ('I accept the bound'): |W_new| × (2,880 + 288) per calendar day (2,880 quote upserts and 288 bar cycles per newly warm symbol, pollers 24/7), a union since the last marketdata restart, with the listed caveats. P-1 is declined and D-2 stays at 15 s."
        },
        {
          "id": "O-10",
          "how": "The bound is restated as a per-viewer snapshot max(0, Q_u − 50) with Q_u ≤ max(max_universe_size, |curated_u| + |muted_only_u|), a union across viewers and over time since restart, citing the cut at servicer.py:5627-5639."
        },
        {
          "id": "O-12",
          "how": "The Case A count includes only requests whose JSON body has page.pageSize == 1000 (transport.ts:57), in a window that ends before the first 15 s refetch."
        },
        {
          "id": "O-13",
          "how": "The bar ingester is the third cost line: 288 cycles per symbol per day, each adding one symbol to GetBarsMulti and one InsertBars call (marketdata_service.go:1382-1383, 1425-1432). marketdata.ohlcv.out_of_memory_errors{op=insert_bars} is named as a watch signal and feature 291's dead-symbol hold (bar_hold.go:47-77) as the mitigation."
        },
        {
          "id": "O-14",
          "how": "The bound is a union since the last marketdata restart, V is distinct viewers since boot, and the ceiling is the servable signal-symbol universe, with no structural bound below it until restart. The removal paths are the first-load prune and the feature-352 delisting removal."
        },
        {
          "id": "O-15",
          "how": "The per-viewer term is written as max_universe_size − 50, and opportunity.max_universe_size > 100 is a second tripwire next to marketdata.classification.enabled = true."
        },
        {
          "id": "O-16",
          "how": "Re-cited to servicer.py:5627-5639 (max_universe at :5629, signal_axis sort at :5637, cut at :5639), verified by the adversary at HEAD. The spec re-cites at the step SHA."
        },
        {
          "id": "O-17",
          "how": "The spec adds a row to services/xstockstrat-marketdata/docs/context-constitution-findings.md for warm-set growth and the classification-flag exposure, and references a follow-up feature for a marketdata warm-set TTL prune."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-ui; key reuse patterns: `useIsAdmin()` threaded through `EditState` like `isNativeEnv`, and the `useOpportunities` request params hoisted as `QUEUE_DEFAULT_FILTERS`).
- Phase 1 Grilling: 5 rounds (full). Chosen approach: one UI-only PR with a three-state namespace-editor gate (D-1) and a bounded queue-membership drain under `['opportunities','membership']` (D-2 to D-6), carrying the operator-accepted O-5 cost text (D-7 to D-10). Rejected: R-1 to R-5 (per-symbol fan-out, fail-closed gate, proto/analysis-side fixes, 50-row paging, storing Opportunity objects).
- Constitution rules touched: C-01, C-11, C-12, C-13, C-15, C-16, C-17, C-18, P-02, P-03, F-06, F-07. Floor breaches: none.
- Status: spec-ready → design-approved.
- Operator rulings recorded 2026-11-20:
  - C-16 sign-off for this feature's @AC-1 and @AC-2 (both CHANGE).
  - The O-5 warm-set cost is accepted ("I accept the bound") at |W_new| × (2,880 + 288) write statements per calendar day, a union since the last marketdata restart, with the round-5 caveats. O-5 is closed and P-1 is declined, so D-2's 15 s cadence stands.
  - Design approved after round 5 under the operator's standing authorisation of the same day. The round-5 adversary verdict was SOUND, with no Floor breach and no blocking objection.
- The adversary's two accuracy corrections bind the spec and do not change the accepted bound: retained quote rows are at most 2,880 × 90 per symbol, in practice the distinct vendor quote timestamps; and the 288 counts bar-cycle transactions, not statements.
- debate.md: State approved, P-1 verdict "user declined". No new rows. O-11, O-18, O-19 and O-20 stay open and non-blocking.
- Wrote design.md. Next: `/sdd-spec fix-ui-gating-gaps`.

## Open Threads

- [ ] O-11: measure B_row from a dev BFF JSON `ListOpportunities` body and state bytes per 15 s poll. Target: `/sdd-spec`, checked at `/sdd-review impl-spec`.
- [ ] O-18: spec keeps "2,880 upsert statements per day" and states quote retention as "at most 2,880 × 90 rows; in practice the distinct vendor quote timestamps". Target: `/sdd-spec`.
- [ ] O-19: spec keeps 2,880 + 288 and labels the 288 as bar transactions of about 2 to 3 row upserts each (about 3,456 to 3,744 statements per symbol per day, 9 to 18% above the 3,168 headline). The operator should see the relabel. Target: `/sdd-spec`, checked at `/sdd-review impl-spec`.
- [ ] O-20: one tripwire key name everywhere, `opportunity.max_universe_size` (namespace `analysis`). Target: `/sdd-spec`.
- [ ] Warm-set growth has no ceiling below the servable signal-symbol universe until marketdata restarts. Target: spec carries the cost text, adds the row to `services/xstockstrat-marketdata/docs/context-constitution-findings.md` and references a follow-up warm-set TTL-prune feature (numbered by the allocator at spec time).
- [ ] Bar upserts land on `marketdata.ohlcv`, which has a recorded lock-table exhaustion risk. The pool gauges and `out_of_memory_errors{op=insert_bars}` only detect saturation. Target: post-deploy dev verification step.
- [ ] Two live-tunable keys can break the bound: `marketdata.classification.enabled = true` and `opportunity.max_universe_size` > 100. The UI has no guard. Target: tripwire text in the spec and the marketdata findings row.
- [ ] The about-330 `GetBarsMulti` pagination threshold and the O-9 fallback lines were not re-derived in round 5. Target: re-cite at the step SHA in `/sdd-spec`.
- [ ] The C-16 sign-off for @AC-1 and @AC-2 rests on the recorded ruling. The operator's relayed words cover only the O-5 bound. Target: confirm at the `/sdd-spec` gate if the operator wants it restated.
- [ ] Badges past 3,000 queue rows are silently dropped. The badge is a cue, not an authority. Target: hook step.
- [ ] Fail-open shows an enabled Edit trigger to a non-admin when `/me` fails, so the BFF's rejection must be legible. Target: Unit 1 e2e step.

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 5 steps. Status: design-approved → implementation-ready.
- Step shape: Steps 1+2 (test + service, namespace-editor gate) and Steps 3+4 (test + service, queue-membership drain) are atomic units (`**Lands with**`); Step 5 is docs (findings rows). `@AC-1` → Step 1, `@AC-2` → Step 3.
- Operator rulings recorded 2026-11-20 and applied: C-16 sign-off for `@AC-1` and `@AC-2`; the O-5 bound accepted at |W_new| × (2,880 + 288) per calendar day ("I accept the bound"), P-1 declined; design approved after round 5. The spec carries the two binding accuracy corrections (quote retention at most 2,880 × 90 rows; the 288 are bar-cycle transactions).
- Tree: evidence read on `origin/main-dev@fb52065c` (detached). The feature branch (`20742720`) is 168 commits behind `main-dev`. This run did not merge `main-dev` into it, because the run may write only this feature directory; `/sdd-execute` BRANCH SYNC does the merge.
- Assumptions made in this run:
  - The task named the directory `docs/roadmap/features/docs/roadmap/features/325-fix-ui-gating-gaps/`; the real directory `docs/roadmap/features/325-fix-ui-gating-gaps/` was used (the doubled prefix does not exist).
  - design.md build-order items 2 and 3 (hoist + hook, then consumer swap) are one `service` step, because they must commit together anyway and one step is the smallest unit.
  - The post-deploy dev checks are a spec section, not a numbered step, because an execute step must verify in-tree (F-05).
- Key codebase findings:
  - Line drift since recon: `WatchlistDetail.tsx` `useOpportunities()` is at `:72`, the Set at `:91-93`, the prop at `:367`; `WatchlistReadiness.tsx` `queued` is at `:329`, the badge at `:376-378`. `WatchlistReadiness` has one caller and `inQueue` is in no test.
  - Every spec that drives the namespace editor's Edit already uses `addAdminCookie`; no spec mocks `/api/auth/me` today.
  - The shared `e2e/mock-backend.ts` `listOpportunities` returns the whole fixture in one page with no token, so the existing in-queue cases in `watchlists.spec.ts` (`:84`, `:448-465`) keep passing under the drain.
  - `GetBarsMulti`'s limit is `barsLimit()` = `marketdata.backfill.batch_size` (default 1000, cap 10,000; `alpaca/client.go:413-418`, `cmd/server/main.go:93`), not a literal 1000. The about-330 threshold holds at the default. O-9 fallback re-cited at `marketdata_service.go:1246-1259` and `:1262-1280`. The analysis cites stand (`servicer.py:4688`, `:4744-4749`, `:4792`, `:5627-5639`).
- Staging observation (2026-11-20, one account, via the agent `list_opportunities` tool with `page_size` 1000): 487 queue rows over 396 symbols with `opportunity.max_universe_size = 100`. The per-viewer snapshot term is 437 rows, not the design's worked "50". About 188 symbols are the |W_new| estimate for that one viewer (595,584 headline writes per day). B_row ≈ 921 bytes, so about 448 KB per 15 s poll against about 46 KB today.
- Side effect of that read: it ran the full-window enrichment once, so it may have warmed up to those symbols on staging marketdata until its next restart.

## Open Threads

- [ ] **For the operator.** The accepted bound's formula is unchanged, but the staging account above puts one viewer at about 188 newly warm symbols and a 10× payload. Confirm the ruling still stands at those figures before `/sdd-execute`, or reopen P-1.
- [ ] O-11: B_row is estimated from the agent's JSON, not a dev BFF body. Target: implementation-spec.md § Post-Deploy Verification item 3.
- [ ] Follow-up feature `marketdata-warm-set-ttl-prune` has no number. This run could not run the allocator (it pushes `sdd/feature-cursor`). Target: `/sdd-story marketdata-warm-set-ttl-prune`.
- [ ] Out of scope, proposed only: `NamespaceEditor.tsx:345-353` tells a per-user-scope viewer they are "Editing your own per-user overrides … self-service", while `SetConfig` is admin-only at the BFF. After Step 2 a non-admin sees that text beside "Admin only: read-only view". Target: a defect report via `/sdd-qa defect`.
- [ ] Bar upserts land on `marketdata.ohlcv` (lock-table risk); the watch signals only detect saturation. Target: § Post-Deploy Verification item 4.
- [ ] Two live-tunable keys can break the bound (`marketdata.classification.enabled`, `opportunity.max_universe_size`). Target: Step 5 findings row and § Post-Deploy Verification item 5.
- [x] O-18, O-19, O-20: carried in implementation-spec.md § Accepted Cost (d) and (f).
- [x] The about-330 threshold and the O-9 lines: re-cited in § Accepted Cost (e).
- [x] C-16 sign-off for `@AC-1` and `@AC-2`: restated by the operator ruling of 2026-11-20.
- [x] Badges past 3,000 queue rows: Step 4 instruction 2. Fail-open legibility: Step 1 case 1d.
