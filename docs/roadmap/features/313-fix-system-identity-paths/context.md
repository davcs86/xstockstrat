# Context Log: fix-system-identity-paths

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - `docs/reports/2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect.md` — mcp_client loop ledger events stored with a NULL owner (SEV-3)
  - `docs/reports/2026-10-19-analysis-pnl-compose-system-owner-raises-defect.md` — P&L snapshot compose can raise ValueError for a system-owned order event (SEV-3)
- Cluster rationale: both are owner-identity gaps on paths with no real inbound caller (server-initiated loop, system owner), where the header-based identity contract (PLAT-11 / feature 225) has no value to propagate.
- Severity: SEV-3 (both)
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (2 regression scenarios), context.md; report sidecars stamped `triaged`
- Affected services (from reports): xstockstrat-ingest, xstockstrat-analysis, xstockstrat-ledger
- Root cause hypothesis: ledger owner arrives only via propagated header; feature-225 owner_metadata raise sits ahead of FR-6 degrade blocks. Drift noted: pnl consumer now retries + parks ValueError (poison) instead of cursor-skipping.
- Recommended design depth: full → `/sdd-design fix-system-identity-paths` (rationale: ≥2 affected services; otherwise SEV-3 with clear root causes)
- Development branch: feature/fix-system-identity-paths

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); open questions not explicitly deferred; no consumer-surface statement for owner-visible ExportEvents change
- Overlap findings: WARN: ingest mcp_client area shared with 328; analysis shared with 308/309/327
- Recommended design depth: full (ingest + analysis + ledger)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 (sdd-batch design gate (round 2))

- `/sdd-design fix-system-identity-paths` full debate is at its approval gate after round 2 (gate policy: halt). design.md is not written and status.md is unchanged (spec-ready). The register is in `debate.md`.

## Open Threads

- **Approach.** The round-1 code design (D-1 to D-8) is unchanged:
  - Ingest sets `AppendEventRequest.user_id=owner` on `ingest.signal.ingested` (D-1).
  - `poll_one_source` mints one `x-trace-id` per source per poll cycle and passes it via `propagation_meta` only, with no `x-user-id` (D-2).
  - Analysis adds `is_real_owner()` in `app/identity.py` and uses it at `_compose` and the window guard. `owner_metadata` reuses it with its raise unchanged. A system order writes a degraded snapshot and opens no window (D-3, D-4).

  Round 2 adds only docs edits, to be made before `/sdd-spec`:
  - (A) product-spec.md gets FR-1, FR-2 and FR-3, with FR-1 narrowed to the loop path and FR-2 narrowed to "a system owner alone never causes parking". It also gets the Problem Statement drift fix (an empty `propagation_meta` list, not `metadata=None`) and a Consumer Surface line for the /trader ledger export.
  - (B) AC-1 and AC-2 are reworded to behavioural Thens tagged @FR-1 and @FR-2. The ledger @AC-11 @feature-021 export guarantee stays a cited PRESERVE comment.
  - (C) New @AC-3 @FR-3: distinct, non-duplicate signals per source, and one shared per-cycle `x-trace-id` per source that differs across sources. The metric-label Then is dropped in favour of a PRESERVE of @AC-41/@AC-28/29/53 @feature-294, and a comment says ledger does not read gRPC `x-trace-id`.
- **Strongest open objection.** The new evidence behind the D-2 REOPEN petition (P-1): ledger `appendEvent` reads only `x-user-id` from call metadata (`ledgerServiceImpl.ts:76-97`), so the per-cycle id is dropped on arrival. The operator's options are:
  - persist it as `AppendEventRequest.correlation_id`;
  - drop OQ-1;
  - keep D-2 with AC-3 reworded (the current default).

  Six non-blocking objections (O-4 to O-9) are adopted into the approach but the proposer has not yet confirmed them.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** None of the following has an operator decision behind it:
  - @AC-1 CHANGE and @AC-2 CHANGE;
  - @AC-3 EXTEND;
  - PRESERVEs of @AC-11 @feature-021, @AC-33 @feature-224, @AC-8/14/15/16/17 @feature-225, @AC-7/9 @feature-259 and @AC-28/29/41/53 @feature-294.
- **Resume.** The next `/sdd-batch` run resumes the debate from the state block below.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "The round-1 code design (D-1 to D-8) is unchanged. Round 2 adds only docs edits, written before /sdd-spec and recorded in context.md. The edits land in product-spec.md, acceptance.feature and context.md, and fold in the adversary's non-blocking wording fixes.\n\nCODE (unchanged)\n- Ingest:\n  - Add user_id=owner to the ingest.signal.ingested AppendEventRequest at services/xstockstrat-ingest/app/handlers/servicer.py:1175-1180 (D-1).\n  - poll_one_source (services/xstockstrat-ingest/app/engine/mcp_client_loop.py:153-160) mints one x-trace-id per source per cycle, using the servicer.py:762 idiom. It passes propagation_meta=[(\"x-trace-id\", ...)] only, with no x-user-id. D-2 stands; see the REOPEN petition.\n- Analysis:\n  - Add is_real_owner() to services/xstockstrat-analysis/app/identity.py. owner_metadata reuses it with its raise and message unchanged.\n  - Use it at pnl_pattern_consumer.py _compose:539/:546 and at the window guard :388.\n  - A system order writes a degraded snapshot and opens no window. A later system close is a no-op.\n  - _POISON is untouched and tests/test_identity.py is not edited (D-3, D-4).\n\nEDIT A: product-spec.md\n- Add a Functional Requirements section (closes O-3). C-15 (constitution.md:46) has no bug carve-out.\n  - FR-1, narrowed to the loop: an ingest.signal.ingested AppendEvent from the mcp_client loop carries the signal owner in AppendEventRequest.user_id.\n    - On the RPC path, setting the same field is incidental hardening with no behaviour change, because there owner == the x-user-id header (servicer.py:984-995).\n    - The RPC-path test traces to a PRESERVE of AC-33 @feature-224, which checks the system owner and byte-identical attribution.\n  - FR-2, narrowed: a system-owned order event degrades in _compose like an empty owner.\n    - No owner-scoped call is made, indicators and signals are empty, analysis.snapshot.degraded is emitted, and no pnl_positions window is opened.\n    - A system owner alone never causes the event to be parked. A genuinely poison payload still parks, which preserves AC-7 @feature-259.\n  - FR-3: the mcp_client loop mints one x-trace-id per source per poll cycle and forwards it to ledger as call metadata only, with no x-user-id.\n- Fix the Problem Statement drift at product-spec.md:16. The loop forwards an empty propagation_meta list, defaulted at servicer.py:1024, not metadata=None.\n- Add a Consumer Surface(s) line naming the /trader ledger export (D-7).\n\nEDIT B: acceptance.feature AC-1 and AC-2 (closes O-1, honours D-8)\n- @AC-1 @FR-1 @regression, loop-scoped:\n  - Then: the AppendEventRequest has user_id \"user-a\".\n  - And: the request carries no x-user-id metadata.\n  - A comment cites the PRESERVE of ledger @AC-11 @feature-021 (ledgerServiceImpl.ts:76-78; ledgerServiceImpl.test.ts:675) and is not promoted as a Then.\n- @AC-2 @FR-2 @regression: Given a well-formed order.filled event with payload user_id \"system\".\n  - Thens: an order_snapshots row is written with empty indicators and signals; analysis.snapshot.degraded is emitted; no pnl_positions window is opened; the event is not parked.\n  - \"_compose does not raise\" may stay as the RED anchor. At C-16 promotion the durable suite keeps only the behavioural Thens.\n\nEDIT C: @AC-3 @FR-3 (closes O-2)\n- Given two mcp_client sources, each returning two distinct (non-duplicate) signals in one cycle, which avoids the dedup branch at servicer.py:1185.\n- Then each source's AppendEvents carry one shared non-empty x-trace-id, and the two sources' ids differ.\n- Drop the metric-label Then, because test_telemetry_allowlist.py:68 (@AC-41 @feature-294) already enforces it. Replace it with a PRESERVE comment citing @AC-41 and @AC-28/29/53 @feature-294.\n- Add a scenario comment stating that ledger does not read gRPC x-trace-id today (ledgerServiceImpl.ts:76-97). The id is outbound call correlation only. AC-3 must not imply ledger-side traceability.\n\nBUILD ORDER\n1. Docs edits A, B and C, plus a context.md entry recording:\n   - the rewordings;\n   - the FR narrowing;\n   - the D-5/D-6 OQ decisions;\n   - the post-review FR addition, logged as a clarification, not a new requirement.\n2. Analysis RED/GREEN for AC-2 against the real _compose, using the sleeps fixture and an exact-message RED.\n3. Ingest RED/GREEN:\n   - AC-1 on the loop path;\n   - AC-3;\n   - the RPC-path user_id assertion, tagged as AC-33 @feature-224 PRESERVE coverage.\n\nEvery test step names its Covers: AC-n. The spec rebases cited lines against peers 308, 309 and 327 (pnl_pattern_consumer.py) and 328 (mcp_client_loop.py), and checks 328's propagation_meta shape before fixing AC-1/AC-3.",
    "open_objections": [
      {
        "text": "C-16: FR-2 as worded in r2 ('never parked') overclaims against @AC-7 @FR-5 @feature-259. Reword to 'a system owner alone never causes parking'. A poison payload still parks. Not yet confirmed by the proposer.",
        "blocking": false
      },
      {
        "text": "C-15: FR-1 claimed both the loop and RPC paths but only AC-1, which is loop-scoped, traces it. Adopted fix: narrow FR-1 to the loop and trace the RPC-path test as an AC-33 @feature-224 PRESERVE. The proposer must confirm, or instead add an RPC scenario.",
        "blocking": false
      },
      {
        "text": "Test validity: AC-3's Given must specify distinct, non-duplicate signals. Otherwise the dedup branch (servicer.py:1185) emits no second AppendEvent and the shared-id Then holds vacuously.",
        "blocking": false
      },
      {
        "text": "C-18: AC-3's metric-label Then duplicates test_telemetry_allowlist.py:68 (@AC-41 @feature-294). Drop it and cite it as a PRESERVE comment.",
        "blocking": false
      },
      {
        "text": "C-15 drift: product-spec.md:16 says the loop forwards metadata=None. It actually forwards an empty list (servicer.py:1024). Correct it in Edit A and log it in context.md.",
        "blocking": false
      },
      {
        "text": "AC-3 must not imply ledger-side traceability. Ledger never reads gRPC x-trace-id (ledgerServiceImpl.ts:76-97). This holds while the D-2 REOPEN petition awaits an operator ruling.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
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
      "Cite a bug-template exemption for the FR tags: C-15 (constitution.md:46) has none. The Track C template omission (track-c-sdd.md:161) is a template gap, not a waiver.",
      "Keep FR-2 as 'never parked': it overclaims against @AC-7 @feature-259, because poison payloads must still park.",
      "Keep FR-1 covering both paths with only a loop-scoped scenario: that leaves the RPC test untraced. Narrowing FR-1 and tracing the RPC test to the AC-33 @feature-224 PRESERVE costs less than a new scenario for a no-behaviour-change path.",
      "Restate the no-identifier metric-label rule as an AC-3 Then: test_telemetry_allowlist.py:68 (@AC-41 @feature-294) already enforces it, so a second promoted rule would break C-18.",
      "Persist the per-cycle id as AppendEventRequest.correlation_id, or drop OQ-1: either requires reopening D-2, which only the operator can do. Filed as a petition, not adopted."
    ],
    "open_risks": [
      "D-2 may deliver no downstream value. Ledger drops gRPC x-trace-id (ledgerServiceImpl.ts:76-97; only mtls.test.ts:127 reads it), so AC-3 pins an outbound-only value. If the operator reopens D-2, AC-3 and FR-3 change shape: correlation_id or removal.",
      "Peer 328 also edits mcp_client_loop.py. AC-1's 'no x-user-id metadata' and AC-3's distinct-ids Thens bind the propagation_meta shape, so a conflicting metadata addition there is a semantic conflict, not just a textual one.",
      "Re-expressing owner_metadata via is_real_owner touches a builder shared by 9+ callers. The mitigation is that test_identity.py:13-36 stays green and unedited.",
      "Recon did not verify marketdata's handling of a headerless system bars read. It sits inside the try at :541-545 and degrades either way, but the spec should confirm.",
      "The AC-2 RED depends on retry exhaustion. Use the sleeps fixture and an exact-message assertion to avoid a false RED (fails.md:3350-3353).",
      "Line drift from peers 308, 309, 327 and 328: the spec must rebase the cited lines."
    ],
    "constitution_rules_touched": [
      "C-11",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-06"
    ],
    "rationale": "The adversary found no Floor breach and no register violation, and confirmed D-1 to D-8 against the code. The r2 proposal answers O-1, O-2 and O-3 concretely: AC-1 is reworded with an export PRESERVE comment, @AC-3 is appended with per-source per-cycle wording, and FR-1/2/3 are added without an invented exemption. All three are closed.\n\nThe adversary's six new objections are valid. I adopted the fixes into the approach: narrowed FR-1 and FR-2, the distinct-signals Given, dropping the duplicated metric Then, the product-spec drift fix, and the behavioural-only promotion. The proposer has not yet answered them, so they stay open as non-blocking.\n\nI verified the REOPEN D-2 evidence myself. Ledger appendEvent reads only x-user-id from call metadata, and x-trace-id appears in ledger src only in mtls.test.ts. That evidence is not in D-2's record (servicer.py:762,1181 only), so the petition is new. With no operator steer, D-2 stands, and AC-3 is reworded so it does not imply ledger traceability.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "FR-1 is scoped to the mcp_client loop path. Setting AppendEventRequest.user_id on the RPC path is incidental hardening with no behaviour change, and its test traces to a PRESERVE of AC-33 @feature-224.",
          "evidence": "services/xstockstrat-ingest/app/handlers/servicer.py:984-995,1175-1180"
        },
        {
          "text": "FR-2 reads 'a system owner alone never causes parking'. Poison payloads still park under @AC-7 @feature-259.",
          "evidence": "services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:65-73,368-386"
        },
        {
          "text": "AC-3's Given uses distinct, non-duplicate signals. Its metric-label clause is replaced by a PRESERVE comment citing @AC-41/@AC-28/29/53 @feature-294, and it states that ledger does not read gRPC x-trace-id.",
          "evidence": "servicer.py:1145,1185; services/xstockstrat-ingest/tests/test_telemetry_allowlist.py:68; services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:76-97"
        },
        {
          "text": "The product-spec Problem Statement is corrected: the loop forwards an empty propagation_meta list, not metadata=None. The correction is logged in context.md with the other rewordings.",
          "evidence": "servicer.py:1024; docs/roadmap/features/313-fix-system-identity-paths/product-spec.md:16"
        }
      ],
      "new_rejected": [
        {
          "text": "Cite a bug-template exemption for the @FR-N tags",
          "why": "C-15 (constitution.md:46) has no bug carve-out. The Track C template omission is a gap, not a waiver."
        },
        {
          "text": "Restate the no-identifier metric-label rule as an AC-3 Then",
          "why": "test_telemetry_allowlist.py:68 (@AC-41 @feature-294) already enforces it. A second promoted rule would break C-18."
        }
      ],
      "new_objections": [
        {
          "text": "FR-2 'never parked' overclaims against @AC-7 @feature-259. Reword to 'a system owner alone never causes parking'.",
          "blocking": false
        },
        {
          "text": "FR-1 claims both paths but only the loop-scoped AC-1 traces it. Narrow FR-1, or add an RPC scenario.",
          "blocking": false
        },
        {
          "text": "AC-3's Given must specify distinct, non-duplicate signals, or dedup (servicer.py:1185) makes the Then vacuous.",
          "blocking": false
        },
        {
          "text": "Drop AC-3's metric-label Then (duplicates test_telemetry_allowlist.py:68) in favour of a PRESERVE comment.",
          "blocking": false
        },
        {
          "text": "Correct the product-spec.md:16 'metadata=None' drift (actually an empty list, servicer.py:1024).",
          "blocking": false
        },
        {
          "text": "AC-3 must not imply ledger-side traceability, because ledger never reads gRPC x-trace-id.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "AC-1's Then is reworded to assert AppendEventRequest.user_id plus no x-user-id metadata. Export visibility is a cited PRESERVE comment of ledger @AC-11 @feature-021 and is not promoted."
        },
        {
          "id": "O-2",
          "how": "@AC-3 @FR-3 is appended with per-source, per-cycle shared x-trace-id wording."
        },
        {
          "id": "O-3",
          "how": "FR-1/2/3 are added to product-spec.md and every scenario is tagged @FR-N. No exemption is cited, because C-15 has none."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-2",
          "evidence": "services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:76-97: appendEvent reads only x-user-id from call metadata and persists correlation_id and metadata from request fields. A search for x-trace-id in ledger src matches only __tests__/mtls.test.ts:127, so the per-cycle id minted by D-2 is dropped on arrival. The options are to persist the id as AppendEventRequest.correlation_id, to drop OQ-1, or to keep D-2 with AC-3 reworded.",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 (sdd-batch design gate (round 3))

- The `/sdd-design fix-system-identity-paths` full debate is at its approval gate after round 3 (gate policy: halt). design.md is not written and status.md is unchanged (spec-ready). The register is in `debate.md`. Round 3 added D-13, R-7, R-8, O-10 to O-12, P-2 and P-3, and closed O-4 to O-9.

## Open Threads

- **Approach.** The code design (D-1 to D-4) is unchanged:
  - Ingest sets `AppendEventRequest.user_id=owner` on `ingest.signal.ingested` in `_ingest_external_signal` (D-1).
  - `poll_one_source` mints one `x-trace-id` per source per cycle and passes it via `propagation_meta` only, with no `x-user-id` (D-2, while P-1 is pending).
  - Analysis adds `is_real_owner()` to `app/identity.py` and uses it at `_compose` and the window guard. `owner_metadata` reuses it with its raise unchanged. A system order writes a degraded snapshot and opens no window (D-3, D-4).
  - New D-13: `_emit` sets no `AppendEventRequest.user_id` (`pnl_pattern_consumer.py:608-619`), so the degraded snapshot writes no system-owned ledger row. @AC-14 and @AC-15 @feature-225 stay safe with no extra guard.

  Round 3 changes only docs and test shape, all written before `/sdd-spec`:
  - Edits A (product-spec FR-1/2/3, Problem Statement fix, Consumer Surface) and C (AC-3) are as the proposer wrote them. They close O-4 to O-9.
  - AC-2's "Then `_compose` does not raise" is replaced by "Then the event is processed on its first attempt with no retry backoff". It is observed via the sleeps fixture (`tests/test_pnl_pattern_consumer.py:483-486`). The method-level anchor moves to the test name.
  - AC-3's test drives `poll_one_source` through the real `_ingest_external_signal` with a dedup-miss fake DB (the `tests/test_mcp_client_loop.py:173-201` pattern), not the AsyncMock stub.
  - Build order:
    1. Docs edits.
    2. Analysis AC-2 RED/GREEN.
    3. Ingest AC-1 plus the RPC-path `user_id` assertion.
    4. Ingest AC-3/FR-3 as a separate final step, contingent on the P-1 ruling.
- **Strongest open objection.** O-10 is blocking. AC-2's "Then `_compose` does not raise" names a private method, and it would be frozen into the durable analysis suite. Promotion is whole-scenario and `/sdd-archiver` never rewrites a promoted scenario (`docs/sdd/business-rules/CLAUDE.md:23-30`), and Thens must be observable outcomes (`:37-38`). The fix is adopted but the proposer has not confirmed the wording. O-11 (step split) and O-12 (real-core AC-3 harness) are non-blocking and also unconfirmed.
- **Pending operator rulings.**
  - P-1 and its supplement P-3 target D-2. Ledger drops the gRPC `x-trace-id`. Analysis already pairs `correlation_id` with `x-trace-id` (`pnl_pattern_consumer.py:613,618`), so the `correlation_id` option follows an existing idiom.
  - P-2 targets D-9. AC-33 @feature-224 (`private-by-default-templates.feature:40-44`) is a PERMISSION_DENIED refusal, so tracing the RPC-path `user_id` test to it would be false coverage.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** None of the following has an operator decision behind it:
  - @AC-1 CHANGE and @AC-2 CHANGE;
  - @AC-3 EXTEND;
  - PRESERVEs of @AC-11 @feature-021, @AC-33 @feature-224, @AC-8/14/15/16/17 @feature-225, @AC-7/9 @feature-259 and @AC-28/29/41/53 @feature-294.
- **Resume.** The next `/sdd-batch` run resumes the debate from the state block below.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round 3 synthesis. The code design is unchanged (D-1 to D-4). This round only adds docs and test-shape corrections, all written before /sdd-spec and logged in context.md.\n\nCODE (unchanged, rests on D-1 to D-4)\n- Ingest:\n  - Add user_id=owner to the ingest.signal.ingested AppendEventRequest in _ingest_external_signal (working tree services/xstockstrat-ingest/app/handlers/servicer.py:1219-1228; recon tree :1174-1182) (D-1).\n  - poll_one_source (services/xstockstrat-ingest/app/engine/mcp_client_loop.py:153-160) mints one x-trace-id per source per cycle and passes it only via propagation_meta, with no x-user-id. D-2 stands while P-1 is pending.\n- Analysis:\n  - Add is_real_owner() to services/xstockstrat-analysis/app/identity.py. owner_metadata reuses it, with its raise and message unchanged.\n  - Use is_real_owner in _compose (pnl_pattern_consumer.py:539,546) and at the window guard :388.\n  - A system order writes a degraded snapshot and opens no window. _POISON (:65-73) and tests/test_identity.py are not touched (D-3, D-4).\n  - _emit sets no AppendEventRequest.user_id (pnl_pattern_consumer.py:608-615), so the degraded snapshot writes no system-owned ledger row.\n\nEDIT A: product-spec.md (as the proposer wrote it, closes O-4, O-5, O-8, O-9)\n- FR-1 is loop-only (D-9).\n- FR-2: \"a system owner alone never causes parking; poison still parks under @AC-7 @feature-259\" (D-10).\n- FR-3: per-source, per-cycle x-trace-id as outbound call metadata only; \"ledger does not persist it today\".\n- Problem Statement: \"forwards an empty propagation_meta list (defaulted in _ingest_external_signal, servicer.py:1070)\" (D-12).\n- Consumer Surface: the /trader ledger export (D-7).\n\nEDIT B: AC-1 as in D-8. AC-2 CORRECTED this round (new blocking objection, fix adopted):\n- Replace \"Then _compose does not raise\" with: \"Then the event is processed on its first attempt with no retry backoff\".\n  - It is observable through the sleeps fixture (services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py:483-486), which must record no awaited asyncio.sleep.\n  - It is still RED today: owner_metadata raises ValueError at :539, which drives retries and then parking.\n- Keep the behavioural Thens: an order_snapshots row with empty indicators and signals; analysis.snapshot.degraded emitted; no pnl_positions window opened; not parked.\n- The method-level anchor goes in the test name, not the Gherkin. The scenario-promoter promotes whole scenarios and /sdd-archiver never rewrites them (docs/sdd/business-rules/CLAUDE.md:23-30), and Thens must be observable outcomes (:37-38). \"Only behavioural Thens are promoted\" is not a mechanism, and is withdrawn.\n\nEDIT C: @AC-3 @FR-3 @regression (as the proposer wrote it, closes O-6, O-7, O-9)\n- Given two sources owned by user-a, each returning two distinct, non-duplicate signals.\n- Then each source's two AppendEvents carry the same non-empty x-trace-id and no x-user-id.\n- And the two sources' ids differ.\n- Two scenario comments: a PRESERVE comment citing @AC-41/@AC-28/@AC-29/@AC-53 @feature-294 (test_telemetry_allowlist.py:68), and a comment that the id is outbound only and ledger does not read it (ledgerServiceImpl.ts:76-97).\n- Harness correction (adopted): AC-3's test must drive poll_one_source through the REAL _ingest_external_signal against a fake DB whose dedup claim misses, so that the AppendEvent at servicer.py:1221 is reached past the gate at :1191. Follow the real-core pattern already in services/xstockstrat-ingest/tests/test_mcp_client_loop.py:173-201. Do not use the AsyncMock stubs at :100/:130/:231.\n\nRPC-path user_id assertion\n- D-9 stands as settled: the test traces to the @AC-33 @feature-224 PRESERVE.\n- New evidence challenging that trace is filed as a petition. AC-33 (services/xstockstrat-ingest/acceptance/private-by-default-templates.feature:40-44) is a PERMISSION_DENIED refusal of a forged system write.\n- It awaits the operator, and is recorded as an open risk.\n\nBUILD ORDER (revised; adopts the P-1 isolation fix)\n1. Docs edits A, B (with the AC-2 correction) and C, plus a context.md entry. It records:\n   - the rewordings;\n   - the FR narrowing;\n   - the metadata=None drift fix;\n   - D-5 and D-6;\n   - the FRs added post-review as a clarification;\n   - that the step-4 shape is contingent on the operator's ruling on P-1.\n2. Analysis AC-2: a RED test using the sleeps fixture with no-retry and exact-message assertions, then GREEN.\n3. Ingest D-1 / AC-1 on the loop path, plus the RPC-path user_id assertion per D-9. Nothing in this step depends on P-1.\n4. Ingest FR-3 / AC-3 as a separate, final step. It is marked contingent on P-1, so a ruling (correlation_id, or dropping OQ-1) rewrites only this unexecuted step and avoids an F-09 Deviation-Log swap (fails.md:441).\n\n/sdd-spec must rebase every cited line against origin/main-dev and peers 308, 309 and 327 (pnl_pattern_consumer.py) and 328 (mcp_client_loop.py).",
    "open_objections": [
      {
        "text": "C-15/C-16: AC-2 'Then _compose does not raise' is an implementation step. Promotion is whole-scenario and archiver never rewrites a promoted scenario (docs/sdd/business-rules/CLAUDE.md:23-30,37-38), so the 'promote only behavioural Thens' claim does not hold. Adopted fix: 'Then the event is processed on its first attempt with no retry backoff', observed via the sleeps fixture (tests/test_pnl_pattern_consumer.py:483-486). The proposer must confirm this wording before approval.",
        "blocking": true
      },
      {
        "text": "F-09 / fails.md:441: AC-1/D-1 and AC-3/FR-3 must be split into separate ingest steps, with the AC-3 step final and marked contingent on P-1 in context.md, so an operator ruling rewrites one unexecuted step. Adopted in the build order; the proposer has not yet confirmed.",
        "blocking": false
      },
      {
        "text": "C-15 test validity: AC-3's Then is observed at AppendEvent, but the mocked loop harness (test_mcp_client_loop.py:100,130,231) never reaches it. The spec must drive poll_one_source through the real _ingest_external_signal with a dedup-miss fake DB, following the test_mcp_client_loop.py:173-201 real-core pattern. Adopted; the proposer has not yet confirmed.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
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
      "Keep 'Then _compose does not raise' in AC-2 and promote only the behavioural Thens: scenario-promoter promotes whole scenarios and /sdd-archiver never rewrites a promoted scenario (business-rules/CLAUDE.md:23-30), and Thens must be observable outcomes (:37-38). A private method name would be frozen into the durable analysis suite.",
      "Bundle AC-1 and AC-3 into one ingest step: P-1 is still pending, so a ruling after execution starts would force a Deviation-Log swap of a frozen step (F-09, fails.md:441).",
      "Observe AC-3 through the mocked loop harness (AsyncMock _ingest_external_signal): it never reaches the dedup gate or AppendEvent (servicer.py:1191,1221), so the distinct-signals Given is untested.",
      "Persist the per-cycle id as AppendEventRequest.correlation_id (also sent as x-trace-id, matching pnl_pattern_consumer.py:613,618): this needs D-2 reopened, which only the operator can do. It stays under petition P-1 and is not adopted.",
      "Fold the RPC-path owner assertion into the AC-1 test, or leave it untraced: this contradicts the trace target in settled D-9. It is filed as a REOPEN petition, not adopted."
    ],
    "open_risks": [
      "D-9 traces the RPC-path user_id test to @AC-33 @feature-224, but AC-33 (private-by-default-templates.feature:40-44) tests a PERMISSION_DENIED refusal with no row written. A spec step with 'Covers: AC-33' would be false coverage until the operator rules on the D-9 petition.",
      "P-1 (D-2) is still pending. AC-3 and FR-3 pin an outbound-only x-trace-id that ledger drops (ledgerServiceImpl.ts:76-97). A ruling for correlation_id or for dropping OQ-1 changes AC-3's Thens and the step-4 shape. The step split limits this to one unexecuted step.",
      "Peer 328 also edits mcp_client_loop.py. AC-1's 'no x-user-id' and AC-3's per-source-id Thens bind the propagation_meta shape, so any conflicting metadata addition there is a semantic conflict.",
      "Re-expressing owner_metadata through is_real_owner touches a builder with 9+ callers. The mitigation is that test_identity.py:13-36 stays unedited and green.",
      "Marketdata's handling of a headerless system bars read is unverified. It sits inside _compose's try, so the event degrades either way, but the spec should confirm.",
      "The AC-2 RED depends on the retry path. The sleeps fixture must record no awaited sleep, and an exact-message assertion is needed to avoid a false RED (fails.md:3350-3353).",
      "Line drift: the working tree is already shifted from the recon stamp (servicer.py:1070/1191/1213/1221 against recon :1024/:1174-1185). The spec must rebase against origin/main-dev and peers 308, 309, 327 and 328."
    ],
    "constitution_rules_touched": [
      "C-11",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "F-09",
      "P-02",
      "P-06"
    ],
    "rationale": "The adversary found no Floor breach and no register violation. Its working-tree line confirmations, and its confirmations of D-7, D-9's no-behaviour-change premise and D-4's ledger safety, all hold. The proposer concretely answered all six round-2 objections with file-ready wording: FR-2 parking language, FR-1 loop narrowing, distinct-signal Given, metric-label PRESERVE comment, the metadata=None drift fix, and the no-ledger-traceability comment. So O-4 to O-9 are closed.\n\nI verified the adversary's new evidence myself:\n- business-rules/CLAUDE.md:23-30 shows whole-scenario promotion with no archiver rewrite, and :37-38 says Thens are observable outcomes. The AC-2 objection is valid and blocking, because the wording becomes permanent at C-16.\n- The sleeps fixture exists at test_pnl_pattern_consumer.py:483-486, so the replacement Then is testable.\n- test_mcp_client_loop.py stubs _ingest_external_signal with AsyncMock in most tests, with a real-core pattern at :173-201. The harness objection is valid.\n- AC-33's text (private-by-default-templates.feature:40-44) is a PERMISSION_DENIED scenario, so D-9's trace target is weak. That evidence is not in D-9's record, so it is filed as a new petition. D-9 still stands because the operator has made no steer.\n- pnl_pattern_consumer.py:613,618 confirms that analysis already pairs correlation_id with x-trace-id. This is new supporting evidence for P-1, recorded for the operator.\n\nThe step split is adopted. It honours D-2 and reduces the blast radius of a P-1 ruling.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "A system-owned degraded snapshot writes no system-owned ledger row, because _emit sets no AppendEventRequest.user_id. @AC-14/@AC-15 @feature-225 are therefore safe under D-4 with no extra guard.",
          "evidence": "services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:608-619"
        }
      ],
      "new_rejected": [
        {
          "text": "Keep 'Then _compose does not raise' in AC-2 and rely on promoting only the behavioural Thens",
          "why": "Promotion is whole-scenario and /sdd-archiver never rewrites a promoted scenario (docs/sdd/business-rules/CLAUDE.md:23-30). Thens must be observable outcomes (:37-38)."
        },
        {
          "text": "Observe AC-3's AppendEvent Then through the AsyncMock-stubbed loop harness",
          "why": "The stub never reaches the dedup gate or AppendEvent (servicer.py:1191,1221), so the Then is vacuous. The real-core pattern exists at tests/test_mcp_client_loop.py:173-201."
        }
      ],
      "new_objections": [
        {
          "text": "AC-2 'Then _compose does not raise' is an implementation step that would be promoted permanently. Replace it with 'Then the event is processed on its first attempt with no retry backoff', observed via the sleeps fixture (test_pnl_pattern_consumer.py:483-486).",
          "blocking": true
        },
        {
          "text": "Split D-1/AC-1 and FR-3/AC-3 into separate ingest steps, with AC-3 last and marked contingent on P-1 in context.md, so a ruling does not force an F-09 Deviation-Log swap (fails.md:441).",
          "blocking": false
        },
        {
          "text": "AC-3's test must drive poll_one_source through the real _ingest_external_signal with a dedup-miss fake DB (the test_mcp_client_loop.py:173-201 pattern), not the AsyncMock stub.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-4",
          "how": "The proposer adopts FR-2 wording 'a system owner alone never causes parking; poison still parks under @AC-7 @feature-259' (D-10)."
        },
        {
          "id": "O-5",
          "how": "FR-1 is narrowed to the mcp_client loop. No RPC scenario is added (D-9)."
        },
        {
          "id": "O-6",
          "how": "AC-3's Given specifies two distinct, non-duplicate signals per source, gated on 'if not deduplicated' (servicer.py:1191)."
        },
        {
          "id": "O-7",
          "how": "The metric-label Then is dropped and replaced by a PRESERVE comment citing @AC-41/@AC-28/@AC-29/@AC-53 @feature-294 (test_telemetry_allowlist.py:68)."
        },
        {
          "id": "O-8",
          "how": "The Problem Statement now reads 'an empty propagation_meta list (defaulted in _ingest_external_signal)', logged in context.md (D-12)."
        },
        {
          "id": "O-9",
          "how": "FR-3 and an AC-3 scenario comment state that the id is outbound call metadata only and that ledger appendEvent does not read x-trace-id (ledgerServiceImpl.ts:76-97)."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-9",
          "evidence": "services/xstockstrat-ingest/acceptance/private-by-default-templates.feature:40-44. AC-33 @feature-224 is 'mallory sends x-user-id system without grant → PERMISSION_DENIED and no signal row is written'. An AppendEventRequest.user_id==owner assertion on an accepted ingest exercises none of it, so tracing the RPC test there is false coverage. Proposed re-target: an untraced incidental-hardening assertion, or an extra assertion inside the AC-1 test. D-9's FR-1 loop narrowing stands.",
          "is_new": true
        },
        {
          "target": "D-2",
          "evidence": "services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:613,618: analysis's ledger emits send one id as both AppendEventRequest.correlation_id and x-trace-id call metadata. That makes the P-1 correlation_id option an existing platform idiom, not a new design. This supplements P-1.",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 (sdd-batch design gate (round 4))

- The `/sdd-design fix-system-identity-paths` full debate is at its approval gate after round 4 (gate policy: halt). design.md is not written and status.md is unchanged. The register is in `debate.md`. Round 4 added D-14 to D-16, R-9, R-10 and O-13 to O-16, closed O-10 to O-12, and marked D-9 reopened (operator steer). P-1, P-2 and P-3 keep their recorded verdicts.

## Open Threads

- **Approach.** The code core is unchanged (D-1, D-3, D-4, D-13). Round 4 applies the operator's D-9 reopen and AC-2 wording, and tightens the AC-2 test:
  - Ingest sets `AppendEventRequest.user_id=owner` on `ingest.signal.ingested` in `_ingest_external_signal` (D-1). FR-1 stays scoped to the mcp_client loop.
  - `poll_one_source` mints one `x-trace-id` per source per cycle and passes it via `propagation_meta` only, with no `x-user-id` (D-2 as written). The proposer's `correlation_id` variant is not adopted, because the steer supports the P-1 option without saying "reopen D-2". The variant is ready to apply if the operator rules for it; a ruling rewrites only step 4 and the AC-3/FR-3 wording.
  - Analysis adds `is_real_owner()` to `app/identity.py` and uses it in `_compose` and at the window guard. A system order writes a degraded snapshot, opens no window and writes no system-owned ledger row.
  - AC-2's Then reads "the event is processed on its first attempt with no retry backoff" (D-15). Its test drives `_process_with_retry`, not `process_event`, because `asyncio.sleep` is awaited only there (`pnl_pattern_consumer.py:228-232`). It asserts no awaited sleep, one `process_event` run, no parking, a degraded snapshot and no `pnl_positions` window.
  - The RPC-path `AppendEventRequest.user_id` check is an untraced incidental-hardening assertion inside the AC-1 test, with no "Covers: AC-33" (D-14, superseding D-9's trace clause).
  - AC-1 and AC-3 tests drive `poll_one_source` through the real `_ingest_external_signal` with a dedup-miss fake DB (`tests/test_mcp_client_loop.py:173-201`).
  - Build order (D-16):
    1. Docs and context.md, including a note that step 4 and the AC-3/FR-3 wording are contingent on the P-1 ruling.
    2. Analysis AC-2, RED then GREEN.
    3. Ingest D-1/AC-1, with the in-test RPC assertion.
    4. Ingest FR-3/AC-3 as a separate final step.
  - `/sdd-spec` must re-ground every cited line against `origin/main-dev` and peers 308, 309, 327 and 328. The round-4 line checks ran on a `feature/fix-trading-config-plumbing` tree, where the AppendEvent is at `servicer.py:1397` and the core at `:1237`.
- **Strongest open objection.** O-13 is blocking. The operator must give an explicit verdict on P-1 and P-3 before approval: reopen D-2 for the `correlation_id` option, or decline.
  - If reopened, step 4 sends the per-cycle id as both `x-trace-id` metadata and `AppendEventRequest.correlation_id`, and AC-3/FR-3 are reworded to "persisted as the ledger event's correlation_id". O-14 to O-16 (non-blocking) then apply: the spy at `tests/test_mcp_client_loop.py:196` must accept the new keyword, one keyword-only `trace_id` should feed both channels, and the consumer-surface note must cover the export's `correlation_id` column.
  - If declined, D-2 and the outbound-only AC-3 stand. The per-cycle id is then dropped at the ledger, so AC-3 proves outbound metadata only.
  - AC-3's wording becomes permanent at promotion, so this must be settled first.
- **Floor status.** No Floor breach.
- **Uncovered @AC changes.** @AC-3 (EXTEND) is not covered by an operator decision; the C-16 sign-off of 2026-11-20 covers the @AC-1 and @AC-2 CHANGEs only. All other touched scenarios are PRESERVE.
- **Unverified.** The operator decisions and steer reached this step as workflow-computed text and are not yet confirmed against context.md. Check they are recorded here before `/sdd-spec`.

```sdd-batch-design-state
{
  "round": 4,
  "synth": {
    "approach": "Round 4 synthesis. The code core is unchanged (D-1, D-3, D-4, D-13). This round applies the operator's D-9 reopen and AC-2 wording, and tightens the AC-2 test. The per-cycle id stays as D-2 wrote it, because the steer does not explicitly reopen D-2.\n\nINGEST, OWNER (D-1 / AC-1, FR-1 loop-scoped)\n- Add user_id=owner to the ingest.signal.ingested AppendEventRequest in _ingest_external_signal.\n- On the tree I checked (branch feature/fix-trading-config-plumbing, not main-dev) the request is at services/xstockstrat-ingest/app/handlers/servicer.py:1397 and the core at :1237. Recon recorded :1174-1182.\n\nINGEST, PER-CYCLE ID (FR-3 / AC-3) — D-2 as written\n- poll_one_source (services/xstockstrat-ingest/app/engine/mcp_client_loop.py:116,153-160) mints one uuid4 per source per cycle.\n- It passes the id only as propagation_meta=[(\"x-trace-id\", id)], with no x-user-id.\n- AC-3 Thens: each source's two AppendEvents carry the same non-empty x-trace-id call metadata and no x-user-id; the two sources' ids differ.\n- Scenario comments stay as in round 3: the @AC-41/@AC-28/@AC-29/@AC-53 @feature-294 PRESERVE, and \"outbound call metadata only; ledger does not read x-trace-id\".\n- The proposer's correlation_id variant is NOT adopted. It contradicts D-2's \"only via propagation_meta\" clause, and the steer takes P-3 \"as support for\" the P-1 option without saying \"reopen D-2\". P-1 and P-3 stay pending.\n- The variant is technically sound and ready to apply if the operator rules for it:\n  - Ledger persists req.correlationId (services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:89).\n  - Analysis already pairs correlation_id with x-trace-id (services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:613,618).\n  - A ruling rewrites only step 4 and the AC-3/FR-3 wording.\n\nANALYSIS (D-3 / D-4, unchanged)\n- Add is_real_owner() to services/xstockstrat-analysis/app/identity.py. owner_metadata reuses it, with its raise and message unchanged.\n- Use it in _compose (pnl_pattern_consumer.py:539,546) and at the window guard (:388).\n- A system order writes a degraded snapshot, opens no window, and writes no system-owned ledger row (D-13). _POISON and tests/test_identity.py are not touched.\n\nAC-2 (operator wording, 2026-11-20)\n- Then: \"the event is processed on its first attempt with no retry backoff\".\n- The test must drive consumer._process_with_retry(event), not process_event. asyncio.sleep is awaited only inside _process_with_retry (pnl_pattern_consumer.py:228-232), so a direct process_event call passes with or without the bug.\n- With the sleeps fixture (services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py:483-486), assert:\n  - sleeps.await_count == 0;\n  - process_event ran exactly once;\n  - not parked;\n  - an order_snapshots insert with empty indicators and signals;\n  - analysis.snapshot.degraded emitted;\n  - no pnl_positions window opened.\n- RED evidence before the fix: two awaited sleeps and PARKED after three attempts, with the exact message \"owner-scoped call needs a real owner, got 'system'\".\n\nAC-1 TEST (D-9 reopened by the operator)\n- Drive poll_one_source through the real _ingest_external_signal with a dedup-miss fake DB (the services/xstockstrat-ingest/tests/test_mcp_client_loop.py:173-201 pattern).\n- Assert AppendEvent's request has user_id == \"user-a\" and the call metadata has no x-user-id.\n- The same test function adds one untraced incidental-hardening assertion: IngestSignal with an x-user-id: user-a header yields AppendEventRequest.user_id == \"user-a\" (the tests/test_signal_ownership.py:138-139 request-object pattern).\n- It carries no \"Covers: AC-33\". @AC-33 @feature-224 is a plain PRESERVE that this feature does not exercise. D-9's FR-1 loop narrowing stands.\n\nAC-3 TEST\n- Same real-core harness as AC-1 (R-8).\n- Given two sources owned by user-a, each returning two distinct, non-duplicate signals.\n\nBUILD ORDER\n1. Docs and context.md:\n   - AC-1 and AC-2 rewordings, with the operator's C-16 sign-off (2026-11-20);\n   - FR-1 loop-only; FR-2 per D-10; FR-3 outbound-only;\n   - the D-12 drift fix; D-5 and D-6;\n   - the D-9 re-target;\n   - a note that step 4 and the AC-3/FR-3 wording are contingent on the operator's P-1 ruling.\n2. Analysis AC-2, RED then GREEN, via _process_with_retry.\n3. Ingest D-1 / AC-1, including the in-test RPC assertion.\n4. Ingest FR-3 / AC-3 as a separate final step.\n\n/sdd-spec must re-ground every cited line against origin/main-dev and peers 308, 309, 327 (pnl_pattern_consumer.py) and 328 (mcp_client_loop.py and the _ingest_external_signal signature).",
    "open_objections": [
      {
        "text": "Register: the operator must give an explicit verdict on P-1 (and P-3) before approval. The steer takes P-3 'as support for the P-1 correlation_id option' but does not say 'reopen D-2', unlike its explicit 'reopen D-9'. If reopened, step 4 sends the per-cycle id as both x-trace-id metadata and AppendEventRequest.correlation_id, and AC-3/FR-3 are reworded to 'persisted as the ledger event's correlation_id'. If declined, D-2 and the outbound-only AC-3 stand as synthesised here. AC-3's wording becomes permanent at promotion, so this must be settled first.",
        "blocking": true
      },
      {
        "text": "Contingent on a P-1 reopen: the real-core spy at services/xstockstrat-ingest/tests/test_mcp_client_loop.py:196 is `async def spy(signal, propagation_meta=None, owner=None)`. A new correlation_id keyword would raise TypeError, which the per-item except in mcp_client_loop.py swallows as a skipped item. The @AC-4 @feature-166 dedup test would then fail or pass for the wrong reason. Step 4's Files must include that test, and the spy must accept and forward the new keyword. The proposal did not answer this.",
        "blocking": false
      },
      {
        "text": "Contingent on a P-1 reopen (C-18): passing the same id through two channels (propagation_meta and correlation_id) lets a future caller send mismatched values. Prefer one keyword-only trace_id on _ingest_external_signal that the core turns into both, or state the equality constraint in the docstring. The RPC path passes neither, so D-9's no-behaviour-change premise holds either way. The proposal did not answer this.",
        "blocking": false
      },
      {
        "text": "Contingent on a P-1 reopen (C-14 / D-7): correlation_id is an export-row column (services/xstockstrat-ledger/acceptance/ledger-event-export.feature:40). The context.md consumer-surface note must say mcp_client rows show a poll-cycle id there, not a request trace, and that RPC rows stay empty.",
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
      "Adopt the correlation_id variant now (id sent as x-trace-id metadata and AppendEventRequest.correlation_id): it contradicts settled D-2 and the steer does not explicitly reopen D-2. It stays under P-1/P-3 pending an explicit operator verdict.",
      "Derive correlation_id from any x-trace-id entry in propagation_meta: it would start storing inbound trace ids on RPC-path ledger rows, a behaviour change outside FR-1/FR-3 that breaks D-9's no-behaviour-change premise.",
      "Trace the RPC-path user_id assertion to @AC-33 @feature-224: AC-33 is a PERMISSION_DENIED refusal with no row written (services/xstockstrat-ingest/acceptance/private-by-default-templates.feature:40-44), so that trace is false coverage. The operator reopened D-9 on this.",
      "Observe AC-2's 'no retry backoff' by calling process_event directly: asyncio.sleep is awaited only in _process_with_retry (pnl_pattern_consumer.py:228-232), so the Then would pass with the bug present."
    ],
    "open_risks": [
      "P-1 is unruled. If the operator reopens D-2 after /sdd-spec, AC-3, FR-3 and step 4 change. The step split limits this to one unexecuted step, but AC-3's wording must be fixed before promotion.",
      "Under D-2 as written, the per-cycle id is dropped at the ledger (ledgerServiceImpl.ts reads only x-user-id from metadata), so AC-3 proves outbound metadata only.",
      "The operator decisions and steer reached this step as workflow-computed text. I could not confirm them against context.md, so the orchestrator should check they are recorded there before /sdd-spec.",
      "Peer 328 also edits mcp_client_loop.py and the _ingest_external_signal signature. A conflicting metadata or keyword change there is a semantic merge conflict with AC-1 and AC-3.",
      "Line drift: I checked the tree on branch feature/fix-trading-config-plumbing, where the AppendEvent is at servicer.py:1397 and the core at :1237. Recon's ingest citations are stale, and /sdd-spec must re-ground against origin/main-dev.",
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
      "P-06"
    ],
    "rationale": "There is no Floor breach. The one blocker is a register question: the proposal adopts the correlation_id design, which contradicts settled D-2, and the steer does not explicitly reopen D-2.\n\nWhat I applied from the operator:\n- D-9 is explicitly reopened. The RPC-path assertion moves inside the AC-1 test, untraced, and the FR-1 loop narrowing stands.\n- AC-2 takes the wording \"processed on its first attempt with no retry backoff\".\n- The C-16 sign-off covers @AC-1 and @AC-2 only, so @AC-3 is not marked covered.\n\nWhy D-2 is not treated as reopened:\n- The steer says \"reopen D-9 — accept the petition\" for D-9, but only \"take the D-2 petition's evidence as support for the P-1 correlation_id option\" for D-2.\n- The task limits `reopened` to ids the steer explicitly reopens. The proposer's own strongest-risk section and the adversary both flag the same gap.\n- So I corrected the approach to D-2 as written and raised the ruling as the blocking objection.\n\nWhat I verified on the tree:\n- The spy signature at tests/test_mcp_client_loop.py:196 has no correlation_id parameter.\n- asyncio.sleep is awaited inside _process_with_retry at pnl_pattern_consumer.py:228-232.\n- Ledger persists req.correlationId at ledgerServiceImpl.ts:89.\n- AC-33's text at private-by-default-templates.feature:40-44 is the PERMISSION_DENIED scenario.\n- The AppendEvent is at servicer.py:1397 and the core at :1237.\n\nObjections:\n- O-10 closes: the operator wording is adopted and the test is specified to drive _process_with_retry, which answers the adversary's vacuous-test point.\n- O-11 closes: the ingest steps are split with AC-3 last, and the P-1 contingency is recorded in step 1.\n- O-12 closes: both AC-1 and AC-3 use the real-core harness.\n- The adversary's spy-signature, two-channel and export-column points apply only if D-2 is reopened. The proposal did not answer them, so they stay open as non-blocking.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Supersedes D-9's trace clause (operator reopen, 2026-11-20): the RPC-path AppendEventRequest.user_id check is an untraced incidental-hardening assertion inside the AC-1 test, with no 'Covers: AC-33'. @AC-33 @feature-224 is a plain PRESERVE. FR-1 stays scoped to the mcp_client loop.",
          "evidence": "services/xstockstrat-ingest/acceptance/private-by-default-templates.feature:40-44; services/xstockstrat-ingest/tests/test_signal_ownership.py:138-139; operator steer 2026-11-20"
        },
        {
          "text": "AC-2's Then reads 'the event is processed on its first attempt with no retry backoff'. Its test drives _process_with_retry with the sleeps fixture and asserts no awaited sleep, one process_event run, no parking, a degraded snapshot and no pnl_positions window.",
          "evidence": "operator decision 2026-11-20; services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:228-232; services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py:483-486"
        },
        {
          "text": "Build order: docs and context.md first, then analysis AC-2, then ingest D-1/AC-1, then ingest FR-3/AC-3 as a separate final step. AC-1 and AC-3 tests drive poll_one_source through the real _ingest_external_signal with a dedup-miss fake DB.",
          "evidence": "docs/roadmap/ledger/fails.md:441; services/xstockstrat-ingest/tests/test_mcp_client_loop.py:173-201"
        }
      ],
      "new_rejected": [
        {
          "text": "Derive AppendEventRequest.correlation_id from an x-trace-id entry in propagation_meta",
          "why": "It would start storing inbound trace ids on RPC-path ledger rows, a behaviour change outside FR-1/FR-3 (servicer.py:1216,1237)."
        },
        {
          "text": "Observe AC-2's 'no retry backoff' Then by calling process_event directly",
          "why": "asyncio.sleep is awaited only in _process_with_retry (pnl_pattern_consumer.py:228-232), so the Then passes with the bug present."
        }
      ],
      "new_objections": [
        {
          "text": "The operator must give an explicit verdict on P-1/P-3 (reopen D-2 for the correlation_id option, or decline) before approval. The round-4 steer supports the option but does not say 'reopen D-2'.",
          "blocking": true
        },
        {
          "text": "If D-2 is reopened: step 4's Files must include tests/test_mcp_client_loop.py, and the spy at :196 must accept and forward the new keyword, or the @AC-4 @feature-166 dedup test breaks silently.",
          "blocking": false
        },
        {
          "text": "If D-2 is reopened: use one keyword-only trace_id that the core turns into both x-trace-id metadata and correlation_id, or state the equality constraint in the docstring (C-18).",
          "blocking": false
        },
        {
          "text": "If D-2 is reopened: the context.md consumer-surface note must say the export's correlation_id column shows a poll-cycle id for mcp_client rows (ledger-event-export.feature:40).",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-10",
          "how": "AC-2 adopts the operator wording 'Then the event is processed on its first attempt with no retry backoff', observed by driving _process_with_retry with the sleeps fixture."
        },
        {
          "id": "O-11",
          "how": "The proposer confirms separate ingest steps with FR-3/AC-3 last. The P-1 contingency is recorded in step 1's context.md entry."
        },
        {
          "id": "O-12",
          "how": "The proposer confirms that AC-1 and AC-3 drive poll_one_source through the real _ingest_external_signal with a dedup-miss fake DB (test_mcp_client_loop.py:173-201)."
        }
      ],
      "reopen_petitions": [],
      "reopened": [
        "D-9"
      ]
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 (sdd-batch design gate (round 5))

- The `/sdd-design fix-system-identity-paths` full debate is at its approval gate after round 5 (gate policy: halt). design.md is not written and status.md is unchanged. The register is in `debate.md`. Round 5 added D-17 to D-19, R-11, R-12 and O-17 to O-19, closed O-13 to O-16, and marked D-2 reopened (operator steer). D-9 keeps its round-4 "reopened" status. P-1, P-2 and P-3 still read "pending user" in the register; flipping them is O-19.

## Open Threads

- **Approach.** The code core is unchanged (D-1, D-3, D-4, D-13, D-15, D-16). Round 5 applies the operator's D-2 reopen (P-1, P-3) and adopts two adversary fixes the proposer has not yet answered:
  - `_ingest_external_signal` gains one keyword-only `trace_id: str = ""` after `owner`. When it is non-empty, the core sets `AppendEventRequest.correlation_id=trace_id` and appends `("x-trace-id", trace_id)` to the call metadata, on the `ingest.signal.ingested` AppendEvent only (D-17). One value feeds both channels.
  - The core appends the header; it does not strip and replace an inbound `x-trace-id`. A one-line docstring constraint says `trace_id` is for callers with no inbound metadata.
  - The RPC path passes no `trace_id` and is unchanged, so R-9 holds.
  - `poll_one_source` mints `str(uuid.uuid4())` once per source per cycle, before the item loop, and passes it as `trace_id=` on every per-item call, with no `propagation_meta` and no `x-user-id`.
  - AC-3's Thens assert only what a consumer can observe: each `ingest.signal.ingested` ledger event from one source's cycle carries the same non-empty correlation_id, the two sources' ids differ, and no `x-user-id` is sent. The matching `x-trace-id` metadata is a plain test assertion. FR-3 and the scenario comment read "the id persists as the ledger event's correlation_id; ledger ignores the x-trace-id header" (D-18).
  - Step 4's Files include `tests/test_mcp_client_loop.py`. The real-core spy at `:196-197` takes and forwards `**kw`, so the @AC-4 @feature-166 dedup test keeps its meaning (D-19).
  - Ingest owner (D-1, D-14) and analysis (D-3, D-4, D-13, D-15) are as recorded in round 4.
  - Build order (D-16):
    1. Docs and context.md: the AC-1 and AC-2 rewordings with the C-16 sign-off, FR-1 loop-only, FR-2 per D-10, FR-3 reworded, the D-12 drift fix, the operator's 2026-11-20 rulings on D-2 and D-9, and the consumer-surface note below. The "step 4 contingent on P-1" note is dropped.
    2. Analysis AC-2, RED then GREEN.
    3. Ingest D-1/AC-1, with the in-test RPC assertion.
    4. Ingest FR-3/AC-3 as a separate final step.
  - Consumer-surface note (extends D-7): in the /trader ledger export, the correlation_id column (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature:40`) shows a poll-cycle id on mcp_client `ingest.signal.ingested` rows, not a request trace. RPC-path rows stay empty.
  - `/sdd-spec` must re-ground every cited line against `origin/main-dev` and peers 308, 309, 327 (`pnl_pattern_consumer.py`) and 328 (`mcp_client_loop.py:134-140`).
- **Strongest open objection.** None is blocking. The strongest is O-17: AC-3's Thens must stay observable-only, and the proposer has not confirmed the synthesis wording. It must be settled before `/sdd-spec` writes acceptance.feature, because promotion is whole-scenario and permanent. O-18 (append, not strip-and-replace) and O-19 (record the operator's rulings in the register and context.md) are also open and non-blocking.
- **Floor status.** No Floor breach.
- **Uncovered @AC changes.** @AC-1 and @AC-2 are CHANGE and are covered by the operator's C-16 sign-off. @AC-3 is an EXTEND, net-new to this feature and not covered; it needs C-15 traceability (@FR-3), not sign-off. Every other touched rule is a PRESERVE: @AC-8 and @AC-11 @feature-021, @AC-4 @feature-166, @AC-33 @feature-224, @AC-8 and @AC-14 to @AC-17 @feature-225, @AC-7 and @AC-9 @feature-259, and @AC-28, @AC-29, @AC-41 and @AC-53 @feature-294.
- **Where the rulings came from.** The operator's D-2 and D-9 rulings reached this step as workflow-computed text. P-1 to P-3 are not flipped here; the orchestrator records the rulings before `/sdd-spec` (O-19).

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

## Session 2026-11-20 — sdd-design (approved)

- Phase 0 Recon: recon.md was written on 2026-11-11 (services: xstockstrat-ingest, xstockstrat-analysis; xstockstrat-ledger reference only; key reuse patterns: the existing `AppendEventRequest.user_id` request field, and the empty-owner degrade branch in `_compose`).
- Phase 1 Grilling: 5 rounds (full). Chosen approach: ingest sets `AppendEventRequest.user_id=owner` and sends one per-cycle id through a keyword-only `trace_id` as both `correlation_id` and `x-trace-id` metadata; analysis adds `is_real_owner()` so a `system` owner degrades and opens no window. Rejected: R-1 to R-12 in debate.md (header forging, NULL-row backfill, inline `system` comparisons, two-parameter or correlation_id-only id passing, and the vacuous-test shapes).
- Constitution rules touched: C-11, C-14, C-15, C-16, C-18, F-09, P-02, P-03, P-06, PLAT-4. Floor breaches: none.
- Status: spec-ready → design-approved. design.md written; debate.md State is `approved`.
- Operator rulings, recorded 2026-11-20. They reached this step as workflow-computed text from the `/sdd-batch` gate:
  - REOPEN D-9 is granted (P-2). The RPC-level assertion is re-targeted as an extra assertion inside the AC-1 test; D-9's FR-1 loop narrowing stands (D-14).
  - REOPEN D-2 is granted (P-1 and P-3). The per-cycle id is sent as both `x-trace-id` metadata and `AppendEventRequest.correlation_id`, the existing idiom at `pnl_pattern_consumer.py:613,618` (D-17).
  - C-16 sign-off for this feature's @AC-1 and @AC-2. AC-2 wording: "Then the event is processed on its first attempt with no retry backoff".
  - Design APPROVED after round 5 under the operator's standing authorisation of the same day (round-5 adversary verdict SOUND, no Floor breach, no blocking objection, every C-16 CHANGE covered by a ruling).
  - Binding on the spec from the round-5 synthesis: AC-3's Thens are limited to the persisted `correlation_id` (the `x-trace-id` metadata is a plain test assertion); the core appends and does not strip-and-replace; the spy at `tests/test_mcp_client_loop.py:196-197` forwards `**kw`; the ledger-export consumer-surface note is recorded (round-5 session above).
- Register bookkeeping: P-1, P-2 and P-3 now read "user reopened". The gate step's generic instruction was to mark pending petitions "user declined"; that would contradict the rulings above, so they are recorded as reopened. No other register cell was changed: O-17, O-18 and O-19 still read "open", and D-2 / D-9 still read "reopened", not "superseded by D-17 / D-14".
- No ledger line: the debate surfaced no pattern or trap that is not already in recon.md or the ledger.

## Open Threads

- [ ] Register status cells lag the rulings (O-17, O-18, O-19 "open"; D-2 / D-9 "reopened"). The O-17 and O-18 fixes are binding by operator ruling regardless. Target: step 1 (docs).
- [ ] AC-3's wording becomes permanent at promotion. `/sdd-spec` must write the observable-only Thens into acceptance.feature, traced by `@FR-3` (C-15, not C-16). Target: step 1.
- [ ] Peer 328 edits `mcp_client_loop.py:134-140`; possible textual conflict in `poll_one_source` near `:140-160`. Target: `/sdd-spec` (re-ground step 4 against 328's branch).
- [ ] The `**kw` spy accepts any keyword, so a rename of `trace_id` would not fail the dedup test. The AC-3 `correlation_id` assertion is the guard. Target: step 4.
- [ ] Append-only metadata: a future caller passing both `trace_id` and an `x-trace-id` in `propagation_meta` would send two headers. The docstring constraint is the only guard. Target: step 4.
- [ ] The export's `correlation_id` column changes meaning on mcp_client rows (empty → poll-cycle id). `@AC-8 @feature-021` covers only the column's presence. Target: step 1 (context.md note).
- [ ] Line drift: recon's citations are stale (core moved from `servicer.py:1015` to `:1237`); "now" lines come from a `ccr-*` working tree. Target: `/sdd-spec` (re-ground against `origin/main-dev`).
- [ ] Re-expressing `owner_metadata` through `is_real_owner` touches a builder with 9+ callers. `tests/test_identity.py:13-36` stays unedited and green. Target: step 2.
- [ ] Marketdata's handling of a headerless `system` bars read is unverified; it sits inside `_compose`'s `try`, so the event degrades either way. Target: step 2.
- [ ] The ledger, analysis and peer-328 citations were not re-checked in round 5. Target: `/sdd-spec`.
- Next: `/sdd-spec fix-system-identity-paths`.

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
