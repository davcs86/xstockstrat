# Design: fix-system-identity-paths

**Created**: 2026-11-20
**Rounds**: 5 (full; termination: approved)
**Approved by**: operator @ 2026-11-20, under the operator's standing authorisation of the same day, applied at the `/sdd-batch` design gate (round-5 adversary verdict SOUND, no Floor breach, no blocking objection, every C-16 CHANGE covered by an operator ruling)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Two owner-identity gaps are fixed with no proto, migration, config or ledger code change (recon.md:141-145).
Recon was taken at `origin/main-dev@c4fd48b0a` (recon.md:5) and its line numbers have drifted. Where a
current working-tree line is given below it is marked "now"; `/sdd-spec` re-grounds every line.

### Ingest: owner on the ledger event (FR-1, @AC-1; D-1, D-14)

- `_ingest_external_signal` sets `user_id=owner` on the `ingest.signal.ingested` `AppendEventRequest`
  (bug site recon.md:29-31; reuse pattern recon.md:104-107). The proto field exists for this and ledger
  reads it before the header (recon.md:69, recon.md:73). No `x-user-id` header is forged (R-3).
- FR-1 is scoped to the `mcp_client` loop path (recon.md:23-26). The RPC path gets the same field for free,
  because there the owner equals the header value (recon.md:106); that is incidental hardening.
- The AC-1 test drives `poll_one_source` through the real `_ingest_external_signal` with a dedup-miss fake
  DB (harness recon.md:82-87; D-16, R-8). It asserts `user_id == "user-a"` on the request and no `x-user-id`
  call metadata.
- The same test function adds one untraced RPC-path assertion, using the pattern at recon.md:88-90. It
  carries no "Covers: AC-33": `@AC-33 @feature-224` is a plain PRESERVE (D-14, operator ruling on D-9).

### Ingest: per-cycle id (FR-3, @AC-3; D-17, D-18, D-19)

D-17 supersedes D-2's "only via `propagation_meta`" clause (operator ruling on D-2, petitions P-1 and P-3).

- `_ingest_external_signal` (recon.md:27; now `servicer.py:1237-1239`, signature
  `(self, signal, propagation_meta=None, *, owner: str)`) gains one keyword-only `trace_id: str = ""` after
  `owner`.
- When `trace_id` is non-empty, on the `ingest.signal.ingested` AppendEvent only, the core sets
  `AppendEventRequest.correlation_id=trace_id` and appends `("x-trace-id", trace_id)` to the call metadata.
  Both channels come from the one value, so they cannot disagree (R-11).
- The core appends; it does not strip and replace an inbound `x-trace-id`. No caller passes both `trace_id`
  and `propagation_meta`. A one-line docstring constraint says `trace_id` is for callers with no inbound
  metadata.
- When `trace_id` is empty (the RPC path, recon.md:32; now `servicer.py:1206-1217`) behaviour is unchanged
  and no `correlation_id` is set, so R-9 holds.
- `poll_one_source` (recon.md:23) mints `str(uuid.uuid4())` once per source per cycle, before the item loop,
  and passes it as `trace_id=` on every per-item call (recon.md:25), with no `propagation_meta` and no
  `x-user-id`. Mint precedent: recon.md:35.
- The pairing of `correlation_id` with `x-trace-id` metadata is the existing idiom at
  `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:613,618` (debate.md P-3). Ledger persists
  `req.correlationId` (`ledgerServiceImpl.ts:89`) and reads only `x-user-id` from metadata (recon.md:69).
- AC-3 wording, binding on the spec:
  - Given: two sources owned by user-a, each returning two distinct, non-duplicate signals (D-11).
  - Thens are limited to the persisted `correlation_id`: each `ingest.signal.ingested` ledger event from one
    source's cycle carries the same non-empty `correlation_id`; the two sources' ids differ; no `x-user-id`
    is sent.
  - The matching `x-trace-id` call metadata is a plain test assertion, not a Then, because ledger never
    reads the header.
  - The scenario comment reads "the id persists as the ledger event's correlation_id; ledger ignores the
    x-trace-id header" (D-18). The `@AC-41`/`@AC-28`/`@AC-29`/`@AC-53 @feature-294` PRESERVE comment stays.
- Test and spy fix (D-19): the spy at `tests/test_mcp_client_loop.py:196-197` (recon.md:85, recon.md:158)
  becomes `async def spy(signal, propagation_meta=None, owner=None, **kw)` and forwards `**kw` to `orig`.
  Without it, `trace_id=` raises `TypeError`, the per-item `except` (recon.md:26) swallows it, and the
  `@AC-4 @feature-166` dedup test stops proving anything. The AC-3 test uses the same real-core harness and
  asserts `AppendEvent.call_args.args[0].correlation_id` and `kwargs["metadata"]`.

### Analysis: a `system` owner degrades (FR-2, @AC-2; D-3, D-4, D-10, D-13, D-15)

- `is_real_owner()` is added to `services/xstockstrat-analysis/app/identity.py` (recon.md:44) and used at
  the `_compose` meta build and degrade check (recon.md:56, recon.md:58) and at the window guard
  (recon.md:53). `owner_metadata` reuses it; its raise and message are unchanged, and
  `tests/test_identity.py:13-36` stays unedited as the regression proof (D-3).
- A `system`-owned order writes a degraded snapshot and opens no `pnl_positions` window. `position_id`
  keeps the raw owner (recon.md:50) and a later close for `system` is a documented no-op (D-4).
- The degraded snapshot writes no `system`-owned ledger row, because `_emit` sets no
  `AppendEventRequest.user_id` (D-13).
- `_POISON` is not changed (recon.md:46, recon.md:154). FR-2 reads "a system owner alone never causes
  parking"; poison payloads still park under `@AC-7 @feature-259` (D-10).
- AC-2's Then is the operator wording "Then the event is processed on its first attempt with no retry
  backoff". The test drives `_process_with_retry` (recon.md:47) with the `sleeps` fixture (recon.md:99) and
  asserts no awaited sleep, one `process_event` run, no parking, a degraded snapshot and no `pnl_positions`
  window (D-15, R-10). "Degraded" is the ledger event name, not a row column (recon.md:64, recon.md:149).
  RED is taken against the real `_compose` and `owner_metadata` (recon.md:153).

### Decisions on the recon open questions

- OQ-2: existing NULL-owner ledger rows are left; `ledger.events` is append-only (recon.md:156; D-5).
- OQ-3: no trading-side `system` guard; trading is out of scope (recon.md:157; D-6).

### Consumer surface (C-14)

- The surface is the `/trader` ledger export (recon.md:160; D-7). No UI or ledger code step is needed: the
  route forwards caller-scoped `ExportEvents` with no event-type allowlist, and export scoping is
  `user_id = caller` (recon.md:70-72), so owner-stamped `mcp_client` events become visible to their owner.
- Consumer-surface note, recorded in context.md (D-19): in that export, the `correlation_id` column
  (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature:40`) shows a poll-cycle id on
  `mcp_client` `ingest.signal.ingested` rows, not a request trace. RPC-path rows stay empty.
- The analysis change is internal-only.

### Build order (D-16)

1. Docs and context.md: the AC-1 and AC-2 rewordings with the C-16 sign-off; FR-1 loop-only; FR-2 per D-10;
   FR-3 reworded to "persisted as correlation_id"; the D-12 Problem Statement drift fix (recon.md:28); the
   operator's 2026-11-20 rulings on D-2 and D-9; the consumer-surface note above.
2. Analysis AC-2, RED then GREEN.
3. Ingest D-1 / AC-1.
4. Ingest FR-3 / AC-3, as a separate final step.

`/sdd-spec` must re-ground every cited line against `origin/main-dev` and peers 308, 309, 327
(`pnl_pattern_consumer.py`) and 328 (`mcp_client_loop.py:134-140`) (recon.md:159).

## Rejected Alternatives

- `R-1` Normalise `system` to an empty string in `_handle_order_event` — rejected because it shifts `position_id` and leaves `_compose` able to raise when called directly.
- `R-2` Inline `SYSTEM_IDENTITY` comparisons at three sites with no predicate — rejected because it makes three copies of the feature-225 identity rule (C-18).
- `R-3` Forge an `x-user-id` header on the loop's ledger AppendEvent — rejected because the proto request field exists and ledger reads it first; a forged header risks `@AC-33 @feature-224` trust semantics.
- `R-4` Backfill NULL-owner ledger rows — rejected because `ledger.events` is append-only (deny_mutation triggers).
- `R-5` Cite a bug-template exemption for the `@FR-N` tags — rejected because C-15 has no bug carve-out.
- `R-6` Restate the no-identifier metric-label rule as an AC-3 Then — rejected because `test_telemetry_allowlist.py:68` (`@AC-41 @feature-294`) already enforces it; a second promoted rule would break C-18.
- `R-7` Keep "Then _compose does not raise" in AC-2 and rely on promoting only the behavioural Thens — rejected because promotion is whole-scenario and permanent, and Thens must be observable outcomes.
- `R-8` Observe AC-3's AppendEvent Then through the AsyncMock-stubbed loop harness — rejected because the stub never reaches the dedup gate or AppendEvent, so the Then is vacuous.
- `R-9` Derive `AppendEventRequest.correlation_id` from an `x-trace-id` entry in `propagation_meta` — rejected because it would start storing inbound trace ids on RPC-path ledger rows, outside FR-1/FR-3.
- `R-10` Observe AC-2's "no retry backoff" Then by calling `process_event` directly — rejected because `asyncio.sleep` is awaited only in `_process_with_retry`, so the Then passes with the bug present.
- `R-11` Pass the per-cycle id through two separate parameters (a `propagation_meta` `x-trace-id` entry plus a `correlation_id` keyword) — rejected because a caller could send mismatched values (C-18).
- `R-12` Send the per-cycle id as `correlation_id` only, with no `x-trace-id` call metadata — rejected because it contradicts the operator ruling of 2026-11-20 ("sent as both") and the idiom at `pnl_pattern_consumer.py:613,618`.

## Open Risks

- [ ] Register status cells lag the rulings: O-17, O-18 and O-19 still read "open", and D-2 / D-9 read "reopened", not "superseded by D-17 / D-14". The operator ruling makes the O-17 and O-18 fixes binding regardless — to be addressed at step 1 (docs).
- [ ] AC-3's wording becomes permanent at promotion. The observable-only Thens must be what `/sdd-spec` writes into acceptance.feature; AC-3 needs C-15 traceability (`@FR-3`), not C-16 sign-off — to be addressed at step 1.
- [ ] Peer 328 edits `mcp_client_loop.py:134-140`. No 328 change to the `_ingest_external_signal` signature was found; the risk is a textual conflict in `poll_one_source` near `:140-160` — to be addressed at `/sdd-spec` (re-ground step 4 against 328's branch).
- [ ] The `**kw` spy accepts any keyword, so a future rename of `trace_id` would not fail the dedup test. The AC-3 test's `correlation_id` assertion is the guard — to be addressed at step 4.
- [ ] With append-only metadata, a future caller passing both `trace_id` and an `x-trace-id` in `propagation_meta` would send two headers. The docstring constraint is the only guard — to be addressed at step 4.
- [ ] The export's `correlation_id` column changes meaning on `mcp_client` rows, from empty to a poll-cycle id. `@AC-8 @feature-021` covers only the column's presence, so the context.md note is the only record — to be addressed at step 1.
- [ ] Line drift: recon's citations are stale (the core moved from `servicer.py:1015` to `:1237`) and the "now" lines come from a `ccr-*` working tree — to be addressed at `/sdd-spec` (re-ground against `origin/main-dev`).
- [ ] Re-expressing `owner_metadata` through `is_real_owner` touches a builder with 9+ callers. Mitigation: `tests/test_identity.py:13-36` stays unedited and green — to be addressed at step 2.
- [ ] Marketdata's handling of a headerless `system` bars read is unverified (recon.md:151). It sits inside `_compose`'s `try`, so the event degrades either way — to be addressed at step 2.
- [ ] The ledger, analysis and peer-328 citations were not re-checked in round 5; they rest on the adversary's reading and on round 4 — to be addressed at `/sdd-spec`.

## Constitution Rules Touched

- `C-11` — honored by: the full design debate ran (5 rounds) before any code; assumptions and rulings are in debate.md and context.md.
- `C-14` — honored by: the consumer surface is named (the `/trader` ledger export, D-7) with the `correlation_id` column note; analysis is internal-only.
- `C-15` — honored by: FR-1/FR-2/FR-3 are added to the product spec and every scenario is tagged `@FR-N` (R-5); Thens are observable outcomes only.
- `C-16` — honored by: the `@AC-1` and `@AC-2` rewordings carry the operator sign-off of 2026-11-20; every other touched rule is a PRESERVE (below).
- `C-18` — honored by: one `is_real_owner()` predicate (R-2), one `trace_id` keyword for both channels (R-11), no restated metric-label rule (R-6), no dead strip branch.
- `F-09` — honored by: FR-3/AC-3 is a separate final step, so no Deviation-Log step swap is needed (D-16).
- `P-02` — honored by: the orchestrator mediated every proposer/adversary exchange through the synthesized state.
- `P-03` — honored by: nothing invented; unverified items are listed under Open Risks and recon's Not-found.
- `P-06` — honored by: operator rulings are recorded with ISO date in debate.md and context.md.
- `PLAT-4` — honored by: the loop sends no `x-user-id`; owner travels as the request field; the `x-trace-id` header follows the existing propagation convention and stays a plain test assertion.

Floor breaches: none.

## Business Rules Touched (C-16)

- CHANGE `@AC-1` "mcp_client loop signal events are owner-stamped in the ledger" (this feature's `acceptance.feature`) — second Then reworded to the `AppendEventRequest.user_id` assertion plus no `x-user-id` metadata; export visibility becomes a cited PRESERVE of `@AC-11 @feature-021` (D-8); signed off by operator @ 2026-11-20 (context.md, "C-16 sign-off for this feature's @AC-1 and @AC-2").
- CHANGE `@AC-2` "A system-owned order event yields a partial P&L snapshot" (this feature's `acceptance.feature`) — "Then _compose does not raise" replaced by "Then the event is processed on its first attempt with no retry backoff", with the degraded-snapshot, no-window outcome (D-8, D-15); signed off by operator @ 2026-11-20 (context.md, same ruling).
- EXTEND `@AC-3` (new to this feature, `@FR-3`) — new case added: per-source, per-cycle shared `correlation_id` on `ingest.signal.ingested` ledger events. Net-new, so it needs C-15 traceability, not sign-off.
- PRESERVE `@AC-11 @feature-021` and `@AC-8 @feature-021` (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — not regressed by: no ledger change; export stays scoped to `user_id = caller` and the row shape is unchanged.
- PRESERVE `@AC-4 @feature-166` (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`) — not regressed by: the spy forwards `**kw`, so the dedup test still reaches the real core.
- PRESERVE `@AC-33 @feature-224` "A user cannot write as the system owner" (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature`) — not regressed by: the fix attributes a real owner and never routes through `system`; no test is traced to it (D-14).
- PRESERVE `@AC-8 @feature-225` "A headerless owner-scoped call is rejected in analysis" and `@AC-16 @feature-225` "An ungranted system identity is refused by analysis" (`services/xstockstrat-analysis/acceptance/private-by-default-enforce-contract.feature`) — not regressed by: `owner_metadata` still raises for `system` and no `system` header is sent.
- PRESERVE `@AC-14 @feature-225` and `@AC-15 @feature-225` (same file) — not regressed by: a `system` order opens no `pnl_positions` window and writes no `system`-owned ledger row (D-4, D-13).
- PRESERVE `@AC-17 @feature-225` "An ownerless order event issues no owner-scoped call" (same file) — not regressed by: the empty-owner branch is unchanged; `system` takes the same branch.
- PRESERVE `@AC-7 @feature-259` "A ledger event that keeps failing is parked" and `@AC-9 @feature-259` (`services/xstockstrat-analysis/acceptance/fix-python-loop-supervision.feature`) — not regressed by: `_POISON` is unchanged; only a `system` owner alone stops causing parking (D-10).
- PRESERVE `@AC-28`, `@AC-29`, `@AC-41` and `@AC-53 @feature-294` (`services/xstockstrat-ingest/acceptance/signal-map-instrumentation.feature`) — not regressed by: neither `user_id` nor the per-cycle id becomes a metric label; `test_telemetry_allowlist.py:68` stays the enforcement.
