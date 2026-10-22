# Design: fix-ingest-poller-backfill

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved — operator approval at the design gate, Floor clear)
**Approved by**: user @ 2026-10-22 (design gate r2: "APPROVED as synthesized", FR-1 amended; recorded in context.md)
**Grounded in**: recon.md

---

## Chosen Approach

The fix stays inside `xstockstrat-ingest`, in three files: `app/engine/mcp_client_loop.py`, `app/config/watcher.py` and
`app/handlers/servicer.py`. It needs no proto, migration, config-key or `config_json` change (recon.md:173-190).
`xstockstrat-config` is read-only (recon.md:89-101).

**Consumer surfaces (C-14).** Two surfaces see the fix, and neither changes its layout or tool schema:
- the `/config-ui` signal-sources health list (feature 083) and the agent `list_signal_sources` / `manage_signal_source`
  tools show the corrected `last_error` / `signals_fed` values;
- the agent `get_backfill_status` / `cancel_backfill` tools report a canceled job as `CANCELED`.

Both surfaces read the same persisted rows these changes write. No consumer code changes.

### FR-6 — signal-list selection (`mcp_client_loop.py`)

A new `_select_signal_list(d)` replaces the first-list-wins dict branch at `:41-45` and the decoded-text-dict branch at
`:50-51` (recon.md:26-29). A decoded list still passes through, and `JSONDecodeError` stays a source error. The rules
run in this order:

1. If `d["signals"]` is a list, return it, even when it is empty.
2. Candidates are the list values that are non-empty and contain only dicts. With exactly one candidate, return it.
3. With two or more candidates, raise `ValueError("ambiguous result: multiple candidate lists [<sorted keys>]")`.
   **Pinned `last_error` marker for AC-7: `ambiguous result`.**
4. With no candidates:
   - if `d` has at least one list value, every list value is empty, and `"symbol"` is not in `d`, return `[]`. This
     keeps today's silent result for `{"items": []}` and `{"results": [], "count": 0}`, which the loop at `:42-44`
     already returns as `[]`;
   - otherwise return `[d]`. A single signal object, with `tags: ["ai"]` or `tags: []`, carries `"symbol"` and is
     wrapped as one item.

The raise reaches the existing per-source catch (`run_one_cycle` `:143-152`, recon.md:36-39, :125-126). It ends up in
`mark_source_error(str(e))`, so the error needs no new plumbing. AC-7's `{alerts, rows}` shape gives two candidates,
so it is never selected.

### FR-1 — per-item guard (`mcp_client_loop.py:124-125`)

The loop at recon.md:32-35 changes as follows:

- Each parsed item is wrapped in `try/except Exception`. The pattern is the per-source isolation style already used at
  `:143-152` (recon.md:105-108).
- A failure logs `mcp_client loop: source %s item skipped: %s`, increments `skipped` and keeps `first_err`.
- After the loop, one summary record is logged:
  `log.info("mcp_client loop: source %s polled ingested=%d skipped=%d")`. It is emitted **before** any raise.
- If `parsed` is non-empty and every item was skipped, the poll raises `RuntimeError(f"all {n} items failed: {first_err}")`.
  The per-source catch records it as `last_error`. This is the operator-amended FR-1 and `@AC-8`.
- A partial failure only logs, and does not mark the source errored.
- Items the extractor drops (for example, a missing `symbol`) keep their existing warning and are not counted.

### FR-5 — GetSecret deadline (`watcher.py:146-164`)

- `resolve_secret(key, user_id=..., timeout: float | None = None)` passes `timeout=` to `self._stub.GetSecret`
  (recon.md:43-44).
- Only an `AioRpcError` whose `code()` is `DEADLINE_EXCEEDED` is translated, as
  `raise RuntimeError(f"GetSecret deadline exceeded after {timeout}s") from e`. **Pinned `last_error` marker for AC-4:
  `GetSecret deadline exceeded`.**
- `PERMISSION_DENIED`, `INTERNAL` and `found=false` behave exactly as before (recon.md:161-164).
- The call site at `mcp_client_loop.py:116` passes `float(timeout_seconds)`, the value already clamped at `:133-138`
  (recon.md:34, :37, :116-124).
- When feature 244's `int_positive` read lands, rebase onto it. If 261 lands first, keep today's `max(get_int(...), 1)`.

### FR-2 / FR-3 / FR-4 — cancel guards (`servicer.py`)

Each check is synchronous. No `await` sits between a check and the write it protects (recon.md:47-74).

- **FR-2.** The first statement inside `async with self._backfill_sem:` (`:493`), before the RUNNING write (`:494`), is:
  `if job_id in self._canceled_jobs:` discard the id, log `...canceled while queued...`, and return.
- **FR-3.** In `_execute_fundamentals_backfill`, the same check (discard, log, return) sits between the
  `BackfillFundamentals` return (`:532-540`) and `update_job` (`:544`). There is no COMPLETED/PARTIAL write and no
  `.completed` emit.
- **FR-4.** In `_resume_job`, after `row = get_job` (`:724`) and before the RUNNING write (`:734`):
  `if row["status"] == BACKFILL_STATUS_CANCELED:` log `skipping resume of canceled job %s` and return. This is the only
  persisted-status check. It covers the restart case, when the set is empty.
- **Blanket except** (`:510`): `if job_id in self._canceled_jobs:` discard the id and return before the FAILED write.

The change adds no new events. `_finalize_backfill`, `run_one`, `resume_incomplete_jobs` and its returned count are
untouched.

**Why the in-memory set is authoritative.** The only `BACKFILL_STATUS_CANCELED` write in `app/` is `servicer.py:900`.
It follows the synchronous `self._canceled_jobs.add` at `:896` (recon.md:70-74), and ingest runs with
`instance_count: 1` (`.do/app.yaml:238`). Ledger rule `fails.md:1688-1693` (an unenforced invariant is a latent defect)
was weighed. It is answered by the **O-3 guard test**: a repo fake for `update_job` asserts
`job_id in servicer._canceled_jobs` at the moment the CANCELED write arrives. A future reorder, or a second CANCELED
writer, then fails CI.

**Accepted FR-2 window.** The window spans CancelBackfill's whole `await get_job` (`:881`), not only the RUNNING write.
A cancel that overlaps the runner acquiring the semaphore can still produce one `ingest.backfill.running` emit and one
marketdata call. The outcome stays correct through three existing guards: the chunk guard at `:759`, the FR-3 guard,
and `_finalize_backfill` at `:657`. **Executors must NOT add a DB read before the RUNNING write.**

**Accepted FR-3 interleave.** A cancel that lands during the COMPLETED `update_job` await leaves one stale set entry
per race. It also writes both `.completed` and `.canceled` to the ledger. This is accepted as rare and is not a guard
bug.

### Trace propagation (C-03; operator 2026-10-21 standing rule, no waiver)

- Request-derived paths keep the `propagation_meta` captured before `create_task`. That includes the new skip paths in
  `_run_backfill` and `_execute_fundamentals_backfill`.
- `_resume_job` has no originating request. It mints `(("x-trace-id", str(uuid.uuid4())),)` once per resumed job and
  passes it to `_run_chunks` / `_finalize_backfill` instead of `()` (`:737-738`, recon.md:67, :187-188). `uuid` is
  already imported at `:11`, so this is one line with no new helper.
- The poll-loop `GetSecret` keeps only its internal-caller metadata (recon.md:189). The cost case for this is in
  context.md, and an operator call is welcome:
  - `resolve_secret` has no metadata parameter;
  - widening it collides with in-flight edits to `watcher.py` by features 242, 260 and fix-config-stream-resilience;
  - `last_error` already carries the source slug and owner.

### Tests (red first per step, P-06)

**Widen existing fakes** with `timeout=None`: `test_mcp_client_loop.py:65` and `:210`, and `test_mcp_client.py:27`
(recon.md:127-136).

**The DEADLINE_EXCEEDED builder.** `AioRpcError(DEADLINE_EXCEEDED, Metadata(), Metadata(), details=...)` stays inline,
unless both `test_mcp_client.py` and `test_mcp_client_loop.py` consume it. In that case it moves next to `job_row` in
`tests/_helpers.py`, and the new home is recorded in context.md (C-13).

**AC-4.** The fake asserts `timeout == 2.0`, runs `await asyncio.sleep(timeout)`, and then raises. The test asserts the
marker in src-a's `last_error`, and that src-b is still polled. Feature 247's outer hang guard stays.

**Parsing tests:**
- AC-1, with a caplog check of the summary record;
- AC-5 and AC-7;
- AC-8, where every item fails: the summary is logged before the raise, and `last_error` reads `all 1 items failed`;
- a single object with `tags`;
- an envelope whose lists are all empty returns `[]` with no extractor warning;
- a text-fallback `{"signals": [...]}`.

**Cancel tests:**
- AC-2 (a queued cancel, for bars and for fundamentals) and AC-6 run through `CancelBackfill` with repo fakes. They do
  not copy the private-set assertion at `test_cancel_backfill.py:52`.
- AC-3 runs through `resume_incomplete_jobs` with a CANCELED `job_row`, and spies on the chunk runner and marketdata.
- The O-3 ordering test.
- `test_ingest_servicer.py:624` stays green.

### Build order and teardown

Build order: FR-6 + FR-1 → FR-5 (after 244) → FR-2/3/4 → teardown. The teardown:

- fixes the "no automatic resume" drift in `services/xstockstrat-ingest/CLAUDE.md` (recon.md:21-22);
- logs the comment drift at `main.py:66` and `:117-118` in
  `services/xstockstrat-ingest/docs/context-constitution-findings.md`, leaving `main.py` itself untouched;
- adds an ingest invariant: "single instance; `CancelBackfill` adds to `_canceled_jobs` before its CANCELED write; the
  guards rely on the set alone". The invariant references the O-3 test.

## Rejected Alternatives

- **`asyncio.wait_for` as the GetSecret bound.** Feature 247 rejected it (247 design.md:22, :162-165). It raises a bare
  `TimeoutError` with an empty `str()`, sends no `grpc-timeout`, and would split the precedent.
- **The raw `AioRpcError` text as the FR-5 marker.** `str(AioRpcError)` is multi-line debug text that would land in
  `last_error` and the `/config-ui` health list. The clean translated message costs about 4 lines.
- **A per-source `result_key` in `config_json` for FR-6.** It changes the `config_json`, `manage_signal_source` and
  `/config-ui` contracts (C-14, `@AC-32` parity) with no stated need (C-18).
- **r1's "sole non-empty list" / "all empty → `[]`" FR-6 rule.** It selects, or empties, a single signal object's
  `tags` list, and silently drops the signal.
- **r2's unconditional rule-4 `[d]` wrap.** It turns today's silent empty-envelope polls into a per-poll extractor
  warning (O-2). The "all lists empty and no `symbol` → `[]`" refinement supersedes it.
- **r1's `_is_canceled` helper (a set check, then an awaited `get_job`).** The `await` between the check and the write
  leaves a window in which a cancel is missed.
- **Compare-and-set terminal writes** (`UPDATE ... WHERE status <> CANCELED`, widening `backfill_jobs.update_job` at
  `:59`). This is the strongest alternative: it is safe across replicas and closes the O-4/O-8 windows. It loses
  because it changes a shared helper that every status write uses and needs new repo-fake semantics. That rework is
  not justified at `instance_count: 1`, given the user's low-rework instruction.
- **Filtering canceled jobs in `list_jobs_with_incomplete_chunks` with a join.** It changes the resume count and breaks
  `test_ingest_servicer.py:624`.
- **Leaving the resumed BackfillBars path with `()` metadata.** Minting a uuid4 trace id there is one line, `uuid` is
  already imported, and the operator's standing rule asks for a trace id when one is available.

## Open Risks

- [ ] **Single-instance dependency.** The FR-2/FR-3 guards rely on three things: ingest runs as a single instance,
  CancelBackfill stays the only CANCELED writer, and it adds to the set before writing. The O-3 test catches an
  in-process reorder or a second writer. Scaling ingest above `instance_count: 1` would still silently bring back D-34.
  It is documented as an invariant but not enforced. Addressed at: the FR-2/3/4 step (O-3 test) and teardown
  (invariant).
- [ ] **Accepted FR-2 window.** A cancel whose `await get_job` (`:881`) overlaps the runner acquiring the semaphore can
  still produce one `ingest.backfill.running` emit and one marketdata call. The existing guards (`:759`, FR-3,
  `_finalize_backfill` `:657`) then stop the run. Addressed at: the FR-2/3/4 step (documented, no extra DB read).
- [ ] **FR-3 interleave.** It leaves one stale `_canceled_jobs` id per race and writes both `.completed` and `.canceled`
  to the ledger. Addressed at: the FR-2/3/4 step (documented).
- [ ] **AC-4 fidelity.** A sleeping fake proves the deadline value and the error translation. The real `grpc-timeout`
  behaviour on a hung channel rests on the `grpc.aio` contract. Addressed at: the FR-5 step plus the dev smoke test.
- [ ] **Merge-order coupling.** FR-5 depends on feature 244's `int_positive` read. `watcher.py` and
  `mcp_client_loop.py` overlap with 242, 260, 259 and fix-config-stream-resilience. Addressed at: `/sdd-spec`, with a
  `merge-order.md` row 244 → 261.
- [ ] **Out of scope: seeded key form.** The seeded bare key and the dotted read differ (`025_…up.sql:34` vs
  `mcp_client_loop.py:135`, recon.md:194-200), so the effective timeout is the 30 s code default. This needs its own
  defect report or a 244 follow-up. Addressed at: teardown (file a report).
- [ ] **Repeated resume of canceled jobs.** Canceled bars jobs with PENDING chunks are re-listed and counted in
  "resumed N" at every boot. This is bounded, and the skip log explains it. Addressed at: the FR-4 step (skip log).
- [ ] **Stale main-dev copy (C-15).** The main-dev copy of `acceptance.feature` has no AC-6/AC-7/AC-8 and carries the
  older AC-1 text. Design and spec cite the branch copy. Addressed at: `/sdd-sync`.

## Constitution Rules Touched

- `C-03` — honored by: request paths keep the inbound `propagation_meta`. The `_resume_job` path, which has no
  request, mints a uuid4 trace id. The poll-loop GetSecret exception is argued on cost in context.md. There is no
  waiver.
- `C-08` — honored by: no config-service key is added. FR-5 reuses `ingest.mcp_client.request_timeout_seconds`, and no
  value is hardcoded beyond the existing code default.
- `C-11` — honored by: recon plus a 2-round full debate before any code, with the operator's approval recorded.
- `C-13` — honored by: tests reuse the existing fakes and `tests._helpers.job_row`. The DEADLINE_EXCEEDED builder's
  placement rule is stated above.
- `C-15` — honored by: FR-1 is amended in product-spec.md and `@AC-8` is appended (ids stay append-only) before
  `/sdd-spec`. The stale main-dev copy is reconciled by `/sdd-sync`.
- `C-16` — honored by: the Business Rules section below.
- `C-18` — honored by: no `result_key`, no compare-and-set rework, no new helper. The accepted windows are documented
  instead.
- `P-02` / `P-03` — honored by: design.md cites recon.md and the code, and spec drift (O-1) is resolved in the spec
  artifacts, not only in the design.
- `P-06` — honored by: every step goes red first.
- Floor (`F-*`) — no breaches.

## Business Rules Touched (C-16)

- CHANGE `@AC-1` (261, FR-1) "One failing item does not drop the rest of an mcp_client batch" — signed off by the
  operator 2026-10-21 (scope D-09/D-34/D-42/D-59, context.md § sdd-review "OPERATOR DECISIONS").
- CHANGE `@AC-2` (261, FR-2) "A backfill canceled while queued stays CANCELED and never runs" — signed off by the
  operator 2026-10-21 (same).
- CHANGE `@AC-3` (261, FR-4) "A canceled backfill is not resumed after a restart" — signed off by the operator
  2026-10-21 (same).
- CHANGE `@AC-4` (261, FR-5) "A hung GetSecret is bounded and recorded as that source's error" — signed off by the
  operator 2026-10-21 (same).
- CHANGE `@AC-5` (261, FR-6) "The signal list is found when the result also carries another list" — signed off by the
  operator 2026-10-21 (same).
- CHANGE `@AC-6` (261, FR-3) "A fundamentals backfill canceled mid-run is not finalized as COMPLETED or PARTIAL" —
  signed off by the operator 2026-10-21 (same).
- CHANGE `@AC-7` (261, FR-6) "An ambiguous result shape is recorded as a source error" — signed off by the operator
  2026-10-21 (same).
- EXTEND `@AC-8` (261, FR-1) "A batch in which every item fails is recorded as the source's error" — new case: a batch
  where every item fails, including a one-item batch, sets `last_error` after the summary log. Sanctioned by the
  operator's design-gate approval 2026-10-22 ("FR-1 is AMENDED"; context.md § sdd-design 2026-10-22).
- EXTEND `@AC-4 @feature-166` "MCP tool result is parsed into ExternalSignals and ingested"
  (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`) — new case: a single signal object with
  a `tags` list is wrapped as one item instead of returning its tag strings. The bare-list, `[item]` and
  `{"signals": …}` shapes and the dedup keep working. Covered by the operator's "APPROVED as synthesized" at the
  2026-10-22 gate, which included this classification (context.md).
- PRESERVE `@AC-3 @feature-166` (bearer via GetSecret) — not regressed: the request, the `x-internal-caller` metadata
  and the Bearer header are unchanged, and only a deadline is added.
- PRESERVE `@AC-5 @feature-166` "Unreachable endpoint records health without crashing the service" — not regressed: the
  per-source catch is unchanged, and FR-5, FR-6 and the all-fail FR-1 case add only new `last_error` causes.
- PRESERVE `@AC-35 @feature-224 @feature-225` and `@AC-9 @feature-224` — not regressed: the call is still
  `GetSecret(user_id=<owner>)` with exact scope, and ingested items still carry `owner=owner`.
- PRESERVE `@AC-6 @feature-198` "Fundamentals backfill is a distinct data kind" — not regressed: the `data_kind`
  routing at `servicer.py:504-509` is untouched.
- PRESERVE `@AC-1`, `@AC-3 @feature-173` (present-aware config reads) — not regressed: the timeout read is unchanged
  until 244's `int_positive` rebase.
- PRESERVE `@AC-4`, `@AC-5`, `@AC-16 @feature-147` (GetSecret server contract) — not regressed: the server is
  untouched. A deadline error stays distinct from `found=false` and `PERMISSION_DENIED`, and ingest never falls back to
  an unauthenticated call.
