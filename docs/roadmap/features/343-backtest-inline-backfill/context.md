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
