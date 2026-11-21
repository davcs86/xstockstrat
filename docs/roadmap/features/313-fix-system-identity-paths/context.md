# Context Log: fix-system-identity-paths

> Distilled 2026-11-21 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).

Append-only from here on. Each session appends a new ## Session entry.

## Decisions

Design is approved and the spec is implementation-ready (`design.md`; `debate.md` holds D-1..D-19, R-1..R-12, O-1..O-19, P-1..P-3). Why-level history that lives only in this log:

- **Triage**: two SEV-3 reports (ingest mcp_client loop ledger events stored with a NULL owner; analysis P&L snapshot compose raising `ValueError` for a system-owned order event) are owner-identity gaps on paths with no real inbound caller (server-initiated loop, system owner), where the header-based identity contract (PLAT-11 / feature 225) has no value to propagate. Root cause: ledger owner arrives only via the propagated header; the feature-225 `owner_metadata` raise sits ahead of the FR-6 degrade blocks. Drift noted: the pnl consumer now retries + parks `ValueError` (poison) instead of cursor-skipping. Track C, depth `full`; services ingest, analysis, ledger (reference only).
- **Ingest owner (D-1/D-14)**: `_ingest_external_signal` sets `AppendEventRequest.user_id=owner` on `ingest.signal.ingested` (proto field exists, ledger reads it first: `ledgerServiceImpl.ts:76-78`); never forge an `x-user-id` header (R-3, AC-33 @feature-224 trust semantics). FR-1 is scoped to the mcp_client loop; the RPC-path `user_id` check is incidental hardening, an UNTRACED assertion inside the AC-1 test with no "Covers: AC-33" (AC-33 is a PERMISSION_DENIED refusal, `private-by-default-templates.feature:40-44`, so tracing to it would be false coverage); AC-33 stays a plain PRESERVE.
- **Per-cycle trace id (D-17/D-18/D-19; operator reopened D-2)**: `poll_one_source` mints `str(uuid.uuid4())` once per source per cycle before the item loop and passes it as keyword-only `trace_id: str = ""` (after `owner`) on every per-item call, with no `propagation_meta` and no `x-user-id`. When non-empty, the core sets `AppendEventRequest.correlation_id=trace_id` AND appends `("x-trace-id", trace_id)` to call metadata, on the `ingest.signal.ingested` AppendEvent only — one value feeds both channels (idiom `pnl_pattern_consumer.py:613,618`). The core APPENDS (no strip-and-replace; a one-line docstring constraint says `trace_id` is for callers with no inbound metadata). RPC path passes no `trace_id` (R-9 holds). Reason for the reopen: ledger `appendEvent` reads only `x-user-id` from metadata (`ledgerServiceImpl.ts:76-97`), so an `x-trace-id`-only id was dropped on arrival. AC-3's Thens assert only the persisted `correlation_id` (same non-empty id per source cycle, ids differ across sources, no `x-user-id`); the `x-trace-id` metadata match is a plain test assertion (promotion is permanent and Thens must be observable). FR-3 and the scenario comment: "the id persists as the ledger event's correlation_id; ledger ignores the x-trace-id header". AC-3's Given uses distinct non-duplicate signals (D-11) and PRESERVEs @AC-41/@AC-28/29/53 @feature-294 instead of restating the metric-label rule. The real-core spy at `tests/test_mcp_client_loop.py:196-197` takes and forwards `**kw` so the @AC-4 @feature-166 dedup test keeps its meaning (step 4/6 Files include that test file).
- **Analysis (D-3/D-4/D-13/D-15)**: `is_real_owner()` in `app/identity.py` used at `_compose` and the window guard; `owner_metadata` reuses it with its raise and message unchanged (`tests/test_identity.py:13-36` stays unedited and green as the regression proof; 9+ other callers). A system-owned order writes a degraded snapshot, opens no `pnl_positions` window (`position_id` keeps the raw owner; a later close for `system` is a documented no-op) and writes no system-owned ledger row (`_emit` sets no `AppendEventRequest.user_id`, `:608-619`), so @AC-14/@AC-15 @feature-225 are safe with no extra guard. FR-2 reads "a system owner alone never causes parking" (poison payloads still park, @AC-7 @feature-259). AC-2's Then (operator wording): "the event is processed on its first attempt with no retry backoff"; its test drives `_process_with_retry` with the sleeps fixture (asyncio.sleep is awaited only there, `:228-232`) and asserts no awaited sleep, one `process_event` run, no parking, a degraded snapshot, no window; exact-message assertion and sleeps fixture avoid a false RED (`fails.md:3350-3353`).
- **Other settled**: D-5 existing NULL-owner ledger rows stay (append-only, deny_mutation triggers); D-6 no trading-side guard; D-7 C-14 consumer surface is the /trader ledger export (no code step; route forwards caller-scoped `ExportEvents` with no event-type allowlist) plus a context.md note that the export's `correlation_id` column now shows a poll-cycle id on mcp_client `ingest.signal.ingested` rows (empty on RPC rows; `@AC-8 @feature-021` covers only the column's presence); D-8 AC-1/AC-2 second Thens reworded (export guarantee kept as cited PRESERVE of ledger @AC-11 @feature-021); D-12 product-spec Problem Statement corrected (loop forwards an empty `propagation_meta` list, not `metadata=None`); product-spec gains FR-1/2/3 and a Consumer Surface line. C-16 sign-off covers the @AC-1 and @AC-2 CHANGEs only; @AC-3 EXTEND is net-new and needs C-15 traceability (`@FR-3`), not sign-off.
- **Build order (D-16)**: (1) docs + context.md, (2) analysis AC-2 RED→GREEN, (3) ingest D-1/AC-1 with the in-test RPC assertion, (4) ingest FR-3/AC-3 as a separate final step (split so a late P-1 ruling would not swap a frozen step — F-09, `fails.md:441`). AC-1/AC-3 tests drive `poll_one_source` through the real `_ingest_external_signal` with a dedup-miss fake DB (`tests/test_mcp_client_loop.py:173-201`).
- **Rejected alternatives (why)**: normalising `system` to empty in `_handle_order_event` (R-1; shifts `position_id` `:358`, leaves `_compose` able to raise); inline `SYSTEM_IDENTITY` comparisons at three sites (R-2; C-18 DRY); forging an `x-user-id` on the loop's AppendEvent (R-3); backfilling NULL-owner rows (R-4; append-only); citing a bug-template exemption for @FR tags (R-5; C-15 has no bug carve-out); restating the metric-label rule as an AC-3 Then (R-6; already enforced by `test_telemetry_allowlist.py:68`); keeping "Then `_compose` does not raise" in AC-2 (R-7; private method name frozen into a durable suite — `docs/sdd/business-rules/CLAUDE.md:23-30,37-38`); observing AC-3 through the AsyncMock loop harness (R-8; never reaches dedup/AppendEvent, vacuous); deriving `correlation_id` from an `x-trace-id` entry in `propagation_meta` (R-9; would store inbound RPC trace ids); observing AC-2 via `process_event` directly (R-10; passes with the bug present); two separate parameters for the id (R-11; mismatch risk, C-18); `correlation_id` only with no header (R-12; contradicts "sent as both"); FR-2 as "never parked" (overclaims against @AC-7 @feature-259); FR-1 covering both paths with only a loop-scoped scenario (narrowing + tracing costs less); bundling AC-1 and AC-3 into one ingest step; keeping D-2 as written (id dropped at the ledger).
- **Spec (2026-11-20)**: 7 steps; Steps 6+7 are one atomic unit (the spy at `tests/test_mcp_client_loop.py:196-197` mirrors the signature); evidence tree was the feature branch, with `_ingest_external_signal` at `servicer.py:1237` and the emit at `:1396-1404` on `main-dev@fb52065c`; `mcp_client_loop.py` has no `import uuid` (Step 6 adds it); the ingest findings row (`context-constitution-findings.md:38`) and CLAUDE.md event row (`:146`) go stale once Steps 4/6 land. The verbatim spec and review sessions below carry the rest.

## Open Threads

Authoritative list: the two `## Open Threads` sections after the last two verbatim sessions below (AC-1 Then wording confirmation, stale ingest docs, `merge-order.md` row for 313/309, `**kw` spy rename risk, two-header residual, DRY guard rail missing on this branch base). Carried forward from the design-approved section and not repeated there:

- [ ] Register status cells lag the rulings (O-17/O-18/O-19 "open"; D-2/D-9 "reopened" not "superseded by D-17/D-14"); the O-17 and O-18 fixes are binding by operator ruling regardless — step 1 (docs).
- [ ] AC-3's wording becomes permanent at promotion: write the observable-only Thens into `acceptance.feature` traced by `@FR-3` (C-15, not C-16) — step 1.
- [ ] Marketdata's handling of a headerless `system` bars read is unverified (inside `_compose`'s `try`; the event degrades either way) — step 2.
- [ ] Peer 328 edits `mcp_client_loop.py:134-140`; possible textual conflict in `poll_one_source` near `:140-160` (spec: near Step 6's `:156-160`); peer 309 overlaps `_ingest_external_signal` and shares `tests/test_mcp_client_loop.py`; whichever merges second re-greps — Step 6.

## Files Modified

None yet (no code written). Artifacts only: `implementation-spec.md` (7 steps), `design.md`, `recon.md`, `debate.md`, `product-spec.md`, `acceptance.feature` (AC-1/AC-2 rewordings and `@AC-3` are specced as Step 1, not yet written).

## Superseded Sessions

- 2026-11-10 — /sdd-triage: two SEV-3 reports clustered and routed to Track C, depth `full`; branch `feature/fix-system-identity-paths`; details in Decisions.
- 2026-11-10 — sdd-review product-spec: approved, draft → spec-ready. Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); open questions not explicitly deferred; no consumer-surface statement for the owner-visible ExportEvents change. Overlap WARN: ingest mcp_client area shared with 328; analysis shared with 308/309/327.
- 2026-11-11 — sdd-batch design gate (round 2): halted at the gate. Kept the round-1 code design; docs edits A (FR-1/2/3, Problem Statement fix, Consumer Surface), B (AC-1/AC-2 behavioural Thens tagged @FR-1/@FR-2, @AC-11 @feature-021 kept as cited PRESERVE), C (new @AC-3 @FR-3); opened P-1 (D-2 REOPEN: ledger drops the per-cycle id; options `correlation_id` / drop OQ-1 / keep D-2).
- 2026-11-13 — sdd-batch design gate (round 3): added D-13, R-7, R-8, O-10..O-12, P-2, P-3; closed O-4..O-9; AC-2 and the AC-3 harness reshaped (see R-7, R-8); build order split so AC-3 is a separate final step; O-10 blocking until the AC-2 wording was adopted.
- 2026-11-20 — sdd-batch design gate (round 4): added D-14..D-16, R-9, R-10, O-13..O-16; closed O-10..O-12; D-9 reopened by operator steer; O-13 blocking (verdict on P-1/P-3: reopen D-2 or decline); the operator's decisions reached the step as workflow-computed text and were checked against context.md before /sdd-spec.
- 2026-11-20 — sdd-batch design gate (round 5): added D-17..D-19, R-11, R-12, O-17..O-19; closed O-13..O-16; D-2 reopened by operator steer; no blocking objection, adversary verdict SOUND, no Floor breach. Earlier rounds' `sdd-batch-design-state` fences are superseded by this last one, which follows verbatim.
```sdd-batch-design-state
{
  "round": 5,
  "synth": {
    "approach": "Round 5 synthesis. The code core is unchanged (D-1, D-3, D-4, D-13, D-15, D-16). This round applies the operator's D-2 reopen (P-1, P-3), keeps the D-9 re-target already recorded as D-14, and adopts two adversary fixes that the proposal has not yet answered.\n\nINGEST, PER-CYCLE ID (FR-3 / AC-3, step 4) — supersedes D-2's \"only via propagation_meta\" clause\n- `_ingest_external_signal` (services/xstockstrat-ingest/app/handlers/servicer.py:1237-1239, signature `(self, signal, propagation_meta=None, *, owner: str)`) gains one keyword-only `trace_id: str = \"\"` after `owner`.\n- When `trace_id` is non-empty, on the `ingest.signal.ingested` AppendEvent only, the core:\n  - sets `AppendEventRequest.correlation_id=trace_id`;\n  - appends `(\"x-trace-id\", trace_id)` to the call metadata.\n- Both channels come from the one value, so they cannot disagree (O-15).\n- The core appends; it does not strip and replace an inbound x-trace-id. No caller passes both `trace_id` and `propagation_meta`, so a strip branch would be dead code. A one-line docstring constraint says `trace_id` is for callers with no inbound metadata.\n- When `trace_id` is empty (the RPC path, servicer.py:1206-1217) behaviour is unchanged and no correlation_id is set. R-9 holds.\n- `poll_one_source` (services/xstockstrat-ingest/app/engine/mcp_client_loop.py:115, per-item call at :158-160) mints `str(uuid.uuid4())` once per source per cycle, before the item loop. It passes the id as `trace_id=` on every per-item call, with no `propagation_meta` and no x-user-id. Mint precedent: servicer.py:951 and app/engine/webhook_handoff_loop.py:96.\n- The pairing is the existing idiom at services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:613,618. Ledger persists `req.correlationId` (services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:89) and reads only x-user-id from metadata (:77-78).\n\nAC-3 / FR-3 WORDING\n- Given: two sources owned by user-a, each returning two distinct, non-duplicate signals (D-11).\n- Thens are limited to what a consumer can observe:\n  - each `ingest.signal.ingested` ledger event from one source's cycle carries the same non-empty correlation_id;\n  - the two sources' ids differ;\n  - no x-user-id is sent.\n- The matching x-trace-id call metadata is a plain test assertion (PLAT-4 convention), not a Then, because ledger never reads the header. This is the R-7 rationale.\n- The scenario comment becomes \"the id persists as the ledger event's correlation_id; ledger ignores the x-trace-id header\". The @AC-41/@AC-28/@AC-29/@AC-53 @feature-294 PRESERVE comment stays.\n\nAC-3 TEST AND SPY FIX (step 4 Files include services/xstockstrat-ingest/tests/test_mcp_client_loop.py)\n- The spy at :196-197 becomes `async def spy(signal, propagation_meta=None, owner=None, **kw)` and forwards `**kw` to `orig`. I confirmed that today it is `spy(signal, propagation_meta=None, owner=None)` calling `orig(signal, propagation_meta, owner=owner)`.\n- Without the fix, `trace_id=` raises TypeError, the per-item except swallows it, and the @AC-4 @feature-166 dedup test stops proving anything.\n- The AC-3 test uses the real-core, dedup-miss harness (:173-201; R-8, D-16). It asserts `AppendEvent.call_args.args[0].correlation_id` and `kwargs[\"metadata\"]`.\n\nINGEST, OWNER (D-1 / AC-1, step 3; D-14)\n- `user_id=owner` goes on the `ingest.signal.ingested` AppendEventRequest.\n- The AC-1 test drives `poll_one_source` through the real core. It asserts `user_id == \"user-a\"` and no x-user-id metadata.\n- The same test function adds one untraced RPC assertion, using the tests/test_signal_ownership.py:138-139 pattern. It carries no \"Covers: AC-33\". FR-1 stays loop-scoped.\n\nANALYSIS (D-3, D-4, D-13, D-15, unchanged)\n- `is_real_owner()` in services/xstockstrat-analysis/app/identity.py, used at pnl_pattern_consumer.py:388,539,546.\n- The AC-2 test drives `_process_with_retry` with the sleeps fixture. The operator wording is \"Then the event is processed on its first attempt with no retry backoff\".\n\nBUILD ORDER (D-16)\n1. Docs and context.md:\n   - the AC-1 and AC-2 rewordings with the C-16 sign-off;\n   - FR-1 loop-only; FR-2 per D-10; FR-3 reworded to \"persisted as correlation_id\";\n   - the D-12 drift fix;\n   - the operator's 2026-11-20 rulings on D-2 and D-9, with ISO date;\n   - the consumer-surface note extending D-7: in the /trader ledger export, the correlation_id column (services/xstockstrat-ledger/acceptance/ledger-event-export.feature:40) shows a poll-cycle id on mcp_client `ingest.signal.ingested` rows, not a request trace, and RPC-path rows stay empty.\n   - The \"step 4 contingent on P-1\" note is dropped.\n2. Analysis AC-2, RED then GREEN.\n3. Ingest D-1 / AC-1.\n4. Ingest FR-3 / AC-3, as a separate final step.\n\n/sdd-spec must re-ground every cited line against origin/main-dev and peers 308, 309, 327 (pnl_pattern_consumer.py) and 328 (mcp_client_loop.py:134-140).",
    "open_objections": [
      {
        "text": "C-15 / R-7 rationale: the proposal's AC-3 Then included 'and matching x-trace-id call metadata', which no consumer can observe (ledger reads only x-user-id from metadata, ledgerServiceImpl.ts:77-78). The synthesis keeps only the correlation_id outcome as Thens and moves the header check to a plain test assertion. The proposer has not confirmed this. It must be fixed before /sdd-spec writes acceptance.feature, because promotion is whole-scenario and permanent.",
        "blocking": false
      },
      {
        "text": "C-18 / minimum-code: the proposal's 'propagation_meta minus any x-trace-id, plus trace_id' strip branch is dead code today, since no caller passes both. The synthesis adopts append plus a one-line docstring constraint. The proposer has not confirmed this. The alternative is to keep the replace and add a named test for it.",
        "blocking": false
      },
      {
        "text": "Register bookkeeping: the feature files do not yet record the operator's D-2 ruling. debate.md shows P-1, P-2 and P-3 as 'pending user' and O-13 as open, and context.md's round-4 session still treats D-2 as unreopened. Before the gate closes the orchestrator must flip P-1 and P-3 to 'user reopened', flip P-2 to 'user reopened', mark D-2 superseded by the new decision, and record the 2026-11-20 rulings in context.md.",
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
        "ac_id": "@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-11 @feature-021",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 @feature-021",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 @feature-166",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-33 @feature-224",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 @feature-225",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-14 @feature-225",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-15 @feature-225",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-16 @feature-225",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-17 @feature-225",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @feature-259",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 @feature-259",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-28 @feature-294",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-29 @feature-294",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-41 @feature-294",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-53 @feature-294",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Keep D-2 as written (id only as x-trace-id via propagation_meta): the id is dropped at the ledger (ledgerServiceImpl.ts:77-78,89), and the operator reopened D-2 on P-1/P-3.",
      "Pass the id as propagation_meta=[('x-trace-id', id)] and have the core copy it to correlation_id: this is locked R-9. It would start persisting inbound RPC trace ids.",
      "Two separate parameters (propagation_meta entry plus a correlation_id keyword): a caller could send mismatched values (C-18, O-15). One keyword-only trace_id feeds both.",
      "Send correlation_id only, with no x-trace-id header: the smallest diff, but it contradicts the operator ruling ('sent as both') and the idiom at pnl_pattern_consumer.py:613,618.",
      "Strip and replace any inbound x-trace-id in propagation_meta when trace_id is set: no caller passes both, so the branch is untested dead code. Append plus a docstring constraint is the minimum.",
      "Assert 'matching x-trace-id call metadata' as an AC-3 Then: no consumer can observe it and it would be promoted permanently (the R-7 rationale). It stays a plain test assertion.",
      "Trace the RPC-path user_id assertion to @AC-33 @feature-224: false coverage (private-by-default-templates.feature:40-44). D-14 already settles this."
    ],
    "open_risks": [
      "The operator rulings reached this step as workflow-computed text. On the checked tree, debate.md and context.md do not yet record the D-2 reopen, so the orchestrator must record it before /sdd-spec.",
      "AC-3's wording becomes permanent at promotion. The observable-only Thens adopted here still need the proposer's or /sdd-spec's confirmation in acceptance.feature. AC-3 is new to this feature, so it needs C-15 traceability (@FR-3), not C-16 sign-off.",
      "Peer 328 edits mcp_client_loop.py:134-140 (the split_credentials_ref namespace drop). The adversary found no 328 change to the _ingest_external_signal signature. The risk is a textual conflict in poll_one_source near :140-160, so /sdd-spec must re-ground step 4 against 328's branch.",
      "The **kw spy accepts any keyword, so a future rename of trace_id would not fail the dedup test. The AC-3 test's correlation_id assertion is the guard.",
      "With append-only metadata, a future caller that passes both trace_id and an x-trace-id in propagation_meta would send two headers. The docstring constraint is the only guard.",
      "The export's correlation_id column changes meaning on mcp_client rows, from empty to a poll-cycle id. @AC-8 @feature-021 covers only the column's presence, so the context.md note is the only record.",
      "Line drift: citations come from the working tree (branch ccr-*, core at servicer.py:1237) and recon's are stale. /sdd-spec must re-ground against origin/main-dev.",
      "Re-expressing owner_metadata through is_real_owner touches a builder with 9+ callers. The mitigation is that tests/test_identity.py:13-36 stays unedited and green.",
      "Marketdata's handling of a headerless system bars read is unverified. It sits inside _compose's try, so the event degrades either way."
    ],
    "constitution_rules_touched": [
      "C-11",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "F-09",
      "P-02",
      "P-03",
      "P-06",
      "PLAT-4"
    ],
    "rationale": "There is no Floor breach and no blocking objection. The adversary's verdict is SOUND. The only round-4 blocker, O-13, closes on the operator's explicit D-2 ruling.\n\nWhat I applied from the operator:\n- D-2 is reopened (P-1, P-3). The per-cycle id is sent as both x-trace-id metadata and AppendEventRequest.correlation_id, through one keyword-only `trace_id`.\n- D-9's reopen was already applied in round 4 as D-14, so nothing new is recorded for it.\n- The C-16 sign-off covers @AC-1 and @AC-2 only. @AC-3 is net-new and stays uncovered; it needs C-15 traceability, not sign-off.\n\nObjections closed:\n- O-13: the operator ruled.\n- O-14: the spy forwards `**kw`, and the test file is in step 4's Files.\n- O-15: one keyword feeds both channels.\n- O-16: the context.md note covers the export's correlation_id column.\n\nWhere the synthesis departs from the proposal:\n- AC-3's Thens assert only the persisted correlation_id. The x-trace-id header is a plain test assertion.\n- The core appends the header and does not strip and replace.\n- Both follow the adversary's unanswered objections, so both stay open as non-blocking until the proposer or /sdd-spec confirms.\n\nRegister check:\n- The approach contradicts D-2 only where the operator reopened it.\n- R-9 holds, because the RPC path passes no `trace_id`.\n- D-11's ledger clause is revised as a consequence of the D-2 reopen and is recorded as a new decision.\n\nWhat I checked on the tree:\n- The spy at tests/test_mcp_client_loop.py:196-197 has no `**kw` today.\n- `_ingest_external_signal` is at servicer.py:1237, and `propagation_meta` defaults to an empty list at :1246.\n- debate.md still shows P-1, P-2 and P-3 as \"pending user\", and context.md has no record of the D-2 reopen.\n\nI did not re-check the ledger, analysis or 328 citations this round; those rest on the adversary's reading and on round 4.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Supersedes D-2's 'only via propagation_meta' clause (operator reopen, 2026-11-20, P-1/P-3): poll_one_source mints one uuid4 per source per poll cycle and passes it as a keyword-only trace_id to _ingest_external_signal. On the ingest.signal.ingested AppendEvent the core sets AppendEventRequest.correlation_id and appends x-trace-id call metadata from that one value, with no x-user-id. The RPC path passes no trace_id and is unchanged. OQ-1 stays in scope, traced by @AC-3.",
          "evidence": "operator ruling 2026-11-20; services/xstockstrat-ingest/app/handlers/servicer.py:1237-1239,1206-1217; services/xstockstrat-ingest/app/engine/mcp_client_loop.py:115,158-160; services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:613,618; services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:77-78,89"
        },
        {
          "text": "Revises D-11's ledger clause as a consequence of the D-2 reopen: FR-3 and the AC-3 scenario comment read 'the id persists as the ledger event's correlation_id; ledger ignores the x-trace-id header'. D-11's distinct-signals Given and the @feature-294 PRESERVE comment stand.",
          "evidence": "services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:77-78,89; operator ruling 2026-11-20"
        },
        {
          "text": "Step 4's Files include tests/test_mcp_client_loop.py: the real-core spy at :196-197 takes and forwards **kw so the @AC-4 @feature-166 dedup test keeps its meaning. Step 1's context.md consumer-surface note (extending D-7) says the export's correlation_id column shows a poll-cycle id on mcp_client ingest.signal.ingested rows and stays empty on RPC rows. The 'step 4 contingent on P-1' note is dropped.",
          "evidence": "services/xstockstrat-ingest/tests/test_mcp_client_loop.py:196-197; services/xstockstrat-ledger/acceptance/ledger-event-export.feature:40"
        }
      ],
      "new_rejected": [
        {
          "text": "Pass the per-cycle id through two separate parameters (a propagation_meta x-trace-id entry plus a correlation_id keyword)",
          "why": "A caller could send mismatched values (C-18). One keyword-only trace_id feeds both channels (servicer.py:1237-1239)."
        },
        {
          "text": "Send the per-cycle id as correlation_id only, with no x-trace-id call metadata",
          "why": "It contradicts the operator ruling of 2026-11-20 ('sent as both') and the existing idiom at pnl_pattern_consumer.py:613,618."
        }
      ],
      "new_objections": [
        {
          "text": "AC-3's Thens must assert only the observable outcome (same non-empty correlation_id per source cycle, ids differ across sources, no x-user-id). The 'matching x-trace-id call metadata' check stays a plain test assertion, because ledger never reads the header (ledgerServiceImpl.ts:77-78; the R-7 rationale). Adopted in the synthesis; the proposer has not confirmed it.",
          "blocking": false
        },
        {
          "text": "Drop the 'propagation_meta minus any x-trace-id' strip branch: no caller passes both trace_id and propagation_meta, so it is dead code (C-18). Append the header and state the constraint in a one-line docstring, or keep the replace with a named test. Adopted as append in the synthesis; the proposer has not confirmed it.",
          "blocking": false
        },
        {
          "text": "Before the gate closes, record the operator's 2026-11-20 rulings in the feature files: P-1 and P-3 'user reopened' (D-2), P-2 'user reopened' (D-9), D-2 marked superseded, and an ISO-dated entry in context.md. On the checked tree all three petitions still read 'pending user'.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-13",
          "how": "The operator ruled on 2026-11-20: REOPEN D-2 is granted (P-1 and P-3), and the per-cycle id is sent as both x-trace-id metadata and AppendEventRequest.correlation_id."
        },
        {
          "id": "O-14",
          "how": "Step 4's Files include tests/test_mcp_client_loop.py, and the spy at :196-197 takes and forwards **kw to the real core."
        },
        {
          "id": "O-15",
          "how": "One keyword-only trace_id on _ingest_external_signal feeds both correlation_id and the x-trace-id call metadata, so the two cannot disagree."
        },
        {
          "id": "O-16",
          "how": "The step-1 context.md consumer-surface note says the export's correlation_id column (ledger-event-export.feature:40) shows a poll-cycle id on mcp_client rows and stays empty on RPC rows."
        }
      ],
      "reopen_petitions": [],
      "reopened": [
        "D-2",
        "D-9"
      ]
    }
  },
  "floor_breaches": []
}
```

- 2026-11-20 — sdd-design (approved): Recon (recon.md 2026-11-11; services ingest, analysis, ledger reference only; reuse: existing `AppendEventRequest.user_id` request field, empty-owner degrade branch in `_compose`). 5 rounds (full); chosen approach is in Decisions. Constitution rules touched C-11, C-14, C-15, C-16, C-18, F-09, P-02, P-03, P-06, PLAT-4; no Floor breaches. Status spec-ready → design-approved; design.md written; debate.md State `approved`. Register bookkeeping: P-1, P-2, P-3 recorded as "user reopened" (the gate's generic "user declined" would contradict the rulings); no other register cell changed. No ledger line. The operator rulings follow verbatim.

## Session 2026-11-20 — sdd-design (approved) — operator rulings, verbatim

- Operator rulings, recorded 2026-11-20. They reached this step as workflow-computed text from the `/sdd-batch` gate:
  - REOPEN D-9 is granted (P-2). The RPC-level assertion is re-targeted as an extra assertion inside the AC-1 test; D-9's FR-1 loop narrowing stands (D-14).
  - REOPEN D-2 is granted (P-1 and P-3). The per-cycle id is sent as both `x-trace-id` metadata and `AppendEventRequest.correlation_id`, the existing idiom at `pnl_pattern_consumer.py:613,618` (D-17).
  - C-16 sign-off for this feature's @AC-1 and @AC-2. AC-2 wording: "Then the event is processed on its first attempt with no retry backoff".
  - Design APPROVED after round 5 under the operator's standing authorisation of the same day (round-5 adversary verdict SOUND, no Floor breach, no blocking objection, every C-16 CHANGE covered by a ruling).
  - Binding on the spec from the round-5 synthesis: AC-3's Thens are limited to the persisted `correlation_id` (the `x-trace-id` metadata is a plain test assertion); the core appends and does not strip-and-replace; the spy at `tests/test_mcp_client_loop.py:196-197` forwards `**kw`; the ledger-export consumer-surface note is recorded (round-5 session above).

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 7 steps. Status: design-approved → implementation-ready.
- Steps: 1 docs (acceptance.feature rewordings + `@AC-3`, FR-1 to FR-3, Consumer Surface, register cells); 2-3 analysis `is_real_owner` + AC-2; 4-5 ingest `AppendEventRequest.user_id` + AC-1; 6-7 ingest per-cycle `trace_id` + AC-3, one atomic unit (`Lands with`).
- Key codebase findings:
  - Evidence tree is the feature branch (`8c12eacf`, code base `c4fd48b0a`). Against `origin/main-dev@fb52065c` only ingest `app/handlers/servicer.py` moved: `_ingest_external_signal` `:1015` → `:1237`, the `ingest.signal.ingested` emit `:1174-1182` → `:1396-1404`. `mcp_client_loop.py`, `test_mcp_client_loop.py`, `test_signal_ownership.py`, analysis `identity.py`, `pnl_pattern_consumer.py`, `test_pnl_pattern_consumer.py` and `test_identity.py` are identical on both trees.
  - The ledger citations hold on both trees: owner precedence `ledgerServiceImpl.ts:76-78`, `req.correlationId` persisted at `:89`, `AppendEventRequest.user_id = 9` at `ledger.proto:51`, `correlation_id = 3` at `:41`.
  - Peers 308, 309, 327 and 328 carry no diff against `origin/main-dev` under either service directory yet, so there is nothing to re-ground against. 328's planned `mcp_client_loop.py:134-140` edit is still a future textual-conflict risk near Step 6's `:156-160`.
  - `_ingest_external_signal` has two callers (`IngestSignal`, `poll_one_source`). The only site that mirrors its signature is the test spy at `tests/test_mcp_client_loop.py:196-197`; that is why Steps 6+7 are one unit.
  - `mcp_client_loop.py` has no `import uuid`; Step 6 adds it.
  - `owner_metadata` has 9 call sites besides `_compose`; none changes, because its signature, raise and message are untouched.
- Assumptions made by this spec (to confirm at `/sdd-review impl-spec`):
  - The acceptance.feature and product-spec.md edits are specced as Step 1 (design build order D-16), not written by `/sdd-spec` itself. `@AC-3` therefore does not exist in acceptance.feature until Step 1 runs.
  - The AC-1 Thens in Step 1 ("the ingest.signal.ingested AppendEvent request carries user_id "user-a"" and "no x-user-id call metadata is sent with it") are this spec's wording of the signed-off shape; the register holds no verbatim text for them. The AC-2 first Then is the operator's wording verbatim.
  - The AC-1 and AC-3 tests drive `run_one_cycle`, which calls `poll_one_source`, with the real core (the harness at `tests/test_mcp_client_loop.py:173-212`).
  - The untraced RPC-path assertion lives inside the AC-1 test function, importing `_fresh_ingest_svc` and `_signal_req` from `tests/test_signal_ownership.py`.
  - The `_compose` log text at `pnl_pattern_consumer.py:547` ("has no owner") is left unchanged for a `system` owner.
- Proposed, not specced: the open finding at `services/xstockstrat-ingest/docs/context-constitution-findings.md:38` and the event row at `services/xstockstrat-ingest/CLAUDE.md:146` go stale once Steps 4 and 6 land. Neither is in the design's scope.
- No ledger line: nothing surfaced that is not already in recon.md or the ledger.
- Tooling note: each commit's pre-commit hook printed `can't open file .../scripts/check-duplication.py` (the script is absent on this branch's base `c4fd48b0a`). The commits went through; `--no-verify` was not used.

## Open Threads

- [ ] Confirm the AC-1 Then wording in Step 1 (spec-authored under the operator's C-16 sign-off). Target: `/sdd-review impl-spec`.
- [ ] Decide whether the ingest findings row (`:38`) and the CLAUDE.md event row (`:146`) get a docs step. Target: `/sdd-review impl-spec`.
- [ ] Peer 328's planned edit near `mcp_client_loop.py:134-140`. Target: Step 6 (re-check before editing).
- [ ] The `**kw` spy accepts any keyword; Step 7's `correlation_id` assertion is the guard. Target: Step 7.
- [ ] Append-only metadata; Step 6's docstring constraint is the only guard. Target: Step 6.
- Next: `/sdd-review fix-system-identity-paths impl-spec`, then `/sdd-execute fix-system-identity-paths`.

## Session 2026-11-20 — sdd-review impl-spec (advisory)

- Result: 0 failures, 7 warnings (advisory — did not block). Overall PASS WITH WARNINGS; no Floor breach. Lifecycle unchanged (implementation-ready).
- implementation-spec.md was edited to address the clearly-correct warnings. This reached the step as workflow-computed text from the `/sdd-batch` impl-review phase; MODE B on its own does not edit the spec.
- Addressed (each re-verified on `origin/feature/fix-system-identity-paths@35c0dd1a` before editing):
  - [x] Step 7, duplicate-header guard: the AC-3 test now also asserts exactly one `x-trace-id` entry per loop-path `AppendEvent` call. The Step Dependencies open-risk bullet says what the assertion does and does not cover.
  - [x] Steps 3 and 5, coverage floor: 40 matches the CI matrix for both services (`.github/workflows/ci.yml:428-429` ingest, `:431-432` analysis, applied at `:477`). Recorded as Codebase Evidence in both steps.
  - [x] Steps 4 and 6, line hints: each step now starts with a re-grep of its anchors before editing. The Step 6 citation for `poll_one_source` was off by one (`:115` → `:116`) and is corrected.
  - [x] Overlap (WARN), peers 309 and 328: the spec's Peers paragraph now names the planned same-function overlap with 309 (`_ingest_external_signal`, `_build_external_signal`, `tests/test_mcp_client_loop.py`) and the near-miss with 328 (`mcp_client_loop.py:140`), cited from the peers' specs on their branches. Both peer branches still carry no code diff under either service directory.
- Unresolved ⚠ carried into execution:
  - Step 1: the AC-1 Then wording ("the ingest.signal.ingested AppendEvent request carries user_id "user-a"" / "no x-user-id call metadata is sent with it") is spec-authored, not operator-verbatim; C-16 promotion makes it permanent — [ ] unaddressed (needs the operator)
  - Steps 4 and 6: `services/xstockstrat-ingest/docs/context-constitution-findings.md:38` (open-finding row) and `services/xstockstrat-ingest/CLAUDE.md:146` (event row) go stale once these land. Adding a docs step widens the approved design scope, so it was not added. Operator decides: add a docs step, or record a deviation (P-03) — [ ] unaddressed
  - Step 7: the `**kw` spy accepts any keyword, so a rename of `trace_id` would not fail the dedup test; the `correlation_id` assertion is the only guard. The spy shape is binding by design D-19, so it was not changed — [ ] unaddressed (accepted risk unless the operator rules otherwise)
  - Step 6: a future caller passing both `trace_id` and an inbound `x-trace-id` would still send two headers; the new Step 7 assertion covers only today's loop caller — [ ] unaddressed (residual)
  - Tooling: the pre-commit hook prints a missing `scripts/check-duplication.py` on this branch base, so the DRY guard rail did not run on the spec commits (seen again on this session's commits). Not a spec defect; it clears when `main-dev` is merged into the feature branch — [ ] unaddressed
- Overlap findings: WARN, no FAIL. No migration, proto-field or config-key collision. Same-file overlap with 309 (same function in `servicer.py`; `mcp_client_loop.py`; `tests/test_mcp_client_loop.py`) and a textual near-miss with 328 (`mcp_client_loop.py:140`). Shared-helper dependency only: peers 308, 312 and 327 call analysis `owner_metadata`, whose behaviour Step 2 keeps unchanged.

## Open Threads

- [ ] Confirm the AC-1 Then wording in Step 1 with the operator before Step 1 lands. Target: `/sdd-execute` checkpoint, Step 1.
- [ ] Decide on the stale ingest docs (findings row `:38`, CLAUDE.md event row `:146`): docs step or recorded deviation. Target: `/sdd-execute` checkpoint, before Step 6.
- [ ] `docs/roadmap/features/merge-order.md` has no row for 313. The overlap scan recommends an optional soft row for 313 and 309 (whichever merges second re-greps its anchors). Not written here: the file is outside this step's write scope. Target: operator.
- [ ] `**kw` spy rename risk (Step 7) and the residual two-header risk for a future caller (Step 6). Target: Steps 6-7.
- [ ] DRY guard rail did not run on this branch's doc commits (missing `scripts/check-duplication.py` on the branch base). Target: first `/sdd-execute` step (merge `main-dev` first).
- Next: `/sdd-execute fix-system-identity-paths`.

## Session 2026-11-21 — /sdd-distill
- Distilled 9 sessions → header + Superseded Sessions; kept 2 verbatim (sdd-spec, sdd-review impl-spec) plus the sdd-design operator rulings (verbatim).
- Dropped the three superseded earlier `sdd-batch-design-state` fences (round 2, 3, 4; the round-5 fence is the last and only one; register in debate.md); their content is hoisted into Decisions.
- context.md 1075 → 324 lines / 98195 → 40486 bytes. Original prose preserved in git history.
