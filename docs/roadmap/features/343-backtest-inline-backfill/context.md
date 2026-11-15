# Context: backtest-inline-backfill

**Feature**: `docs/roadmap/features/343-backtest-inline-backfill/feature.md`
**Product Spec**: `docs/roadmap/features/343-backtest-inline-backfill/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/343-backtest-inline-backfill/implementation-spec.md`

---

## Session 2026-11-15 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from an operator report (staging, homelab, with screenshots) and same-day read-only recon.
- Operator decisions (2026-11-15): backfill the **missing range only**; after completion show a **re-run action** (no automatic re-run); **try to open the action to everyone**; if that requires a lot of changes, **replace the section with strategy scores only, default "not enough data", no actions at all**.
- Interpretation (mine): "Yes to the rerun action" answered a recommendation of inline progress + a "data ready, re-run" state over automatic re-run; read as accepting that. "The section" in the fallback is read as the Backtests card on the symbol page; confirm in design.
- @AC-7 and @AC-8 are mutually exclusive — design picks FR-6 or FR-7 and the losing scenario is struck, not renumbered.
- Recon facts: `page.tsx:1226-1240` (insufficient-data callout), `:1405-1415` (panel trigger: no range, BARS, 1Day, admin-only UI), `hooks/useBacktest.ts:19-23` (`useTriggerBackfill`), `insightsBff.ts:86-88` (BFF `forward`, no admin gate), ingest `servicer.py:417-425` (`admin scope required`), analysis `servicer.py:1578` (gap = prefix start → window start).

## Session 2026-11-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (8; overall PASS WITH WARNINGS, no fails, no floor breaches):
  - Resolved in this session:
    - FR-5 named partial and canceled but only @AC-6 (failed) covered it — added @AC-9 (Scenario Outline, PARTIAL and CANCELED); FR-5 now reads "with the job's error when one is reported" (a canceled job may carry none). @AC-9 belongs to the FR-6 branch, so the Open Questions line now reads "@AC-1…@AC-7 and @AC-9 are authoritative if FR-6 is chosen".
    - C-14 Agent box: left unchecked with the reason stated — the Agent `trigger_backfill` tool and the `strat-lab` `backtest` skill are in scope in the same PR only if FR-6 is chosen and the `TriggerBackfill` admin gate opens; design ticks the box then.
    - Latent config key: the Config Key Changes line now says a per-user backfill limit key, if added, carries the full config-key contract with a namespace-relative stored key (C-05, F-07).
    - Problem Statement names the persona ("the trader").
  - Carried to design:
    - FR-6 vs FR-7 is ticked in Open Questions but is a deferred process decision, not a resolved one: the operator picks at the design gate; design must not proceed silently (C-11).
    - @AC-2 ("a daily-bars backfill is requested … from 2023-03-17 to 2024-01-01") and @AC-5 ("a backtest … is requested") assert a request rather than what the card shows. Left as written — the range is the point of FR-2 and no UI copy for it is decided; design may reword to an observable outcome.
    - "No proto changes" is unchecked pending design; the FR-7 fallback needs an existing RPC as its score source and design must name it.
    - The ingest `TriggerBackfill` admin gate was added deliberately in feature 092 to protect vendor quota (`services/xstockstrat-ingest/tests/test_ingest_servicer.py:362-384`); opening it is a quota-exposure risk design must cost. The e2e at `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts:337` asserts /Backfill coverage panel/ and must be handled on either branch. `coverage_gaps` exists at `packages/proto/analysis/v1/analysis.proto:136`.
- Overlap findings (WARN; file-level, soft — no config, proto, or migration collision; peers 339–342 and 344 are all `draft`):
  - [file] `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` shared with `339-fix-symbol-page-alerts-ui` (Research tab Fundamentals card vs this feature's Analysis → Backtests card). Disjoint regions; whichever merges second rebases.
  - [service] `xstockstrat-ingest` shared with `344-alert-detail-page` (backfill-failure alert body vs `TriggerBackfill` authorization). No shared file or key named; re-check at impl-spec.
  - [ui] `xstockstrat-ui` also shared with `342-chart-series-palette`, `341-fix-indicator-pane-warmup`, `344-alert-detail-page` — different surfaces, low risk.
  - `strat-lab` `backtest` skill must update in the same PR if the admin gate changes (`docs/patterns/strat-lab-plugin.md`) — not a peer collision.
  - Historical: `merge-order.md` rows for 052/053/054 cover `ingest.backfill_jobs` and `BackfillJob` field numbers; this feature adds no proto field and no migration, so no new collision.
  - Merge-order: no entry for 343 and none required now. Re-check at impl-spec if the FR-6 path adds an ingest migration or a config key.
- Recommended design depth: full (2 affected services; warning-level overlap)

OPERATOR DECISIONS (binding, recorded 2026-11-15):
- Backfill only the missing range reported by the backtest, not full history.
- After the backfill completes show a re-run action; do not re-run automatically.
- Try to open the backfill action to every authenticated user. If that requires a lot of changes, replace the section with strategy scores only, defaulting to 'not enough data' with no actions at all.
- The operator set the fallback but not the threshold for 'a lot of changes': the design must present the cost of opening the trigger to non-admins at the design gate rather than choose silently.

## Session 2026-11-15 — sdd-batch design gate (round 2)

- `/sdd-design backtest-inline-backfill` full debate halted at its approval gate after round 2 (gate policy: halt). `design.md` is not written and `status.md` is unchanged (`spec-ready`). Register: `debate.md` (D-1…D-7 settled, R-1…R-3 locked, O-1…O-9 closed, O-10…O-18 open, no petitions).

### Open Threads

- **Approach (round 2 best)**: FR-6 through a narrow server-side self-serve envelope on ingest `TriggerBackfill` (D-1), recommended tier **T1** (D-4): one symbol, BARS, `FILL_MODE_GAPS_ONLY`, no overwrite, explicit `start < end`, span ≤ new WatchConfig key `ingest` / `backfill.self_serve_max_range_days` (int, default 730, config seed migration `050`), empty `callback_url`, and a non-empty non-`system` `x-user-id`. Admin behaviour unchanged; no proto change, no ingest migration. The card requests exactly the reported `gap` (D-5), keeps its own `jobId` in local state and re-runs through `handleRun` with no automatic re-run and no BFF change (D-2); a same-gap second insufficient result after a COMPLETED backfill shows "No vendor data for {range}" (D-7). Server proof of @AC-7 is one table-driven ingest test with real requests (D-6). Agent tool docs, `docs/runbooks/mcp-tools.md` and the `strat-lab` `backtest` skill change in the same PR as the ingest change (C-14).
- **Operator must answer at the gate**: (1) tier — T0 / T1 (recommended) / T1+ / T1-L / T2 / FR-7 (D-3; T1+ and T1-L are not yet costed, O-17); (2) **G-2** — widen the request to `{gap.start .. requestedRange.end}`, which amends FR-2/@AC-2 and operator decision 1; (3) **G-3** — switch the insights strategy page backfill button to GAPS_ONLY, which changes admin behaviour there and opens a second surface to non-admins.
- **Strongest open objection**: **O-12** (blocking, C-15/C-14) — switching the insights button (`insights/strategies/[id]/page.tsx:541-547`) to GAPS_ONLY is an unsanctioned behaviour and scope change with no @AC. The synthesis keeps it FULL through a shared `gapToBackfillRequest(gap, {fillMode})`; the proposer has not yet confirmed. Also blocking and unanswered: **O-10** (no `user_id` in the `ingest.backfill.queued` payload — ledger already stamps the owner from `x-user-id` metadata; add a metadata test) and **O-11** (PARTIAL copy needs two branches, since PARTIAL occurs with zero failed chunks at `servicer.py:739-740`). Non-blocking O-13…O-18 are open too; the proposal predates all nine round-2 points.
- **Floor status**: no Floor breach (`floor_breaches` is empty in both the synthesis and the round).
- **@AC changes not covered by an operator decision** (must be shown at the gate):
  - `343@AC-9` — **CHANGE**: example strings rewritten to server-true copy (O-18).
  - `343@AC-3`, `343@AC-6` — EXTEND (zero-denominator progress; failure copy from chunk counts when `error` is empty).
  - `244@AC-6` (`docs/sdd/business-rules/platform.feature`) — EXTEND: a row for the new key (O-15).
  - `343@AC-1`, `343@AC-5`, `270@AC-4` — PRESERVE.
  - Covered by operator decisions: `343@AC-2`, `343@AC-4`, `343@AC-8` (PRESERVE), `343@AC-7` (EXTEND through the denial scenarios).
  - Net-new scenarios due at /sdd-spec: zero-denominator progress, "No vendor data", the over-cap non-admin denial, both PARTIAL branches.
- **Carried risks**: request-count flooding under T1 (global `backfill.max_concurrent_jobs`, default 3, is the only bound); a definition-path re-run can return OK with zero trades unless G-2 is sanctioned; the 730 default is coupled to analysis `backtest.max_range_days` by documentation only; T1 adds xstockstrat-config as an affected service and a new-config-key approval that `feature.md` does not yet list; config migration number `050` may collide with a batch peer (re-check at /sdd-spec); `339-fix-symbol-page-alerts-ui` shares the symbol page file.
- The relayed user request for this batch (Q2/Q3) concerns the alert page and the batch kickoff; it reopens nothing here.

Resume state for the next `/sdd-batch` run (do not edit by hand):

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round 2 best approach: the round-1 shape (D-1, D-2, D-3) with tier T1 as the recommended default, plus five corrections from the adversary that I checked against the code. The proposer has not yet answered those corrections, so they are open objections O-10 to O-18.\n\n**Ingest (`services/xstockstrat-ingest/app/handlers/servicer.py`)**\n- Add a pure predicate `_is_self_serve_backfill(request, max_days)`. The gate at `:423` becomes `if not self._has_admin_scope(context) and not _is_self_serve_backfill(...)`. It keeps its position: after the `_db` check (`:418`), before the 1d check (`:442`) and before callback validation (`:448`).\n- The envelope is all of:\n  - exactly one symbol;\n  - data kind UNSPECIFIED or BARS;\n  - `fill_mode == FILL_MODE_GAPS_ONLY`;\n  - `overwrite` false;\n  - `range.start` and `range.end` both set, with `start < end`;\n  - `end - start <= max_days`;\n  - empty `callback_url`;\n  - (correction, O-13) a non-empty `x-user-id` that is not `system`.\n- A miss returns PERMISSION_DENIED with a detail that names the envelope. The agent already passes that detail through: PERMISSION_DENIED is in `_PASS_THROUGH_CODES` (`services/xstockstrat-agent/app/tools.py:225-228`).\n- New key `backfill.self_serve_max_range_days` in namespace `ingest`:\n  - int, default 730;\n  - read by a new `int_positive` property in `app/config/watcher.py`, next to `:111-113`;\n  - seeded by config migration `050_ingest_backfill_self_serve_keys` (`049` is the last on main-dev);\n  - live through WatchConfig;\n  - listed in the ingest `CLAUDE.md` key table and the config-governance registered-keys log (C-05).\n- **Correction (O-10): no `user_id` in the `ingest.backfill.queued` payload.** `_emit_backfill_event` already sends `metadata=propagation_meta` (`servicer.py:502-515`), and ledger stamps the event owner from `x-user-id` (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:76-78`). Add an ingest test that the queued event carries `x-user-id` in its metadata.\n- No proto change and no ingest migration.\n\n**Request range: exactly `gap`**\n- This honours operator decision 1, FR-2 and @AC-2.\n- The proposer traced the case where the prefix is filled and the window is empty:\n  - Definition path: status OK with zero trades (analysis `servicer.py:1581,2123,2214,1315-1322`).\n  - SMA path: a second insufficient result whose gap is the request window, which the card offers as a second backfill.\n- Gate question G-2: widen the request to `{gap.start .. requestedRange.end}` under GAPS_ONLY. This amends FR-2/@AC-2 and is taken only with operator sanction.\n\n**UI (`BacktestsSection`, `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:1133`)**\n- New `src/lib/backtestBackfill.ts` with vitest, holding `gapToBackfillRequest` and `backfillJobMessage`.\n- **Correction (O-12): the insights button keeps its current behaviour.** `gapToBackfillRequest(gap, {fillMode})` is the one shared mapping. The symbol card passes GAPS_ONLY. The insights button (`insights/strategies/[id]/page.tsx:541-547`) calls the helper without `fillMode`, so admins stay on FULL and non-admins stay denied there. Switching that button to GAPS_ONLY is gate question G-3; if accepted it needs its own @AC.\n- Status copy:\n  - Running: \"Backfilling… X / Y bars\", or \"Backfilling…\" while `bars_total == 0`.\n  - FAILED: \"Backfill failed: {error}\" when `error` is set, otherwise chunk counts. The chunked finalizer writes no `error` (`servicer.py:744-752`).\n  - **Correction (O-11), PARTIAL in two branches.** The server sets PARTIAL when `failed_symbols` is non-empty even with zero failed chunks (`servicer.py:739-740`). So:\n    - if `chunks_total - chunks_completed > 0`: \"Backfill partial: {n} of {total} chunks failed\";\n    - otherwise: \"{symbol} returned no data for part of the range\", from `failed_symbols`.\n    - One vitest case per branch.\n  - CANCELED: \"Backfill canceled\".\n  - FAILED, PARTIAL and CANCELED re-enable the action.\n- A PERMISSION_DENIED from the trigger maps to a specific message (\"range exceeds self-serve limit\"), not a generic error (O-15).\n- Vendor-unfillable gap: the card remembers the gap it last backfilled to COMPLETED. If the re-run is still insufficient for the same symbol and gap, it shows \"No vendor data for {range}\" and hides the action for that gap. A different gap is still offered.\n- The card keeps `jobId` in local state (`useTriggerBackfill` `src/hooks/useBacktest.ts:19`; `useBackfillStatus` / `isTerminal` `src/hooks/useBackfills.ts:30,:13`). Re-run goes through `handleRun` (`:1178`), with no automatic re-run and no BFF change. Copy at `:1237` and `position-detail.spec.ts:337` change together.\n\n**Tests**\n- Ingest: one table-driven test with a real `ingest_pb2.TriggerBackfillRequest` and scope \"0\".\n  - Each envelope condition broken in turn gives PERMISSION_DENIED with no `insert_job` and no notify call. The rows include span = cap + 1 day and a missing or `system` `x-user-id`.\n  - A request at exactly the cap is QUEUED.\n  - An admin with each breaking condition is still QUEUED.\n  - The MagicMock tests at `tests/test_ingest_servicer.py:362` and `:594` are rewritten with real requests.\n- UI e2e: fixtures from `backfillJob(over)` / `prefixGapRange`, with:\n  - a gap distinct from the window;\n  - an `INVENTORY.md` row;\n  - a `getBackfillStatus` mock for all six statuses;\n  - an empty `error` on chunked FAILED and PARTIAL.\n\n**Docs, same PR as the ingest change (C-14, strat-lab binding)**\n- Agent `app/tools.py:21`, `:1557`, and the now-false sentence at `:1578-1580` (\"ingest performs no synchronous input validation\"). The tool defaults `fill_mode` to FULL, so the wording must say non-admins need `fill_mode='gaps_only'` and explicit start and end.\n- Agent `CLAUDE.md` and `tests/test_tools_endpoint.py:104`.\n- `docs/runbooks/mcp-tools.md:964-968` and `plugins/strat-lab/skills/backtest/reference/backfill.md`.\n- Ingest `CLAUDE.md:17-20` and the findings line.\n- The key rows in the ingest and analysis `CLAUDE.md` name the coupling between the 730 default and `backtest.max_range_days`.\n- `docs/sdd/business-rules/platform.feature` `@AC-6 @feature-244` gains a row for the new key.\n\n**Acceptance scenarios (at /sdd-spec)**\n- Rewrite the @AC-9 examples to the server-true copy. @AC-9 is at `acceptance.feature:44` on `origin/feature/backtest-inline-backfill`; the main-dev copy stops at @AC-8.\n- Add scenarios for zero-denominator progress, \"No vendor data\", the over-cap non-admin denial, and both PARTIAL branches.\n\n**Gate cost table (D-3)**\n\n| Tier | Change set | Exposure left |\n|---|---|---|\n| T0 | Predicate of about 15 lines, table test, docs in about 7 files | Unbounded range per request; unbounded request count |\n| T1 (recommended) | T0 plus one key, watcher property, config seed migration 050, new-key approval, config as an affected service | Request count bounded only by the global `backfill.max_concurrent_jobs` (default 3) |\n| T1+ (adversary option, not yet costed by the proposer) | T1 plus per-symbol active-job de-duplication, about 10 lines, no migration | Flooding across distinct symbols |\n| T1-L (adversary option, not yet costed) | T1 plus one more key and a second limiter beside `servicer.py:348` | Per-user fairness |\n| T2 | T1 plus `user_id` column (ingest 017), a second key, per-user active-job count | None of the above |\n| FR-7 | One UI step; drops the user story | n/a |\n\n**Gate questions:** tier choice; G-2 (widen the range); G-3 (insights button to GAPS_ONLY).\n\n**Build order:**\n1. ingest predicate, key property, table test and metadata test;\n2. config seed migration 050;\n3. agent, docs and plugin wording;\n4. UI helper and vitest;\n5. UI card, fixtures and e2e.",
    "open_objections": [
      {
        "text": "O-10 (C-18, attribution): the proposal adds `user_id` to the `ingest.backfill.queued` payload. That duplicates attribution ledger already stamps from the `x-user-id` metadata (`ledgerServiceImpl.ts:76-78`; `servicer.py:502-515` sends `propagation_meta`). The synthesis drops the payload field. The proposer must confirm the drop and commit to an ingest test that the queued event carries `x-user-id` in its metadata.",
        "blocking": true
      },
      {
        "text": "O-11 (correctness of PARTIAL copy): `_finalize_backfill` sets PARTIAL when `failed_symbols` is non-empty even with zero failed chunks (`servicer.py:739-740`), so the proposed copy can read \"0 of N chunks failed\". The proposer must adopt the two-branch `backfillJobMessage` (chunk counts when `chunks_total - chunks_completed > 0`, otherwise the `failed_symbols` message), with a vitest case per branch and a matching @AC-9 example.",
        "blocking": true
      },
      {
        "text": "O-12 (scope, C-15/C-14): switching the insights button (`insights/strategies/[id]/page.tsx:541-547`) to GAPS_ONLY moves admins there from FULL to GAPS_ONLY and opens the trigger to non-admins on a second surface. No @AC covers either change. The synthesis keeps that call FULL through a shared `gapToBackfillRequest(gap, {fillMode})` and puts the switch to the operator as G-3. The proposer must accept this, or justify the switch with an @AC and operator sanction.",
        "blocking": true
      },
      {
        "text": "O-13 (security, attribution): the backfill RPCs are exempt from the `owner_scoped` identity gate, so a caller with no `x-user-id` passes the envelope and its jobs are stamped NULL in ledger. Add an eighth envelope condition (a non-empty `x-user-id` that is not `system`) with a row in the table test. The synthesis adopts this; the proposer must confirm it does not break a legitimate caller.",
        "blocking": false
      },
      {
        "text": "O-14 (C-14, strat-lab parity): `services/xstockstrat-agent/app/tools.py:1578-1580` says ingest \"performs no synchronous input validation\", which the envelope makes false, and the line is not on the touchpoint list. The tool defaults `fill_mode` to FULL, so every default non-admin agent call is denied. The docs must say `fill_mode='gaps_only'` and explicit start and end are required. PERMISSION_DENIED pass-through is confirmed at `tools.py:225-228`.",
        "blocking": false
      },
      {
        "text": "O-15 (C-16, C-05, C-18 coupling): add a `backfill.self_serve_max_range_days` row to `@AC-6 @feature-244` in `docs/sdd/business-rules/platform.feature` and to the ingest key table and the registered-keys log. Name the coupling with analysis `backtest.max_range_days` in both service `CLAUDE.md` key rows. The card should map PERMISSION_DENIED to a specific over-limit message.",
        "blocking": false
      },
      {
        "text": "O-16 (operational): after a restart, in-flight jobs are set FAILED \"interrupted by restart\" and may then be resumed. The card treats FAILED as terminal and re-enables the action, so the user can queue a duplicate. The proposer must state this as accepted, or define the card's handling of that error.",
        "blocking": false
      },
      {
        "text": "O-17 (flooding mitigation, gate cost): request-count flooding stays open under T1. The proposer must cost the adversary's two options for the gate table: T1+ (per-symbol active-job de-duplication, no migration) and a separate self-serve concurrency limiter.",
        "blocking": false
      },
      {
        "text": "O-18 (C-15, residual from O-9): @AC-9 exists only on `origin/feature/backtest-inline-backfill` (`acceptance.feature:44`). Its example strings must be rewritten to the server-true copy. Net-new scenarios are needed for zero-denominator progress, \"No vendor data\", the over-cap denial and both PARTIAL branches.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "343@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-7",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-8",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "270@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "244@AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Tier T0 as the default (envelope with no span cap): GAPS_ONLY plans every gap inside an uncapped caller range (`servicer.py:650-667`), so one request can be a full-history fetch. It stays in the gate table as an option.",
      "A span-cap default below 730 days: it would deny the request-range fallback gap the card legitimately sends, which analysis already caps at 730 days.",
      "`user_id` in the `ingest.backfill.queued` payload: ledger already stamps the owner from the `x-user-id` metadata (`ledgerServiceImpl.ts:76-78`), and a second copy in an untyped Struct can drift.",
      "Switch the insights backfill button to GAPS_ONLY as part of this feature without sanction: it changes admin behaviour and widens FR-6 to a second surface with no @AC. It goes to the operator as G-3; the shared mapping function alone resolves the duplication.",
      "Widen the backfill request to `{gap.start .. requestedRange.end}` without sanction: it amends FR-2/@AC-2 and operator decision 1. It goes to the operator as G-2.",
      "PARTIAL copy from chunk counts alone: it renders \"0 of N chunks failed\" when only `failed_symbols` is set (`servicer.py:739-740`).",
      "Tier T2 as the default (per-user cap with ingest migration 017): it closes flooding but is the expensive path. It stays in the gate table."
    ],
    "open_risks": [
      "Request-count flooding under T1: any user or agent can fill the global 3-slot backfill queue with in-envelope jobs and delay operator backfills. T1+ and the separate limiter are not yet costed.",
      "With the exact-gap request, a definition-path re-run can return OK with zero trades for a symbol with no bars in the window. @AC-5 passes literally but the result is empty unless the operator sanctions G-2.",
      "On the SMA path the user may need a second backfill, for the window, before a re-run succeeds.",
      "The 730 default is coupled to analysis `backtest.max_range_days` by documentation only. Raising the analysis cap makes the card's fallback request fail for non-admins.",
      "A restart can mark a running job FAILED and then resume it, so the card may let the user queue a duplicate.",
      "The eighth envelope condition (`x-user-id` present and not `system`) has not been checked against every legitimate non-admin caller.",
      "Config migration number 050 may collide with a peer feature in this batch; re-check at /sdd-spec.",
      "T1 adds xstockstrat-config as an affected service and a new-config-key approval. The feature's affected-services list (ui, ingest) and config gate do not yet reflect this.",
      "@AC-9 exists only on the feature branch; main-dev's `acceptance.feature` stops at @AC-8 until the branches are synced.",
      "Marketdata `BackfillBars` range bounds for a wholly historical range are still not inspected.",
      "`jobId`, \"Data ready\" and the last-filled gap are local state and are lost on reload (accepted under D-2).",
      "If G-3 is declined, non-admins still see a backfill button on the insights page that is denied.",
      "The peer feature fix-symbol-page-alerts-ui may touch the same symbol page file, giving merge-order conflicts."
    ],
    "constitution_rules_touched": [
      "C-05",
      "C-08",
      "C-10",
      "C-11",
      "C-12",
      "C-13",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "F-07",
      "P-02",
      "P-03",
      "P-06",
      "PLAT-4"
    ],
    "rationale": "The adversary found no Floor breach and endorsed the T1 envelope. I checked its factual corrections against the code, and each holds:\n\n- **Attribution.** Ledger takes the event owner from the `x-user-id` metadata (`ledgerServiceImpl.ts:76-78`), and ingest sends that metadata with the event (`servicer.py:502-515`). A payload `user_id` is a duplicate.\n- **PARTIAL.** The finalizer sets PARTIAL on `failed_symbols` alone (`servicer.py:739-740`), so chunk-count copy can read \"0 of N\".\n- **Insights button.** The current call sends no `fillMode` (`page.tsx:541-547`), so switching it changes behaviour on a surface outside FR-1 and FR-6.\n- **Agent docstring.** The sentence at `tools.py:1578-1580` becomes false. PERMISSION_DENIED is already passed through (`:225-228`).\n- **@AC-9.** It exists at `acceptance.feature:44` on the feature branch; the main-dev copy stops at @AC-8.\n\n**Closed this round**\n- O-1: the proposal adopts a span-cap key with a named default and a corrected cost table.\n- O-2: the proposal did both things the objection asked. It traced what the re-run returns, and it brings widening to the gate as G-2 without adopting it.\n- O-3: the proposal commits to the table-driven test with real requests.\n- O-4: closed by the shared mapping function. The contested behaviour change moves to O-12.\n- O-5, O-7, O-8: answered concretely. The adversary's follow-ups are new objections O-14 and O-11.\n- O-6: closed as already satisfied by ledger header stamping.\n- O-9: the cited scenario exists; the remaining spec work is O-18.\n\n**Still open**\nThe proposal predates the adversary's nine round-2 points, so none is answered. I folded the verified fixes into the approach and kept the points open as O-10 to O-18. The three the adversary marked blocking stay blocking until the proposer confirms.\n\n**Business rules**\n- @AC-9 is a CHANGE because its example strings are rewritten. No operator decision covers that, so it must be shown at the gate.\n- @AC-7 is EXTEND through the companion denial scenarios, under the operator's decision to open the trigger.\n- `244@AC-6` in `platform.feature` is EXTEND for the new key row.\n\n**Register**\nThe approach rests on D-1, D-2 and D-3. The extra envelope conditions narrow D-1 and do not contradict it. R-1, R-2 and R-3 are respected. The added T1+ and limiter rows extend the D-3 tier table. No petitions were filed. The relayed user request (Q2/Q3) concerns the alert page and the batch kickoff, so it reopens nothing.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "T1 is the design's recommended tier: the self-serve envelope plus the WatchConfig key `ingest` / `backfill.self_serve_max_range_days` (int, default 730, `int_positive` reader, config seed migration, full C-05 contract). The operator still chooses the tier at the gate under D-3.",
          "evidence": "services/xstockstrat-ingest/app/handlers/servicer.py:650-667; app/config/watcher.py:111-113; proposer adopts it and the adversary endorses it in round 2."
        },
        {
          "text": "The backfill request range stays exactly the reported `gap`. Widening to `{gap.start .. requestedRange.end}` is put to the operator as gate question G-2 and is not adopted without sanction.",
          "evidence": "Operator decision 1; analysis servicer.py:1581,2123,2214,1315-1322 (trace of the empty-window re-run); e2e/insights/backtest-coverage.spec.ts:77-79; uncontested by the adversary in round 2."
        },
        {
          "text": "Server proof of @AC-7 is one table-driven ingest test with a real `ingest_pb2.TriggerBackfillRequest` at scope \"0\": each envelope condition broken gives PERMISSION_DENIED with no `insert_job` and no notify call, at-cap is QUEUED, and admin is unaffected. The MagicMock gate tests are rewritten with real requests.",
          "evidence": "tests/test_ingest_servicer.py:362,:594; proposer commitment in round 2, uncontested."
        },
        {
          "text": "Vendor-unfillable gap: after a COMPLETED backfill from the card, a re-run that is still insufficient for the same symbol and gap shows \"No vendor data for {range}\" and hides the action for that gap. A different gap is still offered.",
          "evidence": "Proposal round 2 answer to O-8; uncontested by the adversary."
        }
      ],
      "new_rejected": [],
      "new_objections": [
        {
          "text": "O-10: drop `user_id` from the `ingest.backfill.queued` payload, because ledger already stamps the owner from `x-user-id` metadata (`ledgerServiceImpl.ts:76-78`). Add a test that the queued event carries `x-user-id` metadata. Proposer to confirm.",
          "blocking": true
        },
        {
          "text": "O-11: PARTIAL copy must have two branches, because PARTIAL can occur with zero failed chunks (`servicer.py:739-740`). One vitest case per branch.",
          "blocking": true
        },
        {
          "text": "O-12: switching the insights button to GAPS_ONLY is an unsanctioned behaviour and scope change. Keep it FULL through `gapToBackfillRequest(gap, {fillMode})` and put the switch to the operator as G-3.",
          "blocking": true
        },
        {
          "text": "O-13: add an eighth envelope condition, a non-empty `x-user-id` that is not `system`, with a row in the table test.",
          "blocking": false
        },
        {
          "text": "O-14: fix the false sentence at agent `tools.py:1578-1580` and state that non-admins need `fill_mode='gaps_only'` and explicit start and end.",
          "blocking": false
        },
        {
          "text": "O-15: add the new key to `platform.feature` `@AC-6 @feature-244`, the ingest key table and the registered-keys log; name the coupling with analysis `backtest.max_range_days`; map PERMISSION_DENIED to a specific card message.",
          "blocking": false
        },
        {
          "text": "O-16: a restart marks a job FAILED and may then resume it, so the card can allow a duplicate. State this as accepted or define the handling.",
          "blocking": false
        },
        {
          "text": "O-17: cost T1+ (per-symbol active-job de-duplication) and a separate self-serve concurrency limiter for the gate table.",
          "blocking": false
        },
        {
          "text": "O-18: rewrite the @AC-9 examples to server-true copy and add scenarios for zero-denominator progress, \"No vendor data\", the over-cap denial and both PARTIAL branches.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "The proposal adopts tier T1: a span-cap WatchConfig key `backfill.self_serve_max_range_days` (default 730, full C-05 contract, seed migration) and a corrected gate cost table. The adversary endorses it."
        },
        {
          "id": "O-2",
          "how": "The proposer traced the empty-window re-run (OK with zero trades on the definition path, a window gap on the SMA path), keeps the exact gap, and brings widening to the gate as G-2, an explicit @AC-2 amendment."
        },
        {
          "id": "O-3",
          "how": "The proposer commits to the table-driven test with a real `TriggerBackfillRequest` and rewrites the MagicMock tests at `:362` and `:594`."
        },
        {
          "id": "O-4",
          "how": "One shared `gapToBackfillRequest` mapping serves both the symbol card and the insights button. The fill-mode change on the insights button is split out as O-12 and gate question G-3."
        },
        {
          "id": "O-5",
          "how": "The denial detail and the agent, mcp-tools and plugin wording list every envelope condition. PERMISSION_DENIED pass-through is confirmed at `tools.py:225-228`. The remaining docstring fix is O-14."
        },
        {
          "id": "O-6",
          "how": "Already satisfied: ledger stamps the event owner from the `x-user-id` metadata (`ledgerServiceImpl.ts:76-78`) that ingest sends with the event (`servicer.py:502-515`). No payload field is added; the follow-up test is O-10."
        },
        {
          "id": "O-7",
          "how": "The proposal commits to canonical builders, an INVENTORY row, a gap distinct from the window and server-true status and error strings. The PARTIAL copy defect is tracked as O-11."
        },
        {
          "id": "O-8",
          "how": "Same-gap memory after a COMPLETED backfill shows \"No vendor data for {range}\" and hides the action for that gap. Uncontested."
        },
        {
          "id": "O-9",
          "how": "@AC-9 exists at `acceptance.feature:44` on `origin/feature/backtest-inline-backfill`, so round 1's claim was wrong. The example rewrites and new scenarios are tracked as O-18."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-15 — sdd-batch design gate (round 3)

- `/sdd-design backtest-inline-backfill` full debate halted at its approval gate after round 3 (gate policy: halt). `design.md` is not written and `status.md` is unchanged (`spec-ready`). Register: `debate.md` (D-8…D-13 settled, D-5 reopened by operator steer and superseded by D-8, R-4…R-6 locked, O-10…O-18 closed, O-19…O-25 open, petition P-1 on D-5 pending user).
- Operator rulings applied this round (2026-11-15): tier **T1** chosen and the FR-7 fallback declined; the request range is widened (G-2); the insights strategy button is opened to non-admins (G-3); the request-count exposure is accepted and answered by raising `backfill.max_concurrent_jobs`, not by a per-user cap.

### Open Threads

- **Approach (round 3 best)**: FR-6 through the self-serve envelope on ingest `TriggerBackfill` at tier T1, with three additions.
  - **Envelope (8 conditions)**: one symbol; data kind UNSPECIFIED or BARS; `GAPS_ONLY`; no overwrite; explicit `start < end`; span ≤ `ingest` / `backfill.self_serve_max_range_days` (config seed migration `050`); empty `callback_url`; a non-empty `x-user-id` that is not `system` (D-11). Admin behaviour is unchanged. No proto change and no ingest migration.
  - **De-dup, self-serve only (D-9)**: `has_active_job` over QUEUED and RUNNING plus the insert, in one transaction under `pg_advisory_xact_lock`. A hit returns ALREADY_EXISTS without the other job's id (R-4). Admins are not de-duplicated.
  - **Range (D-8, supersedes D-5)**: the symbol card requests `gap.start` through the backtest window end under GAPS_ONLY. FR-2 and @AC-2 are amended.
  - **Insights strategy button (D-10)**: opened to non-admins on the envelope with the exact gap. Non-admins send GAPS_ONLY; admins keep FULL (R-5). It gets its own @AC.
  - **Copy (D-12)**: PARTIAL has two branches, chunk counts or "{symbol} returned no data for part of the range".
  - **Concurrency (D-13)**: `backfill.max_concurrent_jobs` is raised. Option A is a new seeded default of 6 everywhere. Option B keeps 3 and sets 8 on the homelab through `SetConfig`, recorded in the homelab runbook.
  - Unchanged from round 2: the card's own `jobId` and manual re-run (D-2), the "No vendor data" memory (D-7), the table-driven ingest test (D-6), and agent, `mcp-tools.md` and `strat-lab` wording in the same PR (C-14).
- **Operator must answer at the gate**:
  1. Concurrency option A or B, and the value. Relayed item 6 ("Accept it, option A") may already answer this; I did not assume so, because the request numbers answers across six features.
  2. Whether `insights/backfills/page.tsx` opens to non-admins, if O-21 is not designed in.
  3. Whether relayed items 7 ("update all pages") and 9 ("Expand the fetches. Add a metric…") are meant for this feature. If not, O-20 and O-21 fall away. Item 10 (per-row and clear-all buttons) is read as belonging to another feature and changes nothing here.
- **Strongest open objection**: **O-19** (blocking, C-11/P-03). The lock-budget arithmetic for the concurrency raise uses the DigitalOcean figure (1024 × 25 = 25,600, `docs/runbooks/ohlcv-lock-budget-tuning.md:59-63`), but option B targets the homelab. Nothing under `deploy/` sets `max_locks_per_transaction` or `max_connections`, so the homelab budget is unverified and may be the stock 64 per connection. The invariant must also count all concurrent bars scans and use 30-day chunks. No safe value is established for either option yet.
  - Also blocking: **O-20**, the lock-breach metric the user asked for is not designed (no service handles SQLSTATE 53200 today; marketdata may become an affected service). **O-21**, the third trigger page `insights/backfills/page.tsx` is left unchanged against "update all pages".
  - Non-blocking: O-22 (the 1096 span-cap default is justified by the wrong coupling; the gap length comes from the strategy warmup, not `backtest.max_range_days`), O-23 (one denial message misreports seven of eight envelope conditions), O-24 (`insert_job` takes a pool, so the de-dup transaction needs a signature change and emit-after-commit ordering), O-25 (an admin multi-symbol job blocks self-serve for its symbols, and the card has no job to follow on ALREADY_EXISTS).
- **Floor status**: no Floor breach (`floor_breaches` is empty in both the synthesis and the round). The adversary's verdict is NEEDS WORK.
- **@AC changes not covered by an operator decision** (must be shown at the gate):
  - `343@AC-9` — **CHANGE**: example strings rewritten to server-true copy, one example per PARTIAL branch.
  - `343@AC-3`, `343@AC-6` — EXTEND.
  - `244@AC-6` (`docs/sdd/business-rules/platform.feature`) — EXTEND: a row for the new key.
  - `343@AC-1`, `343@AC-5`, `270@AC-4`, `198@AC-6`, `334@AC-1`, `334@AC-26` — PRESERVE.
  - Covered by operator decisions: `343@AC-2` (**CHANGE**, the widening), `343@AC-7` and `198@AC-7` (EXTEND), `343@AC-4`, `343@AC-8`, `244@AC-5` (PRESERVE; only the default value moves under option A).
  - Net-new scenarios due at /sdd-spec: both PARTIAL branches, zero-denominator progress, "No vendor data", the over-cap denial, ALREADY_EXISTS, and the insights strategy button for non-admins.
- **Carried risks**: one user can still queue one in-envelope job per symbol and fill every slot (accepted by the operator); raising the cap raises vendor-quota and marketdata queue pressure, on DigitalOcean too under option A; a strategy whose warmup prefix exceeds the span cap is denied self-serve backfill; opening `insights/backfills/page.tsx` may need the form reshaped; config migration `050` may collide with a batch peer and `339`/`344` can conflict at merge (re-check at /sdd-spec); `feature.md` does not yet list xstockstrat-config (and possibly xstockstrat-marketdata) as affected services.

Resume state for the next `/sdd-batch` run (do not edit by hand; supersedes the round 2 block above):

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round 3 best approach: tier T1 (chosen by the operator) plus per-symbol de-duplication, the widened request range, and the insights strategy button opened on the envelope. The envelope, de-dup and widening survive the adversary. Three things do not yet: the lock-budget numbers for the concurrency raise, the lock-breach metric, and the third trigger page.\n\n**Ingest (`services/xstockstrat-ingest/app/handlers/servicer.py`)**\n- Pure predicate `_is_self_serve_backfill(request, x_user_id, max_days)`. The gate at `:423` becomes admin OR envelope, in the same position: after the `_db` check (`:418`), before the 1d check (`:442`) and callback validation (`:448`).\n- Envelope, all required:\n  1. exactly one symbol;\n  2. data kind UNSPECIFIED or BARS;\n  3. `fill_mode == GAPS_ONLY`;\n  4. `overwrite` false;\n  5. `range.start` and `range.end` set, start before end;\n  6. span no longer than `backfill.self_serve_max_range_days`;\n  7. empty `callback_url`;\n  8. non-empty `x-user-id` that is not `system`.\n- A miss returns PERMISSION_DENIED. The detail must say which condition failed, so the UI does not show a range message for a non-range denial (open, O-23).\n- **De-dup (T1+, included, no migration), self-serve only; admins are not de-duplicated.**\n  - New `has_active_job(conn, symbol)` in `app/repositories/backfill_jobs.py`, reusing the `= ANY(symbols)` predicate at `:111`, over QUEUED and RUNNING.\n  - Check and insert share one transaction under `pg_advisory_xact_lock(hashtext('backfill:'||symbol))` (pattern at `servicer.py:1568-1571`; safe under PgBouncer transaction pooling).\n  - A hit returns ALREADY_EXISTS and does not return the other job's id.\n  - Correction I verified: `insert_job` takes a pool today (`backfill_jobs.py:29-30`). Both calls must run on the `conn` inside `conn.transaction()`, and the ledger emit and `_run_backfill` spawn (`:464`, `:472`) must happen after commit (open, O-24).\n- No `user_id` in the `ingest.backfill.queued` payload. Add a test that the event is emitted with `x-user-id` in its metadata (`servicer.py:502-515`; ledger stamps the owner at `ledgerServiceImpl.ts:76-78`).\n- No proto change, no ingest migration.\n\n**Request range (D-5 reopened by the operator)**\n- The symbol card requests `gap.start` through the backtest window end (`page.tsx:1190`) under GAPS_ONLY.\n- Amended FR-2: \"requests a daily-bars GAPS_ONLY backfill from the reported gap start through the end of the backtest window.\"\n- Amended @AC-2 example: a gap from 2023-03-17 to 2024-01-01 requests LYFT from 2023-03-17 to 2024-12-31.\n\n**Span-cap key `ingest` / `backfill.self_serve_max_range_days`**\n- Config seed migration `050_ingest_backfill_self_serve_keys` (049 is the last on main-dev), `int_positive` reader next to `watcher.py:111-113`, full C-05 contract.\n- The default must fit prefix plus window. The proposer's 1096 is plausible, but its stated reason is wrong: the gap length comes from the strategy's warmup (`prefix_calendar_days`, analysis `servicer.py:1559-1578`), not from `backtest.max_range_days`. The default and the CLAUDE.md coupling note must be re-derived (open, O-22).\n\n**Concurrency cap `backfill.max_concurrent_jobs` (operator: raise it; value and scoping go to the gate)**\n- Option A: new seeded default 6 everywhere (code default `watcher.py:113` plus seed).\n- Option B: keep default and seed at 3, set 8 on the homelab deployment through `SetConfig`, recorded in the homelab deploy runbook so a rebuild does not revert to 3. The homelab has its own database and migrator (`docs/runbooks/config-rollout.md:293`), so the value does not reach DigitalOcean.\n- The supporting arithmetic is not yet valid (open, O-19):\n  - \"fits under 1024 × 25 = 25,600\" is the DigitalOcean budget (`docs/runbooks/ohlcv-lock-budget-tuning.md:59-63`).\n  - Nothing under `deploy/` sets `max_locks_per_transaction` or `max_connections` (my grep found none), so the homelab budget is unverified.\n  - The invariant counts all concurrent bars scans (`:47-48`), not backfill alone.\n  - Homelab chunks are 30 days on a fresh deploy.\n- Gate wording for the exposure left: one active self-serve job per symbol; no per-user bound (accepted by the operator, 2026-11-15). T1-L and T2 stay recorded as costed alternatives.\n\n**Lock-budget breach metric (relayed user item 9)**\n- In scope here, because this feature raises the cap against that budget. Not yet designed (open, O-20). No service code handles SQLSTATE 53200 today.\n\n**UI**\n- New `src/lib/backtestBackfill.ts` with vitest: `gapToBackfillRequest(gap, {fillMode?, rangeEnd?})`, `backfillJobMessage(job)`, `triggerErrorMessage`.\n- PARTIAL copy in two branches (`servicer.py:739-740`), one vitest case and one @AC-9 example each:\n  - `chunks_total − chunks_completed > 0`: \"Backfill partial: {n} of {total} chunks failed\";\n  - otherwise: \"{symbol} returned no data for part of the range\".\n- ALREADY_EXISTS maps to \"A backfill for {symbol} is already in progress\". The card has no job to follow in that case; its behaviour is open (O-25).\n- Symbol card (`trader/positions/[symbol]/page.tsx:1133`): GAPS_ONLY with `rangeEnd` = window end; own `jobId` via `useBackfillStatus` (`useBackfills.ts:30`); re-run only through `handleRun` (`:1178`), never automatic; copy at `:1237` and `position-detail.spec.ts:337` change together. D-7 \"No vendor data\" memory stands.\n- Insights strategy page (`insights/strategies/[id]/page.tsx:541-547`): exact gap, no widening. Non-admins send GAPS_ONLY; admins keep FULL, because GAPS_ONLY would remove their ability to re-fetch a range that already has bars. Own new @AC.\n- Third trigger page `insights/backfills/page.tsx` (create form, `useTriggerBackfill` near `:129`): the user said \"update all pages\", so it should not ship unchanged by default. Design is open (O-21).\n- Restart duplicate: accepted; de-dup blocks it once the job is resumed to RUNNING.\n\n**Tests**\n- Ingest table test with a real `TriggerBackfillRequest` at scope \"0\": 8 envelope rows, at-cap row, admin row, 2 de-dup rows, a rolled-back-insert row; the metadata test; rewrites of `tests/test_ingest_servicer.py:362` and `:594`.\n- UI e2e from canonical builders with an INVENTORY row and a `getBackfillStatus` mock.\n\n**Docs in the same PR**\n- Agent `tools.py:21`, `:1557`, `:1578-1580` (non-admins need `fill_mode='gaps_only'` and explicit start and end), agent `CLAUDE.md`, `tests/test_tools_endpoint.py:104`.\n- `docs/runbooks/mcp-tools.md:964-968`, `plugins/strat-lab/skills/backtest/reference/backfill.md`, and `SKILL.md` if it names trigger parameters.\n- Ingest key table, registered-keys log, `platform.feature` `@AC-6 @feature-244` row.\n\n**Acceptance (at /sdd-spec)**\n- Rewrite @AC-9 examples; amend @AC-2.\n- New scenarios: both PARTIAL branches, zero-denominator progress, \"No vendor data\", over-cap denial, ALREADY_EXISTS, the insights strategy button for non-admins.\n\n**Build order**\n1. Ingest predicate, de-dup, key property, tests.\n2. Config seed migration 050 (plus the default change if option A).\n3. Agent, docs and plugin wording.\n4. UI helper and vitest.\n5. Symbol card, insights button(s), fixtures, e2e, acceptance rewrites.\n\n**Gate questions left:** concurrency option A or B and the value; confirmation of the third page's scope if O-21 is not designed in.",
    "open_objections": [
      {
        "text": "O-19 (C-11/P-03): the lock-budget arithmetic for the concurrency raise uses DigitalOcean inputs (`ohlcv-lock-budget-tuning.md:59-63`), but option B targets the homelab. Nothing under `deploy/` sets `max_locks_per_transaction` or `max_connections`, so the homelab budget may be the stock 64 per connection. The left side must count all concurrent bars scans (`:47-48`) and use 30-day chunks for the fresh homelab. Restate the invariant with the homelab's actual values and present options A and B against both environments.",
        "blocking": true
      },
      {
        "text": "O-20 (C-11, relayed user item 9): the user asked for a metric to monitor lock-budget breaches. The proposal declares it out of scope on an assumption. This feature raises the cap against that budget, so the metric belongs here unless the operator says otherwise. Design it: which service counts SQLSTATE 53200 on the bars query path, the instrument name, and whether marketdata becomes an affected service.",
        "blocking": true
      },
      {
        "text": "O-21 (C-11, relayed user item 7 \"update all pages\"): the third trigger surface `insights/backfills/page.tsx` (create form near `:129`) is left unchanged. Either open it on the same self-serve terms (shared `gapToBackfillRequest`, same denial mapping, own @AC, with the form's multi-symbol and data-kind inputs reconciled with the envelope), or get explicit operator confirmation that it stays admin-only.",
        "blocking": true
      },
      {
        "text": "O-22 (C-11): the 1096 default's stated coupling to analysis `backtest.max_range_days` is false. The gap length is set by the strategy warmup, `prefix_calendar_days` (analysis `servicer.py:1559-1578`). Derive the default from maximum prefix span plus the card's 366-day window, document that real coupling, and state that a warmup prefix beyond the cap is denied self-serve with clear copy.",
        "blocking": false
      },
      {
        "text": "O-23 (C-18, UX): mapping every PERMISSION_DENIED to \"Range exceeds the self-serve limit\" misreports seven of the eight envelope conditions. Have the server detail identify the failed condition and the UI switch on it, or show a generic message that quotes the detail.",
        "blocking": false
      },
      {
        "text": "O-24 (feasibility): `insert_job` takes a pool (`backfill_jobs.py:29-30`). For the advisory lock, the check and the insert to share a transaction, both must run on one `conn`, and the ledger emit and `_run_backfill` spawn (`servicer.py:464`, `:472`) must follow the commit. State the signature change and ordering and add a test row.",
        "blocking": false
      },
      {
        "text": "O-25: a queued or running admin multi-symbol job matches the de-dup lookup and blocks self-serve for that symbol for its whole duration, and the card has no job to follow. State this as accepted and define what the card offers (retry later, or a link to the job list).",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "343@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-7",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-8",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "270@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "244@AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "244@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "198@AC-7",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "198@AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "334@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "334@AC-26",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "FR-7 scores-only fallback: the operator chose tier T1 and declined the fallback.",
      "Join the existing job on a de-dup hit (return its id): that job may cover a different range, so attaching the card to it would falsely trigger the D-7 \"No vendor data\" state. Both sides reject it.",
      "GAPS_ONLY for admins on the insights strategy button: admins would lose the ability to re-fetch a range that already has bars. Admins keep FULL.",
      "Widening the insights strategy button's request to a window end: that button is \"Backfill this range\" and has no backtest window, so it sends the exact gap.",
      "A deployment-aware config seed migration for the homelab concurrency value: no existing seed knows its deployment; an operator `SetConfig` recorded in the homelab runbook is lighter.",
      "A separate self-serve concurrency limiter (T1-L) and the per-user cap (T2): costed but not included, because the operator accepted the request-count risk and chose to raise the global cap instead. They stay in the gate table as alternatives.",
      "`user_id` in the `ingest.backfill.queued` payload: ledger already stamps the owner from `x-user-id` metadata."
    ],
    "open_risks": [
      "The homelab's `max_locks_per_transaction` and `max_connections` are unverified, so the safe value for the raised cap is not yet established for either option.",
      "One user can still queue one in-envelope job per symbol across the universe and fill every slot. The operator accepted this.",
      "Raising the cap also raises vendor-quota and marketdata queue pressure; under option A this applies on DigitalOcean too.",
      "A strategy whose warmup prefix exceeds the span cap is denied self-serve backfill.",
      "An admin multi-symbol job blocks self-serve for its symbols for its whole duration.",
      "The mapping of relayed user items 7 and 9 to this feature is my reading; the request numbers answers across a six-feature batch. If the operator meant another feature, O-20 and O-21 fall away.",
      "Opening `insights/backfills/page.tsx` to non-admins may need the form reshaped, which could grow the feature.",
      "The lock-breach metric may add xstockstrat-marketdata as an affected service; xstockstrat-config is already added by the seed migration.",
      "Config migration number 050 may collide with a peer feature; re-check at /sdd-spec.",
      "Peer features 339-fix-symbol-page-alerts-ui (same `page.tsx`) and 344-alert-detail-page (ingest) can conflict at merge; re-run the C-16 scan at /sdd-spec.",
      "Whether `bars_total` is set during a run is unverified; \"Backfilling…\" without a denominator is the fallback copy.",
      "The `GetBackfillStatus` e2e mock does not exist yet.",
      "`jobId`, \"Data ready\" and the last-filled gap are local state and are lost on reload (accepted under D-2).",
      "@AC-9 exists only on the feature branch until the branches are synced."
    ],
    "constitution_rules_touched": [
      "C-05",
      "C-08",
      "C-10",
      "C-11",
      "C-12",
      "C-13",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "F-07",
      "P-02",
      "P-03",
      "P-06",
      "PLAT-4",
      "PLAT-N1"
    ],
    "rationale": "No Floor breach. The adversary's verdict is NEEDS WORK, and I checked its main factual claims against the repo; they hold.\n\n**Verified**\n- The 25,600 lock budget is the DigitalOcean figure (`docs/runbooks/ohlcv-lock-budget-tuning.md:59-63`), and the invariant counts all concurrent scans.\n- No file under `deploy/` or the compose files sets `max_locks_per_transaction` or `max_connections`.\n- `insert_job` takes a pool (`backfill_jobs.py:29-30`), so the de-dup transaction needs a signature change.\n- No service source handles SQLSTATE 53200, so the lock-breach metric is net-new.\n- The homelab has its own migrator and database (`config-rollout.md:293`), which settles the proposer's shared-store worry for option B.\n\n**Closed this round**\n- O-10, O-11, O-13, O-14, O-18: the proposal adopts each fix concretely.\n- O-12: the operator sanctioned opening the insights strategy button; admins keep FULL.\n- O-16: stated as accepted, narrowed by de-dup.\n- O-17: both options are costed; I corrected the \"one job per symbol\" flood claim in the gate wording.\n- O-15: the key rows are committed; its two contested parts move to O-22 and O-23.\n\n**Still open (blocking)**\n- O-19: the gate would be shown lock numbers for the wrong environment.\n- O-20 and O-21: the relayed user request outranks the computed task. I read item 9 (\"Expand the fetches. Add a metric…\") as the answer to the range-widening question plus a metric request, and item 7 (\"update all pages\") as covering every trigger surface. The proposal set both aside on an assumption, which is a silent guess on a design fork.\n\n**Register**\n- The operator steer explicitly reopens D-5. The widening is recorded as a new decision that supersedes it.\n- D-1, D-2, D-3, D-4, D-6 and D-7 are honoured. The span-cap default is a value inside D-4's key and is left open under O-22.\n- R-1, R-2 and R-3 are respected: the gate stays, the cap is a key, and there is no automatic re-run.\n\n**Business rules**\n- 343@AC-2 is a CHANGE covered by the operator's widening decision.\n- 343@AC-9 is a CHANGE (example strings) with no operator decision, so it is shown at the gate.\n- 198@AC-7 is extended for non-admins under the operator's decision; admins are unchanged.\n- 244@AC-5 keeps its clamp; only the default value moves if option A is chosen.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Supersedes D-5: the symbol card's backfill request runs from `gap.start` through the end of the backtest window under GAPS_ONLY. FR-2 and @AC-2 are amended to match.",
          "evidence": "Operator decision 2026-11-15 (design gate, G-2); planner skips present bars at ingest servicer.py:650-667; window end at page.tsx:1190; adversary agrees in round 3."
        },
        {
          "text": "The operator chose tier T1 under D-3; the FR-7 fallback is not taken. Per-symbol active-job de-duplication (T1+) is included for self-serve requests only: `has_active_job` over QUEUED and RUNNING plus the insert, in one transaction under `pg_advisory_xact_lock`; a hit returns ALREADY_EXISTS without the other job's id; no migration; admins are not de-duplicated.",
          "evidence": "Operator decision 2026-11-15 and round-3 steer; backfill_jobs.py:111; servicer.py:1568-1571; adversary endorses in round 3."
        },
        {
          "text": "The insights strategy-page backfill button is opened to non-admins on the self-serve envelope: non-admins send GAPS_ONLY, admins keep FULL, the range is the exact gap, and the surface gets its own @AC.",
          "evidence": "Operator decision 2026-11-15 (G-3); insights/strategies/[id]/page.tsx:541-547; useIsAdmin at src/hooks/useLiveStrategies.ts:61; adversary confirms 198@AC-7 holds for admins."
        },
        {
          "text": "The envelope has an eighth condition: a non-empty `x-user-id` that is not `system`. No `user_id` is added to the `ingest.backfill.queued` payload; an ingest test asserts the event carries `x-user-id` metadata.",
          "evidence": "servicer.py:502-515; ledgerServiceImpl.ts:76-78; callers insightsBff.ts:86 and agent app/client.py:2141 both forward x-user-id; adopted by the proposer, uncontested in round 3."
        },
        {
          "text": "PARTIAL copy has two branches: chunk counts when `chunks_total − chunks_completed > 0`, otherwise \"{symbol} returned no data for part of the range\". One vitest case and one @AC-9 example per branch.",
          "evidence": "servicer.py:739-740; operator steer adopts O-11; proposer commits in round 3."
        },
        {
          "text": "`backfill.max_concurrent_jobs` is raised. The gate presents option A (new seeded default) and option B (homelab-only value through `SetConfig`, recorded in the homelab runbook) with a proposed value each; the operator picks.",
          "evidence": "Operator decision 2026-11-15; watcher.py:111-113; config-rollout.md:293 (homelab has its own database)."
        }
      ],
      "new_rejected": [
        {
          "text": "On a de-dup hit, return the existing job's id so the card follows it.",
          "why": "The existing job may cover a different range, which would falsely trigger the D-7 \"No vendor data\" state. Both sides reject it."
        },
        {
          "text": "Send GAPS_ONLY for admins on the insights strategy button.",
          "why": "Admins would lose the ability to re-fetch a range where bars already exist; the operator steer allows keeping FULL for admins."
        },
        {
          "text": "The FR-7 scores-only fallback.",
          "why": "The operator accepted tier T1 as an acceptable cost and risk and declined the fallback."
        }
      ],
      "new_objections": [
        {
          "text": "O-19: restate the lock-budget invariant for the concurrency raise with the homelab's actual `max_locks_per_transaction` and `max_connections`, 30-day chunks and all concurrent bars scans, and present options A and B against both environments (`ohlcv-lock-budget-tuning.md:47-48,59-63`).",
          "blocking": true
        },
        {
          "text": "O-20: design the lock-budget breach metric the user asked for (relayed item 9): the service that counts SQLSTATE 53200 on the bars query path, the instrument, and any added affected service.",
          "blocking": true
        },
        {
          "text": "O-21: \"update all pages\" (relayed item 7) covers `insights/backfills/page.tsx`. Open it on the self-serve terms with its own @AC, or get explicit operator confirmation that it stays admin-only.",
          "blocking": true
        },
        {
          "text": "O-22: the 1096 span-cap default's coupling to `backtest.max_range_days` is false; derive it from the warmup prefix (`prefix_calendar_days`, analysis servicer.py:1559-1578) plus the card window, and document that coupling and the over-cap denial copy.",
          "blocking": false
        },
        {
          "text": "O-23: one PERMISSION_DENIED message misreports most envelope denials; the server detail must identify the failed condition and the UI must use it.",
          "blocking": false
        },
        {
          "text": "O-24: the de-dup transaction needs `has_active_job` and `insert_job` on one `conn` (`backfill_jobs.py:29-30`) and the ledger emit and job spawn after commit, with a test row.",
          "blocking": false
        },
        {
          "text": "O-25: an admin multi-symbol job blocks self-serve for its symbols; state this as accepted and define what the card offers on ALREADY_EXISTS.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-10",
          "how": "The proposal drops the payload `user_id` and adds a test that the queued event is emitted with `x-user-id` metadata."
        },
        {
          "id": "O-11",
          "how": "The proposal adopts the two-branch PARTIAL copy with a vitest case and an @AC-9 example per branch."
        },
        {
          "id": "O-12",
          "how": "The operator sanctioned G-3. Non-admins send GAPS_ONLY on the insights strategy button, admins keep FULL, and the surface gets its own @AC."
        },
        {
          "id": "O-13",
          "how": "The eighth envelope condition is adopted with a table-test row. Both callers (UI BFF and agent) forward a real `x-user-id`."
        },
        {
          "id": "O-14",
          "how": "The proposal lists `tools.py:1578-1580` and the non-admin `fill_mode='gaps_only'` wording in its touchpoints."
        },
        {
          "id": "O-15",
          "how": "The key rows, the registered-keys log and the `@AC-6 @feature-244` row are committed. The coupling note and the denial message are carried forward as O-22 and O-23."
        },
        {
          "id": "O-16",
          "how": "Stated as accepted: de-dup blocks a duplicate once the job is resumed, and the marketdata upsert is idempotent."
        },
        {
          "id": "O-17",
          "how": "T1+ is costed and included; the separate limiter is costed and not included. The gate wording is corrected to \"one active job per symbol; no per-user bound (accepted by the operator)\"."
        },
        {
          "id": "O-18",
          "how": "The proposal commits the @AC-9 rewrite and new scenarios for both PARTIAL branches, zero-denominator progress, \"No vendor data\", the over-cap denial and the de-dup case."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-5",
          "evidence": "Operator ruling 3 of the 2026-11-15 design gate sanctions widening to gap.start through the window end under GAPS_ONLY. D-5 deferred to that gate answer, which had not been given when D-5 was settled.",
          "is_new": true
        }
      ],
      "reopened": [
        "D-5"
      ]
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-15 — sdd-batch design gate (round 4)

- `/sdd-design backtest-inline-backfill` full debate halted at its approval gate after round 4 (gate policy: halt). `design.md` is not written and `status.md` is unchanged (`spec-ready`). Register: `debate.md` (D-14…D-21 settled, R-7…R-11 locked, O-20…O-25 closed, O-19 still open, O-26…O-31 open, no new petition).
- Operator answers applied this round (2026-11-15): concurrency option **B**; the insights Backfills create form stays admin-only; the lock-breach counter belongs to feature 341; 200 bars on DigitalOcean and 1000 bars on the homelab; config values are read over the MCP; the lowest-friction handling on ALREADY_EXISTS.
- `debate.md` still shows petition P-1 as `pending user`. The round-4 synthesis treats it as resolved ("user reopened", D-5 superseded by D-8), but the round gave no verdict row for it, so the cell was left unchanged.

### Open Threads

- **Approach (round 4 best)**: the round-3 design stands (tier T1 envelope, self-serve de-dup, widened symbol-card range, insights strategy button opened to non-admins). Round 4 adds:
  - **Denial detail (D-18)**: the envelope predicate returns the first failed condition as a fixed token (`multi_symbol`, `data_kind`, `fill_mode`, `overwrite`, `range_unset`, `range_too_long`, `callback_url`, `no_user`). The PERMISSION_DENIED detail is `self-serve backfill denied: <token>`, with ` (max <N> days)` for `range_too_long`. The UI maps `range_too_long` to the span copy and every other token to one generic sentence; a raw token is never shown.
  - **De-dup transaction (D-19)**: `pg_advisory_xact_lock`, `has_active_job` and `insert_job` run on one connection in one transaction. `insert_job` keeps its signature. The ledger emit and the job spawn happen after commit. The admin path is unchanged.
  - **ALREADY_EXISTS (D-20)**: the card shows "A backfill for {symbol} is already queued or running. Try again when it finishes." and keeps "Backfill missing data" enabled. No link, no polling, no foreign job id (R-4).
  - **Span cap (D-17)**: default and seed stay 730 (config seed migration `050`). Span = `prefix_calendar_days(max warmup bars)` + the 366-day card window: 666 days at 200 bars (fits 730 on DigitalOcean), 1825 at 1000 bars (the homelab is set to 1830 through `set_config`).
  - **Concurrency (D-14, option B)**: `backfill.max_concurrent_jobs` keeps default and seed 3. Only the homelab is set to 8. DigitalOcean is unchanged.
  - **Homelab runbook sequence (D-21)**: read the config inputs over the homelab MCP; read `max_locks_per_transaction`, `max_connections` and `max_prepared_transactions` by `SHOW` over the DB-owner DSN; compute the per-class lock sum; raise `max_locks_per_transaction` to 1024 and restart Postgres; `set_config` 8 and 1830 and read both back; watch feature 341's 53200 counter for one readiness cycle. The same steps go in the homelab provisioning checklist.
  - **Scope (D-15, D-16)**: `insights/backfills/page.tsx` stays admin-only and unchanged. This feature adds no lock-breach counter; `merge-order.md` gets a row that makes it wait for `fix-indicator-pane-warmup` (341).
- **Homelab values read over the MCP on 2026-11-15** (recorded by the round-4 synthesis): ingest `backfill.max_concurrent_jobs` 3, `backfill.max_concurrent_chunks` 3, `backfill.chunk_window_days` 90; analysis `readiness_materializer.max_concurrent_bars_fetches` 2, `opportunity.max_concurrent_bars_fetches` 2, `opportunity.max_concurrent_candidates` 4, `backtest.portfolio_max_concurrent` 9, `strategy.max_concurrent_entry_backfill` 4, `backtest.max_range_days` 730.
- **Strongest open objection**: **O-19** (blocking, narrowed). The proposal's worked lock example is wrong: it uses S = 25 where backfill alone is 24, and applies L = 248 to every scanner class. The corrected per-class sum is about 6,584 (384 backfill writes + 4,216 full-span readers + 1,984 gap-planning scans), which exceeds a stock budget of 64 × 100 = 6,400. The proposer must adopt the per-class sum, make the raise to 1024 the default step before the raise to 8, and confirm whether backfill gap planning scans the full span (ingest `servicer.py:650-667`).
  - Also blocking: **O-26** (C-11). The proposal said relayed item 5 ("Use the mcp to read the values") had nothing to act on. The config inputs and the write/read-back go over the homelab MCP; only the three Postgres `SHOW` parameters need the DB-owner DSN. The proposer must adopt this split in the runbook.
  - Non-blocking: O-27 (the denial tokens are an untyped wire contract; define them once in ingest and pin the strings in a UI vitest), O-28 ("already queued or running" wording), O-29 (the homelab values go in the provisioning checklist with the reverted symptom), O-30 (no de-dup assertion across the admin and self-serve paths), O-31 (confirm that the 1000-bar homelab requirement is this feature's to act on, and that analysis `backtest.max_range_days` = 730 does not cap a 1000-bar warmup prefix).
- **Floor status**: no Floor breach (`floor_breaches` is empty in both the synthesis and the round). The adversary's verdict is NEEDS WORK on O-19 and O-26.
- **@AC changes not covered by an operator decision** (must be shown at the gate):
  - `343@AC-9` — **CHANGE**: example strings rewritten to server-true copy, one example per PARTIAL branch.
  - `343@AC-3`, `343@AC-6` — EXTEND.
  - `244@AC-6` (`docs/sdd/business-rules/platform.feature`) — EXTEND: a row for the new key.
  - `343@AC-1`, `343@AC-5`, `270@AC-4`, `198@AC-6`, `334@AC-1`, `334@AC-26` — PRESERVE.
  - Covered by operator decisions: `343@AC-2` (**CHANGE**, the widening), `343@AC-7` and `198@AC-7` (EXTEND), `343@AC-4`, `343@AC-8`, `244@AC-5` (PRESERVE; now covered because option B leaves the default and clamp unchanged).
  - Net-new scenarios due at /sdd-spec: ALREADY_EXISTS (with the "queued or running" wording) and the over-cap denial, plus the round-3 list.
- **Carried risks**: the homelab's three Postgres parameters are still unread (no connected tool exposes them); raising `max_locks_per_transaction` needs a Postgres restart before concurrency can go to 8; a rebuilt homelab database reverts to 3 and 730 until the checklist is re-run; feature 341's counter is not on `main-dev` yet, so this feature's merge waits on it; config migration `050` and peer features 339, 341 and 344 may collide (re-check at /sdd-spec). The full list is in `open_risks` below.

```sdd-batch-design-state
{
  "round": 4,
  "synth": {
    "approach": "Round 4 best approach: the round-3 design stands (tier T1 envelope, self-serve de-dup, widened symbol-card range, insights strategy button opened). The proposal's answers to O-20, O-21, O-22, O-23, O-24 and O-25 are adopted. Its homelab lock-budget step is corrected below: the config inputs are read over the homelab MCP (I read them this round), the sum is per scanner class, and raising `max_locks_per_transaction` comes first.\n\n**Ingest (`services/xstockstrat-ingest/app/handlers/servicer.py:417-476`)**\n- The gate at `:423` becomes admin OR `_is_self_serve_backfill(...)`, in the same position.\n- The predicate returns the first failed condition as a fixed token: `multi_symbol`, `data_kind`, `fill_mode`, `overwrite`, `range_unset`, `range_too_long`, `callback_url`, `no_user`.\n  - The tokens are defined once as an ingest module constant.\n  - A miss aborts PERMISSION_DENIED with `self-serve backfill denied: <token>`; `range_too_long` adds ` (max <N> days)`.\n- Self-serve path only:\n  - One `async with self._db.acquire() as conn, conn.transaction()` block holds `pg_advisory_xact_lock(hashtext('backfill:'||symbol))`, `has_active_job(conn, symbol)` and `insert_job(conn, ...)`.\n  - `has_active_job` reuses the `= ANY(symbols)` predicate (`app/repositories/backfill_jobs.py:111`) over QUEUED and RUNNING with `LIMIT 1`.\n  - `insert_job` keeps its signature; it only calls `.execute` (`backfill_jobs.py:29-58`).\n  - A hit aborts ALREADY_EXISTS after the block, with no foreign job id (R-4).\n  - `_emit_backfill_event` (`:464`) and the `_run_backfill` spawn (`:472`) run after commit.\n- The admin path is unchanged: pool insert, no lock, no de-dup. Tests do not assert de-dup across the admin and self-serve paths.\n- No proto change, no ingest schema migration, no `user_id` in the queued payload (D-11).\n\n**Span cap `ingest` / `backfill.self_serve_max_range_days`**\n- Code default and seed stay 730 (D-4), via config seed migration `050_ingest_backfill_self_serve_keys`.\n- Documented coupling: span = `prefix_calendar_days(max warmup bars)` + card window.\n  - `prefix_calendar_days` = `ceil(bars × 365/252) + 10` (`services/xstockstrat-analysis/app/services/warmup.py:173-184`).\n  - Card window = 366 days (`trader/positions/[symbol]/page.tsx:1190`).\n  - 200 bars: 290 + 10 + 366 = 666, which fits 730 (DigitalOcean).\n  - 1000 bars: 1449 + 10 + 366 = 1825; the homelab sets 1830 through `set_config`.\n- Over-cap denial copy: \"This backtest needs {span} days of history, more than the self-serve limit of {max} days. Ask an admin to backfill {symbol}.\"\n\n**Concurrency, option B (operator)**\n- `backfill.max_concurrent_jobs` keeps default and seed 3. DigitalOcean is unchanged.\n- Homelab values read over the homelab MCP `get_config` on 2026-11-15:\n\n| Namespace | Key | Value |\n|---|---|---|\n| ingest | `backfill.max_concurrent_jobs` | 3 |\n| ingest | `backfill.max_concurrent_chunks` | 3 |\n| ingest | `backfill.chunk_window_days` | 90 |\n| analysis | `readiness_materializer.max_concurrent_bars_fetches` | 2 |\n| analysis | `opportunity.max_concurrent_bars_fetches` | 2 |\n| analysis | `opportunity.max_concurrent_candidates` | 4 |\n| analysis | `backtest.portfolio_max_concurrent` | 9 |\n| analysis | `strategy.max_concurrent_entry_backfill` | 4 |\n| analysis | `backtest.max_range_days` | 730 |\n\n- Homelab runbook sequence (also a line in the homelab provisioning checklist, so a rebuilt database does not silently revert to 3 and 730):\n  1. Over the homelab MCP: `get_config ingest` and `get_config analysis` for the keys above.\n  2. Over the tailnet DB-owner DSN (`docs/runbooks/config-rollout.md:293`): `SHOW max_locks_per_transaction; SHOW max_connections; SHOW max_prepared_transactions;`. These three are the only inputs with no MCP surface (`docs/runbooks/operator-db-access.md`).\n  3. Compute `Σ L_i × S_i ≤ mlpt × (mc + mpt)` (`docs/runbooks/ohlcv-lock-budget-tuning.md:47-48`) per scanner class, with 30-day chunks and 4 relations per chunk.\n     - Backfill writes: 8 jobs × 3 chunks = 24 transactions × (⌈90 ÷ 30⌉ + 1) × 4 = 16 locks = 384.\n     - Full-span readers: L = (⌈1830 ÷ 30⌉ + 1) × 4 = 248; S = 2 + 2 + 9 + 4 = 17 from the analysis keys, giving 4,216.\n     - Backfill gap-planning scans, if they scan the whole span: 8 × 248 = 1,984.\n     - Upper bound: about 6,584. This exceeds a stock budget of 64 × 100 = 6,400.\n     - The real S is also bounded by the bars database's backend connections behind PgBouncer (`deploy/homelab/compose.yml:22`).\n  4. Default step, not a fallback: raise the homelab `max_locks_per_transaction` to 1024 (DigitalOcean parity) and restart Postgres. The budget becomes 1024 × mc, about 102,400 at mc = 100. Skip only if step 2 already shows 1024 or more.\n  5. Over the homelab MCP: `set_config ingest backfill.max_concurrent_jobs=8` and `set_config ingest backfill.self_serve_max_range_days=1830`, then `get_config` to read both back.\n  6. Watch feature 341's marketdata 53200 counter for one readiness cycle.\n- Reverted symptom to record in the checklist: the span denial copy appears on a 1000-bar warmup.\n\n**Dependencies and scope**\n- Lock-breach counter: owned by feature 341 (fix-indicator-pane-warmup). This feature adds none. Add a `docs/roadmap/features/merge-order.md` row: `backtest-inline-backfill` waits for `fix-indicator-pane-warmup`.\n- `insights/backfills/page.tsx` stays admin-only and unchanged.\n\n**UI**\n- `src/lib/backtestBackfill.ts`: `gapToBackfillRequest`, `backfillJobMessage`, `triggerErrorMessage(err, symbol)`.\n- `triggerErrorMessage` switches on the ConnectError code:\n  - PERMISSION_DENIED with `range_too_long`: the span copy above.\n  - Any other PERMISSION_DENIED: one generic sentence, \"This backfill is not available from here. Ask an admin to backfill {symbol}.\" No raw token is shown.\n  - ALREADY_EXISTS: \"A backfill for {symbol} is already queued or running. Try again when it finishes.\" The \"Backfill missing data\" action stays enabled; no link, no polling.\n- A vitest case pins the exact detail strings that the ingest table test asserts, so the two sides cannot drift.\n- Symbol card, insights strategy button, PARTIAL copy and the D-7 memory are as in round 3.\n\n**Tests (ingest table, real `TriggerBackfillRequest`)**\n- 8 envelope rows, each asserting its token.\n- At-cap row; admin row.\n- Duplicate row: no insert, emit or spawn.\n- Insert-raises row: no emit or spawn.\n- The `x-user-id` metadata test.\n\n**Docs in the same PR**\n- Agent `tools.py:1557,1578-1580` with the new denial detail, `docs/runbooks/mcp-tools.md:964-968`, the strat-lab backfill reference, `tests/test_tools_endpoint.py:104`.\n- Ingest key table, registered-keys log, `platform.feature` `@AC-6 @feature-244` row.\n- Homelab runbook section and provisioning-checklist line.\n\n**Acceptance (at /sdd-spec)**\n- New scenarios for ALREADY_EXISTS (with the \"queued or running\" wording) and the over-cap denial, plus the round-3 list.",
    "open_objections": [
      {
        "text": "O-19 (narrowed): the proposal's worked lock example is wrong on its own terms. It uses S = 25 where backfill alone is 24, and applies L = 248 to every class. The proposer must adopt the per-class sum `Σ L_i × S_i` and make raising the homelab `max_locks_per_transaction` to 1024 the default step before the raise to 8, as written in this synthesis. It must also confirm whether backfill gap planning scans the full span (ingest `servicer.py:650-667`).",
        "blocking": true
      },
      {
        "text": "O-26 (C-11, relayed item 5 \"Use the mcp to read the values\"): the proposal says the item has nothing to act on. The config inputs are readable over the homelab MCP `get_config`, and I read them this round. The step-5 write and read-back go through `set_config` and `get_config`. Only the three Postgres `SHOW` parameters need the DB-owner DSN. The proposer must adopt this split and say so in the runbook.",
        "blocking": true
      },
      {
        "text": "O-27 (C-18): the denial tokens and the ` (max <N> days)` suffix are an untyped wire contract. Define the tokens once in ingest, pin the exact strings in a UI vitest, and never show a raw token to a trader.",
        "blocking": false
      },
      {
        "text": "O-28: the ALREADY_EXISTS copy says \"already running\", but de-dup also covers QUEUED (D-9). Use \"already queued or running\" in the copy and the @AC.",
        "blocking": false
      },
      {
        "text": "O-29: the homelab values 8 and 1830 exist only as hand-applied `set_config` steps. Put both in the homelab provisioning checklist and record the reverted symptom (the span denial on a 1000-bar warmup).",
        "blocking": false
      },
      {
        "text": "O-30: the admin path is not serialized against self-serve. The table test must not assert de-dup across the two paths.",
        "blocking": false
      },
      {
        "text": "O-31 (C-11): relayed item 2 (200 bars on DigitalOcean, 1000 bars on the homelab) may belong to feature 341, not this one. Confirm that the homelab span cap of 1830 is this feature's to set, and that analysis `backtest.max_range_days` (730 on the homelab) does not cap the warmup prefix of a 1000-bar backtest.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "343@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-7",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-8",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "270@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "244@AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "244@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "198@AC-7",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "198@AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "334@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "334@AC-26",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Option A for the concurrency cap (a new seeded default everywhere): the operator chose option B, so DigitalOcean stays at 3.",
      "A second lock-breach counter in this feature: the operator assigned the counter to feature 341; this feature depends on it.",
      "Opening the create form on `insights/backfills/page.tsx` to non-admins: the operator confirmed it stays admin-only and unchanged.",
      "Gating the homelab raise on the stock `max_locks_per_transaction`: the per-class upper bound (about 6,584) exceeds 64 × 100 = 6,400, and raising the parameter costs about 27 MB on a database running at 10% of capacity.",
      "A structured denial through `google.rpc.ErrorInfo` status details: more plumbing than one UI consumer justifies; string tokens with a pinned contract test are enough, and D-1 rules out a proto change.",
      "Showing the raw denial token to the trader (\"Backfill not allowed: {detail}\"): tokens such as `no_user` mean nothing to a user.",
      "Computing S from a `pg_stat_activity` sample: it is a point-in-time reading, not a bound; useful only as a cross-check beside feature 341's counter.",
      "Deriving the span-cap default from analysis `backtest.max_range_days`: the gap length comes from the warmup prefix, not from that key.",
      "A link to the job list or polling on ALREADY_EXISTS: the operator asked for the lowest-friction option, and `/insights/backfills` is admin-only with no symbol deep-link."
    ],
    "open_risks": [
      "The homelab's `max_locks_per_transaction`, `max_connections` and `max_prepared_transactions` are still unread; no connected tool exposes them. The runbook reads them before any change.",
      "Raising `max_locks_per_transaction` on the homelab needs a Postgres restart before concurrency can go to 8.",
      "Whether backfill gap planning scans the whole span is unverified; I included it in the upper bound.",
      "Relayed item 2 (1000 bars on the homelab) may belong to feature 341. If so, the homelab 1830 value is still needed whenever 1000-bar warmups run there.",
      "The homelab's analysis `backtest.max_range_days` is 730. I did not check whether it interacts with a 1000-bar warmup prefix.",
      "A rebuilt homelab database reverts to 3 and 730 until the checklist steps are re-run.",
      "Feature 341's counter design lives on its branch; main-dev has no 53200 handling yet. This feature's merge waits on it.",
      "One user can still queue one in-envelope job per symbol and fill every slot (accepted by the operator).",
      "An admin multi-symbol job blocks self-serve for its symbols for its whole duration (accepted).",
      "A strategy whose warmup prefix exceeds the span cap is denied self-serve backfill.",
      "Config migration number 050 may collide with a peer feature; re-check at /sdd-spec.",
      "Peer features 339 (same `page.tsx`), 341 and 344 (ingest) can conflict at merge; re-run the C-16 scan at /sdd-spec.",
      "Whether `bars_total` is set during a run is unverified; \"Backfilling…\" without a denominator is the fallback copy.",
      "The `GetBackfillStatus` e2e mock does not exist yet.",
      "`jobId`, \"Data ready\" and the last-filled gap are local state and are lost on reload (accepted under D-2).",
      "@AC-9 exists only on the feature branch until the branches are synced."
    ],
    "constitution_rules_touched": [
      "C-05",
      "C-08",
      "C-10",
      "C-11",
      "C-12",
      "C-13",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "F-07",
      "P-02",
      "P-03",
      "P-06",
      "PLAT-4",
      "PLAT-N1"
    ],
    "rationale": "No Floor breach. The adversary's verdict is NEEDS WORK on two points, and both hold.\n\n**Verified this round**\n- I read the homelab config over the MCP (`get_config ingest` and `get_config analysis`). The values are in the approach table. This shows relayed item 5 can be followed for every config input.\n- `deploy/homelab/compose.yml:22` sets `DB_PGBOUNCER: \"true\"`, so the homelab routes through PgBouncer. That closes the proposer's stated unknown.\n- Nothing under `deploy/` sets `max_locks_per_transaction` or `max_connections`, so those stay a runbook read.\n- With the MCP-read values, the per-class upper bound is about 6,584 against a stock budget of 6,400. The proposal's \"passes at 6,200\" does not hold, so raising the lock parameter first is the right default.\n\n**Closed**\n- O-20: dependency on feature 341 plus a merge-order row, as the operator ruled.\n- O-21: admin-only, operator-confirmed.\n- O-22: default 730 kept; 666 and 1825 derived from prefix plus window; denial copy given.\n- O-23: condition tokens in the detail. The remaining contract and copy points move to O-27.\n- O-24: one transaction on `conn`, emit and spawn after commit, two test rows.\n- O-25: accepted, with a message and the action left enabled. The wording fix moves to O-28.\n\n**Still open (blocking)**\n- O-19: the proposal follows the steer's SHOW-first shape, but its arithmetic is wrong. I corrected the approach; the proposer has not yet adopted it.\n- O-26: the proposal set aside a direct user answer.\n\n**Register**\n- D-1 to D-4 and D-6 to D-13 are honoured. D-4's default of 730 is kept.\n- R-1 to R-6 are not reintroduced. ALREADY_EXISTS returns no foreign job id (R-4).\n- D-5 is reopened by the operator steer and superseded by D-8. P-1 is resolved as \"user reopened\"; it needs no new petition.\n\n**Business rules**\n- 244@AC-5 is preserved and now covered: the operator chose option B, so the default and clamp do not move.\n- 343@AC-9 is still a CHANGE without an operator decision and is shown at the gate.\n- The other rows are unchanged from round 3.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Concurrency option B: `backfill.max_concurrent_jobs` keeps default and seed 3; the homelab alone is set to 8 through `set_config`, recorded in the homelab runbook. DigitalOcean is unchanged.",
          "evidence": "Operator decision 2026-11-15 (design gate, round 3) and relayed item 4 \"B\"; homelab MCP get_config shows the current value 3; config-rollout.md:293."
        },
        {
          "text": "The create form on `insights/backfills/page.tsx` stays admin-only and unchanged.",
          "evidence": "Operator decision 2026-11-15 (round 3) and relayed item 6 \"Leave it admin-only\"."
        },
        {
          "text": "The lock-budget breach counter is owned by feature 341 (fix-indicator-pane-warmup). This feature adds no counter and gets a merge-order row that waits for 341.",
          "evidence": "Operator decision 2026-11-15 (round 3) and relayed item 7 \"Agreed\"; adversary concurs in round 4."
        },
        {
          "text": "The span-cap default and seed stay 730. The documented coupling is `prefix_calendar_days(max warmup bars)` plus the 366-day card window: 666 days at 200 bars, 1825 at 1000 bars. The homelab is set to 1830 through `set_config`. An over-cap request is denied with copy that names the span and the limit.",
          "evidence": "services/xstockstrat-analysis/app/services/warmup.py:173-184; page.tsx:1190; relayed item 2; adversary accepts the derivation in round 4."
        },
        {
          "text": "The envelope predicate returns the first failed condition as a fixed token, and the PERMISSION_DENIED detail is `self-serve backfill denied: <token>`, with ` (max <N> days)` for `range_too_long`.",
          "evidence": "servicer.py:423-424; proposal round 4; adversary accepts the shape and adds only contract hardening."
        },
        {
          "text": "Self-serve de-dup runs `pg_advisory_xact_lock`, `has_active_job` and `insert_job` on one connection in one transaction. `insert_job` keeps its signature. The ledger emit and the job spawn happen after commit. The admin path is unchanged.",
          "evidence": "backfill_jobs.py:29-58,:111; servicer.py:464,:472; adversary closes O-24 in round 4."
        },
        {
          "text": "On ALREADY_EXISTS the card shows a message and keeps \"Backfill missing data\" enabled, with no link, no polling and no foreign job id. An admin multi-symbol job blocking self-serve for its symbols is accepted. The case gets its own @AC.",
          "evidence": "Relayed item 8 \"Choose the one with less friction\"; R-4; adversary closes O-25 in round 4."
        },
        {
          "text": "The homelab raise is a runbook sequence: config inputs over the homelab MCP, the three Postgres parameters by read-only SHOW, the per-class lock sum, `max_locks_per_transaction` raised to 1024 first, then `set_config` and read-back, then observation of feature 341's counter.",
          "evidence": "Operator steer round 4 and relayed items 1 and 5; ohlcv-lock-budget-tuning.md:47-48,59-63; homelab MCP get_config read 2026-11-15; deploy/homelab/compose.yml:22."
        }
      ],
      "new_rejected": [
        {
          "text": "Option A for the concurrency cap: a new seeded default on every deployment.",
          "why": "The operator chose option B; DigitalOcean stays at 3."
        },
        {
          "text": "A second lock-breach counter designed in this feature.",
          "why": "The operator assigned the counter to feature 341; this feature depends on it."
        },
        {
          "text": "Opening the create form on the insights Backfills page to non-admins.",
          "why": "The operator confirmed it stays admin-only and unchanged."
        },
        {
          "text": "A structured denial through `google.rpc.ErrorInfo` status details.",
          "why": "It adds decoding plumbing for one UI consumer; string tokens with a pinned contract test are enough."
        },
        {
          "text": "Gating the homelab raise to 8 on the stock `max_locks_per_transaction` value.",
          "why": "The per-class upper bound exceeds the stock budget; raising the parameter is cheap on a database at 10% of capacity."
        }
      ],
      "new_objections": [
        {
          "text": "O-26: relayed item 5 \"Use the mcp to read the values\" must be followed as far as it can be: config inputs and the write/read-back over the homelab MCP, only the three Postgres SHOW parameters over the DB-owner DSN.",
          "blocking": true
        },
        {
          "text": "O-27: the denial tokens are an untyped wire contract; define them once in ingest, pin the exact strings in a UI vitest, and never show a raw token to a trader.",
          "blocking": false
        },
        {
          "text": "O-28: the ALREADY_EXISTS copy must say \"already queued or running\", because de-dup covers QUEUED too.",
          "blocking": false
        },
        {
          "text": "O-29: put the homelab `set_config` steps (8 and 1830) in the homelab provisioning checklist and record the reverted symptom.",
          "blocking": false
        },
        {
          "text": "O-30: the table test must not assert de-dup across the admin and self-serve paths.",
          "blocking": false
        },
        {
          "text": "O-31: confirm that relayed item 2 (1000 bars on the homelab) is this feature's to act on, and that analysis `backtest.max_range_days` (730 on the homelab) does not cap a 1000-bar warmup prefix.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-20",
          "how": "No second counter. Feature 341 owns the marketdata 53200 counter; this feature lists it as a dependency with a merge-order row (operator ruling)."
        },
        {
          "id": "O-21",
          "how": "The insights Backfills create form stays admin-only and unchanged, confirmed by the operator."
        },
        {
          "id": "O-22",
          "how": "The default stays 730, derived from prefix plus window (666 days at 200 bars). The homelab is set to 1830 for 1000 bars. The coupling and the over-cap denial copy are documented."
        },
        {
          "id": "O-23",
          "how": "The predicate returns a condition token and the detail names it; the UI switches on it. Contract pinning and copy mapping are carried forward as O-27."
        },
        {
          "id": "O-24",
          "how": "The lock, `has_active_job` and `insert_job` share one connection and transaction; emit and spawn follow the commit; two test rows are added. `insert_job` needs no signature change."
        },
        {
          "id": "O-25",
          "how": "Stated as accepted. On ALREADY_EXISTS the card shows a message and keeps the action enabled. The \"queued or running\" wording fix is carried forward as O-28."
        }
      ],
      "reopen_petitions": [],
      "reopened": [
        "D-5"
      ]
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-15 — sdd-batch design gate (round 5)

- `/sdd-design backtest-inline-backfill` full debate halted at its approval gate after round 5 (gate policy: halt). `design.md` is not written and `status.md` is unchanged (`spec-ready`). Register: `debate.md` (D-22…D-28 settled, R-12…R-15 locked, O-19 and O-26…O-31 closed, O-32 and O-33 open, P-2 pending user, D-21 reopened by the operator steer and superseded by D-22).
- Operator answers relayed with this run (2026-11-15), verbatim: "1. Approved", "2. Confirmed", "3. Sign-off the change, amend it", "4. There are no production instances. Staging is enough." Only item 4 is applied as a decision (D-24). The questions that items 1–3 answer were not in this step's input, so they are not mapped to a register row here; O-32, O-33 and P-2 stay open or pending until the gate ties them.
- `debate.md` still shows petition P-1 as `pending user`. The round-5 synthesis asks the orchestrator to mark it "user reopened" (D-5 is already superseded by D-8); this round gave no verdict row for it, so the cell was left unchanged.

### Open Threads

- **Approach (round 5 best)**: the round-4 design stands in shape (tier T1 envelope with first-failed-condition tokens, self-serve de-dup in one transaction, widened symbol-card range, insights strategy button opened, span cap default and seed 730, concurrency option B). Round 5 changes only:
  - **Lock budget (D-23, closes O-19)**: capacity is cluster-wide, `max_locks_per_transaction × (max_connections + max_prepared_transactions)` = 1024 × (70 + 0) = 71,680 once homelab-edge PR #79 is applied. The binding bound is `marketdata connections × replicas × L_stmt_max × databases`: only marketdata queries `marketdata.ohlcv`, and its pool is capped at 2 connections (`pool.go:14,23`; `DB_POOL_MAX` is forbidden on pooled homelab services, `render-assert.jq:49`). PgBouncer `pool_size` (10 per database) is a backstop only. L = (⌈span ÷ 30⌉ + 1) × 4; the largest statement is not the self-serve cap (L = 248) but the analysis bar fetch (2,555 days, L = 348) or an uncapped admin GAPS_ONLY coverage scan. At L = 348 the bound is 1,392; at L = 1,000 it is 4,000. GAPS_ONLY gap planning scans the full requested span once per job, before chunk writes (ingest `servicer.py:654-661,683`; `marketdata_repo.go:228-232`). The unbounded per-class sum is 6,200 per database, for reference. No lock-parameter raise is part of this feature.
  - **Homelab runbook (D-22, D-24, D-26; closes O-26, O-29)**: a new homelab subsection in `docs/runbooks/config-rollout.md` next to `:293-297`, staging environment only. (1) `get_config` over the homelab staging MCP for the three ingest backfill keys and the six analysis keys. (2) Read-only `SHOW max_locks_per_transaction`, `max_connections`, `max_prepared_transactions` over the DB-owner DSN (expected 1024, 70, 0); confirm marketdata runs one replica with `DB_POOL_MAX` unset; no PgBouncer `SHOW DATABASES`. (3) Compute the lock inequality from the values read, and stop if it fails; a value that differs from the expected ones is reported as "PR #79 not applied" and does not stop the rollout while the inequality holds. (4) `set_config ingest backfill.max_concurrent_jobs=8` and `backfill.self_serve_max_range_days=1830`, then read both back. (5) Watch feature 341's 53200 counter and marketdata's pool-wait metrics for one readiness cycle. Checklist lines: re-run step 4 after a database rebuild; apply the same two values per environment when a homelab production app is first deployed; reverted symptom is the "limit of 730 days" denial on a 1000-bar warmup and at most 3 jobs running. Nothing in homelab-edge is edited.
  - **Denial tokens (D-25, closes O-27)**: one frozen tuple of the 8 tokens and one formatter `_self_serve_denial_detail(token, max_days=None)` in ingest next to `_has_admin_scope` (`servicer.py:357`); prefix and token literals in `src/lib/backtestBackfill.ts`. `range_too_long` maps to the span copy and every other or unknown token to the generic copy. The drift guard is one checked-in JSON fixture of the tokens and detail format, loaded by both the ingest table test and the UI vitest; its path is chosen at /sdd-spec under the C-13 fixture homes.
  - **Copy, tests, scope (D-27, D-28; closes O-28, O-30, O-31)**: the ALREADY_EXISTS copy is "A backfill for {symbol} is already queued or running. Try again when it finishes." in the @AC and its vitest case. De-dup is asserted only between two self-serve requests; the admin row asserts QUEUED only. This feature owns the homelab value 1830 because it owns the key. Analysis `backtest.max_range_days` is checked against `request.range` only (analysis `servicer.py:928-935`) and does not cap the warmup prefix.
  - **Unchanged from round 4**: ingest gate, predicate, de-dup transaction, admin path, no proto change, no ingest schema migration; config seed migration `050_ingest_backfill_self_serve_keys` (number re-checked at /sdd-spec); UI card, insights strategy button, PARTIAL copy, D-7 memory; the dependency on feature 341 with a merge-order row; the docs list.
- **Strongest open objection**: none is blocking. Two gate confirmations remain:
  - **O-32**: the synthesis makes the computed lock inequality the hard stop for the homelab rollout and treats a mismatch with the PR #79 values (1024 / 70 / 0) as a reported finding. The operator steer's "runbook precondition" wording can also be read as "stop until PR #79 is applied". Both readings are safe; the gate must pick one.
  - **O-33**: `343@AC-9` is still a CHANGE with no operator decision that names it. Relayed item 3 ("Sign-off the change, amend it") may be that sign-off or may refer to amending D-21.
  - Also pending: **P-2**, the petition to reopen D-21 (step 4 only), which D-22 already acts on under the operator steer.
- **Floor status**: no Floor breach (`floor_breaches` is empty in both the synthesis and the round). The adversary's verdict is SOUND.
- **@AC changes not covered by an operator decision** (must be shown at the gate; no row changed from round 4):
  - `343@AC-9` — **CHANGE**: example strings rewritten to server-true copy, one example per PARTIAL branch (see O-33).
  - `343@AC-3`, `343@AC-6` — EXTEND.
  - `244@AC-6` (`docs/sdd/business-rules/platform.feature`) — EXTEND: a row for the new key.
  - `343@AC-1`, `343@AC-5`, `270@AC-4`, `198@AC-6`, `334@AC-1`, `334@AC-26` — PRESERVE.
  - Covered by operator decisions: `343@AC-2` (**CHANGE**), `343@AC-7` and `198@AC-7` (EXTEND), `343@AC-4`, `343@AC-8`, `244@AC-5` (PRESERVE).
- **Carried risks**: homelab-edge PR #79 is merged but not applied, so the live Postgres values are unread until runbook step 2; the S ≤ 2 bound fails if marketdata gets `DB_POOL_MAX` or more replicas; admin GAPS_ONLY ranges are uncapped; 8 jobs move contention onto marketdata's 2 connections and can slow interactive `GetBars`; the marketdata pool metric names were not checked against the marketdata `CLAUDE.md`; a rebuilt homelab database reverts to 3 and 730; config migration `050` and peer features 339, 341 and 344 may collide (re-check at /sdd-spec). The full list is in `open_risks` below.

```sdd-batch-design-state
{
  "round": 5,
  "synth": {
    "approach": "Round 5 best approach: the round-4 design stands in shape (tier T1 envelope with first-failed-condition tokens, self-serve de-dup in one transaction, widened symbol-card range, insights strategy button opened, span cap default and seed 730, concurrency option B). This round changes only the lock-budget statement, the homelab runbook, the token drift guard and three small copy, test and scope points. I checked the adversary's code claims in the working tree and they hold.\n\n**Lock budget (O-19)**\n- Capacity is cluster-wide: `max_locks_per_transaction × (max_connections + max_prepared_transactions)` = 1024 × (70 + 0) = 71,680 once homelab-edge PR #79 is applied.\n- Gap planning does scan the full requested span.\n  - Under GAPS_ONLY, `_plan_work_ranges` passes `request.range` unchanged to marketdata `GetDataCoverage` (`services/xstockstrat-ingest/app/handlers/servicer.py:654-661`).\n  - That runs one `SELECT MIN, MAX, COUNT … WHERE time >= $3 AND time <= $4` (`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:228-232`).\n  - It runs once per job, before the job's chunks are planned and written (`servicer.py:683`), so planning and chunk writes of one job never overlap.\n- Binding concurrency bound: only marketdata queries `marketdata.ohlcv`, and its pool is capped at 2 connections (`services/xstockstrat-marketdata/internal/repository/pool.go:14,23`). `DB_POOL_MAX` is forbidden on pooled homelab services (`deploy/homelab/render-assert.jq:49`). So S ≤ 2 × marketdata replicas per database.\n- Backstop bound: PgBouncer `pool_size` = 10 per database (operator value). It applies only if the marketdata pool is ever raised.\n- Per-statement L = (⌈span ÷ 30⌉ + 1) × 4. The self-serve cap (1830 days, L = 248) is not the largest statement:\n  - Analysis bar fetch on the homelab: 730-day window plus up to 1825 days of prefix = 2,555 days, L = 348.\n  - Admin GAPS_ONLY coverage scans have no range cap at ingest.\n- Stated bound: `marketdata conns × replicas × L_stmt_max × databases`. At L = 348: 2 × 348 × 2 = 1,392. At L = 1,000: 4,000. Both fit 71,680, and both also fit the pre-PR-#79 budget (64 × 60 = 3,840 only at the L = 348 figure).\n- Unbounded per-class sum, for reference: 17 full-span readers × 248 + 8 jobs × max(248, 3 × 16) = 6,200 per database.\n- No lock-parameter raise is part of this feature.\n\n**Homelab runbook (O-26, O-29)** — new homelab subsection in `docs/runbooks/config-rollout.md`, next to `:293-297`. Config steps target the homelab staging environment only (user: no production instance exists).\n1. Over the homelab staging MCP, `get_config` for ingest `backfill.max_concurrent_jobs`, `backfill.max_concurrent_chunks`, `backfill.chunk_window_days` and the six analysis keys from round 4.\n2. Read-only against the live host over the DB-owner DSN (`docs/runbooks/operator-db-access.md`): `SHOW max_locks_per_transaction`, `SHOW max_connections`, `SHOW max_prepared_transactions`. Expected after PR #79: 1024, 70, 0. Record what is read.\n   - No PgBouncer `SHOW DATABASES`: no access route is named, and `pool_size` is not the binding bound. Cite the operator value 10.\n   - Confirm marketdata runs one replica with `DB_POOL_MAX` unset (`deploy/homelab/compose.yml:128`, `render-assert.jq:49`).\n3. Compute `marketdata conns × replicas × L_stmt_max × databases ≤ mlpt × (mc + mpt)` from the values just read, with L_stmt_max from the longest admin range the operator accepts. Stop if it fails. A value that differs from the expected ones is reported as \"PR #79 not applied\" and does not stop the rollout while the inequality holds.\n4. Over the homelab staging MCP: `set_config ingest backfill.max_concurrent_jobs=8` and `set_config ingest backfill.self_serve_max_range_days=1830`, then `get_config` to read both back.\n5. For one readiness cycle, watch feature 341's 53200 counter and marketdata's `marketdata.db.pool.empty_acquire_wait` and acquired-equals-max (24 chunk writes now contend for 2 connections with interactive `GetBars`).\n- Provisioning-checklist lines in the same subsection:\n  - Re-run step 4 after a database rebuild.\n  - Apply the same two values per environment when a homelab production app is first deployed.\n  - Reverted symptom: the span-denial copy (\"limit of 730 days\") appears on a 1000-bar warmup, and at most 3 jobs run while others stay QUEUED.\n- This feature edits nothing in homelab-edge.\n\n**Denial tokens (O-27)**\n- Ingest: one frozen tuple of the 8 tokens next to `_has_admin_scope` (`servicer.py:357`) and one formatter `_self_serve_denial_detail(token, max_days=None)`.\n- UI: `src/lib/backtestBackfill.ts` holds the prefix and token literals. `triggerErrorMessage` maps `range_too_long` to the span copy and every other or unknown token to the generic copy. No raw token reaches a trader.\n- Drift guard: one checked-in JSON fixture listing the 8 tokens and the detail format, loaded by both the ingest table test and the UI vitest. Its path is chosen at /sdd-spec under the C-13 fixture homes. Two independently pinned literal sets are not adopted, because each test would only check its own side.\n\n**Copy, tests, scope (O-28, O-30, O-31)**\n- ALREADY_EXISTS copy: \"A backfill for {symbol} is already queued or running. Try again when it finishes.\" Same wording in the @AC and its vitest case.\n- De-dup is asserted only between two self-serve requests (a duplicate row and a race row). The admin row asserts QUEUED only. No row pairs an admin job with a self-serve job.\n- This feature owns the homelab value 1830 because it owns the key. Producing 1000-bar warmups is not this feature's work.\n- Analysis `backtest.max_range_days` is checked against `request.range` only (`services/xstockstrat-analysis/app/handlers/servicer.py:928-935`), so it does not cap the warmup prefix.\n\n**Unchanged from round 4**\n- Ingest gate, predicate, de-dup transaction, admin path, no proto change, no ingest schema migration.\n- Config seed migration `050_ingest_backfill_self_serve_keys` (number re-checked at /sdd-spec).\n- UI card, insights strategy button, PARTIAL copy, D-7 memory.\n- Dependency on feature 341 with a merge-order row.\n- Docs list (agent `tools.py`, `mcp-tools.md`, strat-lab reference, key tables, `platform.feature` row).",
    "open_objections": [
      {
        "text": "Stop condition for the homelab rollout: the synthesis makes the computed lock inequality the hard stop and treats a mismatch with the PR #79 values (1024 / 70 / 0) as a reported finding. The operator steer says the Postgres parameters are \"verified … as a runbook precondition\", which can also be read as \"stop until PR #79 is applied\". Confirm the reading at the design gate; both are safe.",
        "blocking": false
      },
      {
        "text": "343@AC-9 is still a CHANGE with no operator decision that names it. Relayed item 3 (\"Sign-off the change, amend it\") may be that sign-off or may refer to amending D-21; the question numbering is not in this step's input. Confirm at the gate.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "343@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-7",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-8",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "270@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "244@AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "244@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "198@AC-7",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "198@AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "334@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "334@AC-26",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Raising the homelab `max_locks_per_transaction` as a step of this feature: the operator's homelab-edge PR #79 already sets 1024, and the corrected bound fits without it.",
      "Bounding lock use by PgBouncer `pool_size × L_max` as the primary bound: marketdata's 2-connection pool is tighter and code-enforced; the PgBouncer bound stays as a backstop only.",
      "Using L = 248 (the self-serve span cap) as the largest statement: analysis fetches reach 348 and admin coverage scans are uncapped.",
      "A PgBouncer `SHOW DATABASES` read in the runbook: it needs an admin or stats login the design does not name, and the value is not binding.",
      "A hard stop on `max_locks_per_transaction < 1024`: it ties the rollout to another repo's apply when the computed inequality already passes on the stock value.",
      "Two independently pinned token literal sets (ingest test and UI vitest) as the drift guard: each test checks only its own side, so a rename on one side passes CI.",
      "A token list generated from a single file into both languages: more mechanism than one UI consumer needs; a shared test fixture gives the same guard without codegen.",
      "Recording the token set only as a constitution contract entry: it documents the coupling but does not fail CI on drift.",
      "Editing homelab-edge's `deploy-compose-app.md` for the checklist: that is the owner's repo; the checklist lives in this repo's `config-rollout.md`.",
      "Applying the two homelab values to the homelab production environment now: no production instance exists; a checklist line covers the day it is deployed."
    ],
    "open_risks": [
      "Homelab-edge PR #79 is merged but not applied. The live Postgres values are unread until runbook step 2.",
      "The S ≤ 2 bound fails if marketdata gets `DB_POOL_MAX` or more replicas; the runbook re-checks both.",
      "Admin GAPS_ONLY ranges are uncapped, so L_stmt_max is whatever admin range the operator accepts.",
      "Pre-004 one-day ohlcv chunks would raise L for old ranges; the homelab is asserted to be a fresh deploy, not verified.",
      "Raising to 8 jobs moves contention onto marketdata's 2 connections and can slow interactive `GetBars`; step 5 watches the pool metrics.",
      "The marketdata pool metric names come from the adversary's citation of the marketdata CLAUDE.md; I did not open that file.",
      "Feature 341's 53200 counter lives on its branch; this feature's merge waits on it.",
      "A rebuilt homelab database reverts to 3 and 730 until the checklist is re-run.",
      "The shared token fixture is read across two service trees; its home and loading path are set at /sdd-spec.",
      "Config migration number 050 may collide with a peer feature; re-check at /sdd-spec.",
      "Peer features 339 (same `page.tsx`), 341 and 344 (ingest) can conflict at merge; re-run the C-16 scan at /sdd-spec.",
      "One user can still queue one in-envelope job per symbol and fill every slot (accepted by the operator).",
      "An admin multi-symbol job blocks self-serve for its symbols for its whole duration (accepted).",
      "Whether `bars_total` is set during a run is unverified; \"Backfilling…\" without a denominator is the fallback copy.",
      "The `GetBackfillStatus` e2e mock does not exist yet.",
      "`jobId`, \"Data ready\" and the last-filled gap are local state and are lost on reload (accepted under D-2).",
      "@AC-9 exists only on the feature branch until the branches are synced."
    ],
    "constitution_rules_touched": [
      "C-05",
      "C-08",
      "C-10",
      "C-11",
      "C-12",
      "C-13",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "F-07",
      "P-02",
      "P-03",
      "P-06",
      "PLAT-4",
      "PLAT-N1"
    ],
    "rationale": "No Floor breach. The adversary's verdict is SOUND, and no blocking objection remains. Seven objections close, and the adversary's non-blocking fixes are folded into the approach.\n\n**Verified this round (working tree)**\n- `pool.go:14,23`: marketdata's pool defaults to 2 connections.\n- `render-assert.jq:49`: a pooled homelab service may not set its pool size.\n- Only `marketdata_repo.go` and `marketdata_service.go` query `marketdata.ohlcv`.\n- `servicer.py:654-661` and `marketdata_repo.go:228-232`: GAPS_ONLY planning scans the full requested range, once per job, before the chunks.\n- Analysis `servicer.py:928-935`: `backtest.max_range_days` is checked against `request.range` only.\n\n**Closed**\n- O-19: the per-class sum is stated (6,200), planning is confirmed to scan the full span, and the bound is corrected to marketdata's pool with PgBouncer as backstop.\n- O-26: config reads and the write and read-back go over the homelab staging MCP; the three Postgres parameters are read-only SHOWs.\n- O-27: one ingest constant and formatter, a shared JSON fixture for both tests, no raw token shown.\n- O-28, O-29, O-30, O-31: adopted as proposed, with the production-instance checklist line added.\n\n**Register**\n- D-21 step 4 (\"raise to 1024 first\") is contradicted by this round's operator steer (\"no lock-setting raise is needed before the cap raise\"). I record D-21 as reopened by the steer and superseded by a new decision. The proposer's petition is recorded with new evidence (PR #79 values).\n- R-11 is honoured: the rollout is not gated on the stock lock value; the stop is the computed inequality on live values.\n- D-14, D-16, D-17, D-18 and R-10 are honoured. The shared fixture is test data, not `ErrorInfo` plumbing or codegen.\n- P-1 (D-5) is already resolved by D-8; the orchestrator should mark it \"user reopened\".\n\n**Operator steer versus adversary**\n- The steer asks to bound S by the PgBouncer pool where scans are pooled. I keep that bound as a backstop and lead with the tighter marketdata bound.\n- The steer's \"runbook precondition\" wording is ambiguous on whether a non-applied PR #79 stops the rollout. I chose the inequality as the stop and raised it for gate confirmation.\n\n**Business rules**\n- No row changes from round 4. 343@AC-9 stays uncovered because I cannot tie relayed item 3 to it from this step's input.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Supersedes D-21. The homelab raise is a runbook sequence with no lock-parameter change: config inputs over the homelab staging MCP; `max_locks_per_transaction`, `max_connections` and `max_prepared_transactions` by read-only SHOW on the live host; the lock inequality computed from those values as the stop condition; then `set_config` (8 and 1830) and read-back; then observation.",
          "evidence": "Operator steer round 5 (PR #79: 1024 / 70 / 0, no raise needed; O-26 split); proposal round 5; adversary supports the D-21 reopen."
        },
        {
          "text": "The lock bound is `marketdata connections × replicas × L_stmt_max × databases` against the cluster-wide `mlpt × (mc + mpt)`. PgBouncer `pool_size` (10 per database) is a backstop. GAPS_ONLY gap planning scans the full requested span once per job, before chunk writes.",
          "evidence": "services/xstockstrat-marketdata/internal/repository/pool.go:14,23; deploy/homelab/render-assert.jq:49; ingest servicer.py:654-661,683; marketdata_repo.go:228-232; operator values."
        },
        {
          "text": "The homelab config steps target the staging environment only. A checklist line applies the same two values per environment when a homelab production app is first deployed.",
          "evidence": "Relayed user item 4 (\"There are no production instances. Staging is enough.\"); adversary round 5."
        },
        {
          "text": "The denial tokens are one frozen tuple and one formatter in ingest and literals in `src/lib/backtestBackfill.ts`. One checked-in JSON fixture of the tokens and detail format is loaded by both the ingest table test and the UI vitest. `range_too_long` maps to the span copy; any other or unknown token maps to the generic copy.",
          "evidence": "servicer.py:357,423-424; docs/roadmap/ledger/fails.md:308,1516 (adversary round 5); D-18."
        },
        {
          "text": "The homelab provisioning checklist and reverted symptom live in the homelab subsection of `docs/runbooks/config-rollout.md`. Observation after the raise covers feature 341's 53200 counter and marketdata's pool-wait metrics.",
          "evidence": "docs/runbooks/config-rollout.md:293-297; proposal round 5; adversary round 5 (pool contention)."
        },
        {
          "text": "The ALREADY_EXISTS copy is \"A backfill for {symbol} is already queued or running. Try again when it finishes.\" De-dup tests cover self-serve pairs only.",
          "evidence": "D-9 (QUEUED and RUNNING); proposal round 5; uncontested by the adversary."
        },
        {
          "text": "This feature owns the homelab value 1830 for its own key. Analysis `backtest.max_range_days` does not cap the warmup prefix.",
          "evidence": "services/xstockstrat-analysis/app/handlers/servicer.py:928-935; adversary confirms in round 5."
        }
      ],
      "new_rejected": [
        {
          "text": "Raising the homelab `max_locks_per_transaction` as a step of this feature.",
          "why": "PR #79 in the operator's homelab-edge repo already sets 1024, and the corrected bound fits without it."
        },
        {
          "text": "Two independently pinned token literal sets as the drift guard.",
          "why": "Each test checks only its own side, so a rename on one side passes CI."
        },
        {
          "text": "A PgBouncer `SHOW DATABASES` read in the runbook.",
          "why": "No access route is named, and `pool_size` is not the binding bound."
        },
        {
          "text": "A hard stop on `max_locks_per_transaction` below 1024.",
          "why": "The computed inequality passes without it, and the gate would wait on another repo's apply."
        }
      ],
      "new_objections": [
        {
          "text": "Confirm at the gate whether a host that does not yet show the PR #79 values stops the homelab rollout, or only a failed lock inequality does.",
          "blocking": false
        },
        {
          "text": "Confirm at the gate that the 343@AC-9 change is signed off; relayed item 3 cannot be tied to it from the synthesis input.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-19",
          "how": "Per-class sum stated (6,200 per database); gap planning confirmed to scan the full span once per job; the bound is corrected to marketdata's 2-connection pool with PgBouncer as backstop, against 1024 × 70."
        },
        {
          "id": "O-26",
          "how": "Config reads and the write and read-back go over the homelab staging MCP; the three Postgres parameters are read-only SHOWs on the live host as a precondition."
        },
        {
          "id": "O-27",
          "how": "One ingest constant and formatter, UI literals, a shared JSON fixture loaded by both tests, and generic copy for any non-span token."
        },
        {
          "id": "O-28",
          "how": "The copy and the @AC say \"already queued or running\"."
        },
        {
          "id": "O-29",
          "how": "Checklist lines and the reverted symptom go in the homelab subsection of `config-rollout.md`, including a line for a future production deploy."
        },
        {
          "id": "O-30",
          "how": "De-dup is asserted only between self-serve requests; the admin row asserts QUEUED only."
        },
        {
          "id": "O-31",
          "how": "The 1830 value is this feature's because it owns the key; `backtest.max_range_days` is checked against `request.range` only and does not cap the prefix."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-21",
          "evidence": "Proposer, step 4 only: homelab-edge PR #79 and its db-host verify task assert `max_locks_per_transaction` = 1024, so the raise step becomes a read-only check. The adversary supports it and asks that the stop be the computed inequality.",
          "is_new": true
        }
      ],
      "reopened": [
        "D-21"
      ]
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-15 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-ui, xstockstrat-ingest, plus xstockstrat-agent and the `strat-lab` plugin for the docs; key reuse patterns: the insights strategy page gap → backfill request, `useTriggerBackfill` + `useBackfillStatus(jobId)`).
- Phase 1 Grilling: 5 rounds (full). Chosen approach: FR-6 through a tier-T1 self-serve envelope on ingest `TriggerBackfill` (eight conditions with denial tokens, per-symbol de-dup, span cap key `backfill.self_serve_max_range_days` default 730), an inline action on the symbol-page Backtests card with manual re-run, the insights strategy button opened to non-admins, and a homelab-only runbook that sets 8 jobs and 1830 days after a read-only lock check. Rejected: R-1…R-15 in `debate.md`, chiefly deleting the gate outright, automatic re-run, the FR-7 fallback and any lock-parameter raise in this feature.
- Constitution rules touched: C-05, C-08, C-10, C-11, C-12, C-13, C-14, C-15, C-16, C-18, F-07, P-02, P-03, P-06, PLAT-4, PLAT-N1. Floor breaches: none.
- Status: spec-ready → design-approved.
- Operator approval (2026-11-15, design gate, round 5), verbatim "Agreed": the round-5 design is approved, including the petitioned D-21 reopen. The lock-setting raise step becomes a read-only check, and the computed inequality is the stop.
- `debate.md` changes this session: State `in-debate` → `approved`; petition verdicts P-1 and P-2 `pending user` → `user reopened`. No row was added or reworded.
  - Deviation from the batch step's wording, which said to mark pending petitions `user declined`: both reopens were accepted by the operator (P-1 by the round-3 widening decision, D-8; P-2 by the round-5 approval, D-22), so `user declined` would misstate the record.
  - O-32 and O-33 keep status `open`, because the step supplied no status line for them. The round-5 approval answers O-32: only a failed lock inequality stops the homelab rollout.
- `343@AC-9` CHANGE sign-off (C-16): the round-5 approval covers the design that contains the rewrite (D-12). No operator decision names the scenario on its own (O-33), so /sdd-spec confirms before it edits the scenario.
- Operator answers relayed with this run (2026-11-15), verbatim: "1. Agreed", "2. Ok, agreed.", "3. I plan to do psql over ssh if possible.", "4. Confirmed", "5. Yes, fix the primitives. Use the switch component from Shadcn.", "6. Sounds good". The questions they answer were not in this step's input, and the batch covers four features, so none is mapped to a register row here. Item 3 may concern the access route for runbook step 2; it is carried as an open thread.
- No ledger line was written. The token drift trap is already in `fails.md` (lines 308 and 1516, cited by D-25).

### Decisions

- The chosen approach is `design.md` § Chosen Approach; the binding register is `debate.md` (D-1…D-28, with D-5 superseded by D-8 and D-21 by D-22).

### Open Threads

- Homelab-edge PR #79 is merged but not applied; the live Postgres values are unread — runbook step 2.
- The 2-connection bound fails if marketdata gets `DB_POOL_MAX` or more replicas — runbook step 2.
- Admin GAPS_ONLY ranges are uncapped, so `L_stmt_max` is the longest admin range the operator accepts — runbook step 3.
- Pre-004 one-day ohlcv chunks would raise L for old ranges; the homelab is asserted to be a fresh deploy, not verified — runbook step 2.
- Eight jobs move contention onto marketdata's 2 connections and can slow interactive `GetBars` — runbook step 5.
- The marketdata pool metric names were not checked against the marketdata `CLAUDE.md` — /sdd-spec.
- Feature 341's 53200 counter lives on its branch; this feature's merge waits on it — merge-order row at /sdd-spec.
- A rebuilt homelab database reverts to 3 and 730 until the checklist is re-run — runbook checklist step.
- The shared token fixture's home and loading path are not chosen — /sdd-spec (C-13).
- Config migration number 050 may collide with a peer feature — /sdd-spec.
- Peer features 339 (same `page.tsx`), 341 and 344 (ingest) can conflict at merge — re-run the C-16 scan at /sdd-spec.
- One user can queue one in-envelope job per symbol and fill every slot — accepted by the operator; no step.
- An admin multi-symbol job blocks self-serve for its symbols for its whole duration — accepted (D-20); no step.
- Whether `bars_total` is set during a run is unverified; "Backfilling…" without a denominator is the fallback copy — UI card step.
- The `GetBackfillStatus` e2e mock does not exist yet — UI e2e step.
- `jobId`, "Data ready" and the last-filled gap are local state and are lost on reload — accepted under D-2; no step.
- `acceptance.feature` is unchanged: the @AC-2 amendment, the @AC-9 rewrite, the new scenarios and the @AC-8 strike are due at /sdd-spec. The product-spec Agent box (C-14) is ticked there too.
- O-33: confirm the `343@AC-9` rewrite sign-off — /sdd-spec.
- Access route for runbook step 2: the design names the DB-owner DSN; the relayed note says psql over ssh if possible — /sdd-spec runbook step.
- `feature.md` § Summary still says "exactly the missing range"; the range is now `gap.start` through the window end (D-8) — /sdd-spec.
