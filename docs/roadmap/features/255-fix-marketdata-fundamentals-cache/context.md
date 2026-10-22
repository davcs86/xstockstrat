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

## Session 2026-10-22 — sdd-batch design gate (round 4)

The full-mode `/sdd-design` debate stopped at the approval gate after round 4 (gate policy: halt). `design.md` has
not been written and `status.md` has not changed (still spec-ready). This entry records where the debate stands so
the next `/sdd-batch` run can pick it up.

### Open Threads

- **Approach (round-4 synthesis):** Steps 1-4 and 6 are unchanged from r1/r2 (D-50, D-51, D-52, D-53a, D-19).
  Step 5 (D-53b) adopts the r4 proposal, which takes in operator r3 decisions (1)-(4), with these amendments:
  - **S, source-id constants (new):** `fmp.SourceName` and `finnhub.SourceName` do not exist today. They are
    introduced at the client write sites (`fmp_client.go:334`, `finnhub_client.go:94`), and
    `classification.SourceFMP` becomes an alias of `fmp.SourceName`, so one named constant remains. If `go list -deps`
    shows an import cycle, the alias goes the other way. Repo seed/count methods take the source as a `string`
    parameter. C-18 waivers: `marketdata_repo.go:587` and `marketdata_service.go:1931/:1951`. S applies to Step 2 as
    well as 5.8.
  - **Classification:** the non-200 return at `fmp_client.go:254-255` becomes an unexported `*statusError` with
    byte-identical `Error()` text. A single `enrichmentExpires(err)` runs in this order: cap → ctx
    (cancel/deadline) → 402/403/404 exempt (cached fresh, honest missing_metrics) → everything else expires. Empty
    `nil, nil` stays a success.
  - **WARN:** one aggregated WARN per call, using the same class order (`cap`/`ctx`/`http_<code>`/`transport`/
    `read`/`decode`). The raw error is never logged.
  - **Write path:** epoch `fetched_at` via `$17::boolean`. A same-source COALESCE merge keeps last-known-good
    enrichment values on flagged overwrites (operator r3 (1)). One `wctx` covers the post-fetch write/emit block.
  - **Seed query:** the parenthesised `source = $1 AND (fetched_at >= $d OR as_of >= $d)` (operator r3 (3)).
  - **Spec text:** FR-4(b) with a provenance note. AC-5's first Then lists "beta" only. The @AC-10 trigger is pinned
    now to an FMP HTTP 503 on profile.
  - **Tests:** one per class, 4xx-exemption tests, a no-apikey-in-log test, pgxmock SQL tests, and one real-Postgres
    `DB_PGBOUNCER=true` epoch-branch test.
- **Strongest open objection (blocking):** the phantom-symbol risk (P-03/F-04, C-18). Steps 2 and 5.8 cited
  `fmp.SourceName`/`finnhub.SourceName`, which grep shows do not exist; only `classification.SourceFMP`
  (`sector.go:17`) does. The synthesis's fix S is not yet confirmed by the proposer, so the objection stays blocking
  (P-02) until the next proposal adopts S, so that `/sdd-spec` cannot write a non-existent symbol into Codebase
  Evidence.
- **Non-blocking, to record or confirm:**
  - C-11 wording gap: 400/401/429 and read failures fall in neither operator list. The proposal expires them. This
    needs an explicit operator acknowledgement, and changing it is a one-line `switch` edit.
  - The proposer must confirm the @AC-10 trigger pin to 503 (C-08/C-15).
  - Accepted budget blast radius: a persistent 5xx re-spends quote and ratios calls on every request, which starves
    the 215 filler and 217 classification.
  - as_of provenance after a merge, for feature-246 consumers.
  - The class order must be pinned by tests.
  - Carried: the FMP seed reads about 0 under finnhub; StreamBars hangs after a give-up (follow-up); D-19
    ack-then-drop.
- **Floor status:** no breaches. No migration (F-01) and no tunable (F-07). F-04 would be breached only if the
  phantom constant reached the spec.
- **Uncovered @AC changes:** none. @AC-1, @AC-5 and @AC-9 CHANGE and @AC-10 EXTEND are all covered by operator
  decisions. Everything else (@AC-2/3/4/6/7/8, @feature-215 @AC-5/@AC-7/@AC-14, @feature-217 @AC-4, @feature-198
  @AC-5, @feature-196 @AC-5, @feature-211 @AC-6/@AC-7) is PRESERVE.
- **Merge order:** 255 after 215, with a soft WARN row for 254 (which overlaps `fmp_client.go:254-255`). Rows are
  added only after a user yes. The fetched_at reader grep must run before Step 5.

```sdd-batch-design-state
{
  "round": 4,
  "synth": {
    "approach": "Round-4 synthesis. Line numbers were re-checked in the worktree.\n\n**Steps 1–4 and 6 stay as synthesized in r1/r2:**\n- D-50: comment and doc fixes, plus the cap-0 tests.\n- D-51: source-filtered counts and SeedFMPBudget.\n- D-52: vendor-axis fresh check; stale serves unchanged.\n- D-53a: decodeExtraMetrics.\n- D-19: manager ctx, URL seam, healthy flag, closeAllLocked.\n\nThere is one correction: the source constants (see S below) apply to Step 2 as well as 5.8.\n\n**Step 5 (D-53b) adopts the r4 proposal, amended as follows.**\n\n**S. Source-id constants [r4 amendment; neither constant exists today].**\n- grep finds no `SourceName` anywhere in `internal/`.\n- `fmp_client.go:334` is the bare literal `Source: \"fmp\"`, and `finnhub/finnhub_client.go:94` is the bare literal `Source: \"finnhub\"`.\n- The only named constant is `classification.SourceFMP = \"fmp\"` (`classification/sector.go:17`), used at `repository/classification_repo.go:149`.\n- Introduce `const SourceName = \"fmp\"` in package `fmp` and use it at `:334`. Introduce `const SourceName = \"finnhub\"` in package `finnhub` and use it at `finnhub_client.go:94`.\n- Make `classification.SourceFMP = fmp.SourceName`, so only one named constant remains (DRY guard rail).\n- `classification` currently imports no internal package, and `fmp` imports only `internal/source`. `/sdd-spec` must confirm with `go list -deps` that `source` does not import `classification`. If it does, there is a cycle; the fallback is to reuse `classification.SourceFMP` as the source of truth and have `fmp.SourceName` alias it.\n- The repo seed and count methods take the source id as a `string` parameter, so `repository` does not import `fmp` or `finnhub`. The service passes `fmp.SourceName` or `finnhub.SourceName`.\n- Waivers recorded under C-18: the fallback literal `\"fmp\"` at `marketdata_repo.go:587`, and the `\"finnhub\"` literals in the service provider switch at `marketdata_service.go:1931/:1951` (not on this fix's path).\n\n**5.1 Flag.** Add a transient `EnrichmentFailed bool` to `source.Fundamentals` (`source.go:62-64`). The FundamentalsSource interface does not change.\n\n**5.2′ One classification point.**\n- `getJSON`'s non-200 return (`fmp_client.go:254-255`) becomes an unexported `*statusError{path string; code int}`.\n- Its `Error()` text stays byte-identical: `\"fmp: %s returned HTTP %d\"`. It still carries no URL and no apikey.\n- The enrichment loop (`:195-200`) calls one unexported `enrichmentExpires(err) bool`, evaluated in this order (adversary r4):\n  1. nil → false.\n  2. `errors.Is(err, ErrFMPDailyCapExceeded)` → true (it arrives unwrapped from `reserve`, `:233`).\n  3. `errors.Is(err, context.Canceled)` or `errors.Is(err, context.DeadlineExceeded)` → true. This must come before any transport classification, because both the `:229` limiter wrap and the `:243` `*url.Error` wrap contain ctx errors.\n  4. `errors.As(err, &se)` with `se.code` in {402, 403, 404} → false. The row is cached fresh, the metric pointers stay nil, and missing_metrics is honest.\n  5. Everything else → true: 5xx, other non-200 codes, transport (`:243`), read (`:251`) and decode (`:258`) failures.\n- The three exempt codes live in one `switch`, not in a tunable or a list (C-18, F-07).\n- `nil, nil` (an empty array, `:280-282`, `:293-295`) is still a successful answer.\n\n**5.3′ WARN.**\n- One aggregated `slog.WarnContext` per GetFundamentalsMulti call, with entries `SYM:ratios|profile:class`.\n- `class` is one of `cap`, `ctx`, `http_<code>`, `transport`, `read`, `decode`, evaluated in the same order as 5.2′.\n- The raw `err.Error()` is never logged (the apikey is in the `:243` `*url.Error`).\n- Deterministic 4xx pairs are included under `http_40x`.\n- Tests: one per class, plus a no-apikey-in-log test.\n- 254 stays a soft rebase WARN row. Its overlap with the `:254-255` edit is listed in the merge-order notes.\n\n**5.4 Expire on write.**\n- In VALUES, `now()` (`marketdata_repo.go:593`) becomes `CASE WHEN $17::boolean THEN 'epoch'::timestamptz ELSE now() END`.\n- In the conflict branch, `fetched_at=now()` (`:600`) becomes `fetched_at=EXCLUDED.fetched_at`.\n- `$17 = f.EnrichmentFailed`. Fix the doc comment at `:572-573` in the same edit.\n\n**5.5 Keep last-known-good values on a flagged overwrite (operator r3 (1)).**\n- The enrichment columns at `:595-597` become `CASE WHEN $17::boolean AND fundamentals.source = EXCLUDED.source THEN COALESCE(EXCLUDED.<col>, fundamentals.<col>) ELSE EXCLUDED.<col> END`.\n- A deterministic 4xx row (`$17` false) is overwritten plainly.\n- [r4 note, adversary provenance] On a flagged merge, `as_of` is still overwritten. A later stale serve therefore shows prior enrichment values under today's `as_of`, with an empty missing_metrics. This is acceptable only because the row is served `stale=true`. State it in the FR-4(b) note and in context.md for feature-246 consumers.\n\n**5.6** Create one `wctx := context.WithoutCancel(ctx)` for the whole post-fetch write/emit block (`marketdata_service.go:1706-1713`, `:1762-1766`). The WARNs at `:1708/:1763` become `WarnContext(wctx, …)`.\n\n**5.7** Behaviour as stated in r3: the current call serves stale=false with an honest missing_metrics. The next call with budget re-fetches. The next call at cap serves stale=true, never ResourceExhausted (`@feature-215 @AC-7`).\n\n**5.8 Seed query (operator r3 (3)).**\n- `CountFundamentalsFetchedToday` (`marketdata_repo.go:652-662`) becomes `WHERE source = $1 AND (fetched_at >= $d OR as_of >= $d)`.\n- `$1` is the parameter passed as `fmp.SourceName` (per S). `$d` is the existing UTC-day expression, unchanged.\n- The Finnhub window query is source-filtered with `finnhub.SourceName` and gets no as_of clause.\n- Tests:\n  - 30 edgar rows with as_of today count 0.\n  - Epoch-stamped fmp rows with as_of today are counted.\n- Add a 2-line constraint comment at `:333` (`AsOf: now`) and a client test that AsOf is approximately now.\n\n**5.9 Tests.**\n- AC-5 test (cap-exceeded profile).\n- A 503-profile sibling test.\n- AC-10 test.\n- 4xx-exemption tests: a 404 profile and a 402 ratios. Each stores a row with a non-epoch fetched_at, the next call within TTL makes no FMP call, and missing_metrics lists the metrics.\n- A ctx-cancel-after-quote test showing the row persists via wctx.\n- pgxmock SQL tests for the CASE, the merge and the seed WHERE.\n- One real-Postgres `DB_PGBOUNCER=true` epoch-branch upsert test (ledger fails.md:1977-1989).\n- Make fakeFundRepo source-, flag- and merge-aware.\n\n**Spec text (operator r3 (4) sign-off).**\n- FR-4(b) as worded in the r4 proposal, plus the 5.5 provenance note.\n- AC-5: the first Then lists \"beta\" only.\n- [r4 amendment, fixed now rather than deferred to /sdd-spec] The failure trigger of @AC-10 is pinned to a transient class, an FMP HTTP 503 on profile. If the r3-synthesis text named a 402/403/404, the swap to 503 is recorded in context.md under the r3 sign-off as a consistency edit required by operator r3 (2). No new @AC is added for the 4xx exemption; unit tests pin it.\n\n**Housekeeping.**\n- Merge order: 255 after 215, with a soft WARN row for 254. Rows are added only after a user yes.\n- Read-only C-14 checks: agent `tools.py:402/:812`, `traderBff.ts`, `insightsBff.ts`.\n- The fetched_at reader grep must run before Step 5.",
    "open_objections": [
      {
        "text": "[P-03/F-04 risk, C-18 DRY] Steps 2 and 5.8 cite `fmp.SourceName` and `finnhub.SourceName`, and neither exists. I verified this: grep finds no `SourceName` in `internal/`. `fmp_client.go:334` is the literal `\"fmp\"`, `finnhub_client.go:94` is the literal `\"finnhub\"`, and the only named constant is `classification.SourceFMP` (`sector.go:17`). The synthesis fixes it with S: introduce both constants at their client write sites, alias `classification.SourceFMP = fmp.SourceName` (checking for an import cycle, with a reverse-alias fallback), have the repo methods take source as a parameter, and record waivers for the literals at `:587` and `:1931/:1951`. The proposer has not yet answered it. It stays blocking until the next proposal adopts S, so that /sdd-spec does not write a phantom symbol into Codebase Evidence.",
        "blocking": true
      },
      {
        "text": "[C-11 / operator wording gap] Operator r3 (2) exempts 402/403/404 and says that only cap-exceeded, cancel/deadline, 5xx, transport and decode failures expire. HTTP 400, 401 and 429 (and the read-body failure at `:251`) fall in neither list. The proposal treats them as expiring. This is sound: 401 means a bad or rotated key, and 429 is transient. It is still an assumption on an operator-defined boundary. Record it in context.md as an explicit operator acknowledgement alongside the r3 sign-off. If the operator disagrees, it is a one-line `switch` change.",
        "blocking": false
      },
      {
        "text": "[C-08/C-15] The trigger for @AC-10 was left conditional ('/sdd-spec must check word for word'). The synthesis pins it now to an FMP HTTP 503 on profile, which is transient under operator r3 (2), and records any swap in context.md. The proposer must confirm.",
        "blocking": false
      },
      {
        "text": "[operator r2 residual, budget] Under a persistent 5xx, an epoch-expired row never caches. Every request re-spends the counted quote and ratios calls (only non-200 responses are refunded, `fmp_client.go:235-240`), which drains the shared day budget the 217 classification refresh and the 215 ETF filler also use (the filler stops at 80%). The operator r2 decision mandates expiry, so this stands, but the blast radius must be recorded in context.md as an accepted cost. A bounded retry window (`now()-ttl+N`) is open to the operator only as a future decision.",
        "blocking": false
      },
      {
        "text": "[data provenance] On a flagged merge, the 5.5 COALESCE keeps the prior enrichment values but overwrites as_of with today. A later stale serve shows old enrichment under a fresh as_of, with an empty missing_metrics. This is acceptable because the row is served stale=true, but it must be stated in the FR-4(b) note and in context.md (for feature-246 consumers).",
        "blocking": false
      },
      {
        "text": "[classification ordering] `enrichmentExpires` and the WARN class must use the same order: errors.Is(ErrFMPDailyCapExceeded), then errors.Is(context.Canceled/DeadlineExceeded), then errors.As(statusError), then transport/read/decode. Ctx errors arrive wrapped by both the limiter (`:229`) and the `*url.Error` (`:243`). Pin it with one test per class.",
        "blocking": false
      },
      {
        "text": "[ledger fails.md:1977-1989] `$17::boolean` plus one real-Postgres DB_PGBOUNCER=true epoch-branch upsert test must be named in the impl-spec test step.",
        "blocking": false
      },
      {
        "text": "[C-16 doc drift, carried] Under the finnhub provider the FMP seed counts about 0, and classification spend writes no row. Both are accepted under floor semantics and recorded in context.md.",
        "blocking": false
      },
      {
        "text": "[FR-5 scope, carried] The StreamBars RPC client still hangs after a manager give-up (marketdata_handler.go:37-54). Follow-up.",
        "blocking": false
      },
      {
        "text": "[D-19 residual, carried] A server that acks and then drops causes reconnects forever at a fixed delay. Accepted.",
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
        "covered_by_operator_decision": true
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
        "covered_by_operator_decision": true
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
      "Cite a pre-existing `fmp.SourceName` or `finnhub.SourceName` (r1–r4 text). Lost: neither exists, which would put a phantom symbol into the spec (F-04).",
      "Create `fmp.SourceName` alongside `classification.SourceFMP`. Lost: two named constants for one vendor id (DRY guard rail). Alias one to the other.",
      "Make the fmp client import `classification.SourceFMP` directly. Lost as the primary option because the snapshot-source id has an odd home in classification. Kept as the fallback if aliasing creates an import cycle.",
      "Have the repo import `fmp` for the seed constant. Lost: it inverts the dependency direction. The repo takes source as a parameter instead.",
      "Expire on every enrichment failure, including 402/403/404 (r2/r3 wording). Lost to operator r3 (2): it burns quota and starves the filler and classification.",
      "Unexported status-error rejected as 'no consumer' (r3). Superseded: the 4xx exemption is now a real, package-internal consumer.",
      "Exempt all 4xx except 429. Lost: it goes beyond the operator's explicit 402/403/404 list, and a 401 (bad key) would stay cached fresh for a TTL after the key is fixed.",
      "Leave the @AC-10 trigger to be checked or swapped at /sdd-spec. Lost: it leaves an acceptance scenario's meaning open after sign-off (C-15). The trigger is pinned now.",
      "Bounded retry window (now()-ttl+N) instead of epoch. Lost: the operator r2 decision mandates 'already expired', and the window needs a fixed invariant or a tunable (F-07). The operator may revisit it.",
      "Skip the upsert on a transient failure (edgarFinish precedent). Lost: superseded by operator r3 (1), and never-seen symbols would get ResourceExhausted at cap.",
      "Unconditional cross-source COALESCE. Lost: it relabels edgar values as fmp.",
      "Unparenthesised seed OR clause. Lost: it counts edgar rows, which re-introduces D-51.",
      "Log the raw rErr/pErr. Lost: the `:243` *url.Error text carries apikey=.",
      "One WARN per symbol per enrichment. Lost: it floods once the cap is hit.",
      "Detach only the upsert ctx. Lost: seedFromProfile and maybeAlertQuota would still die on a cancelled ctx (operator C-03 rule).",
      "Make 254 a hard predecessor. Lost: class-only logging removes the leak without that dependency.",
      "A marker in extra_metrics, a per-symbol error set, a FailedEnrichments slice, or a migration 010 index. Lost for the reasons recorded in r3: wire leak, interface churn, no consumer, not needed."
    ],
    "open_risks": [
      "A 403 classed as deterministic may sometimes be transient at FMP (a suspended key, or a per-minute limit). The row would then be pinned fresh with missing metrics for one TTL. This is bounded, visible as `http_403` in the WARN, and sanctioned by the operator, but it is the classification most likely to be wrong in production.",
      "Re-fetch amplification under a persistent transient failure (5xx or transport): counted quote and ratios calls are re-spent on every request and every fundsignal cycle, reaching the cap earlier and starving the 215 filler and 217 classification. The hard cap bounds it, and it is now limited to transient classes because deterministic 4xx responses are cached and refunded.",
      "Aliasing `classification.SourceFMP = fmp.SourceName` adds an import edge from classification to fmp. If `internal/source` (or anything fmp imports) imports classification, it is a cycle and the reverse-alias fallback applies.",
      "Epoch-stamped fetched_at would show as 1970 to any reader that displays it. Grep the repo scan sites and the C-14 consumers before Step 5.",
      "After a COALESCE merge, a stale-served row carries prior-day enrichment under today's as_of, with an empty missing_metrics.",
      "Class-only WARNs lose detailed diagnostics until 254 lands.",
      "The pre-existing `now() AT TIME ZONE 'UTC'` timestamp/timestamptz comparison depends on the session time zone, and the new as_of clause inherits it.",
      "Rebase conflicts with 215 and 254 at `fmp_client.go:243/:254-255` and `marketdata_service.go:1704/:1760`, plus the new upsert SQL and seed WHERE touchpoints.",
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
      "F-04",
      "F-07",
      "P-02",
      "P-03",
      "PLAT-N1"
    ],
    "rationale": "The r4 proposal adopts operator r3 decisions (1) through (4). That concretely closes the three prior blocking objections:\n- The same-source COALESCE merge is operator-approved.\n- The seed predicate is parenthesised.\n- The FR-4(b), AC-5 and AC-10 package is signed off, and it must be recorded in context.md.\n\nThe operator's 4xx exemption gives the unexported statusError a real consumer, so the r3 \"no consumer\" rejection no longer applies. The edit is confined to the single non-200 return at `fmp_client.go:254-255`, and its Error() text is unchanged.\n\nThe adversary's blocking point is correct, and I verified it:\n- grep finds no `SourceName` anywhere in `internal/`.\n- `fmp_client.go:334` and `finnhub_client.go:94` are bare literals.\n- `classification.SourceFMP` (`sector.go:17`) is the only named constant, and it is already used at `classification_repo.go:149`.\n- The r1–r3 syntheses carried the same phantom for finnhub too.\n\nThe synthesis therefore adds S: a constant at each client write site, one alias for classification, the repo taking source as a parameter, and a cycle check (`classification` imports no internal package today; `fmp` imports only `source`). Under P-02 the objection stays blocking until the next proposal adopts S.\n\nThe other adversary points are adopted directly:\n- The classification order. Ctx errors arrive wrapped at `:229` and `:243`, and the cap error arrives unwrapped from `:233`, which I verified.\n- Pinning the @AC-10 trigger to a 503 now.\n- Recording the as_of provenance note and the budget blast radius.\n\nI raised one new non-blocking C-11 gap. The operator's expire list and exempt list together leave 400, 401, 429 and read failures unassigned. The proposal's choice (expire) is sound but needs explicit acknowledgement.\n\nThere are no Floor breaches: no migration (F-01) and no tunable (F-07). F-04 becomes a breach only if the phantom constant reaches the spec.\n\nFiles (under `/home/user/xstockstrat/.claude/worktrees/wf_dcd9f6a8-fbb-47/services/xstockstrat-marketdata/internal/`):\n- `fmp/fmp_client.go`\n- `finnhub/finnhub_client.go`\n- `classification/sector.go`\n- `repository/marketdata_repo.go`\n- `repository/classification_repo.go`\n- `service/marketdata_service.go`\n- `source/source.go`"
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: recon.md was already written (services: xstockstrat-marketdata; reuse patterns: the `cacheAxis`
  source-aware check at `marketdata_service.go:1849-1850`, and the single `atQuotaAlertThreshold` home at `:1959`).
- Phase 1 Grilling: 4 rounds (full). The operator approved at the r4 gate, "APPROVED as synthesized", and the Floor
  was clear.
  - Chosen approach: comment/doc-only cap-0 fix (D-50); source-filtered counts plus a `SeedFMPBudget` seam (D-51);
    a vendor-axis fresh check (D-52); `decodeExtraMetrics` (D-53a); and, for D-53b, a classified enrichment failure
    stored already-expired (an epoch `fetched_at`) with a same-source COALESCE merge. D-19 adds a stream-manager
    ctx, a URL seam, a healthy-session reset and `closeAllLocked`.
  - Rejected: skip-upsert, expiring on every failure, a bounded retry window, a cross-source COALESCE, logging the
    raw error, and a phantom `SourceName` (see design.md §Rejected Alternatives).
- Constitution rules touched: C-03, C-08, C-11, C-14, C-15, C-16, C-18, F-01, F-04, F-07, P-02, P-03, PLAT-N1.
  Floor breaches: none.
- Status: spec-ready → design-approved.
- Resumed after a cut session. design.md was written from the round-4 final synthesized state recorded above.

### Decisions

- **Operator 2026-10-22, design gate r2:** expire-instead-of-fresh applies to enrichment failures. No residual is
  accepted for transient failures.
- **Operator 2026-10-22, design gate r3:** four decisions.
  1. ADOPT step 5.5. On a flagged overwrite, last-known-good enrichment values are kept through the same-source
     COALESCE merge, so edgar values are never relabelled as fmp. The row is still stored expired.
  2. EXEMPT deterministic FMP 4xx (402/403/404) from expiry. These are cached fresh with an honest missing_metrics.
     Only cap-exceeded, cancel/deadline, 5xx, transport and decode failures expire the row. This narrows the r2
     "every failure" wording.
  3. ADOPT the parenthesised D-51 seed predicate `source = $1 AND (fetched_at >= $d OR as_of >= $d)`, with
     `fmp.SourceName` and the 30-edgar-rows test.
  4. SIGN-OFF on three spec edits: the FR-4(b) rewrite reflecting (2), AC-5's first Then listing "beta" only, and
     the new @AC-10 as rewritten in the r3 synthesis.
- **Operator 2026-10-22, design gate r4:** APPROVED as synthesized, including S:
  - introduce `fmp.SourceName`/`finnhub.SourceName` at the client write sites;
  - alias `classification.SourceFMP` to `fmp.SourceName` (`go list -deps` cycle check, with a reverse-alias
    fallback);
  - repo count/seed methods take the source as a parameter.
  - The @AC-10 trigger is pinned to a transient FMP HTTP 503 on profile. If the r3-synthesis @AC-10 text named a
    402/403/404, the swap to 503 is a consistency edit required by r3 (2).
- **Acknowledged with the r4 approval (C-11):** HTTP 400, 401 and 429 and read-body failures are in neither the
  operator's expire list nor the exempt list. The design expires them. Changing that later is a one-line `switch`
  edit.
- **Accepted cost (operator r2):** under a persistent 5xx/transport failure, every request and fundsignal cycle
  re-spends the counted quote/ratios calls. That reaches the cap earlier and starves the 215 filler and 217
  classification. The hard cap bounds the cost. A bounded retry window remains open to the operator as a future
  decision only.
- **Note for feature-246 consumers (provenance):** after a flagged merge, `as_of` is today but the enrichment values
  are prior-day, and missing_metrics is empty. This is acceptable only because the row is served `stale=true`.
- No `010` index migration. Merge-order rows (255 after 215; a soft WARN row for 254) are still pending a user yes.

### Open Threads

- [ ] A 403 classed as deterministic may be transient at FMP (pinned fresh for one TTL; visible as `http_403`). →
  Step 5 tests and PR note.
- [ ] Unassigned 4xx codes (400/401/429/read) expire. → Step 5 PR, operator-visible.
- [ ] Re-fetch amplification under persistent transient failures. → Step 5 PR note.
- [ ] Possible import cycle from `classification.SourceFMP = fmp.SourceName`; the reverse alias is the fallback. →
  `/sdd-spec` (`go list -deps`).
- [ ] Epoch `fetched_at` shows as 1970 to display readers. → grep the fetched_at readers (repo scan sites
  `:526`/`:569` and the C-14 consumers) before Step 5.
- [ ] After a COALESCE merge, prior enrichment appears under today's `as_of`. → FR-4(b) note at `/sdd-spec`.
- [ ] Class-only WARNs lose detail until 254 lands. → 254.
- [ ] The `now() AT TIME ZONE 'UTC'` session-TZ dependence is inherited by the new as_of clause. → Step 5.8.
- [ ] Rebase conflicts with 215/254 (`fmp_client.go:243`/`:254-255`, `marketdata_service.go:1704`/`:1760`, the
  upsert SQL, the seed WHERE). → merge-order rows, on a user yes.
- [ ] A source/flag/merge-aware `fakeFundRepo` may break tests that seed `todayCount` directly. → Steps 2 and 5.
- [ ] Under the finnhub provider the FMP seed is about 0, and classification spend writes no row (floor semantics).
  → Step 2 docs.
- [ ] D-19 assumes Alpaca sends `subscription` only after a successful auth+subscribe. → Step 6 test.
- [ ] A server that acks then drops reconnects forever at a fixed delay (accepted). → Step 6 PR note.
- [ ] StreamBars RPC clients still hang after a manager give-up (`marketdata_handler.go:37-54`). → follow-up
  feature.
- [ ] `/sdd-spec` must apply the acceptance.feature and product-spec edits: rewrite AC-5, add @AC-10, rewrite
  FR-4(b).

## Session 2026-10-22 — sdd-spec

- Generated `implementation-spec.md` with 17 steps: 1 docs, 7 service, 9 test.
- Status: design-approved → implementation-ready.
- This session resumed a cut run. The design phase was already complete on the branch, and no spec draft existed.
- The spec-text edits that design.md assigned to /sdd-spec were applied (operator r3 (4) and r4 sign-off):
  - `acceptance.feature`:
    - AC-5's first Then now lists "beta" only.
    - AC-6's input is refined to the jsonb object `{"total_debt":"n/a"}`, which really fails the
      `map[string]float64` decode (design Step 4).
    - New `@AC-10 @FR-3 @FR-4 @regression`, pinned to an FMP HTTP 503 on profile.
  - `product-spec.md`: FR-4(b) is rewritten. It now covers the transient vs deterministic (402/403/404) split, the
    class-only aggregated WARN, and the same-source merge provenance note for feature-246 consumers.
- Key codebase findings. These were taken at branch tip 818be318, where the marketdata tree is identical to
  origin/main-dev 111b4e25.
  - **Import cycle (S):** none.
    - `classification` and `source` import no internal package.
    - `fmp` and `finnhub` import only `source`.
    - So the primary alias `classification.SourceFMP = fmp.SourceName` closes no cycle.
    - The service does not import `finnhub` yet; Step 5 adds that import.
  - **Repo read paths:** `GetFundamentals` (`marketdata_repo.go:531`) and both count methods read through `r.pool`,
    not through the pgxmock-able `r.db`. Steps 5 and 9 switch them to `r.db`, which is the same pool in production.
  - **`fetched_at` readers:** it is read only in `marketdata_repo.go` and is not on the wire
    (`marketdata.proto:221-242`). The epoch sentinel therefore cannot show as 1970 on any C-14 surface. This closes
    the "fetched_at reader grep" thread.
  - **Live-Postgres harness: Not found** in marketdata. Step 14 creates an env-gated `fundamentals_livedb_test.go`
    for the DB_PGBOUNCER epoch and seed-predicate proof. It skips when `DATABASE_URL` is unset, so it skips in CI.
  - **Websocket test server: Not found.** Step 16 builds one from httptest and `websocket.Accept`.
  - **Test fake:** `fakeFundRepo.todayCount`/`sinceCount` have 17 references. Step 6 replaces them with per-source
    maps.
- Sequencing: design 5.8's parenthesised seed predicate lands in Step 5, together with the D-51 source filter, so
  the same SQL is not edited twice.
- Step 2 (the AC-1/AC-9 pins) is TDD N/A by design. FR-1 changes no behaviour, so a red cannot be proved.
- The merge-order rows (255 after 215; a soft WARN row for 254) are still pending an operator yes. They are not
  added.
- Housekeeping: this session deleted a pre-existing `cp.sh` in the shared workflow scratchpad, mistaking it for its
  own helper. Re-create it if another run relied on it.

### Open Threads (update)

- [x] Import cycle from `classification.SourceFMP = fmp.SourceName`: there is none (checked by grepping the internal
  imports). The fallback stays documented in Step 3.
- [x] Epoch `fetched_at` visible to display readers: no such reader exists (the field is repo-only and not on the
  wire).
- [x] The acceptance.feature and product-spec edits are applied (AC-5, AC-6 input, @AC-10, FR-4(b)).
- [ ] The live-DB epoch/seed test cannot run in CI. → the Step 14 PR records where it ran.
- Next: `/sdd-review fix-marketdata-fundamentals-cache impl-spec`.

## Session 2026-10-22 — sdd-review impl-spec (advisory)

- Result: 0 failures, 7 warnings; overlap WARN (file-level, with 215). Advisory, so the lifecycle is unchanged
  (`implementation-ready`).
- Addressed in `implementation-spec.md`:
  - [x] Steps 2, 4, 8, 10 (B2 / C-08): each now runs the CI `>= 40%` total coverage command. The "no threshold
    applies" text is replaced.
  - [x] Step 9 (C-01): the symbol local is pinned as `sym` at all three decode sites. The var blocks are at
    `marketdata_repo.go:534`/`:824`/`:873`, scanned at `:539`/`:830`/`:879`.
  - [x] Step 3 (F-09): the dead import-cycle fallback is removed. A cycle at build time is now a P-03 stop.
  - [x] Step 4: re-verification found a real test-only import cycle. An in-package `fmp` test cannot import
    `classification` once `classification` imports `fmp`. The alias assertion moves to
    `internal/classification/sector_test.go`, which is added to Step 4's Files.
  - [x] Step 11 (F-09): `stageError{stage, err}` is pinned. It wraps `:243`/`:251`/`:258`, `Error()` delegates to the
    wrapped error so the text stays byte-identical, and `Unwrap` keeps the ctx chain. `io.ReadAll` and
    `json.Unmarshal` errors have no shared type, so the stages cannot be told apart without it.
  - [x] Step 14 (ledger fails.md 2026-09-01): the live-DB run record in the step PR is now mandatory and part of
    the step's verification.
- Acknowledged, no edit:
  - Steps 1 and 17 have no lint or coverage command. They make no code change, so this is acceptable.
  - The file count in Steps 6 and 14 and the shared `source.go`/finnhub import edits are advisory only. The
    design is minimal.

### Open Threads (sdd-review impl-spec)

- [ ] Step 11: the WARN class label for unstaged enrichment errors (`fmp_client.go:226` build request, and a non-ctx
  limiter error at `:229`, e.g. "would exceed context deadline") is not one of the design's six classes
  (cap/ctx/http_<code>/transport/read/decode). They still expire (rule 5). The executor must ask the operator
  for the label (for example `other`) and must not choose one silently (C-11).
- [ ] Merge-order rows are still pending an operator yes: `fix-marketdata-fundamentals-cache` blocked by
  `block-fundamentals-strategy-on-etf` (215), plus a soft WARN row for `fix-marketdata-secret-exposure` (254).
- [ ] Overlap WARN with 215, file-level only: `marketdata_service.go`, `source/source.go`, `fmp/fmp_client.go`,
  `finnhub/finnhub_client.go` and `cmd/server/main.go`. 215 Step 7 is `done` on its branch, so re-check the line
  anchors after the rebase. There is no proto, migration or config-key collision.
- [ ] Peer-batch overlap is UNVERIFIED (the peer directories were not in the review worktree), and so is 254's
  overlap (its directory and ref were not found). Re-scan before execution.
- [ ] The Step 14 live-DB test skips in CI (carried forward). The mandatory PR record now tracks it.
- Next: `/sdd-execute fix-marketdata-fundamentals-cache`.
