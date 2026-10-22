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
