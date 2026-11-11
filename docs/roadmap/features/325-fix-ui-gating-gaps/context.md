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
