# Debate Register: fix-system-identity-paths

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 8 | 4 | 0 | 3 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 4 | 2 | 3 | 6 | 1 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Ingest attributes the ledger owner by setting AppendEventRequest.user_id=owner in _ingest_external_signal, not by forging an x-user-id header. | packages/proto/ledger/v1/ledger.proto:51; services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:76-78; services/xstockstrat-ingest/app/handlers/servicer.py:1167,1175-1180 | settled |
| D-2 | 1 | OQ-1 is in scope: poll_one_source mints one x-trace-id per source per poll cycle and passes it only via propagation_meta, with no x-user-id. It is traced by a new @AC-3. | services/xstockstrat-ingest/app/engine/mcp_client_loop.py:116,153-160; servicer.py:762,1181 | settled |
| D-3 | 1 | Analysis adds is_real_owner() to app/identity.py and uses it at _compose:539,546 and the window guard :388. owner_metadata reuses it, with its raise and message unchanged and test_identity.py left unedited as the regression proof. | services/xstockstrat-analysis/app/identity.py:3,8; app/engine/pnl_pattern_consumer.py:388,539,546-548; tests/test_identity.py:13-36 | settled |
| D-4 | 1 | A system-owned order writes a degraded snapshot and opens no pnl_positions window. position_id keeps the raw owner, and a later close for system is a documented no-op. | pnl_pattern_consumer.py:358,388,434,546-548 | settled |
| D-5 | 1 | OQ-2: existing NULL-owner ledger rows are left as they are, because ledger.events is append-only. | services/xstockstrat-ledger/migrations/003_events_user_id.up.sql (deny_mutation triggers) | settled |
| D-6 | 1 | OQ-3: no trading-side system guard is added. Trading is out of scope. | recon Open Question 3; product-spec affected services | settled |
| D-7 | 1 | The C-14 consumer surface is the /trader ledger export. No code step is needed because the route forwards caller-scoped ExportEvents with no event-type allowlist. | services/xstockstrat-ui/src/app/trader/api/ledger/export/route.ts:12,97-111; src/app/trader/portfolio/page.tsx | settled |
| D-8 | 1 | AC-1's second Then is reworded to the AppendEventRequest.user_id assertion, with the export guarantee kept as a cited PRESERVE of ledger @AC-11 @feature-021. AC-2's second Then is reworded to the degraded-snapshot, no-window outcome. Both rewordings are recorded in context.md before spec. | fails.md:3174-3177; ledgerServiceImpl.test.ts:675 | settled |
| D-9 | 2 | FR-1 is scoped to the mcp_client loop path. Setting AppendEventRequest.user_id on the RPC path is incidental hardening with no behaviour change, and its test traces to a PRESERVE of AC-33 @feature-224. | services/xstockstrat-ingest/app/handlers/servicer.py:984-995,1175-1180 | settled |
| D-10 | 2 | FR-2 reads 'a system owner alone never causes parking'. Poison payloads still park under @AC-7 @feature-259. | services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:65-73,368-386 | settled |
| D-11 | 2 | AC-3's Given uses distinct, non-duplicate signals. Its metric-label clause is replaced by a PRESERVE comment citing @AC-41/@AC-28/29/53 @feature-294, and it states that ledger does not read gRPC x-trace-id. | servicer.py:1145,1185; services/xstockstrat-ingest/tests/test_telemetry_allowlist.py:68; services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:76-97 | settled |
| D-12 | 2 | The product-spec Problem Statement is corrected: the loop forwards an empty propagation_meta list, not metadata=None. The correction is logged in context.md with the other rewordings. | servicer.py:1024; docs/roadmap/features/313-fix-system-identity-paths/product-spec.md:16 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Normalise system to empty string in _handle_order_event | It shifts position_id (:358) and leaves _compose able to raise when called directly. | locked |
| R-2 | 1 | Inline SYSTEM_IDENTITY comparisons at three sites with no predicate | It makes three copies of the feature-225 identity rule, against C-18 DRY. | locked |
| R-3 | 1 | Forge an x-user-id header on the loop's ledger AppendEvent | The proto request field exists and ledger reads it first. A forged header risks AC-33 @feature-224 trust semantics. | locked |
| R-4 | 1 | Backfill NULL-owner ledger rows | ledger.events is append-only (deny_mutation triggers). | locked |
| R-5 | 2 | Cite a bug-template exemption for the @FR-N tags | C-15 (constitution.md:46) has no bug carve-out. The Track C template omission is a gap, not a waiver. | locked |
| R-6 | 2 | Restate the no-identifier metric-label rule as an AC-3 Then | test_telemetry_allowlist.py:68 (@AC-41 @feature-294) already enforces it. A second promoted rule would break C-18. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | AC-1's second Then must be reworded to what ingest asserts (AppendEventRequest.user_id), with the export guarantee kept as a cited ledger @AC-11 PRESERVE and not promoted verbatim under C-16. | no | closed @ round 2 (AC-1's Then is reworded to assert AppendEventRequest.user_id plus no x-user-id metadata. Export visibility is a cited PRESERVE comment of ledger @AC-11 @feature-021 and is not promoted.) |
| O-2 | 1 | Append @AC-3 for the per-source, per-cycle shared x-trace-id taken under OQ-1. | no | closed @ round 2 (@AC-3 @FR-3 is appended with per-source, per-cycle shared x-trace-id wording.) |
| O-3 | 1 | Add @FR-N tags (FR-1/FR-2/FR-3) to every scenario, or cite the bug-template exemption. | no | closed @ round 2 (FR-1/2/3 are added to product-spec.md and every scenario is tagged @FR-N. No exemption is cited, because C-15 has none.) |
| O-4 | 2 | FR-2 'never parked' overclaims against @AC-7 @feature-259. Reword to 'a system owner alone never causes parking'. | no | open |
| O-5 | 2 | FR-1 claims both paths but only the loop-scoped AC-1 traces it. Narrow FR-1, or add an RPC scenario. | no | open |
| O-6 | 2 | AC-3's Given must specify distinct, non-duplicate signals, or dedup (servicer.py:1185) makes the Then vacuous. | no | open |
| O-7 | 2 | Drop AC-3's metric-label Then (duplicates test_telemetry_allowlist.py:68) in favour of a PRESERVE comment. | no | open |
| O-8 | 2 | Correct the product-spec.md:16 'metadata=None' drift (actually an empty list, servicer.py:1024). | no | open |
| O-9 | 2 | AC-3 must not imply ledger-side traceability, because ledger never reads gRPC x-trace-id. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 2 | D-2 | services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:76-97: appendEvent reads only x-user-id from call metadata and persists correlation_id and metadata from request fields. A search for x-trace-id in ledger src matches only __tests__/mtls.test.ts:127, so the per-cycle id minted by D-2 is dropped on arrival. The options are to persist the id as AppendEventRequest.correlation_id, to drop OQ-1, or to keep D-2 with AC-3 reworded. | pending user |
