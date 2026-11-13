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
