# Context Log: fix-ingest-poller-backfill

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-ingest-poller-backfill-defect.md` (Issues disabled);
  sidecar `triaged` / `ref: feature:261-fix-ingest-poller-backfill`.
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-09, D-34,
  D-42, D-59.
- Severity: SEV-2 (group). Impact type: silent-signal-loss. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..5), context.md.
- Affected services: xstockstrat-ingest (fix site), xstockstrat-config (`GetSecret` server, read-only).
- Root cause hypothesis: per-source (not per-item / per-call) error handling in the poller; a first-list extraction
  heuristic; in-memory cancel flag plus unconditional `RUNNING` writes on queued-start and resume.
- Re-verification on a053b0e: all four D-ids reproduce by reading.
  - D-09: `mcp_client_loop.py:124-125` (unchanged); caller catch `:143-146` (scan `:145`).
  - D-34: queued-start `RUNNING` `servicer.py:493-498` (scan `:494-498`); resume `RUNNING` `:734` (unchanged);
    `backfill_chunks.py:146` (unchanged); `_canceled_jobs` `:326` (unchanged); `CancelBackfill` `:869-907`.
    Traced further at triage: a queued-canceled bars job is left `RUNNING` with PENDING chunks (`run_one` skip
    `:759-760`, `_finalize_backfill` early return `:655-659`), then revived on restart; a queued-canceled
    fundamentals job calls `BackfillFundamentals` and overwrites `CANCELED` (`:526-545`, no cancel check).
  - D-42: `watcher.py:155-163` (unchanged); call site `mcp_client_loop.py:116`; loop `:139-146`.
  - D-59: `mcp_client_loop.py:41-45` (unchanged).
- **Overlaps:**
  - `244-fix-python-config-stored-zero` (implementation-ready) modifies `mcp_client_loop.py:133-138` (the
    `request_timeout_seconds` read, switching to `int_positive`) and `ingest/app/config/watcher.py` (getters and the
    `backfill_max_concurrent_*` properties, consumed at `servicer.py:323,749`). D-42 should reuse 244's clamped
    timeout read. **Merge 244 first, then rebase 261**; add a `merge-order.md` row at /sdd-spec.
  - `247-fix-agent-getconfig-deadline` (implementation-ready) is the agent-side sibling of D-42 (the filed report
    `2026-10-19-agent-get-config-value-no-deadline-defect` does not cover ingest). Reuse its deadline pattern; no file
    overlap.
  - `259-fix-python-loop-supervision` (D-08) edits `_watch` in the same ingest `watcher.py`; disjoint from
    `resolve_secret`, rebase only.
- Recommended design depth: full → `/sdd-design fix-ingest-poller-backfill` (rationale: 2 affected services, the C-0
  full trigger). Config is read-only, so the operator may downgrade to `/sdd-design fix-ingest-poller-backfill quick`.
  Design forks: D-59 rule (sole list key vs named `signals` key vs per-source `result_key`); D-34 persisted-status
  check vs a new column.
- Development branch: feature/fix-ingest-poller-backfill

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (0 fails, 0 floor
  breaches). Overlap level: WARN (no FAIL; no proto-field, migration, or new config-key collision).
- Warnings:
  - Criterion 8 / FR-6: AC-7 ("no rule selects either list" for `{alerts, rows}`) is testable only once design fixes
    the selection rule (well-known `signals`/`items` keys vs per-source `result_key`). Design must confirm AC-7 stays
    valid under the chosen rule.
  - Criterion 2: FR-5 "deadline error" and FR-6 "ambiguous-result error" do not pin `last_error` text. Design pins a
    stable marker substring that AC-4 / AC-7 assert.
  - Criterion 8: AC-2 / AC-3 "marketdata RPC never called" / "no chunk executed" are observable only at the
    stub/mock boundary. Resolved in product-spec § Acceptance Criteria (stated as verified there).
  - Criterion 11: a FR-6 `result_key` in `config_json` would change the `manage_signal_source` schema and the
    `/config-ui` source form; recorded as a conditional Consumer Surface amendment. Design updates the surfaces if
    `result_key` is chosen.
  - Doc drift (NOTE): `services/xstockstrat-ingest/CLAUDE.md` says restart reconciles RUNNING/QUEUED jobs to FAILED
    with "no automatic resume", but `resume_incomplete_jobs` is wired at `app/main.py:119` and defined at
    `app/handlers/servicer.py:714`. FR-4 matches the code. Reconcile that CLAUDE.md at landing (teardown).
  - Coordination (NOTE): 244, 259 and the config-stream resilience peer touch `mcp_client_loop.py` / `watcher.py`.
    Design confirms the merge order.
- Overlap findings:
  - `244-fix-python-config-stored-zero` (implementation-ready): same-key, same-lines conflict at
    `mcp_client_loop.py:133-138` (`request_timeout_seconds` read → `int_positive`); same file, disjoint regions in
    `app/config/watcher.py` (getters) and `app/handlers/servicer.py` (`_backfill_sem` at `:323`). Recommended order:
    244 first, then 261 rebases FR-5 onto `int_positive`.
  - `259-fix-python-loop-supervision` (draft): same file `app/config/watcher.py`; region overlap unverified until 259
    is specced.
  - Low-risk shared context: 260 (`servicer.py:1039-1066`) and 242 (`servicer.py:473`, adjacent to queued start
    `:493-498`) — disjoint lines, rebase only. Config `GetSecret` (254, 242 peer-SAN grant at
    `services/xstockstrat-config/src/grpc/authz.ts:124`) is read-only here — no collision.
  - Line drift: trunk has `resolve_secret` at `watcher.py:146` (spec cites `:155-163`) and the timeout read at
    `mcp_client_loop.py:135`. Design re-anchors.
  - Merge-order: no `merge-order.md` row for 261 yet. Recommended WARN row 244 → 261 (later also vs 259). Not
    written — needs user confirmation per the /sdd-review rule; propose at /sdd-spec.
- OPERATOR DECISIONS (binding, recorded 2026-10-22):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C (precedent #1264).
  - Scope is D-09, D-34, D-42, D-59.
  - Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
- Next: `/sdd-design fix-ingest-poller-backfill`.
