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

## Session 2026-11-21 — operator ruling on AC-1 wording, recorded by the orchestrator (verbatim)

Question (handoff § 3.4): after the operator asked to see the wording first, the orchestrator showed AC-1 exactly as in acceptance.feature (`@AC-1 @regression`): "Given an mcp_client signal source registered by owner "user-a" / When one ingest.mcp_client.poll_interval_seconds cycle ingests a signal from it / Then the ingest.signal.ingested ledger event has user_id "user-a" / And ExportEvents called as "user-a" returns that event". "Confirm it as written?"

Operator's answer (option selected): "Confirm as written (Recommended)".

Effect: the spec-authored AC-1 `Then` wording is operator-confirmed; the Step 1 confirmation is cleared. The ingest-docs question (docs step vs recorded deviation, § 3.4) is still open.

## Session 2026-11-21 — operator ruling on the stale ingest docs, recorded by the orchestrator (verbatim)

Question (handoff § 3.4): "Feature 313: after its Steps 4 and 6, the ingest docs go stale (findings :38 and ingest CLAUDE.md :146 still describe the old system-owner behaviour). How should that be handled?"

Operator's answer (option selected): "Add a docs step (Recommended)".
Option text as offered: "Add a step to 313's spec that updates the ingest findings row and CLAUDE.md. Needs a small re-spec and impl-spec review before execute."

Orchestrator note (not an operator quote): 313 needs `/sdd-spec` re-spec for the added docs step and `/sdd-review impl-spec` before `/sdd-execute`. Not yet done. The doc line numbers cited above predate the 2026-11-21 main-dev sync; re-grep them.

## Session 2026-11-26 — sdd-spec re-spec (operator ruling: add ingest docs step)

- Re-spec of `implementation-spec.md` under the operator ruling of 2026-11-21 ("Add a docs step"). Status unchanged (`implementation-ready`); Total Steps 7 → 8. No code, proto, config or migration change.
- Added **Step 8 — docs** (`**TDD**: N/A (docs)`, Reviewers none, no `**Lands with**`), placed last because it documents Step 4 (owner stamp) and Step 6 (per-cycle `correlation_id`, proved by Step 7). Steps 1-7 are not renumbered and their bodies are untouched; the unit stays Steps 6+7 (cap of 4 respected).
  - `services/xstockstrat-ingest/docs/context-constitution-findings.md`: delete the `## Open questions` bullet "The `mcp_client` loop drives `_ingest_external_signal` with **no `propagation_meta`**" (`:38` on both trees) and add a `RESOLVED <landing date> ... (feature 313)` bullet at the top of `## Resolved`. The `## Filed as defect reports` row for the ownerless report (`:65`) stays: that file's own rule (`:59`) keeps a row until its report is resolved.
  - `services/xstockstrat-ingest/CLAUDE.md`: replace the `ingest.signal.ingested` row of `## Ledger Events Emitted` (`:185` on the branch, `:197` on main-dev; the ruling's `:146` matches neither) with text naming the owner (`AppendEventRequest.user_id`, both paths) and the loop-path per-cycle `correlation_id` (empty on the RPC path).
  - Checked and left alone: CLAUDE.md § Ownership (reserved `system` owner rules) and `docs/context-constitution.md` INGEST-12; neither describes behaviour Steps 4 or 6 change.
- Other edits to keep the spec coherent: `## Execution Summary` (one sentence), `## Step Dependencies` (Step 8 requires Steps 4 and 6; the "Steps 6-7 stay last" line now says "last code steps" and notes that only Step 8's per-cycle wording would change if FR-3 were ruled out; the old "Proposed, not specced" ingest-docs bullet is replaced by the ruling reference), `feature.md` (Artifacts step count, Reviewers snapshot row "Steps 1, 8 (docs)", Last Updated).
- Self-review (no subagent tool, so this was a self-review against `sdd-review/reference/impl-spec-criteria.md` B2/B2b/B3/B3b): Step 8 passes: evidence re-grepped on `origin/feature/fix-system-identity-paths@8c1db49e` and `origin/main-dev@2b2dec92`; Files are exact paths; Instructions cite only confirmed symbols (`_ingest_external_signal`, `poll_one_source`, both grep-found); Verification is runnable and was dry-run against the pre-edit tree (the open-question check fails there, as it should; the other checks return 0). B2b not triggered (no trading-domain terms). B3 and B3b: no migration/proto dependency, no code step without a test pair, no new atomic-unit trigger. Result: 0 failures, 0 new warnings; the pre-existing carried items below are unchanged.
- Open items:
  - [ ] AC-1 wording vs Step 1: the operator's "Confirm as written" (session 2026-11-21) was given on the text now in `acceptance.feature` (Then "the ingest.signal.ingested ledger event has user_id "user-a"" / And "ExportEvents called as "user-a" returns that event"). Step 1 still replaces those Thens with the AppendEvent-request wording ("the ingest.signal.ingested AppendEvent request carries user_id "user-a"" / "no x-user-id call metadata is sent with it"). Left as written per the ruling's "no change"; the operator or `/sdd-review impl-spec` must reconcile which text lands in Step 1 before it executes.
  - [ ] Analysis findings go stale after Steps 2-3 (`services/xstockstrat-analysis/docs/context-constitution-findings.md:24` latent-bug row and `:32` open question). The ruling named only the ingest docs, so no step covers them. Target: operator.
  - [ ] The bracketed "main-dev `:N`" hints in Steps 4 and 6 predate main-dev moving again: `_ingest_external_signal` is now `servicer.py:1346` and the `ingest.signal.ingested` emit `:1507` on `origin/main-dev@2b2dec92`. Steps 4 and 6 carry a re-grep instruction; no edit made. Merge `main-dev` (21 commits ahead, `servicer.py` and `test_ingest_servicer.py` among the changes) before executing.
  - [ ] Step 8 wording of the per-cycle id depends on FR-3 holding; if FR-3 is ruled out, record it in the Deviation Log (F-09).
  - [ ] Still open from earlier sessions: `**kw` spy rename risk (Step 7), the two-header residual (Step 6), merge-order row for 313/309, the missing `scripts/check-duplication.py` on the branch base.
- Next: `/sdd-review fix-system-identity-paths impl-spec`, then `/sdd-execute fix-system-identity-paths`.

## Session 2026-11-26 — operator ruling on AC-1 text, recorded by the orchestrator (verbatim)

Question: "Which text should land? (confirmed text vs AppendEvent-request wording)"

Operator's answer (option selected): "Keep the confirmed text (Recommended)" — option text as offered: "AC-1 stays exactly as you confirmed (ledger event user_id + ExportEvents). I amend Step 1 so it does not rewrite the Thens; the AppendEvent-request assertion moves into the test, not the scenario."

What changed in `implementation-spec.md` (sdd-spec amendment, same date):
- Step 1: `@AC-1` keeps its Given/When/Then/And byte-for-byte ("the ingest.signal.ingested ledger event has user_id "user-a"" / "ExportEvents called as "user-a" returns that event"); only the `@FR-1` tag is added (tag, not wording; needed for C-15 FR traceability). The `PRESERVE @AC-11 @feature-021` comment that existed only for the rewording is dropped. The `@AC-2` rewording and `@AC-3` are unchanged. The context.md fold-in, the Verification greps (the `ExportEvents called as` negative check becomes a positive check, plus a negative check for the AppendEvent wording and the dropped comment) and the Execution Summary were updated to match.
- Step 1 also marks `debate.md` D-8 (`superseded by operator ruling 2026-11-26`) and O-1 (`reopened and closed @ 2026-11-26`), the two register rows that recorded the AC-1 rewording as settled.
- Step 5: the `AppendEventRequest.user_id` and no-`x-user-id`-metadata assertions stay in the test and are now described as plain test assertions, not scenario Thens. Evidence added: AC-1's ExportEvents Then rests on the unchanged ledger code and tests (`@AC-11 @feature-021`, `ledgerServiceImpl.test.ts:675,691,709`).
- Step Dependencies: Step 5 no longer depends on Step 1's wording.
- Open items:
  - [ ] `design.md` "Business Rules Touched" (CHANGE `@AC-1`, and C-16 line) still records the AC-1 rewording; design.md was not edited. Superseded by this ruling.
  - [ ] AC-1's ExportEvents Then is not executed by any ingest test; it is carried by existing ledger tests. Accepted by the ruling; flagged for `/sdd-review impl-spec`.
  - [ ] The `@FR-1` tag on `@AC-1` is the only edit to the confirmed scenario; confirm it is acceptable.
  - The open item "AC-1 wording vs Step 1" of the 2026-11-26 sdd-spec re-spec entry above is resolved by this entry.

## Session 2026-11-26 — independent impl-spec review (spec-reviewer), recorded by the orchestrator

- Verdict: PASS WITH WARNINGS, no blockers. Fixes applied (nothing else changed; no operator question needed):
  - `design.md`: a one-line HTML-comment supersession note ("Superseded 2026-11-26 by operator ruling: AC-1 stays as confirmed (PRESERVE); only AC-2 is reworded.") at the three places that record the AC-1 rewording: Build order step 1, the `C-16` "honored by" line, and the `CHANGE @AC-1` line under Business Rules Touched. design.md is not in Step 1's Files; the edit is recorded here only.
  - AC-1 Then 2 delegation: `@AC-1`'s ExportEvents Then is run by no ingest test. Recorded in Step 1 item 4 (the context.md fold-in) and as a test-comment instruction in Step 5: "AC-1 Then 2 is covered by ledger @AC-11 @feature-021 plus ledgerServiceImpl.test.ts:675-709 (owner precedence) and the WHERE user_id = $1 predicate at ledgerServiceImpl.ts:404, not here". `:404` verified on both `origin/feature/fix-system-identity-paths` and `origin/main-dev@2b2dec92`; the Execution Summary citation `:373` (a comment) was changed to `:404`. Step 5 also tells `/sdd-execute` the promoted scenario must not be claimed as fully ingest-tested.
  - Header: the Evidence-tree paragraph now says the "main-dev `:N`" hints come from two tips (`fb52065c` for Steps 1/4/6/7, `2b2dec92` for Step 8) and are advisory (edit by symbol, re-grep at BRANCH SYNC). The stale "only `servicer.py` has moved" claim is replaced: at `2b2dec92` ingest `servicer.py`, `tests/test_ingest_servicer.py` and `CLAUDE.md` differ from the branch, while `mcp_client_loop.py`, `tests/test_mcp_client_loop.py`, analysis `identity.py`, `pnl_pattern_consumer.py` and their tests do not (checked with `git diff --stat HEAD...origin/main-dev`).
  - C-14: `## Step Dependencies` gains "No UI/ledger step by design (D-7): the `/trader` ledger export route has no event-type allowlist and the ledger scopes the export to the caller; the `correlation_id` meaning change is recorded in context.md."
  - Step 1 Verification gains a check that the only `@AC-1` delta against the pre-step file is the `@FR-1` tag line (a `diff` of the `@AC-1` block; simulated on the current tree: exactly one changed line).
- Open items carried: the `**kw` spy rename risk (Step 7), the two-header residual (Step 6), the analysis findings `:24`/`:32` that Steps 2-3 make stale (no step), the merge-order row for 313/309, the missing `scripts/check-duplication.py` on the branch base (merge `main-dev` first).

## Session 2026-11-26 — sdd-execute sequential (sdd-batch-execute)

- Up-front confirmation (operator-approved plan, binding record, verbatim): `{"mainDev":"f802b184b13bd899d858c4b0349a616e9981b9d9","dev":"72eecaaca38c7715d20484911283b8502f001442","specHash":"98ea87c10fa0cef7027661b6f4b39efb57385351","directive":"conditional","pending":[1,2,3,4,5,6,7,8],"mismatches":[{"n":1,"detail":"All 4 Files exist. Every Codebase Evidence claim checks out: acceptance.feature has @AC-1/@AC-2 only, no @FR tags, and the old Thens at :18-19; product-spec has no FR or Consumer Surface section and contains 'metadata=None' (:16) and 'optionally a trace id is "},{"n":2,"detail":"Both Files exist and all pnl_pattern_consumer.py and identity.py anchors match exactly (:3, :6-10, :35, :348, :358, :388, :532, :539, :541, :546-548, :566-569, _POISON :65-73 with ValueError, _process_with_retry :228, the _emit request with no user_id). is_rea"},{"n":3,"detail":"File exists and all test_pnl_pattern_consumer.py anchors match (:33, :122, :158, :214, :234 owner u-1, :273, :328-336, :443 with metas, :461, :474, :483-486, :515); no '\"system\"' match; asyncio_mode at pyproject.toml:33. Mismatches: (a) test_ac17_ownerless_ord"},{"n":4,"detail":"File exists. All servicer.py anchors moved after the main-dev merge and match neither the branch number nor the main-dev hint. The spec allows this because edits go by symbol, and the content is unchanged: _ingest_external_signal is at :1346-1348 (hints 1015 a"},{"n":5,"detail":"File exists. Helpers match: :20-22, :25, :32, :62, :80 (owner seed-user), :173, :338, :426, :465. test_signal_ownership.py :20, :28, :123-139 and :138 match. Mismatches: (a) make_servicer's AppendEvent AsyncMock is at test_ingest_servicer.py:70, not :64-65 (th"},{"n":6,"detail":"Both Files exist. mcp_client_loop.py anchors match exactly: imports asyncio/json/logging/time at :13-16 with no uuid; poll_one_source :116; owner :123; split_credentials_ref :140; for item in parsed :156; the per-item call :158-160 with owner=owner; except :16"},{"n":7,"detail":"File exists. The spy at :194-197 and assertions through :211-212 match; mcp-client-signal-source.feature:32-33 is @AC-4 @FR-4 @feature-166; the except at mcp_client_loop.py:163 and _build_external_signal source=slug at :88-91 match; no correlation_id grep hit "},{"n":8,"detail":"Both Files exist and every anchor matches the main-dev form: the findings open-question bullet is at :38 under '## Open questions' :34; '## Resolved' is at :41 with RESOLVED 2026-11-10 bullets from :43; '## Filed as defect reports' is at :56, the 'A row stays "}]}`
- Merged `origin/main-dev` `f802b184` into the branch (`ae6397eb`; resolver: nothing to resolve; ledger-guard clean).
- Tooling (steps 1-8): python 3.13 ✓ · uv ✓ 0.11.32 · ruff/pytest via per-step `uv sync --extra dev` · docs steps need nothing. Hook check hook=0.
- Re-spec (directive conditional, step bodies only; line-number hints re-grepped on the merged tree, no instruction changed in substance): `43bd8d75` respec(fix-system-identity-paths): align steps 1,2,3,4,5,6,7,8 with current codebase.

```sdd-batch-setup
{"mainDev":"f802b184b13bd899d858c4b0349a616e9981b9d9","date":"2026-11-26"}
```

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), step 1

### Step 1 — docs: acceptance scenarios, FR-1 to FR-3, consumer surface and register cells [done]
- `acceptance.feature`: `@AC-1` gains only the `@FR-1` tag (Given/When/Then/And byte-for-byte, rulings of 2026-11-21 and 2026-11-26); `@AC-2` reworded and tagged `@FR-2`; new `@AC-3 @FR-3`. `product-spec.md`: FR-1 to FR-3, `## Consumer Surface(s)`, the D-12 drift fix ("an empty `propagation_meta` list"), the `**Expected**` per-cycle wording, Open Questions 1-3 marked resolved (D-17, D-5, D-6). `debate.md`: status cells only (D-2 → superseded by D-17, D-8 → superseded by operator ruling 2026-11-26, D-9 → superseded by D-14, O-1 reopened and closed @ 2026-11-26, O-17/O-18/O-19 closed @ round 5).
- Consumer surface (C-14, extends D-7): the `/trader` ledger export. No UI or ledger code change. In that export the `correlation_id` column (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature:40`) shows a poll-cycle id on `mcp_client` `ingest.signal.ingested` rows, not a request trace; RPC-path rows stay empty. The analysis change is internal-only.
- A later `portfolio.position.closed` for a `system` owner is a no-op: no window was opened, so `seal` finds no row (D-4).
- `@AC-2` rewording (pre-design Thens "_compose does not raise" / "marked degraded" replaced by the observable Thens; first Then is the operator's wording verbatim) rests on the operator's C-16 sign-off of 2026-11-20 (session "2026-11-20 — sdd-design (approved)"). `@AC-1`'s text was kept as confirmed (rulings of 2026-11-21 and 2026-11-26). Its second Then (ExportEvents) is run by no ingest test: it is delegated to ledger `@AC-11 @feature-021`, `ledgerServiceImpl.test.ts:675-709` and the `WHERE user_id = $1` predicate at `ledgerServiceImpl.ts:404` (Step 5 carries the matching test comment).
- TDD: N/A (docs). Verification `.sdd-logs/v-1.log` `exit=0`: the `@AC-1` block diff is the one line `@AC-1 @regression` → `@AC-1 @FR-1 @regression`; product-spec shows FR-1/FR-2/FR-3 at `:34-36` and `## Consumer Surface(s)` at `:69`; debate.md counts 2 / 2. Config-key wiring gate not applicable (no config key).
- Discovery notes: the FR-N form precedent `docs/roadmap/features/307-ui-env-themed-bundles/product-spec.md` no longer exists (307 archived, `662413d7`); the same `FR-N.` form was taken from `docs/roadmap/features/280-third-party-sso-oidc/product-spec.md:17`. D-12's line is `servicer.py:1355` on this tree, as the spec says.
- Files modified: `docs/roadmap/features/313-fix-system-identity-paths/acceptance.feature`, `docs/roadmap/features/313-fix-system-identity-paths/product-spec.md`, `docs/roadmap/features/313-fix-system-identity-paths/debate.md`, `docs/roadmap/features/313-fix-system-identity-paths/context.md`
- Deviations: none

## Open Threads

- [x] Register status cells lag the rulings (O-17, O-18, O-19; D-2 / D-9). Closed by Step 1.
- [x] AC-3's observable-only Thens written into acceptance.feature, traced by `@FR-3`. Closed by Step 1.
- [x] The export's `correlation_id` meaning change on mcp_client rows is recorded (Step 1 consumer-surface note above).
- [ ] The `@AC-3` PRESERVE comment (spec text, landed verbatim) places `@AC-41 @feature-294` in `services/xstockstrat-ingest/acceptance/signal-map-instrumentation.feature`; that file holds `@AC-28`, `@AC-29` and `@AC-53` only. `@AC-41 @FR-15 @feature-294` is at `docs/sdd/business-rules/platform.feature:1346`. Target: operator (reword the comment before C-16 promotion, or leave it).
- [ ] Carried: `**kw` spy rename risk (Step 7), two-header residual (Step 6), analysis findings `:24`/`:32` stale after Steps 2-3 (no step), merge-order row for 313/309.

## Session 2026-11-27 — Verification block fixes (operator ruling precedent from 316), recorded by the orchestrator

Defect class (reported by the batch executor on Step 2): a leading `cd services/<svc> && ...` persists in the shell, so the following root-relative lines ran inside the service directory (the `git diff --stat HEAD -- <file>` printed nothing either way; the `grep -n ... services/...` failed with "No such file or directory"). Ruling: the 2026-11-26 operator precedent from feature 316 ("Re-spec the Verification first": one subshell per `cd`, non-failing count checks, then re-run the step verbatim) applies to 313. Only Verification blocks of the pending Steps 2-8 changed; no scope, instruction, evidence or done step (Step 1) was touched.

Fixes, applied identically to every pending block:
- Every `cd services/<svc> && ruff ... && pytest ...` became `( cd services/<svc> && ... )`; all other lines run from the repo root.
- Step 2: old `git diff --stat HEAD -- .../tests/test_identity.py` (vacuous once committed, empty regardless) became `test -z "$(git diff --stat "$(git merge-base HEAD origin/main-dev)" -- .../tests/test_identity.py)"`; old `grep -n "is_real_owner" identity.py pnl_pattern_consumer.py  # 2 + 4 lines` became two `test "$(grep -c ...)" = 2` / `= 4` checks.
- Step 3: old trailing `grep -n "def .*fixture\|from .conftest\|conftest" .../test_pnl_pattern_consumer.py` (exit 1 on the expected no-match) became `test "$(grep -c ...)" = 0`.
- Step 4: old `grep -n -A6 'event_type="ingest.signal.ingested"' ... | grep -n "user_id=owner"` became a count check `= 1` over `-B3 -A8` (the instruction does not fix where `user_id=owner,` sits in the request).
- Step 5: old `grep -n "from tests.test_signal_ownership import\|from tests.conftest import" ...` became `test "$(grep -c ...)" = 2`.
- Step 6: old `grep -n "trace_id" servicer.py mcp_client_loop.py` (passes if either file matches) became one `grep -q` per file; old `grep -n "x-user-id" mcp_client_loop.py  # no new match` (exit 1 on the expected result) became `test "$(grep -c ...)" = 0`.
- Step 7: old `grep -n "async def spy" -A2 ...` (prints, always passes) became two `test "$(grep -c ...)" = 1` checks on the exact spy signature and the forwarded `orig(signal, propagation_meta, owner=owner, **kw)` call.
- Step 8: each `grep -c ... # N` became `test "$(... | grep -c ...)" = N`; old `git diff --name-only HEAD -- services/` (empty once steps are committed, and it would also list Steps 4-7's files) became a diff against the merge-base with main-dev, scoped to `services/xstockstrat-ingest/docs` and `services/xstockstrat-ingest/CLAUDE.md`, compared with the two expected paths.
- Merge-base is used in place of bare `origin/main-dev` because the branch is not always synced to `main-dev` (Step 8's evidence records `CLAUDE.md` differing between the two trees).

Steps fixed: 2, 3, 4, 5, 6, 7, 8. Re-run Step 2 onward with the updated blocks verbatim.

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), step 2

- Tooling (step 2): uv ✓ 0.11.32 · `uv sync --extra dev` in `services/xstockstrat-analysis` ⬇ (the service `.venv` resolved Python 3.12, not the 3.13 pin) · ruff ✓ 0.16.9 (host; CI installs unpinned `ruff`) · pytest ✓ (service `.venv`, put first on `PATH` for each run). Hook check hook=0.

### Step 2 — service: a `system` owner degrades in the P&L consumer [done]
- Added `is_real_owner(owner)` to `app/identity.py` (no import added); `owner_metadata`'s guard now calls it, with the raise, message and return unchanged. `pnl_pattern_consumer.py` uses it at the import, the `_compose` `meta` line (still outside the `try`), the `_compose` degrade branch, and the `_handle_order_event` window guard (ruff format wrapped that guard onto three lines). `_POISON`, `_process_with_retry`, `_synth_position_id`, `_handle_close_event` and the other `SYSTEM_IDENTITY` users are unchanged.
- TDD (no `**Covers**`; AC-2's own test is Step 3). RED: Verification run `.sdd-logs/v-1.log` `exit=1`. ruff and the 77 tests passed, and the final `is_real_owner` count check failed because the predicate did not exist yet. A behaviour probe outside the repo (the AC-2 shape: `_process_with_retry` on `{**ORDER_PAYLOAD, "user_id": "system"}` with the `sleeps` patch, not committed) failed with `Expected mock to not have been awaited. Awaited 2 times.` and logged `attempt 3/3 failed: ValueError("owner-scoped call needs a real owner, got 'system'")` and then `parking event seq=1`. GREEN: `.sdd-logs/v-2.log` `exit=0`: `All checks passed!`, `143 files already formatted`, `77 passed`. The same probe passed (`1 passed`). Full suite `pytest --cov=app --cov-fail-under=40`: `1826 passed`, `Total coverage: 91.89%`.
- The block reports only its last line's status, so the two other root-level checks were run separately: the `test_identity.py` diff against merge-base `f802b184` is empty, and the counts are `identity.py:2` and `pnl_pattern_consumer.py:4`.
- Config-key wiring gate: not applicable (no config key).
- Files modified: `services/xstockstrat-analysis/app/identity.py`, `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py`
- Deviations: none

## Open Threads

- [ ] The Step 2 Verification block's `exit=` reflects only its last command (no `set -e`), so an earlier `test` line failing would not change it. Steps 3-8 share the shape. Target: operator, or the executor re-checking each line as done here.
- [ ] Step 3 RED must run on the pre-Step-2 tree (its instruction 4). Step 2 is now on the branch, so on the current tree the new test passes at once. The probe output above shows the expected RED message. Target: Step 3.
- [ ] Carried: `@AC-3` PRESERVE comment file placement (operator), `**kw` spy rename risk (Step 7), two-header residual (Step 6), analysis findings `:24`/`:32` stale after Steps 2-3 (no step), merge-order row for 313/309.

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), step 3

- Tooling (step 3): uv ✓ · `uv sync --extra dev` in `services/xstockstrat-analysis` ⬇ (the `.venv` resolved Python 3.12.3, not the 3.13 pin, as in Step 2) · ruff ✓ (host) · pytest ✓ (service `.venv`, put first on `PATH` for each run). Hook check hook=0.

### Step 3 — test: AC-2, a system-owned order event is processed on its first attempt [done]
- Added `test_feature313_ac2_system_owned_order_event_degrades_on_first_attempt(sleeps)` after the feature-259 helpers in `tests/test_pnl_pattern_consumer.py`. It drives `_process_with_retry` on `{**ORDER_PAYLOAD, "user_id": "system"}`, uses `_MetaRecordingComposer` and the real `_compose`/`owner_metadata`, and spies on `process_event`. It asserts no awaited sleep, one run, one snapshot with empty indicators and signals, degraded and not captured, no window, no park, `metas == {"ohlcv": []}` and `pool.cursor == 1`.
- TDD: AC-2 red: `sleeps.assert_not_awaited()` failed → green: passed. RED was run on the pre-Step-2 tree by checking out the two Step 2 app files from `878bd1a0^` into the worktree for one run, then restoring them from `HEAD` (empty diff confirmed before GREEN). RED `.sdd-logs/v-1.log`: `AssertionError: Expected mock to not have been awaited. Awaited 2 times.`, with `attempt 1/3`, `2/3` and `3/3 failed: ValueError("owner-scoped call needs a real owner, got 'system'")` and `parking event seq=1`; `1 failed, 50 deselected`. GREEN `.sdd-logs/v-2.log` `exit=0`: `All checks passed!`, `143 files already formatted`, `1 passed, 50 deselected`, `1827 passed`, `Total coverage: 91.89%`. The block's `exit=` reflects only its last line (the C-13 count check, `= 0`); the earlier lines were confirmed from the log.
- C-13: the `system` payload is a single-consumer inline spread; no fixture or conftest entry added.
- Config-key wiring gate: not applicable (no config key).
- Files modified: `services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py`
- Deviations: none

## Open Threads

- [x] Step 3 RED on the pre-Step-2 tree. Closed by Step 3 (see above).
- [ ] Carried: Verification `exit=` reflects only the last line (Steps 4-8), `@AC-3` PRESERVE comment file placement (operator), `**kw` spy rename risk (Step 7), two-header residual (Step 6), analysis findings `:24`/`:32` stale after Steps 2-3 (no step), merge-order row for 313/309.

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), step 4

- Tooling (step 4): uv ✓ 0.11.32 · `uv sync --extra dev` in `services/xstockstrat-ingest` ⬇ (the `.venv` resolved Python 3.12.3, not the 3.13 pin, as in Steps 2-3) · ruff ✓ 0.16.9 (host) · pytest ✓ (service `.venv`, put first on `PATH` for each run). Hook check hook=0.

### Step 4 — service: stamp the owner on the `ingest.signal.ingested` ledger event [done]
- Added `user_id=owner,` after `payload=payload,` in the `ingest.signal.ingested` `AppendEventRequest` of `_ingest_external_signal` (re-grepped anchor: `event_type=` at `servicer.py:1507`). `metadata=propagation_meta`, the other `AppendEventRequest` sites (`servicer.py:648`, `app/admin_audit.py:29`) and both callers are unchanged; no `x-user-id` entry built.
- TDD (no `**Covers**`; AC-1's test is Step 5). RED: Verification `.sdd-logs/v-1.log` `exit=1` (ruff `All checks passed!`, `58 files already formatted`, `246 passed`; the final `user_id=owner` count check failed). A behaviour probe outside the repo (`_ingest_external_signal(..., owner="user-a")` with no `propagation_meta`, the loop shape, via the `test_signal_ownership.py` helpers; not committed) failed with `AssertionError: assert '' == 'user-a'`. GREEN: `.sdd-logs/v-2.log` `exit=0`: `All checks passed!`, `58 files already formatted`, `246 passed`; the probe passed (`1 passed`). Full suite `pytest --cov=app --cov-fail-under=40`: `622 passed`, `Total coverage: 87.68%`.
- Config-key wiring gate: not applicable (no config key).
- Files modified: `services/xstockstrat-ingest/app/handlers/servicer.py`
- Deviations: none

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), step 5

- Tooling (step 5): uv ✓ · `uv sync --extra dev` in `services/xstockstrat-ingest` ⬇ · ruff ✓ 0.16.9 (host) · pytest ✓ (service `.venv`, put first on `PATH` for each run). Hook check hook=0.

### Step 5 — test: AC-1, the loop's ledger event is owner-stamped [done]
- Added `test_feature313_ac1_loop_signal_event_is_owner_stamped(monkeypatch)` after `test_second_identical_cycle_deduplicates`. Loop half: one `_mcp_source(user_id="user-a")`, `_item()`, a dedup-miss `transaction_conn` (one `db.fetchrow` row, two `conn.fetchrow` rows), the real `_ingest_external_signal` via `run_one_cycle`; asserts `event_type == "ingest.signal.ingested"`, `user_id == "user-a"` and no `x-user-id` in the call metadata, with the AC-1 Then 2 delegation comment. RPC half (untraced incidental hardening, no AC-33 claim): `_fresh_ingest_svc(11)` + `IngestSignal(_signal_req("motley-fool"), _ctx("0", user_id="alice"))` → `user_id == "alice"`. Imports `_ctx` from `tests.conftest` and `_fresh_ingest_svc`, `_signal_req` from `tests.test_signal_ownership` (C-13: no copies, no new domain literal). The promoted `@AC-1` is not fully ingest-tested: its ExportEvents Then rests on the ledger tests named in the comment.
- TDD: AC-1 red: `assert '' == 'user-a'` failed → green: passed. Step 4 was already on the branch, so RED ran on the pre-Step-4 tree by checking out `services/xstockstrat-ingest/app/handlers/servicer.py` from `5ac54339^` for one run, then restoring it from `HEAD` (only the test file differed before GREEN). RED `.sdd-logs/v-1.log`: `AssertionError: assert '' == 'user-a'` at `tests/test_mcp_client_loop.py:235`, `1 failed, 22 deselected` (its `exit=0` is the last line, the C-13 count check). GREEN `.sdd-logs/v-2.log` `exit=0`: `All checks passed!`, `58 files already formatted`, `1 passed, 22 deselected`, `623 passed`, `Total coverage: 87.68%`; the C-13 import count is 2.
- Config-key wiring gate: not applicable (no config key).
- Files modified: `services/xstockstrat-ingest/tests/test_mcp_client_loop.py`
- Deviations: none

## Open Threads

- [ ] Carried: Verification `exit=` reflects only the last line (Steps 6-8), `@AC-3` PRESERVE comment file placement (operator), `**kw` spy rename risk (Step 7), two-header residual (Step 6), analysis findings `:24`/`:32` stale after Steps 2-3 (no step), merge-order row for 313/309.

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), steps 6+7

- Tooling (steps 6+7): uv ✓ 0.11.32 · `uv sync --extra dev` in `services/xstockstrat-ingest` ⬇ (`.venv` on Python 3.12, as in Steps 2-5) · ruff ✓ 0.16.9 (host) · pytest ✓ 9.0.3 (service `.venv`, put first on `PATH` for each run). Hook check hook=0.
- Anchors re-grepped before editing (Step 6 instruction 0): `_ingest_external_signal` at `servicer.py:1346`, the `ingest.signal.ingested` emit at `:1507` (with Step 4's `user_id=owner`), `for item in parsed:` at `mcp_client_loop.py:156`, the per-item call at `:158`, the spy at `tests/test_mcp_client_loop.py:198-199`. No peer (309, 328) edit present.

### Step 6 — service: one per-cycle id, sent as `correlation_id` and `x-trace-id` [done] (atomic unit Steps 6+7)
- `_ingest_external_signal` gains the keyword-only `trace_id: str = ""` after `owner`, plus a two-line docstring constraint. On the `ingest.signal.ingested` request only, it adds `correlation_id=trace_id`. Its `AppendEvent` metadata is `[*propagation_meta, ("x-trace-id", trace_id)] if trace_id else propagation_meta`: append only, `propagation_meta` is not mutated, and with no `trace_id` the request and metadata are what Step 4 left (R-9). `mcp_client_loop.py` adds `import uuid`, mints `str(uuid.uuid4())` once before `for item in parsed:` and passes it as `trace_id=`. There is no `propagation_meta`, no `x-user-id`, and no id goes to the metric or tick helpers. The RPC caller is unchanged.
- TDD: Step 6 has no `**Covers**`; the unit's RED is Step 7's AC-3 test (below).
- Config-key wiring gate: not applicable (no config key).
- Files modified: `services/xstockstrat-ingest/app/handlers/servicer.py`, `services/xstockstrat-ingest/app/engine/mcp_client_loop.py`
- Deviations: none

### Step 7 — test: AC-3, per-source per-cycle `correlation_id`, and the spy fix [done] (atomic unit Steps 6+7)
- Spy fix (D-19): `spy(signal, propagation_meta=None, owner=None, **kw)` forwards `**kw` to `orig`; nothing else in `test_second_identical_cycle_deduplicates` changed. Added `test_feature313_ac3_cycle_signals_share_a_per_source_correlation_id(monkeypatch)` after the Step 5 test.
  - Setup: two `_mcp_source(...)` rows owned by `user-a` (`alpha-mcp`, `beta-mcp`), and the MCP fake returning `[_item("AAPL"), _item("MSFT")]`. A dedup-miss `transaction_conn` holds four `db.fetchrow` and eight `conn.fetchrow` rows, and the real core runs.
  - Assertions: exactly four `ingest.signal.ingested` calls, and one distinct non-empty `correlation_id` per `payload["source"]`. The two ids differ, and no `x-user-id` is in the metadata. For every call, `("x-trace-id", correlation_id)` is in the metadata exactly once.
  - RPC path: `IngestSignal` with `_ctx` (inbound `x-trace-id: t1`) gives `correlation_id == ""`.
- TDD: AC-3 red: `assert ('x-trace-id', '') in []` failed → green: passed.
  - RED (`.sdd-logs/v-1.log`, Step 7 block, pre-Step-6 tree with the test and spy fix applied) failed at `tests/test_mcp_client_loop.py:273`, `1 failed, 1 passed, 22 deselected`. The `len(calls) == 4` assertion passed first, so the RED is the missing id, not a vacuous harness. The log's `exit=0` is its last line, the spy count check.
  - GREEN, Step 6 block (`.sdd-logs/v-2.log`, `exit=0`): `All checks passed!`, `58 files already formatted`, `253 passed`.
  - GREEN, Step 7 block (`.sdd-logs/v-3.log`, `exit=0`): `2 passed, 22 deselected`, `624 passed`, `Total coverage: 87.69%`.
  - Each block reports only its last line's status, so the root-level lines were re-run one at a time: both `trace_id` greps rc 0, the `x-user-id` count in `mcp_client_loop.py` is 0, and both spy counts are 1.
- C-13: all domain data comes from `_mcp_source()` and `_item()`, and the RPC half reuses `_fresh_ingest_svc`, `_signal_req` and `_ctx` (already imported by Step 5).
- Config-key wiring gate: not applicable (no config key).
- Files modified: `services/xstockstrat-ingest/tests/test_mcp_client_loop.py`
- Deviations: none

## Open Threads

- [ ] `**kw` spy rename risk: accepted by D-19; the AC-3 `correlation_id` assertion is the guard. Two-header residual: the docstring constraint plus AC-3's one-`x-trace-id` assertion cover today's loop caller only.
- [ ] Carried: Verification `exit=` reflects only the last line (Step 8), `@AC-3` PRESERVE comment file placement (operator), analysis findings `:24`/`:32` stale after Steps 2-3 (no step), merge-order row for 313/309.

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), step 8

- Tooling (step 8): docs step, none needed. Hook check hook=0.
- Anchors re-grepped (instruction 0): the open-question bullet at `context-constitution-findings.md:38` (under `## Open questions` `:34`, `## Resolved` `:41`), the event row at `CLAUDE.md:197`; `_ingest_external_signal` at `servicer.py:1346` (with `correlation_id=trace_id` at `:1514`), `poll_one_source` at `mcp_client_loop.py:117` (hint `:116`; the mint is at `:157`). The ingest docs had no diff against merge-base `f802b184` before the edit.

### Step 8 — docs: ingest findings row and CLAUDE.md event row after Steps 4 and 6 [done]
- `services/xstockstrat-ingest/docs/context-constitution-findings.md`: deleted the "no `propagation_meta`" open question and added `RESOLVED 2026-11-27 — ... (feature 313)` as the first `## Resolved` bullet, using the spec text verbatim. The `## Filed as defect reports` ownerless row stays: its report sidecar flips through `/sdd-triage backmerge`. `services/xstockstrat-ingest/CLAUDE.md`: replaced the `ingest.signal.ingested` row with the spec text. No other line changed.
- TDD: N/A (docs). Verification `.sdd-logs/v-1.log` `exit=0` (empty log). The block reports only its last line, so each line was re-run alone: the open-questions `propagation_meta` count is 0, the `RESOLVED .*feature 313` count is 1, the defect-row count is 1, the CLAUDE.md `user_id.*correlation_id` count is 1, and the merge-base diff lists exactly the two Files.
- All-done gate: `node scripts/check-config-wiring.mjs --final` `.sdd-logs/v-2.log` `exit=0`. It printed only two baseline lines from other features, `REPORTED: services/xstockstrat-analysis/app/engine/fundsignal_loop.py:marketdata/fundamentals.provider:readers-disagree` and `REPORTED: services/xstockstrat-trading/internal/service/trading.go:platform/trading_state:readers-disagree`. This feature declares no config key. Status in-progress → code-completed.
- No insights ledger line: nothing generalizes beyond what the ledger already holds.
- Files modified: `services/xstockstrat-ingest/docs/context-constitution-findings.md`, `services/xstockstrat-ingest/CLAUDE.md`
- Deviations: none

## Open Threads

- [ ] `implementation-spec.md` header `**Status**` still reads `pending` (no step flipped it). SESSION-END SUMMARY sets it to `complete`. Target: orchestrator, per-feature session-end summary.
- [ ] Carried: `@AC-3` PRESERVE comment file placement (operator), analysis findings `:24`/`:32` stale after Steps 2-3 (no step), merge-order row for 313/309, `**kw` spy rename risk and the two-header residual (accepted, D-19).

## Session 2026-11-27 — sdd-batch-execute promotion plan (awaiting operator confirm)

- Branch check (`origin/feature/fix-system-identity-paths` at `5e54f560`): `acceptance.feature` holds @AC-1/@AC-2/@AC-3 with `@FR-*` tags. Its AC-2 and AC-3 match the blocks below. Its AC-1 still has the old Thens ("ledger event has user_id", "ExportEvents called as "user-a" returns that event"), so per the plan the AC-1 wording goes to the operator before anything is promoted. Nothing was written to any durable suite.

```sdd-batch-promotion-plan
> CORRECTED 2026-11-27 by the orchestrator under the operator ruling "Branch text, fix the cite": @AC-1 below is the branch
> acceptance.feature text verbatim (operator rulings 2026-11-21 and 2026-11-26: keep @AC-1 as written; the reworded AC-1 in the
> earlier plan is withdrawn), and the @AC-3 PRESERVE comment cites platform.feature for @AC-41. Nothing else changed.
## Promotion plan — fix-system-identity-paths (feature 313)

### BLOCKER TO CLEAR BEFORE WRITING (source-of-truth gap)
I am read-only with no git access, so I could not read `origin/feature/fix-system-identity-paths:docs/roadmap/features/313-fix-system-identity-paths/acceptance.feature`. The copies I could read disagree:
- The main working tree (`/home/user/xstockstrat/docs/roadmap/features/313-fix-system-identity-paths/acceptance.feature`) is the stale pre-Step-1 file: 2 scenarios (@AC-1, @AC-2), no `@FR-*` tags, no @AC-3. Do NOT promote from it. Its AC-2 Then "_compose does not raise" is an implementation step that design D-15 and R-7 rejected, and promotion is permanent.
- The worktree copies `/home/user/xstockstrat/.claude/worktrees/wf_fbbc69a4-10e-11`, `wf_f74e1465-c7b-6` and `wf_a4649d74-1f8-5` hold 3 scenarios with `@FR-*` tags, the reworded AC-2 and the new AC-3. Their AC-1 still has the old Thens ("ledger event has user_id", "ExportEvents called as user-a returns that event").
- `implementation-spec.md` Step 1 (lines 130-163) specifies a reworded AC-1: "the ingest.signal.ingested AppendEvent request carries user_id "user-a"" and "no x-user-id call metadata is sent with it". `context.md` lines 1044, 1061 and 1070 say this wording is spec-authored and still needs operator confirmation.

The blocks below use the Step 1 text, which is the design-approved, C-16-signed-off shape. Before writing, the orchestrator must compare the AC-1, AC-2 and AC-3 steps with `git show origin/feature/fix-system-identity-paths:docs/roadmap/features/313-fix-system-identity-paths/acceptance.feature`. If the reviewed branch text differs, substitute the branch's step text verbatim. Rule 2 (verbatim, never invented) outranks the blocks here. If the branch AC-1 still has the old Thens, flag that to the operator rather than promoting the un-asserted ExportEvents Then (design R-7/O-17).

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| @AC-1 (@FR-1) mcp_client loop signal events are owner-stamped in the ledger | /home/user/xstockstrat/services/xstockstrat-ingest/acceptance/fix-system-identity-paths.feature | CREATE | NEW | The Then asserts ingest's `ingest.signal.ingested` AppendEvent request, so it is owned by ingest. Wording needs the gate above. |
| @AC-2 (@FR-2) A system-owned order event yields a partial P&L snapshot | /home/user/xstockstrat/services/xstockstrat-analysis/acceptance/fix-system-identity-paths.feature | CREATE | NEW | The subject is analysis `PnLPatternConsumer`. Adjacent to `@AC-17 @feature-225` but not a duplicate (see Notes). |
| @AC-3 (@FR-3) Signals from one mcp_client poll cycle share a per-source correlation id | /home/user/xstockstrat/services/xstockstrat-ingest/acceptance/fix-system-identity-paths.feature | CREATE (same file as AC-1) | NEW | The subject is ingest's per-cycle `correlation_id`. Net-new, so it needs C-15 traceability only. |

### Ready-to-write blocks
--- /home/user/xstockstrat/services/xstockstrat-ingest/acceptance/fix-system-identity-paths.feature (CREATE) ---
# Durable business-rule suite for xstockstrat-ingest (Constitution C-16). Promoted from feature 313's
# acceptance.feature (fix-system-identity-paths) at launch; @feature-313 marks provenance. These are the
# guarantees a future feature must not regress (recon reads this suite; the design-adversary enforces it).

Feature: xstockstrat-ingest - mcp_client loop ledger events keep owner attribution and a per-cycle correlation id
  Server-initiated mcp_client poll-loop signal events are attributed to the source owner and share one
  per-source, per-cycle correlation id.

  # guards: docs/reports/2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect.md
  # PRESERVE @AC-11 @feature-021 (services/xstockstrat-ledger/acceptance/ledger-event-export.feature):
  # the export is scoped to user_id = caller, so an owner-stamped event is returned to its owner.
  @AC-1 @FR-1 @regression @feature-313
  Scenario: mcp_client loop signal events are owner-stamped in the ledger
    Given an mcp_client signal source registered by owner "user-a"
    When one ingest.mcp_client.poll_interval_seconds cycle ingests a signal from it
    Then the ingest.signal.ingested ledger event has user_id "user-a"
    And ExportEvents called as "user-a" returns that event

  # the id persists as the ledger event's correlation_id; ledger ignores the x-trace-id header
  # PRESERVE @AC-41, @AC-28, @AC-29 and @AC-53 @feature-294
  # (@AC-41 is in docs/sdd/business-rules/platform.feature; the others in services/xstockstrat-ingest/acceptance/signal-map-instrumentation.feature): neither user_id nor
  # the per-cycle id becomes a metric label.
  @AC-3 @FR-3 @feature-313
  Scenario: Signals from one mcp_client poll cycle share a per-source correlation id
    Given two mcp_client signal sources registered by owner "user-a", each returning two distinct, non-duplicate signals
    When one poll cycle ingests all four signals
    Then each ingest.signal.ingested ledger event from one source's cycle carries the same non-empty correlation_id
    And the two sources' correlation ids differ
    And no x-user-id is sent

--- /home/user/xstockstrat/services/xstockstrat-analysis/acceptance/fix-system-identity-paths.feature (CREATE) ---
# Durable business-rule suite for xstockstrat-analysis (Constitution C-16). Promoted from feature 313's
# acceptance.feature (fix-system-identity-paths) at launch; @feature-313 marks provenance. These are the
# guarantees a future feature must not regress (recon reads this suite; the design-adversary enforces it).

Feature: xstockstrat-analysis - a system-owned order event degrades instead of raising
  The P&L pattern consumer yields a partial snapshot for a system-owned order event; it is never retried or parked on that basis alone.

  # guards: docs/reports/2026-10-19-analysis-pnl-compose-system-owner-raises-defect.md
  @AC-2 @FR-2 @regression @feature-313
  Scenario: A system-owned order event yields a partial P&L snapshot
    Given an order.filled ledger event whose payload has user_id "system"
    When PnLPatternConsumer processes the event
    Then the event is processed on its first attempt with no retry backoff
    And an order_snapshots row is written for that order with empty indicators and signals
    And an analysis.snapshot.degraded event is emitted
    And no pnl_positions window is opened
    And the event is not parked

### Notes / ambiguities / conflicts
- Source-of-truth gap: see the BLOCKER section above. The AC-1 Then wording is the main risk, because promotion is permanent and `context.md` records it as unconfirmed by the operator.
- Service attribution: AC-1 and AC-3 are ingest (the loop and `_ingest_external_signal` emit the ledger event). AC-2 is analysis. No scenario spans services, so nothing goes to `/home/user/xstockstrat/docs/sdd/business-rules/platform.feature`. `platform.feature` has no `@feature-313` entries and no overlapping rule. Its only system-identity block, at about line 258, covers the SAN-bound analysis->indicators/ingest contract.
- Dedup. No `@feature-313` tag exists in any suite, so there are no DUPs and this is a first-time promotion.
  - Ingest (`/home/user/xstockstrat/services/xstockstrat-ingest/acceptance/`): no scenario asserts `user_id` on `ingest.signal.ingested` or a per-cycle `correlation_id`. `mcp-client-signal-source.feature` and `fix-ingest-poller-backfill.feature` cover registration, poll isolation and last_error, not ledger attribution.
  - Analysis: `/home/user/xstockstrat/services/xstockstrat-analysis/acceptance/private-by-default-enforce-contract.feature:42-47` (`@AC-17 @feature-225`) is adjacent. It covers an empty-owner event: no ingest or indicators call, snapshot stored, degraded event emitted. AC-2 covers a `system` owner and adds first-attempt processing, no `pnl_positions` window and not parked. That is a different input and different Thens, so it is not an OVERLAP. A future curation pass could group the two.
- No CONFLICT. These standing rules hold alongside the new scenarios (design "Business Rules Touched"):
  - `@AC-16 @feature-225`: an ungranted system identity is refused inbound. AC-2 is a ledger-stream event, not an inbound call.
  - `@AC-8`, `@AC-14` and `@AC-15 @feature-225`: no `system`-owned window or ledger row is written.
  - `@AC-7` and `@AC-9 @feature-259`: poison still parks.
  - `@AC-33 @feature-224`: no `x-user-id` is forged. AC-1 and AC-3 assert none is sent.
- File naming follows the source slug. The `acceptance/` dirs already exist for both services, so only the files are created. No directory creation is needed.
- Tag order follows the existing convention (`@AC-n @FR-n [@regression] @feature-NNN`, e.g. `@AC-8 @FR-1 @regression @feature-261`). Original `@AC-*` numbers are not renumbered.
- AC-3 only exists in the branch copy after Step 1. If `status.md` shows Steps 6-7 (ingest `trace_id`) are not done and merged, promoting AC-3 would record an unimplemented guarantee. The caller should promote only at launch or ALL-DONE.

### Coverage check
- Source scenarios: 3 (@AC-1, @AC-2, @AC-3 in the Step 1 / branch target version). The stale main-tree file has only 2.
- Planned (NEW + DUP + OVERLAP): 3 (3 NEW, 0 DUP, 0 OVERLAP, 0 CONFLICT). Nothing is skipped. The counts match, so no scenario is dropped.
- Files written: 2 CREATE (ingest 2 scenarios, analysis 1 scenario), 0 APPEND, 0 to platform.feature.
```

## Session 2026-11-27 — operator ruling recorded by the orchestrator (verbatim)

Question (C-16 promotion gate): the promoter's plan reworded @AC-1 and cited @AC-41 @feature-294 in the wrong suite; how should the scenarios be promoted?
Operator answer: **"Branch text, fix the cite (Recommended)"** — promote @AC-1 verbatim as the branch's acceptance.feature has it (operator rulings 2026-11-21 and 2026-11-26), @AC-2 and @AC-3 verbatim, and correct only the @AC-3 PRESERVE comment's file reference for @AC-41 (platform.feature:1346). The `sdd-batch-promotion-plan` block above was corrected accordingly before the gate was approved.
