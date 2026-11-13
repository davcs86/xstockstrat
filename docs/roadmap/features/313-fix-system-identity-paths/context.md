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
