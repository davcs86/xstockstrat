# Context Log: fix-marketdata-fundamentals-cache

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-marketdata-fundamentals-cache-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings **D-19**, **D-50**,
  **D-51**, **D-52**, **D-53**. All five re-verified on main-dev @ a053b0e and all reproduce in code. None excluded.
  D-19 is latent: no in-repo consumer of `StreamBars`/`StreamQuotes`.
- Severity: SEV-3. Impact type: stale-or-missing-fundamentals. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
  This group is SEV-3 but was routed Track C by the same grouping decision.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..8), context.md; report sidecar `.status` (`triaged`).
- Affected services: xstockstrat-marketdata only.
- Root cause hypothesis:
  - D-50: the `cap > 0` short-circuit is missing.
  - D-51/D-52: the `source` column is read only on the edgar axis.
  - D-53: ignored errors, with no partial marker.
  - D-19: the lifetime-scoped counter, plus `time.Sleep` with no ctx.
- Line drift (scan @ 4535695 → a053b0e):
  - Unchanged: `stream.go:147-172`, `fmp_client.go:97`, `:127`, `:195`, `:198`, `marketdata_service.go:1676`, `:1688`,
    `:1734`, `:1742`, `:1850`, `:1958`, `marketdata_repo.go:548`, `:582`, `:836`, `:889`, `cmd/server/main.go:129-130`.
  - Minor drift: the D-51 SQL sits at `marketdata_repo.go:656-659` / `:669-670` (cited `:656-660` / `:669-672`), and the
    Finnhub window call at `marketdata_service.go:1935`.
- Test-design notes for /sdd-spec:
  - AC-6's "hex-garbled" input is illustrative of the `:582` hazard; refine it to whatever `extra` value actually fails the decode.
  - AC-5's "partial marker" mechanism is a design choice: a shortened TTL, a flag, or no upsert of the partial row.
- Overlaps:
  - **246-fix-fundsignal-neutral-score** (implementation-ready) reads `fmp_client.go`, `finnhub_client.go` and
    `marketdata_repo.go:537-562` only as evidence. Its fix is analysis-only. No code conflict. Its residual risk on cache rows
    with missing metrics (`246/implementation-spec.md:308`) is adjacent to D-53: a D-53 partial marker would help 246's
    absence detection. Note this in design.
  - **253-fix-edgar-companyfacts-decode** (code-completed) edits `internal/edgar/edgar_client.go` only. No conflict, but
    `marketdata_service.go` edgar-path anchors may shift if 253 merges first.
  - **254-fix-marketdata-secret-exposure** edits `fmp_client.go:243` and `finnhub_client.go:118`, the transport-error wrap.
    It is the same file as D-50/D-53 but different functions. Rebase onto whichever lands first.
  - **240-offline-account-full-pnl** (launched) touched `marketdata_service.go` (BatchGetBars), not the fundamentals path.
- Recommended design depth: quick → `/sdd-design fix-marketdata-fundamentals-cache quick` (rationale: SEV-3 and a single
  service with no proto or migration, but D-50 changes the observable semantics of config key
  `marketdata.fmp.daily_request_cap`, which is the C-0 quick trigger, and there are five D-ids with a partial-marker design fork).
- Development branch: feature/fix-marketdata-fundamentals-cache

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS). Status: draft → spec-ready.
- OPERATOR DECISIONS (binding, recorded 2026-10-22):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C (precedent #1264).
  - Scope is D-19, D-50, D-51, D-52, D-53.
  - Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
  - Operator 2026-10-22 resolves OQ-1: marketdata.fmp.daily_request_cap <= 0 means ZERO BUDGET (FMP disabled), matching reserve(), enrichmentUnderCap(), TestBackfillFundamentals_CapDegrade_AC5, marketdata CLAUDE.md and feature 215. D-50 is fixed by correcting the misleading 'cap <= 0 = uncapped' comments (fmp_client.go:97, marketdata_service.go:1958) and any doc saying otherwise — no behaviour change; a large cap means effectively uncapped. Mark OQ-1 [x] and rewrite FR-1 and its @AC accordingly.
- Warnings (6):
  1. C-15, AC-1: the final Then (doc comments describe cap <= 0 as zero budget) was a source-text check. **Resolved
     this session:** that Then is dropped from AC-1, and FR-1 now says the comment/doc corrections
     (`fmp_client.go:97`, `marketdata_service.go:1958`, marketdata `CLAUDE.md:82`, config-governance) are verified by a
     `/sdd-spec` checklist step. AC-1/AC-9 stay behavioural.
  2. AC-3 (boot seed) and AC-8 (ERROR log) include startup/log wiring. Design must name the test seam (for example the
     repo count stub behind `cmd/server/main.go:129`). Open for /sdd-design.
  3. C-14: consumer surfaces (agent `tools.py:402`/`:812`, `traderBff.ts`, `insightsBff.ts`) are named; their
     verification steps are deferred to /sdd-spec.
  4. Scope: FR-5 (D-19, Alpaca stream manager) is unrelated to the fundamentals cache. Kept in scope per the binding
     operator decision (scope D-19, D-50..D-53); design may sequence it as an isolated last step to limit rebase risk
     against 215/254.
  5. C-11: the merge-order rows for 215 and 254 are deferred to /sdd-design — they must actually be added (on user yes).
  6. The optional `(source, fetched_at)` index (marketdata `010_*`) is conditional; design must record the decision.
- Overlap findings (WARN, no FAIL):
  - 215-block-fundamentals-strategy-on-etf (in-progress): same files — `internal/fmp/fmp_client.go` (fetchProfile/IsEtf,
    `reserve()`), `internal/service/marketdata_service.go` (quota gates; 215 Step 7 extracts `atQuotaAlertThreshold`, the
    FR-1 comment site), `cmd/server/main.go` (Limits/boot-seed wiring), `marketdata_service_test.go` (215 Step 10(c) adds a
    `{0,0}` case). Rebase risk only; cap-0 semantics now agree (OQ-1). Recommended order: 255 after 215.
  - 254-fix-marketdata-secret-exposure (draft): error-wrap/key sites in `fmp_client.go` (`:222`, `:243`, `:254`) and
    `marketdata_service.go` (`:1704`, `:1760`). Rebase risk only; 254 has no implementation-spec yet.
  - `internal/alpaca/stream.go` (FR-5): no in-flight feature touches it.
  - 253-fix-edgar-companyfacts-decode (code-completed): edits `edgar_client.go` only; not a collision.
  - Migration: none committed; the optional index would be marketdata `010_*` (re-derive at /sdd-spec). Proto: none.
    Config: none (FR-1 corrects docs for the existing `marketdata.fmp.daily_request_cap`).
  - merge-order.md has no rows for 255/215/254; propose WARN rows at /sdd-design only on user yes.
- Next: `/sdd-design fix-marketdata-fundamentals-cache` (recommended depth quick).

## Session 2026-10-22 — sdd-batch design gate (round 2)

Full-mode `/sdd-design` debate halted at the approval gate after round 2 (gate policy: halt). `design.md` is not
written and `status.md` is unchanged (still spec-ready). This entry records where the debate stands so the next
`/sdd-batch` run can pick it up.

### Open Threads

- **Approach (round-2 synthesis):** Steps 1-4 and 6 from round 1 stand as they were:
  - D-50: comment/doc fixes plus three cap-0 tests.
  - D-51: counts filtered by source, using `fmp.SourceName`/`finnhub.SourceName` and `SeedFMPBudget`.
  - D-52: the fresh check looks at the vendor axis; stale serves are unchanged.
  - D-53a: `decodeExtraMetrics`.
  - D-19: ctx, url, a healthy flag and `closeAllLocked`.

  Step 5 (D-53b) changes in round 2:
  - The retryable class stays narrow. A transient `RetryableEnrichmentFailure bool` on `source.Fundamentals` is set
    only for `ErrFMPDailyCapExceeded`, `context.Canceled` or `context.DeadlineExceeded`.
  - A WARN is emitted with `slog.WarnContext` in `fmp.Client.GetFundamentalsMulti`.
  - The row is still upserted. When the flag is set, `UpsertFundamentals` writes `fetched_at` as the `'epoch'`
    sentinel through a `CASE` (`marketdata_repo.go:593/:600`). There is no repo or interface signature change, no new
    tunable, and `fmp_client.go:243/:254` is not touched.
  - Effect: the current call serves the partial row as not stale, with an honest `missing_metrics`. A later call that
    still has budget re-fetches. A later call at the cap serves the partial row as stale, instead of
    ResourceExhausted or an older row.
- **Strongest open objection (blocking):** the round-2 proposer's mechanism skips the upsert. That drops a core row
  that cannot be fetched again (the budget is already spent), so the next call at the cap returns ResourceExhausted
  (`marketdata_service.go:1742-1746`) or serves an older row. That is a regression against trunk and against
  @feature-215 @AC-7. The synthesis adopts the epoch-sentinel upsert instead, but the proposer has not confirmed it,
  the rewritten @AC-10 steps, or the trade-off that the boot seed under-counts.
- **Second blocking item (needs operator sign-off):** three spec changes go to the operator as one acknowledgement.
  OQ-1 does not cover any of them.
  - (a) FR-4(b) is reworded. It must name the residual: a transient profile/ratios 5xx, transport or decode failure is
    still cached for `cache_ttl_hours` with nil metrics.
  - (b) AC-5's first Then lists "beta" only.
  - (c) A new @AC-10 @FR-3 @FR-4 @regression is added, matching the epoch backdate.
- **Non-blocking items:**
  - The ctx-cancel/deadline members of the retryable class are almost unreachable. They stay, but the predicate must
    remain that single `errors.Is` set (C-18).
  - Under the finnhub provider, a mid-day restart re-grants the full FMP cap, and the epoch rows under-count the seed by
    at most 3 reservations per partial symbol. This is accepted under the CLAUDE.md:82 "floor" wording.
  - After a manager give-up, StreamBars RPC clients still hang. This is a follow-up; AC-8 holds at the manager level
    only.
  - D-19 reconnects forever when the server acks and then drops the connection. Accepted.
- **Floor status:** no breaches.
- **@AC changes:**
  - Covered by an operator decision (OQ-1): @AC-1 CHANGE, @AC-9 CHANGE, @feature-215 @AC-5 PRESERVE.
  - Not yet covered:
    - @AC-5 CHANGE
    - @AC-10 EXTEND
  - PRESERVE: @AC-2/3/4/6/7/8, @feature-215 @AC-7/@AC-14, @feature-217 @AC-4.
- **Open risks to carry into /sdd-spec:**
  - Every `fetched_at` reader in marketdata and in the C-14 consumers must be grepped before Step 5, so that no reader
    shows 1970.
  - Rebase onto 215 and 254 now includes the `UpsertFundamentals` SQL touchpoint.
  - The `fakeFundRepo` changes (aware of source and flag) may break tests that seed `todayCount` directly.
- **Merge order:** 255 goes after 215, plus a WARN row for 254. Both are added only after the user says yes.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis. Steps 1-4 and 6 from the r1 synthesis stand unchanged: D-50 comments/docs plus three cap-0 tests; D-51 source-filtered counts, fmp.SourceName and finnhub.SourceName, SeedFMPBudget; D-52 vendor-axis fresh check with the stale serves unchanged; D-53a decodeExtraMetrics; D-19 ctx/url/healthy-flag/closeAllLocked. Step 5 (D-53b) changes as marked [r2→].\n\n5. D-53b (partial enrichment).\n   - Keep the narrow retryable class. RetryableEnrichmentFailure is set only when errors.Is(err, ErrFMPDailyCapExceeded) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded). The predicate is that one errors.Is set and must not grow (C-18).\n   - The flag is a transient `RetryableEnrichmentFailure bool` on source.Fundamentals, next to Sector (internal/source/source.go:62-64). The FundamentalsSource interface does not change.\n   - The WARN is emitted only in fmp.Client.GetFundamentalsMulti (internal/fmp/fmp_client.go:195-200), as slog.WarnContext(ctx, ..., \"symbol\", sym, \"enrichment\", \"ratios\"|\"profile\", \"error\", err). That is the only place the per-call error is still in scope.\n   - [r2→] Do NOT skip the upsert. Upsert the partial row and mark it already expired. In MarketDataRepo.UpsertFundamentals (internal/repository/marketdata_repo.go:574-600), fetched_at is currently hardcoded to now() at :593 and :600. It becomes `CASE WHEN $17 THEN 'epoch'::timestamptz ELSE now() END` (with EXCLUDED.fetched_at on conflict), with $17 = f.RetryableEnrichmentFailure.\n     - The backdate is a fixed epoch sentinel. It needs no TTL knowledge, adds no tunable (F-07) and changes no repo or interface signature. The service callers at internal/service/marketdata_service.go:1707 and :1762 stay one-line upserts.\n     - edgarFinish (:1879) never sets the flag, so its behaviour does not change.\n     - fmp_client.go:243/:254 are not touched, so nothing collides with 254's lines there.\n     - Fix the :572-573 doc comment in the same edit.\n   - Effect of the expired partial row:\n     - The current call serves the partial vendor row with stale=false and an honest missing_metrics (nil pointers, :2033-2038).\n     - A later call with budget left fails the D-52 TTL check and re-fetches. This meets the AC-5 \"after the quota resets\" step.\n     - A later call at cap (count>=cap :1742, or the ErrFMPDailyCapExceeded branch :1752) serves the partial vendor row with stale=true instead of RE (:1746) or an older row. Trunk's \"data, never RE\" is kept for a symbol already served that day (@feature-215 @AC-7).\n   - Every other enrichment error (non-2xx :253-256, transport :241-243, decode :257-259) is upserted with fetched_at=now(), as on trunk, plus the WARN and missing_metrics.\n   - Also convert the context-free slog.Warn at :1708/:1763 to WarnContext (operator trace-id rule). Add a 254 rebase note for :1704/:1760.\n   - Accepted trade-off, recorded in context.md: an epoch-stamped row drops out of the D-51 \"today\" seed count. After a restart this under-counts by at most 3 reservations per partial symbol. The CLAUDE.md:82 rewrite already states the seed as a floor.\n   - Spec changes awaiting operator sign-off (see objections). Both need sign-off together:\n     - (a) FR-4(b) rewrite, with the proposer's r2 text plus an explicit residual clause: \"a transient profile/ratios 5xx/transport/decode failure is still cached for cache_ttl_hours with nil metrics\".\n     - (b) AC-5 rewrite: the first Then lists \"beta\" only. The Given, the WARN step and the re-fetch-after-reset step are kept word for word.\n     - (c) New @AC-10 @FR-3 @FR-4 @regression, adjusted for the backdate:\n       - Setup: snapshot_source=vendor, provider fmp, a fresh source=edgar AAPL row, and a profile call that hits ErrFMPDailyCapExceeded.\n       - The first call serves the vendor values with stale=false and missing_metrics containing \"beta\". The cache row becomes source=fmp, already expired.\n       - The next call at cap serves that fmp row with stale=true and no HTTP call.\n       - After the quota resets, the next call fetches from FMP again.\n   - Tests: an AC-5 service test, the AC-10 service test, and a repo/fake check that a flagged upsert is excluded from the today count. fakeFundRepo (marketdata_service_test.go:204) stores the flag as an expired fetched_at.\n\nMerge order: 255 merges after 215, and 254 gets a WARN row; both are added only after a user yes. C-14 read-only checks: agent tools.py:402/:812, traderBff.ts, insightsBff.ts.",
    "open_objections": [
      {
        "text": "[C-16 / C-11] The r2 proposal's D-53b mechanism (skip the upsert when RetryableEnrichmentFailure is set) drops a good quote-derived core row that cannot be fetched again. The retryable class means the budget is spent, so the next call hits count>=cap (marketdata_service.go:1742). It then returns ResourceExhausted (:1746) for a symbol already served that day, or serves an older row (an earlier fmp row or the edgar row) stale. Trunk serves the newer partial row in both cases, so this is a regression visible to analysis's @feature-215 @AC-7 guard and to the BFFs. edgarFinish (:1876-1885) is not a matching precedent, because an edgar snapshot can be derived again for free. The synthesis adopts the fix: upsert with fetched_at set to the 'epoch' sentinel via a CASE on the transient flag in UpsertFundamentals (marketdata_repo.go:593/:600), with no repo signature change, no tunable and no fmp_client.go:243/:254 edit. The proposer has not answered this yet. The next proposal must confirm the mechanism, along with the rewritten @AC-10 steps (cache row becomes an expired fmp row; the at-cap step serves it stale) and the seed under-count trade-off.",
        "blocking": true
      },
      {
        "text": "[C-11 / C-15, operator sign-off required] Three spec changes ride on one operator acknowledgement, and none is covered by the OQ-1 decision. (a) FR-4(b) is reworded to the proposer's r2 text: 'when the failure is ErrFMPDailyCapExceeded (or the request was cancelled/deadlined) the row is not cached as fresh...'. The sign-off text must name the residual explicitly: a transient profile/ratios 5xx/transport/decode failure is still cached for cache_ttl_hours with nil metrics, so part of D-53's stated harm stays unfixed. (b) AC-5's first Then lists \"beta\" only; \"sector\" is a string field, not a metric pointer (marketdata_service.go:2021-2038, marketdata.proto:213-218). (c) The new @AC-10 as rewritten in the approach. The proposal supplied the exact text, but approval needs the operator's yes recorded in context.md. If the operator instead picks the heavier exported status-error option, AC-5 keeps its shape and only Step 5's predicate widens.",
        "blocking": true
      },
      {
        "text": "[C-18 YAGNI] The context.Canceled/DeadlineExceeded members of the retryable class are almost unreachable. A cancelled ctx fails fetchQuotes (fmp_client.go:177-179) first, and that becomes a whole-call error (:1703-1704/:1759-1760). Keep them, since they cost nothing, but limit the predicate and its tests to that single errors.Is set.",
        "blocking": false
      },
      {
        "text": "[C-16 doc drift, carried] Under the finnhub provider, the D-51 seed counts about 0 FMP rows, so a mid-day restart re-grants the full cap. The epoch backdate adds a small further under-count. Both are accepted under the CLAUDE.md:82 'floor' wording and recorded in context.md.",
        "blocking": false
      },
      {
        "text": "[FR-5 scope, carried] The StreamBars RPC client still hangs after a manager give-up (marketdata_handler.go:37-54). AC-8 is satisfied at the manager level only and is tracked as a follow-up.",
        "blocking": false
      },
      {
        "text": "[D-19 residual, carried] A server that acks and then drops reconnects forever at a fixed delay. Accepted; runner-up if it is disputed later: a minimum session duration.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-10",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@feature-215 @AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@feature-215 @AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@feature-215 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@feature-217 @AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Skip the upsert when RetryableEnrichmentFailure is set (proposal r2). Lost: once the cap is hit, the fetched FMP core row cannot be fetched again, so dropping it turns later at-cap calls into ResourceExhausted or an older row (marketdata_service.go:1742-1746, :1752). Trunk serves the newer partial row in those cases. fails.md:2290 ('memoize only successful reads') was over-applied: this is a degraded success that cannot be re-fetched.",
      "Backdate to now() - ttl - 1s computed in the service (adversary's literal form). Lost to the epoch sentinel: the SQL hardcodes now() (marketdata_repo.go:593/:600), so passing a computed timestamp needs a repo/interface signature change. A fixed epoch needs no TTL knowledge in the repo.",
      "Short fixed retry horizon for ANY enrichment failure (fetched_at = now - ttl + 1h). Lost: a deterministic 402/4xx (FMP-Free ratios) would cost about 3 reservations per symbol per hour against the shared 250/day budget. It also needs a TTL-aware repo write or a new invariant. It is recorded as the middle option if the operator rejects the FR-4(b) narrowing.",
      "Upsert the partial row with fetched_at = now() - ttl + retry_window (r1). Lost: it needs a repo signature change plus a new tunable (F-07 risk). The epoch sentinel avoids both.",
      "A marker in extra_metrics. Lost: ExtraMetrics goes straight to the wire (marketdata_service.go:2052), so the marker would leak to the agent and the BFFs unless stripped at every read.",
      "Exported HTTP-status error type from getJSON so 5xx/429 also re-fetch. Kept as the operator's heavier option. It edits fmp_client.go:243/:254, which feature 254 also changes, so it loses on the user's low-rework instruction.",
      "Skip the upsert on ANY enrichment failure (r1). Lost: every non-2xx, transport or decode error is non-nil (fmp_client.go:241-259), so this is a budget-burn regression.",
      "A per-symbol error set from GetFundamentalsMulti. Lost: it changes the FundamentalsSource interface and the Finnhub client.",
      "A FailedEnrichments []string field. Lost to a single bool: no consumer.",
      "Pass s.fundProvider for the Finnhub window count. Lost to finnhub.SourceName.",
      "Count every row, or the active provider's rows, for the boot seed. Lost: AC-3 requires FMP-source rows.",
      "Skip edgar rows in the stale serve. Lost: it would be a visible @feature-215 @AC-7 regression.",
      "Add a (source, fetched_at) index (migration 010). Lost: one row per symbol; idx_fundamentals_fetched_at is enough.",
      "Reset the reconnect counter on reaching stream.go:214. Lost: an auth failure arrives as an 'error' frame after subscribe.",
      "A dialer interface for the stream test seam. Lost to a url field.",
      "A classification-spend count in the boot seed. Lost (YAGNI); floor semantics are documented instead."
    ],
    "open_risks": [
      "Epoch-stamped fetched_at changes what the column means for flagged rows. Any reader that shows fetched_at, or uses it for anything other than the TTL check and the today count, would show 1970. The impl spec must grep every fetched_at reader in marketdata (marketdata_repo.go:526, :660, :672 and the scan sites) and the C-14 consumers before Step 5 is executed.",
      "A transient 5xx/transport failure of profile or ratios is still cached fresh for cache_ttl_hours with nil metrics, as on trunk. Only the WARN and missing_metrics improve. If the operator rejects the FR-4(b) narrowing, either the status-error option and its coordination with 254, or the fixed retry-horizon option, comes back.",
      "The operator may read FR-4(b)'s 'not treated as fresh' literally and reject the rewording.",
      "Merge conflicts with 215 (quota gates and alert path; Step 7 extraction) and 254 (marketdata_service.go:1704/:1760). The UpsertFundamentals SQL edit is a new touchpoint the rebase notes must list.",
      "A mid-day restart under the finnhub provider re-grants the full FMP cap. The epoch backdate adds an under-count of at most 3 reservations per partial symbol.",
      "D-19 healthy-session detection assumes Alpaca sends 'subscription' only after a successful auth+subscribe.",
      "StreamBars RPC clients still hang after a manager give-up (follow-up).",
      "Making fakeFundRepo source- and flag-aware may break existing tests that seed todayCount directly."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-08",
      "C-11",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "F-07",
      "PLAT-N1"
    ],
    "rationale": "The user asked to preserve as much as possible with low rework, so r1's Steps 1-4 and 6 and the r2 spec-rewrite package are kept as they are. Only the part the r2 adversary concretely broke changes.\n\nI checked the adversary's claim at marketdata_service.go:1738-1766. At cap with no row the code returns ResourceExhausted, and at cap with a row it serves that row stale. Skipping the upsert after an ErrFMPDailyCapExceeded enrichment therefore makes a symbol served once that day return RE or older data afterwards, which is a real regression against trunk.\n\nThe adversary's fix, as written (now - ttl - 1s), assumed a free fetched_at. But UpsertFundamentals hardcodes now() (marketdata_repo.go:593/:600). A computed timestamp would need the repo or interface signature change that r1 already rejected. An 'epoch' sentinel selected by a CASE on the transient flag gets the same behaviour: the partial row is kept, at-cap calls serve it stale, and the next call with budget re-fetches. It does this with no signature change, no tunable and no fmp_client.go:243/:254 edit, so the 254 rebase stays low. This is also why the r1-rejected 'now - ttl + retry_window' alternative stays rejected while this one wins.\n\nThe proposer has not yet answered the objection, so it stays blocking until the next proposal confirms it.\n\nThe operator sign-off package (FR-4(b), AC-5, @AC-10) is still blocking, because no operator decision covers it. The sign-off text must name the 5xx residual so the waiver is informed. @AC-10's steps are rewritten to match the backdate: the cache row becomes an expired fmp partial, not the retained edgar row. The YAGNI and WarnContext-placement points are folded in as constraints.\n\nFiles: /home/user/xstockstrat/.claude/worktrees/wf_dcd9f6a8-fbb-47/services/xstockstrat-marketdata/internal/repository/marketdata_repo.go, /home/user/xstockstrat/.claude/worktrees/wf_dcd9f6a8-fbb-47/services/xstockstrat-marketdata/internal/service/marketdata_service.go, /home/user/xstockstrat/.claude/worktrees/wf_dcd9f6a8-fbb-47/services/xstockstrat-marketdata/internal/fmp/fmp_client.go, /home/user/xstockstrat/.claude/worktrees/wf_dcd9f6a8-fbb-47/services/xstockstrat-marketdata/internal/source/source.go"
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-batch design gate (round 3)

The full-mode `/sdd-design` debate stopped at the approval gate after round 3 (gate policy: halt). `design.md` has
not been written and `status.md` has not changed (still spec-ready). This entry records where the debate stands so
the next `/sdd-batch` run can pick it up.

### Open Threads

- **Approach (round-3 synthesis):** Steps 1-4 and 6 are unchanged from r1/r2:
  - D-50: comment/doc fixes plus the cap-0 tests.
  - D-51: counts filtered by source, using `fmp.SourceName`/`finnhub.SourceName`, plus `SeedFMPBudget`.
  - D-52: the fresh check looks at the vendor axis; stale serves are unchanged.
  - D-53a: `decodeExtraMetrics`.
  - D-19: manager ctx, url seam, healthy flag, `closeAllLocked`.

  Step 5 (D-53b) follows the operator's 2026-10-22 decision: every enrichment failure stores an already-expired
  row, with no residual.
  - **Flag:** a transient `EnrichmentFailed bool` on `source.Fundamentals` replaces `RetryableEnrichmentFailure`.
    `fmp_client.go:192-199` sets it whenever `fetchRatios` or `fetchProfile` returns a non-nil error. A `nil, nil`
    result still counts as success and is cached fresh. No typed status error is added (C-18).
  - **Expire on write:** `UpsertFundamentals` stamps
    `CASE WHEN $17::boolean THEN 'epoch'::timestamptz ELSE now() END`, and the conflict branch uses
    `fetched_at=EXCLUDED.fetched_at`.
  - **WARN:** one aggregated `slog.WarnContext` per `GetFundamentalsMulti` call. It lists `SYM:ratios|profile` pairs
    with a class (`cap`/`ctx`/`other`) and the path, and **never the raw error string**. The reason is that
    `fmp_client.go:243` wraps a `*url.Error` that contains `apikey=`. Because 255 never logs that string, it no
    longer depends on 254, and 254 is demoted to a soft merge-order WARN row. A no-apikey-in-log test stays in 255.
  - **Detached ctx:** one `wctx := context.WithoutCancel(ctx)` covers the whole post-fetch write/emit block (upsert,
    `seedFromProfile`, `maybeAlertQuota`) on both the batch and single paths.
  - **Seed query:** the D-51 seed query uses exactly `source = $1 AND (fetched_at >= $d OR as_of >= $d)`, with `$1`
    bound to `fmp.SourceName`. It is backed by a 2-line AsOf constraint comment at `fmp_client.go:333` and a test
    that AsOf is approximately now.
  - **Proposed same-source COALESCE merge (Step 5.5, pending operator ack):** keeps last-known-good enrichment
    values on a flagged overwrite of a same-source row.
  - **Tests:** pgxmock SQL tests, plus one real-Postgres `DB_PGBOUNCER=true` test of the epoch branch.
- **Strongest open objection (blocking):** stale-serve quality (C-16 / @feature-215 @AC-7, P-03). The conflict branch
  at `marketdata_repo.go:594-600` overwrites every enrichment column with `EXCLUDED`. When an expired complete row is
  re-fetched and the enrichment fails, the row loses its prior values, and a later at-cap stale serve returns NULLs.
  The 5.5 merge fixes this, but it goes further than the operator's literal wording, "stores the partial row". It
  needs the proposer's confirmation and the operator's choice: accept the merge, or acknowledge the NULL-overwrite
  degradation.
- **Other blocking objections:**
  - The parenthesised seed predicate is adopted by the synthesis but the proposer has not confirmed it yet (P-02).
  - The operator sign-off package (C-11/C-15) has not been answered. It needs one acknowledgement that covers:
    - FR-4(b) with no residual clause;
    - AC-5's first Then listing "beta" only;
    - the new @AC-10;
    - the re-fetch amplification cost (a deterministic 402 re-spends quote+profile per expired symbol per request
      and per fundsignal cycle, so the cap is reached sooner and 215/217 are starved; the remedy is
      `marketdata.fmp.metrics=core`);
    - 5.5, if it is adopted.
- **Non-blocking, folded into the synthesis:**
  - `$17::boolean` together with a real-PgBouncer test (fails.md:1977-1989);
  - the single `wctx` block (C-03);
  - the aggregated WARN;
  - class-only logging, which removes the apikey leak and the 254 dependency;
  - the AsOf coupling comment and test.

  Carried over from earlier rounds:
  - the FMP seed reads about 0 under the finnhub provider;
  - the StreamBars client hangs after a give-up (follow-up);
  - D-19 ack-then-drop reconnects forever.
- **Floor status:** no breaches. No migration (F-01), and the epoch value is a sentinel, not a tunable (F-07).
- **Uncovered @AC changes (not covered by an operator decision):**
  - @AC-5 CHANGE: the first Then lists "beta" only.
  - @AC-10 EXTEND: new @FR-3 @FR-4 @regression scenario.

  @AC-1 and @AC-9 CHANGE are covered by operator decisions. @AC-2/3/4/6/7/8, @feature-215 @AC-5/@AC-7/@AC-14,
  @feature-217 @AC-4, @feature-198 @AC-5, @feature-196 @AC-5 and @feature-211 @AC-6/@AC-7 are PRESERVE.
- **Merge order:** 255 after 215, with a soft WARN row for 254. Rows are added only after a user yes. Before Step 5
  the fetched_at reader grep (`marketdata_repo.go:526/:569` plus the C-14 consumers) must run.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 synthesis. Steps 1-4 and 6 stay as synthesized in r1/r2:\n- D-50: correct the comments and docs, plus the cap-0 tests.\n- D-51: source-filtered counts using fmp.SourceName and finnhub.SourceName, plus SeedFMPBudget.\n- D-52: vendor-axis fresh check; the stale serves do not change.\n- D-53a: decodeExtraMetrics.\n- D-19: manager ctx, url seam, healthy flag, closeAllLocked.\n\nStep 5 (D-53b) adopts the r3 proposal, amended as marked [r3→]. Line numbers below were checked against the worktree.\n\n5. D-53b: every enrichment failure stores an already-expired row (operator 2026-10-22, no residual).\n\n5.1 Flag. Add a transient `EnrichmentFailed bool` to source.Fundamentals next to Sector (internal/source/source.go:62-64). It replaces RetryableEnrichmentFailure. The FundamentalsSource interface does not change.\n\n5.2 Predicate. In fmp.Client.GetFundamentalsMulti (internal/fmp/fmp_client.go:192-199), the enrichment loop sets `f.EnrichmentFailed = true` whenever `fetchRatios` or `fetchProfile` returns a non-nil error.\n- Today the code is `rErr == nil && r != nil` and the error is dropped silently.\n- `nil, nil` means FMP has no ratios or profile for the symbol. That is a successful answer, not a failure, and it is still cached fresh.\n- No exported status-error type (C-18), and the getJSON lines are not edited.\n\n5.3 [r3→] WARN: one aggregated `slog.WarnContext(ctx, \"fmp enrichment failed\", \"failures\", []\"SYM:ratios|profile\", \"count\", n, \"sample_class\", ...)` per GetFundamentalsMulti call, not one per symbol per enrichment. This follows the warm-quote-poller one-WARN-per-cycle precedent and still names AAPL and profile for AC-5.\n- [r3→] The WARN carries no raw error string. Per pair, log the class only: `cap` (errors.Is ErrFMPDailyCapExceeded), `ctx` (errors.Is context.Canceled/DeadlineExceeded), or `other`, plus the path.\n- Reason: the transport wrap at fmp_client.go:243 (`%w` of http.Client.Do's *url.Error) puts the full URL, including `apikey=` (built at :222-223), into the error text. With no error string logged, 255 does not depend on 254's D-39 fix. 254 goes back to a soft merge-order WARN row (rebase-conflict note), not a hard predecessor.\n- An FMP client test asserts that a transport-failure enrichment WARN does not contain the configured api key value.\n\n5.4 Expire on write. In MarketDataRepo.UpsertFundamentals (internal/repository/marketdata_repo.go:574-612), fetched_at changes in two places:\n- VALUES: `now()` at :593 becomes `CASE WHEN $17::boolean THEN 'epoch'::timestamptz ELSE now() END`. The `::boolean` cast is required because of the QueryExecModeExec wire-OID lesson in ledger fails.md:1977-1989.\n- Conflict branch: `fetched_at=now()` at :600 becomes `fetched_at=EXCLUDED.fetched_at`.\n- `$17 = f.EnrichmentFailed`. No signature change, no tunable (F-07).\n- Fix the :572-573 doc comment in the same edit. edgarFinish never sets the flag.\n\n5.5 [r3→, pending operator ack, see objection 1] Keep last-known-good values on a flagged overwrite.\n- In the conflict branch, each enrichment column (pb_ratio, dividend_yield, roe, debt_to_equity, beta) becomes `CASE WHEN $17::boolean AND fundamentals.source = EXCLUDED.source THEN COALESCE(EXCLUDED.<col>, fundamentals.<col>) ELSE EXCLUDED.<col> END`.\n- The same-source guard stops values from a prior edgar row being relabelled as source=fmp.\n- The stored row is still expired, so the next call with budget re-fetches.\n- An at-cap stale serve returns the prior FMP values with stale=true instead of NULLs.\n- The current response is built from the in-memory struct, so its missing_metrics stays honest.\n- If the operator reads \"stores the partial row\" literally and rejects the merge, drop 5.5 and record the NULL-overwrite degradation of the stale serve as acknowledged in context.md.\n\n5.6 [r3→] Request-derived write/emit block. In the batch path (internal/service/marketdata_service.go:1706-1713) and the single path (:1762-1766), create `wctx := context.WithoutCancel(ctx)` once.\n- Use wctx for UpsertFundamentals, seedFromProfile and maybeAlertQuota/quotaCountAfterFetch, so a cancelled or deadlined request still persists its expired row and its emits. Trace values are kept (operator C-03 rule).\n- The two `slog.Warn` calls at :1708 and :1763 become `slog.WarnContext(wctx, ...)`.\n- Do not edit classification_service.go unless the diff already touches it (C-18).\n\n5.7 Resulting behaviour:\n- The current call serves the partial row with stale=false and an honest missing_metrics (toProtoFundamentals :2033-2038).\n- The next call with budget fails the TTL check (:1734 / :1676) and re-fetches.\n- The next call at cap serves the stored row with stale=true (:1742-1744, :1750-1752), never ResourceExhausted, so @feature-215 @AC-7 is preserved.\n\n5.8 [r3→] Seed under-count. The Step-2 FMP seed query (CountFundamentalsFetchedToday, marketdata_repo.go:652-662, already being edited for D-51) must use exactly this parenthesised predicate: `WHERE source = $1 AND (fetched_at >= $d OR as_of >= $d)`.\n- $1 binds fmp.SourceName, the same constant the client writes at fmp_client.go:334. No second 'fmp' literal (ledger 129).\n- $d is the existing UTC-day bound. Leave the pre-existing `now() AT TIME ZONE 'UTC'` timestamp/timestamptz shape alone unless it is made explicit in this same edit.\n- Tests:\n  - A fake-or-SQL test seeds 30 edgar rows whose as_of is today and asserts a count of 0 (AC-3 with as_of populated).\n  - A test asserts that epoch-stamped fmp rows with as_of today are counted.\n- Add a 2-line constraint comment at fmp_client.go:333, `AsOf: now`, saying that the boot seed depends on AsOf being the fetch instant. Add a client test that AsOf is approximately now.\n- The Finnhub window query gets no as_of clause.\n\n5.9 Tests:\n- AC-5 service test (cap-exceeded profile).\n- Sibling test with a 503 profile and the same assertions.\n- AC-10 service test.\n- One ctx-cancel-after-quote test showing the expired row persists via wctx.\n- pgxmock SQL tests for the CASE, the COALESCE merge and the seed WHERE.\n- [r3→] One real-Postgres `DB_PGBOUNCER=true` upsert test of the epoch branch (ledger fails.md:1977-1989; pgxmock cannot prove wire OIDs).\n- fakeFundRepo (marketdata_service_test.go:204) stores the flag as an epoch fetchedAt and applies the same-source merge.\n\nSpec package for one operator acknowledgement:\n- (a) FR-4(b) as worded in the r3 proposal, with no residual clause. Add: when a prior FMP row exists, its enrichment values are kept on the expired row, if 5.5 is accepted.\n- (b) AC-5: the first Then lists \"beta\" only. Everything else stays word for word.\n- (c) New @AC-10 @FR-3 @FR-4 @regression, as in the r3 proposal.\n- (d) Explicit acknowledgement of re-fetch amplification. A deterministic enrichment failure, such as the FMP-Free ratios-ttm 402, makes every expired symbol re-spend its quote and profile reservations on every request, and the feature-224 fundsignal loop turns that into a per-cycle cost. The cap is reached earlier, which starves the 215 ETF filler and the 217 classification refresh. The remedy is the existing `marketdata.fmp.metrics=core`.\n\nMerge order: 255 after 215, with a soft WARN row for 254. Rows are added only after a user yes. Read-only C-14 checks: agent tools.py:402/:812, traderBff.ts, insightsBff.ts. The fetched_at reader grep (marketdata_repo.go:526/:569 scan sites plus the C-14 consumers) must run before Step 5.",
    "open_objections": [
      {
        "text": "[C-16 / @feature-215 @AC-7 stale-serve quality; P-03] The partial upsert's conflict branch sets pb_ratio, dividend_yield, roe, debt_to_equity and beta to EXCLUDED (marketdata_repo.go:594-600, verified). An expired complete row that is re-fetched with a failed enrichment therefore loses its last-known-good values, and a later at-cap stale serve hands out NULLs where trunk would have served the prior values. The synthesis adopts a same-source COALESCE merge for the enrichment columns under $17 (Step 5.5). The guard `fundamentals.source = EXCLUDED.source` prevents edgar values being relabelled as fmp. The proposer has not answered this, and the merge stretches the operator's literal wording, \"stores the partial row\". It stays blocking until the proposer confirms 5.5 and the operator either accepts the merge or explicitly acknowledges the NULL-overwrite degradation, recorded in context.md.",
        "blocking": true
      },
      {
        "text": "[correctness] Operator precedence in the D-51 seed query. It must read `source = $1 AND (fetched_at >= $d OR as_of >= $d)`. Without the parentheses, edgar rows, whose as_of defaults to the write instant (marketdata_repo.go:601-604), are counted and D-51 comes back. pgxmock matches text, not semantics. The synthesis requires the exact parenthesised predicate, $1 bound to fmp.SourceName (no new 'fmp' literal), and a test with 30 edgar rows whose as_of is today (count 0). It stays blocking until the next proposal adopts it.",
        "blocking": true
      },
      {
        "text": "[C-11 / C-15, operator sign-off required] One acknowledgement covers (a) the FR-4(b) rewrite with no residual clause, (b) AC-5's first Then listing \"beta\" only (sector is a string, not a metric pointer: marketdata_service.go:2021-2038, marketdata.proto:213-218), (c) the new @AC-10, and (d) explicit acceptance of the re-fetch amplification cost (a deterministic 402 re-spends quote and profile per expired symbol per request and per fundsignal cycle; cap reached sooner; 215 ETF filler and 217 classification starved earlier; remedy marketdata.fmp.metrics=core). It also covers 5.5 if adopted. The operator's 2026-10-22 decisions sanction the expire-every-failure behaviour, but not the AC-5 or AC-10 text or the amplification cost. The yes must be recorded in context.md.",
        "blocking": true
      },
      {
        "text": "[ledger fails.md:1977-1989] `CASE WHEN $17` depends on pgx bool OID inference under QueryExecModeExec (DB_PGBOUNCER=true). The synthesis requires `$17::boolean` plus one real-Postgres DB_PGBOUNCER=true upsert test of the epoch branch. It must be named in the impl-spec test step.",
        "blocking": false
      },
      {
        "text": "[C-03 / operator trace rule] Only the upsert was detached. seedFromProfile (marketdata_service.go:1710/:1764) and maybeAlertQuota (:1713/:1765) die on a cancelled ctx. The synthesis adopts one `wctx := context.WithoutCancel(ctx)` for the whole post-fetch write/emit block. The proposer must confirm.",
        "blocking": false
      },
      {
        "text": "[C-18 / operability] A per-symbol, per-enrichment WARN floods the batch and screener paths once the cap is hit. The synthesis adopts one aggregated WarnContext per GetFundamentalsMulti call, listing SYM:enrichment pairs with their class.",
        "blocking": false
      },
      {
        "text": "[secret leakage / scheduling] fmp_client.go:243 wraps *url.Error with %w, and its text carries `apikey=` (:222-223). The synthesis decides now: the WARN logs only the class flag (cap/ctx/other) and the path, never the error string. 255 then does not depend on 254, and 254 is demoted to a soft rebase WARN row. A no-apikey-in-log test stays in 255.",
        "blocking": false
      },
      {
        "text": "[C-18 coupling] The as_of seed clause depends on toFundamentals(now) setting AsOf to the fetch instant (fmp_client.go:185, :333). The synthesis requires a 2-line constraint comment at :333 and a client test asserting AsOf is approximately now.",
        "blocking": false
      },
      {
        "text": "[C-16 doc drift, carried] Under the finnhub provider the D-51 FMP seed counts about 0, so a mid-day restart re-grants the full cap. Classification spend writes no row and stays uncounted. Both are accepted under the CLAUDE.md:82 'floor' wording and recorded in context.md.",
        "blocking": false
      },
      {
        "text": "[FR-5 scope, carried] The StreamBars RPC client still hangs after a manager give-up (marketdata_handler.go:37-54). AC-8 is met at the manager level only. Follow-up.",
        "blocking": false
      },
      {
        "text": "[D-19 residual, carried] A server that acks and then drops causes reconnects forever at a fixed delay. Accepted. Runner-up: a minimum session duration.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-10",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@feature-215 @AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@feature-215 @AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@feature-215 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@feature-217 @AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@feature-198 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@feature-196 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@feature-211 @AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@feature-211 @AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Narrow retryable class (cap/ctx only) with a residual cached-fresh 5xx/transport/decode (r2 synthesis). Lost: overruled by the operator decision of 2026-10-22, 'every failure stored expired, no residual'.",
      "Exported HTTP-status error type from getJSON. Lost: every failure class now gets the same treatment, so the type has no consumer (C-18), and it would edit fmp_client.go:254, which 254 also changes.",
      "Make 254 a hard merge-order predecessor to fix the apikey leak (r3 proposal). Lost: it gates a SEV-3 fix on a draft feature. Logging the class flag plus the path, with no error string, removes the leak with no dependency and no duplication of 254's fix.",
      "Log the raw rErr/pErr in the WARN. Lost: the :243 *url.Error text includes apikey=.",
      "One WARN per symbol per enrichment. Lost: it floods once the cap is hit mid-chunk. One aggregated WarnContext per call matches the warm-quote-poller precedent.",
      "Detach only the upsert ctx (r3 proposal). Lost: seedFromProfile and maybeAlertQuota on the same request-derived block would still die on a cancelled ctx (operator C-03 rule).",
      "Unparenthesised `fetched_at >= d OR as_of >= d` seed clause. Lost: it counts edgar rows and re-introduces D-51.",
      "Accept the seed under-count from epoch-stamped rows. Lost to the parenthesised as_of clause, because a deterministic 402 would epoch-stamp every fmp row and zero the boot seed.",
      "Unconditional COALESCE across sources. Lost: it would relabel values from a prior edgar row as source=fmp. The same-source guard is required.",
      "Skip the upsert on enrichment failure (edgarFinish precedent). Lost: it contradicts the operator's 'stores the partial row', and never-seen symbols get ResourceExhausted at cap (marketdata_service.go:1742-1746).",
      "Short negative TTL (now - ttl + retry_window). Lost: it needs a tunable or a hardcoded constant (F-07), and the operator mandated 'already expired'.",
      "Backdate to now() - ttl - 1s computed in the service. Lost to the epoch sentinel: it needs a repo signature change.",
      "A marker in extra_metrics. Lost: it leaks to the wire (marketdata_service.go:2052).",
      "A per-symbol error set from GetFundamentalsMulti. Lost: it changes the FundamentalsSource interface and the Finnhub client.",
      "A FailedEnrichments []string field. Lost to a single bool: no consumer.",
      "Add a (source, fetched_at) index (migration 010). Lost: one row per symbol, and idx_fundamentals_fetched_at is enough.",
      "A classification-spend count in the boot seed. Lost (YAGNI); floor semantics are documented instead."
    ],
    "open_risks": [
      "Re-fetch amplification, by design: a deterministic enrichment failure, such as the FMP-Free ratios-ttm 402, re-spends quote and profile reservations for every expired symbol on every request and on every feature-224 fundsignal cycle. The cap is reached sooner, starving the 215 ETF filler and the 217 classification refresh. The hard cap bounds the damage, and marketdata.fmp.metrics=core is the remedy. Needs the operator's acknowledgement.",
      "Epoch-stamped fetched_at changes the column's meaning for flagged rows. Any reader that displays fetched_at would show 1970. The impl spec must grep the marketdata_repo.go:526/:569 scan sites and the C-14 consumers before Step 5.",
      "If the operator rejects the 5.5 merge, an at-cap stale serve after a failed re-fetch returns NULL enrichment values that the prior row held, and that degradation is not surfaced on the stale response.",
      "The COALESCE merge mixes fresh quote values with prior-day enrichment values in one row whose as_of is today. This is acceptable only because the row is expired and served stale=true.",
      "The class-only WARN loses detailed diagnostics (HTTP status, decode cause) until 254 lands. A later follow-up could log urlErr.Err or the :254 status text.",
      "The pre-existing `now() AT TIME ZONE 'UTC'` timestamp vs timestamptz comparison in the seed query depends on the session time zone, and the new as_of clause inherits it.",
      "Merge conflicts with 215 (quota gates and alert path) and 254 (marketdata_service.go:1704/:1760, fmp_client.go:243). The UpsertFundamentals SQL and the seed WHERE are new touchpoints the rebase notes must list.",
      "Making fakeFundRepo source-, flag- and merge-aware may break existing tests that seed todayCount directly.",
      "D-19 healthy-session detection assumes Alpaca sends 'subscription' only after a successful auth+subscribe.",
      "StreamBars RPC clients still hang after a manager give-up (follow-up)."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-08",
      "C-11",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "F-07",
      "P-02",
      "P-03",
      "PLAT-N1"
    ],
    "rationale": "The r3 proposal answers the prior blocking mechanism objection. It confirms the epoch-CASE expire and the rewritten @AC-10. The operator's r2 decision ('every failure stored expired, no residual') removes the r2 residual clause and the narrow class, so `err != nil` at the enrichment call site is now the right predicate. A typed error would have no consumer.\n\nI verified the adversary's main claims in the worktree:\n- The conflict branch at marketdata_repo.go:594-600 overwrites every enrichment column with EXCLUDED.\n- fmp_client.go:243 wraps the *url.Error, whose text carries the apikey from :222-223. :254 already avoids the URL.\n- The enrichment loop at :192-199 silently drops errors today.\n- The seed query at :652-662 has no source filter yet, which is the D-51 edit.\n- seedFromProfile and maybeAlertQuota sit in the same request-derived block as the upsert (:1706-1713, :1762-1766).\n\nThe adversary's points are folded in as follows:\n- Low-cost, low-rework fixes adopted directly: `$17::boolean` with a real-PgBouncer test, the parenthesised seed predicate bound to fmp.SourceName, one wctx for the whole write/emit block, an aggregated WARN, the AsOf constraint comment and test.\n- 254 dependency: the hard dependency on draft 254 is replaced by class-only logging. That fixes the key leak without duplicating 254 and keeps 255 schedulable.\n- Stale-serve degradation: the synthesis proposes a same-source COALESCE merge. The source guard prevents edgar-to-fmp relabelling. Because it reaches beyond the operator's literal 'stores the partial row', it stays blocking pending the operator's choice.\n- Seed precedence: the fix is adopted but stays blocking until the proposer confirms it, per P-02 (an unanswered objection stays open).\n- Sign-off package: still blocking. No operator decision covers the AC-5/AC-10 text or the amplification cost.\n\nThere are no Floor breaches: there is no migration (F-01) and the epoch is a sentinel, not a tunable (F-07).\n\nFiles:\n- /home/user/xstockstrat/.claude/worktrees/wf_dcd9f6a8-fbb-47/services/xstockstrat-marketdata/internal/repository/marketdata_repo.go\n- /home/user/xstockstrat/.claude/worktrees/wf_dcd9f6a8-fbb-47/services/xstockstrat-marketdata/internal/fmp/fmp_client.go\n- /home/user/xstockstrat/.claude/worktrees/wf_dcd9f6a8-fbb-47/services/xstockstrat-marketdata/internal/service/marketdata_service.go\n- /home/user/xstockstrat/.claude/worktrees/wf_dcd9f6a8-fbb-47/services/xstockstrat-marketdata/internal/source/source.go"
  },
  "floor_breaches": []
}
```
