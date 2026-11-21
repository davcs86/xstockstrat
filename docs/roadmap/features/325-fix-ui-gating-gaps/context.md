> Distilled 2026-11-21 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).

# Context Log: fix-ui-gating-gaps

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries. (/sdd-distill is the sanctioned exception for compaction.)

---

## Decisions

- **Scope (triage 2026-11-10).** Two SEV-3 xstockstrat-ui client display gaps, one UI PR, Track C (SDD path), branch `feature/fix-ui-gating-gaps`. Defect reports: `docs/reports/2026-10-19-ui-namespace-editor-non-admin-edit-defect.md` (Config-UI namespace editor shows Edit/Save to non-admins) and `docs/reports/2026-10-19-ui-watchlist-inqueue-first-page-only-defect.md` (watchlist "in queue" flag sees only the first loaded opportunity page). Root-cause hypothesis: missing UI admin gate (074/119/120); the feature-215 filter fix was never applied to the watchlist consumer. Product spec approved 2026-11-10 (spec-ready) with bug-template warnings only (no FR-N/@FR tags, no Consumer Surface section); overlap none.
- **Operator rulings, 2026-11-20 (verbatim, binding).**
  - C-16 sign-off for this feature's @AC-1 and @AC-2 (both CHANGE).
  - The O-5 warm-set cost is accepted ("I accept the bound") at |W_new| × (2,880 + 288) write statements per calendar day, a union since the last marketdata restart, with the round-5 caveats. O-5 is closed and P-1 is declined, so D-2's 15 s cadence stands.
  - Design approved after round 5 under the operator's standing authorisation of the same day. The round-5 adversary verdict was SOUND, with no Floor breach and no blocking objection.
  - The adversary's two accuracy corrections bind the spec and do not change the accepted bound: retained quote rows are at most 2,880 × 90 per symbol, in practice the distinct vendor quote timestamps; and the 288 counts bar-cycle transactions, not statements.
- **Petition P-1 (filed round 2, target D-2): declined by the operator.** Ask was to lower the 15 s membership `refetchInterval` to 60 s or none (refocus plus invalidation), on evidence that `BatchGetLatestPrice` → `markWarmIfServable` (`marketdata_service.go:932`; `asset_servability.go:81-90`) permanently warms every queued symbol into a global, unpruned set. The operator accepted the bound instead. By D-7, cadence moves none of the warm-set, quote, bar or FMP figures (it lowers only the BatchGetLatestPrice and payload rates). debate.md P-1 verdict: "user declined".
- **Design (approved; register in `debate.md`, full text in `design.md`): one UI-only PR in services/xstockstrat-ui, no proto/migration/config change, two independent units.**
  - **D-1 Unit 1, namespace-editor gate.** NamespaceEditor derives `editGate` (`loading`|`edit`|`readonly`) from `useIsAdmin()`/`useCurrentUserId()` on the shared `['auth-me']` query (`useLiveStrategies.ts:42-70`), threaded through EditState/EditContext like `isNativeEnv`; `COLUMNS` stays module-scope. `loading` disables the `actions-<key>` trigger; settled non-admin hides it and shows one CardNotice "Admin only: read-only view"; admin or settled-null userId (/me failed) is editable (fail-open; BFF `requireAdminScope`, `configUiBff.ts:39`, stays authoritative). The Edit item (`:164`) is the only SetConfig entry point.
  - **D-2 Unit 2, membership drain** `useQueueMembership()` in `useOpportunities.ts`, key `['opportunities','membership']` (infinite-query keys have a number at index 1, so no collision; the `['opportunities']` prefix invalidation after Take/Dismiss/Snooze reaches it), `refetchInterval` 15 s, WatchlistReadiness consumes it; WatchlistDetail's `useOpportunities()`, Set and `inQueue` prop are removed.
  - **D-3** `pageSize` 1000 (`MEMBERSHIP_PAGE_SIZE`, mirrors the `analysis.opportunity.max_universe_size` [1,1000] bound; server does not clamp page_size and reads every row before slicing, `servicer.py:4659,4715-4717`); follow `nextPageToken` up to `MAX_MEMBERSHIP_PAGES` = 3 (held/watchlist/muted rows exceed the universe cut); sorted unique upper-cased `string[]`; throws on `computing`/`computeFailed` with `retry: false` (keeps previous data); `enabled` only when the watchlist has bound rows.
  - **D-4** params from one exported `QUEUE_DEFAULT_FILTERS ... as const` hoisted from `useOpportunities.ts:26-29`; the Opportunities page's UI-token state (`page.tsx:97-100`) is deliberately not coupled (badge means "in your default, unfiltered queue").
  - **D-5 AC-2 tests.** Case A (primary RED): per-test `page.route` honouring `pageSize` and an integer-offset token, 70-row queue, X at index 60 (buggy pageSize 50 misses X, fixed 1000 finds it); request count filters on `page.pageSize == 1000` (`transport.ts:57`, JSON) in a window ending before the first 15 s refetch (O-12). Case B: X beyond row 1000 (pager + cap). Recompute-dependent assertions use an in-place refetch, not `reload()` (fails.md 2026-08-25). Unit 1 RED e2e: non-admin, and admin whose /me 5xx.
  - **D-6** RPC delta: ListOpportunities goes 1 → 2 per poll only while the Copilot rail is toggled on (`CopilotRail.tsx:101`, `PlatformHeader.tsx:184`); otherwise 1.
  - **D-7** warm-set growth is cadence-independent (idempotent set insert); held symbols and strategy-attributed candidates are already warm; newly warm = unattributed speculative, muted non-held, curated unattributed non-held rows; bound is a union across users (`marketdata_service.go:53,637-642,815`; `servicer.py:5658-5660,5679-5691`).
  - **D-8** new-warm baseline = queue rows ranked 51+ (enrichment covers only the returned window, `servicer.py:4744-4749`; page-1 read already warms top 50); per-viewer term max(0, Q_u − 50), Q_u ≤ max(`opportunity.max_universe_size`, |curated_u| + |muted_only_u|), cut at `servicer.py:5627-5639`.
  - **D-9** accepted bound as ruled above; caveats: GetBarsMulti paginates past ~330 total warm symbols, FMP 250/day cap tripwire, servability fails open before first asset load, O-9 fallback (multi-quote failure → one vendor call per warm symbol every 30 s). Tripwires (re-check the bound before changing): `marketdata.classification.enabled = true`, `opportunity.max_universe_size` (namespace `analysis`) > 100 (SetConfig-bounded [1,1000]; ~950 per-viewer at 1000). Watch signals on dev after deploy: `marketdata.db.pool.{acquired,empty_acquire_wait}`, `marketdata.ohlcv.out_of_memory_errors{op=insert_bars}`. Records: marketdata `docs/context-constitution-findings.md` row + follow-up feature for a marketdata warm-set TTL prune (structural fix, out of scope).
  - **D-10** label the 288 as bar transactions (~2-3 row upserts each into `marketdata.ohlcv`; real volume ~3,456-3,744 statements/symbol/day, 9-18% above the 3,168 headline); quote retention "at most 2,880 × 90 rows, in practice distinct vendor quote timestamps". The figures the operator accepted are not changed.
- **Rejected (locked).** R-1 per-symbol `ListOpportunities{symbol}` fan-out (empty reads hit `kick_full`, `servicer.py:4762-4764`; reintroduces feature-181 fan-out). R-2 fail-closed `isAdmin && !adminLoading` (a transient /me non-ok = isAdmin false for 5 min, blocks real admins; regresses @AC-10/11/12 @feature-219). R-3 proto/analysis-side fixes (in_queue on WatchlistReadinessRow, multi-symbol filter, suppress kick, skip-enrichment flag for membership reads) — scope escalation / Signal-detail @AC-15 @feature-215. R-4 draining in pages of 50 with ~20-page cap (N full DB reads per poll, multi-page race). R-5 storing Opportunity objects (normy rewrites objects with `strategyId`, `queryClient.ts:5-11`). Also not adopted: P-1; a marketdata warm-set TTL prune inside this PR (cross-service change in a SEV-3 UI fix; follow-up feature instead); restating the 288 in rows (would change accepted figures); the bound as the snapshot |W_new| ≤ 50 × V (understates growth over uptime); an unfiltered "exactly one request" assertion in Case A (flaky); coupling page useState to `QUEUE_DEFAULT_FILTERS` (needs a mapping layer).
- **@AC status.** CHANGE: @AC-1, @AC-2 of this feature (covered by the C-16 sign-off). PRESERVE: @AC-10/11/12 @feature-219, @AC-2/3 @feature-181, @AC-2/3/5/7 @feature-187, @AC-1 @feature-213, @AC-15 @feature-215. Constitution touched: C-01, C-11, C-12, C-13, C-15, C-16, C-17, C-18, P-02, P-03, F-06, F-07; no Floor breach.
- **Spec shape (implementation-spec.md, 5 steps, status implementation-ready):** Steps 1+2 (test + service, namespace gate) and 3+4 (test + service, membership drain) are atomic `Lands with` units; Step 5 is docs (findings rows). @AC-1 → Step 1, @AC-2 → Step 3. Post-deploy dev checks are a spec section (§ Post-Deploy Verification), not a step (F-05). Evidence anchors are from `origin/main-dev@fb52065c`; the feature branch was 168 commits behind, `/sdd-execute` BRANCH SYNC merges `main-dev` and re-checks anchors (P-03).
- **Risks carried (beyond those in the last fence).** With `marketdata.classification.enabled` on, unattributed/muted/curated-non-held growth can consume a meaningful share of the shared FMP 250/day budget (shared with feature-217 sector, fundamentals snapshots and the ETF-flag filler, which stops at 80%; random map order changes which symbols miss refresh each cycle); ~250 new warm symbols would spend the whole day budget. A 1000-symbol BatchGetLatestPrice never shares a singleflight with the page-1 call, so whole-queue GetPreviousDailyCloseBatch competes with interactive reads. Payload carries the whole queue every 15 s though only symbols are used. Unverified (re-check at the step SHA): `BatchGetLatestPrice` has no small symbol-count cap (only the empty-list guard was seen, `marketdata_service.go:929`). Peer feature `fix-live-enrich-ttl-seed` may change the live-quote memo seed/TTL (affects only enrichment call rate; the drain treats the memo as cold). Pool impact of extra quote/bar upserts is unmeasured. Queue > 3,000 rows silently drops badges past the cap (a cue, not an authority). Fail-open shows an enabled Edit trigger to a non-admin when /me fails; the BFF rejection must be legible.

## Open Threads

- [ ] **For the operator.** Confirm the O-5 ruling at the staging figures (437 rows per viewer, about 188 newly warm symbols, about 595,584 headline writes per day, real statement volume 9-18% higher, 10× payload) before `/sdd-execute`, or reopen P-1. There is no code guard on warm-set growth.
- [ ] **For the operator.** The spec run's staging read with `page_size` 1000 was not requested; it may have warmed up to 396 symbols on staging marketdata until its next restart.
- [ ] O-11: measure B_row/BFF body on dev (§ Post-Deploy Verification item 3); the ~448 KB per 15 s poll (vs ~46 KB today) is an estimate from agent JSON.
- [ ] Reserve a number for `marketdata-warm-set-ttl-prune` via `/sdd-story`.
- [ ] `/sdd-execute` BRANCH SYNC: merge `main-dev` (168 commits) and re-check every `path:line` anchor before Step 1.
- [ ] Bar upserts land on `marketdata.ohlcv` (lock-table risk); watch signals only detect saturation (§ Post-Deploy Verification item 4); two live-tunable keys can break the bound (Step 5 findings row, item 5).
- [ ] Marketdata findings log vs feature 317: overlap not checked; re-check at Step 5.
- [ ] Out of scope: NamespaceEditor.tsx:345-353 "self-service" per-user text beside the read-only notice for non-admins. Target: `/sdd-qa defect`.
- [x] Closed: O-18/O-19/O-20 (spec § Accepted Cost (d),(f)); ~330 threshold and O-9 re-cites (§ Accepted Cost (e)); C-16 sign-off; >3,000-row badges (Step 4 instr. 2); fail-open legibility (Step 1 case 1d).

## Files Modified

- Design/spec artifacts only so far (no service code): `recon.md`, `debate.md` (approved, 5 rounds), `design.md`, `implementation-spec.md` (impl-review fixes commit `c7a38a99`; 5 steps).
- Planned (services/xstockstrat-ui): `src/app/config-ui/[namespace]/NamespaceEditor.tsx` (Steps 1-2); `src/hooks/useOpportunities.ts` (`QUEUE_DEFAULT_FILTERS`, `useQueueMembership`), `src/components/insights/WatchlistDetail.tsx`, `src/components/insights/WatchlistReadiness.tsx`, new watchlist e2e spec + `e2e/fixtures/INVENTORY.md` row (Steps 3-4); `services/xstockstrat-marketdata/docs/context-constitution-findings.md` (Step 5). `e2e/mock-backend.ts` is not touched.

## Superseded Sessions

- 2026-11-10 /sdd-triage: bug reports clustered into one SEV-3 UI PR (both are client display gaps against server truth); recommended depth `skip` (escalate to full only if the watchlist fix picked a multi-symbol proto filter); created feature.md, product-spec.md, acceptance.feature (@AC-1..2), context.md. Details hoisted into Decisions → Scope.
- 2026-11-10 sdd-review product-spec: approved draft → spec-ready; warnings: bug-template conventions, AC-1 Then disjunctive pending OQ1 (hide vs notice), AC-2 lacks a concrete symbol, OQ2 multi-symbol filter would need proto; recommended depth quick; no overlap. Tree ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits).
- 2026-11-11 sdd-batch design gate (round 2): halted at approval gate (D-1..D-5, R-1..R-5, O-1..O-7, P-1); approach, build order (Unit 1 + RED tests → hoist + hook → consumer swap + AC-2 RED → rerun `e2e/insights/watchlists.spec.ts:84,448-465`, INVENTORY.md per C-13) and mitigations now in Decisions. Blocking O-5 (warm-set growth) filed with P-1; O-1/O-2/O-3 closed (hoisted const; no `setQueriesData` on the `['opportunities']` prefix, only `useWatchlists.ts:140,180`; refetch triggers enumerated); O-6 RPC-rate claim wrong, O-7 AC-2 test must cover rank-below-50 in one page. The round-2 state fence is superseded by the round-5 fence below.
- 2026-11-13 sdd-batch design gate (round 3): halted (D-1..D-7, O-1..O-12); added the cost accounting (a)-(e) (cadence-independence D-7, union-across-users bound, per-new-warm-symbol quote/bar/FMP costs, RPC delta D-6, whole-queue payload under R-3), O-8 (classification/FMP draw + per-symbol quote upserts, blocking) and O-9..O-12; closed O-4, O-6, O-7. Superseded by the round-5 fence.
- 2026-11-20 sdd-batch design gate (round 4): halted (D-1..D-8, O-1..O-17); operator asked for one explicit bound to accept. Baseline D-8 (ranks 51+); bound over time corrected to a union since marketdata restart (`markWarm` only adds, `marketdata_service.go:1171-1177`; the sole removal is the delisting prune `asset_servability.go:153` or restart), O-13 bar-ingester cost line, O-14 snapshot-vs-union, O-15 `max_universe_size` > 100 tripwire, O-16 stale cite (:5614-5619 → :5627-5639), O-17 findings row + TTL-prune follow-up; @AC-1/@AC-2 CHANGE now covered by the operator's C-16 sign-off. Superseded by the round-5 fence.
- 2026-11-20 sdd-batch design gate (round 5): halted but approvable (D-1..D-10, O-1..O-20); operator ruling "I accept the bound" closed O-5 (D-9), P-1 treated as declined (debate.md row still read "pending user" until the sdd-design session set "user declined"); open non-blocking O-11, O-18, O-19, O-20; real statement volume 9-18% above the headline (a relabel, not a changed bound). Cost text (a)-(i) lives in this session's state fence (last fence in file, the one the batch parser reads), preserved byte-for-byte:

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

- 2026-11-20 sdd-design: Phase 0 recon.md written (key reuse: `useIsAdmin()` threaded through EditState like `isNativeEnv`; `QUEUE_DEFAULT_FILTERS` hoist); 5 grilling rounds (full); status spec-ready → design-approved; wrote design.md and set debate.md State approved / P-1 "user declined" (no new rows). Operator rulings of that day are reproduced verbatim in Decisions. The `## Open Threads` list of that session is hoisted into the header (O-11, O-18..O-20, warm-set ceiling, ohlcv lock risk, two live-tunable keys, ~330/O-9 re-cite, C-16 restatement, >3,000-row badges, fail-open legibility).

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

## Session 2026-11-20 — sdd-review impl-spec (advisory)

- Result: 0 failures, 9 warnings, no Floor breach (PASS WITH WARNINGS; advisory, lifecycle unchanged). Overlap: WARN, file-level and rebase-only.
- Re-verified in this run: `origin/main-dev` is still `fb52065c` and the feature branch is 168 commits behind it; `test:coverage` exists in `services/xstockstrat-ui/package.json:19`; feature 308's spec (on `origin/feature/fix-analysis-per-symbol-isolation`, `:911-912`) and features 345 (`:2130`) and 360 (`:625`) name the shared fixture files; `INVENTORY.md:45` is the `LYFT_SOURCE_LABEL_OPPORTUNITIES` row.
- Addressed in implementation-spec.md (commit `c7a38a99`):
  - [x] Steps 1 and 3: Verification now runs `pnpm run test:coverage` (B2 "threshold explicit").
  - [x] Step 4: Verification adds `--repeat-each=10` on the new watchlist spec as the flake check for the fake-clock request counts (Cases A and C). It sits in Step 4 because the cases are RED until then.
  - [x] Step 3 instruction 2: the `INVENTORY.md` row is placed by neighbouring symbol, with `:45` as the `fb52065c` anchor.
  - [x] § Step Dependencies: records the rebase-only file overlap with 308, 345 and 360. No `merge-order.md` entry is needed.
- No change needed: the Steps 1+2 and 3+4 pairing was judged justified; `e2e/mock-backend.ts` is not touched by this feature.
- Unresolved ⚠ carried into execution:
  - Whole feature: O-5 scale. The ruling was given against the design's 50-row example; staging shows 437 rows per viewer and about 595,584 headline writes per day. The operator must confirm at these figures or reopen P-1 — [ ] unaddressed
  - Whole feature: warm-set growth has no code guard before deploy; it is recorded only by the Step 5 docs row — [ ] unaddressed
  - Whole feature: the spec-time `list_opportunities` read with `page_size` 1000 on staging ran a full-window enrichment that the operator did not ask for. Harmless (cleared by a marketdata restart) but unauthorized; the operator should know — [ ] unaddressed
  - § Payload: O-11 is an estimate from agent JSON (about 448 KB per 15 s poll, roughly 10× today), not the dev BFF measurement design.md asked for. Measure at § Post-Deploy Verification item 3 and watch the poll growth — [ ] unaddressed
  - Follow-up `marketdata-warm-set-ttl-prune` has no reserved number, so the structural fix is untracked. Reserve via `/sdd-story` before or at execute — [ ] unaddressed
  - Steps 1 to 4: evidence anchors are from `fb52065c`. `/sdd-execute` BRANCH SYNC must merge `main-dev` first and re-check the anchors (P-03) — [ ] unaddressed
  - Step 2: the "self-service" per-user text will sit beside the read-only notice for non-admins. Out of scope; file via `/sdd-qa defect` — [ ] unaddressed
- Overlap findings: `e2e/fixtures/opportunities.ts` (308) and `e2e/fixtures/INVENTORY.md` (308, 345, 360), rebase-only. No migration, proto field or config-key collision. The marketdata findings log was not checked against feature 317.
- Run note: the pre-commit hook printed a missing `scripts/check-duplication.py` on this branch (it predates that script); the commit still passed. The `main-dev` merge at BRANCH SYNC brings the script in.

## Open Threads

- [ ] **For the operator.** Confirm the O-5 ruling at the staging figures (437 rows per viewer, about 188 newly warm symbols, about 595,584 headline writes per day, 10× payload) before `/sdd-execute`, or reopen P-1. There is no code guard on warm-set growth.
- [ ] **For the operator.** The spec run's staging read with `page_size` 1000 was not requested. It may have warmed up to 396 symbols on staging marketdata until its next restart.
- [ ] O-11: measure the BFF body on dev (§ Post-Deploy Verification item 3).
- [ ] Reserve a number for `marketdata-warm-set-ttl-prune` via `/sdd-story`.
- [ ] `/sdd-execute` BRANCH SYNC: merge `main-dev` (168 commits) and re-check every `path:line` anchor before Step 1.
- [ ] Out of scope: the NamespaceEditor "self-service" text beside the read-only notice. Target: `/sdd-qa defect`.
- [ ] Marketdata findings log vs feature 317: overlap not checked. Re-check at Step 5.

## Session 2026-11-21 — /sdd-distill
- Distilled 9 sessions → header + Superseded Sessions; kept 2 verbatim (sdd-spec, sdd-review impl-spec). Earlier state fences (rounds 2-4) dropped; the round-5 fence (last in file) kept byte-for-byte; unique risks from rounds 2-4 hoisted into Decisions.
- context.md 1018 → 317 lines, 112121 → 44962 bytes. Original prose preserved in git history.
